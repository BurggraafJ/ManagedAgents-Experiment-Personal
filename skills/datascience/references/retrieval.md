# Retrieval — `match_all_sources` deep-dive en tuning

## RPC-signatuur (huidige stand v2)

```sql
match_all_sources(
  query_embedding vector,
  top_k integer DEFAULT 5,
  filter_sources text[] DEFAULT NULL,            -- ['mail','engagement','jira','deal','company','contact']
  filter_after timestamptz DEFAULT NULL,
  filter_from_domain text DEFAULT NULL,
  filter_engagement_type text DEFAULT NULL,
  filter_owner_id text DEFAULT NULL,
  filter_company_id text DEFAULT NULL,
  filter_project_key text DEFAULT NULL,
  min_similarity double precision DEFAULT 0.3
) RETURNS TABLE(source, id, subject, preview, occurred_at, from_label, meta jsonb, similarity)
```

## Hoe de SQL onder de motorkap werkt

1. **6 CTE's** (één per source) — elk pakt `top_k * 5` candidates via HNSW index, geordend op embedding-distance.
2. Filters per CTE volledig pushed-down (niet post-filter).
3. UNION ALL alle CTE's, filter `WHERE similarity >= min_similarity`, daarna `ORDER BY similarity DESC LIMIT top_k`.

**Cruciaal:** `top_k * 5` is het candidates-budget per source. Als je 30 mails wil maar top_k=5 zet, krijg je er maximaal 5 (+5 in totaal mix). Wil je breder zoeken? Pak top_k=15 → tot 75 candidates per source.

## Tuning per probleem-pattern

### "Mijn zoekopdracht geeft te weinig resultaten"

Diagnose-volgorde:

| Stap | Check | Fix |
|---|---|---|
| 1 | Is de query >2 woorden? | Single-word queries werken sub-optimaal. Embeddings dragen context — adviseer "wat besprak ik met X over Y" boven "demo" |
| 2 | `min_similarity` te hoog? | Default 0.3 is laag genoeg voor de meeste cases. Onder 0.2 wordt het ruis. |
| 3 | Filter-after te restrictief? | Test zonder `filter_after`. 12 maanden is gangbare range. |
| 4 | `filter_sources` per ongeluk leeg? | NULL betekent ALLE sources. Lege array `ARRAY[]` betekent NIETS — let op typo's. |
| 5 | Embedding gemaakt op zelfde tekst? | Self-similarity test: pak een random row, embed hetzelfde, verwacht similarity 1.000 |

### "Top-5 zijn 5× dezelfde thread"

Dit is de **MMR-issue** — Maximum Marginal Relevance niet geïmplementeerd. Geplande oplossing in F.2 van RAG Quality Engineering project:

```
score(c) = λ · sim(c, query) - (1-λ) · max_j sim(c, selected_j)
```

Greedy: pak hoogste similarity, vervolgens kandidaten die zowel relevant zijn ALS verschillen van al gekozen. λ=0.5 is balanced, λ=0.7 meer similarity-gewicht.

In PL/pgSQL implementatie:

```sql
CREATE OR REPLACE FUNCTION match_all_sources_mmr(
  query_embedding vector, top_k int, mmr_lambda float DEFAULT 0.5, ...
) ... AS $$
DECLARE
  v_selected jsonb := '[]'::jsonb;
  v_remaining record[];
BEGIN
  -- 1. Trek top_k * 5 candidates per source (zoals nu)
  -- 2. Greedy loop top_k iterations:
  --    a. Voor elke remaining: bereken combined score
  --    b. Pak hoogste, voeg toe aan selected
  --    c. Update remaining
END
$$ LANGUAGE plpgsql;
```

Performance-overweging: MMR vereist `selected_j` similarity-pairs te berekenen. Bij top_k=5 en 30 candidates = 150 cosine-distance-computes. Voor pgvector is dat <50ms.

### "Recente match staat niet bovenaan"

Recency-bias is **niet ingebouwd**. Workaround nu: filter `filter_after = now() - interval '30 days'` en accepteer dat oude matches verloren zijn.

Geplande fix (F.3 van RAG Quality Engineering):

```sql
CREATE OR REPLACE FUNCTION match_all_sources(
  ...,
  recency_weight float DEFAULT 0.0,    -- 0 = pure similarity, 1 = pure recency
  recency_decay_days int DEFAULT 90    -- exp(-age / decay)
)
...
SELECT
  ...,
  (1 - recency_weight) * (1 - (m.embedding <=> query_embedding))
  + recency_weight * exp(-extract(epoch from (now() - m.received_at)) / 86400 / recency_decay_days)
  AS combined_score
FROM mail_messages m
ORDER BY combined_score DESC
```

Aandachtspunt: HNSW-index is op cosine-distance, niet op combined score. Recency-weighted ordering kan niet via index — pull top_k×5 op pure similarity, re-rank in CTE.

### "Cross-source zoeken werkt niet zoals verwacht"

Bij `filter_sources=NULL` worden alle 6 CTE's geëvalueerd, **elk op zichzelf**. Dat geeft fair-mix. Maar bij top_k=5 betekent dat soms: 3 mails + 2 engagements + 0 jira (omdat jira-similarity te laag was).

Voor **forced-mix** (bv. minimaal 1 deal): meerdere RPC-calls met `filter_sources=['deal']` en `filter_sources=['mail','engagement']`, daarna client-side mergen. Of nieuwe RPC `match_all_sources_balanced(per_source_min int)`.

## min_similarity strategieën

| Strategie | Wanneer | Voorbeeld |
|---|---|---|
| **Vaste threshold (huidig)** | Algemeen gebruik | `min_similarity = 0.3` |
| **Adaptief op distributie** | Korte queries waar je geen vaste cutoff weet | Pak top_k=20, return alleen wie `> avg(sim) - 1·stddev(sim)`. Te bouwen in een wrapper-RPC. |
| **Per-source threshold** | Quality-verschillen tussen sources | Mails 0.5 (veel ruis), Jira 0.3 (lager volume = lagere baseline) |
| **Geen threshold** | Debug / exploratie | `min_similarity = 0.0` — toont distributie |

## Performance — wat je kunt verwachten

Op huidige database (~19k embeddings):

| Query-type | Latency |
|---|---|
| `match_all_sources` zonder filters, top_k=5 | ~30-80ms RPC + ~250-350ms embed |
| `match_all_sources` met `filter_after` (12 mnd) | ~40-100ms |
| `match_all_sources` met `filter_company_id` | ~20-60ms (kleinere set) |
| Single-source (filter_sources=['mail']) | ~25-50ms |

Bij 100k+ embeddings overweegt:
- HNSW `ef_search` parameter omhoog (default 40 → 80) voor betere recall
- IVFFlat als alternatief — sneller bij massa, lagere recall

## Smoke-test queries

```sql
-- Self-similarity (sanity check pipeline)
WITH probe AS (
  SELECT embedding FROM mail_messages
   WHERE embedding IS NOT NULL
   ORDER BY received_at DESC LIMIT 1
)
SELECT source, subject, similarity::numeric(5,4)
  FROM match_all_sources((SELECT embedding FROM probe), 5);
-- Verwacht: top1 = same row, similarity 1.0000

-- Distribution check (voor threshold-tuning)
WITH probe AS (
  SELECT embedding FROM mail_messages
   WHERE subject ILIKE '%kennismaking%' LIMIT 1
)
SELECT source, similarity::numeric(5,4),
       count(*) OVER () AS total
  FROM match_all_sources(
    (SELECT embedding FROM probe), 50, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.0
  )
ORDER BY similarity DESC;
```

## Antipatronen

- **Single-word query embedden + verwachten dat het werkt**. Embeddings dragen context — leeg context = ambigu. Educatie in UI: prompt-hint.
- **Embedding "demo" en filter `filter_company_id`**. Combineer geen vage queries met scherpe filters. Of vague + breed, of specifiek + smal.
- **min_similarity > 0.7 als default**. Boven 0.7 vind je vrijwel alleen exacte matches. Voor RAG-context wil je 0.3-0.5 range.
- **`top_k = 50` "voor de zekerheid"**. Meer matches = meer ruis voor downstream-skills. Top 5-10 met goede MMR > top 50 zonder.
