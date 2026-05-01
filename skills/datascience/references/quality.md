# RAG Quality Engineering — fasen, metrics, A/B-design

Deze reference begeleidt het uitvoeren van het [Project — RAG Quality Engineering](https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/415137797). De 7 fasen staan daar; hier diepe-uitleg per fase + concrete SQL/code voor elk.

## F.1 — Baseline-meting (HARD VOORWAARDE)

Doel: voor je iets verbetert, weet je waar je begint. Zonder pre-meting is post-meting waardeloos.

### Setup

```sql
CREATE TABLE IF NOT EXISTS rag_quality_baselines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_run_id text NOT NULL,                    -- 'baseline-2026-04-29' / 'mmr-v1' etc.
  autodraft_mail_id uuid REFERENCES autodraft_mails(id),
  variant text NOT NULL CHECK (variant IN ('with_rag','without_rag','mmr','recency','full_quality')),
  draft_body text,                                    -- de gegenereerde draft
  rag_context_snapshot jsonb,                         -- welke matches werden meegestuurd
  token_input integer,                                -- prompt-tokens
  token_output integer,                               -- response-tokens
  latency_ms integer,
  reviewer_decision text,                             -- 'accept' | 'reject' | 'amend'
  reviewer_notes text,
  reviewer_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rag_baselines_run ON rag_quality_baselines(experiment_run_id, variant);
```

### Sampling

```sql
-- 20 mails: 10 met sterke rag_context (avg_top_sim > 0.85), 10 met zwakke (< 0.7)
WITH ranked AS (
  SELECT id, mail_id, subject,
         (rag_context->'matches'->0->>'similarity')::numeric AS top_sim
    FROM autodraft_mails
   WHERE rag_context IS NOT NULL
     AND status = 'pending'
     AND scanned_at >= now() - interval '14 days'
)
SELECT id, mail_id, subject, top_sim
  FROM ranked
 WHERE top_sim > 0.85
 ORDER BY random()
 LIMIT 10
UNION ALL
SELECT id, mail_id, subject, top_sim
  FROM ranked
 WHERE top_sim < 0.70
 ORDER BY random()
 LIMIT 10;
```

### Run-protocol (per mail)

1. Genereer draft 2× via Claude API:
   - **with_rag**: prompt = systeem + originele mail + `rag_context.matches[]` als context-block
   - **without_rag**: prompt = systeem + originele mail (geen context)
2. Schrijf beide naar `rag_quality_baselines` met dezelfde `experiment_run_id`
3. Review-flow: dashboard-pagina toont side-by-side, Jelle klikt accept/reject/amend per variant
4. Aggregeer:

```sql
SELECT variant,
       count(*) AS n,
       count(*) FILTER (WHERE reviewer_decision = 'accept') AS accepted,
       round(avg(token_input)::numeric, 0)  AS avg_input_tokens,
       round(avg(latency_ms)::numeric, 0)   AS avg_latency
  FROM rag_quality_baselines
 WHERE experiment_run_id = 'baseline-2026-04-29'
 GROUP BY variant;
```

Verwacht eindrapport: `with_rag` verslaat `without_rag` op acceptance-rate, kost iets meer tokens. Verschil in absolute tokens × prijs = cost-per-extra-acceptable-draft.

## F.2 — MMR Re-ranking

Zie `references/retrieval.md` § "Top-5 zijn 5× dezelfde thread". Hier de implementatie-PL/pgSQL skelet:

```sql
CREATE OR REPLACE FUNCTION match_all_sources_mmr(
  query_embedding vector,
  top_k integer DEFAULT 5,
  mmr_lambda float DEFAULT 0.5,
  -- ... overige filter-params
  candidate_pool_multiplier integer DEFAULT 5
) RETURNS TABLE(...) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_pool_size integer := top_k * candidate_pool_multiplier;
  v_candidates jsonb;
  v_selected jsonb := '[]'::jsonb;
  v_chosen_indices integer[] := ARRAY[]::integer[];
BEGIN
  -- 1. Trek candidate pool (zoals match_all_sources nu doet, maar NIET filteren op min_similarity)
  WITH pooled AS (
    SELECT * FROM match_all_sources(query_embedding, v_pool_size, ..., 0.0)
  )
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.similarity DESC) INTO v_candidates FROM pooled p;

  -- 2. Greedy MMR: top_k iterations
  FOR i IN 1..top_k LOOP
    -- Bereken combined score voor elke remaining candidate
    -- score = lambda * similarity_to_query - (1-lambda) * max(similarity_to_selected)
    -- Voor "similarity_to_selected" hebben we de embeddings nodig — oof, die staan niet in de output
    -- ... vereist join terug naar source-tabel om embedding op te halen
  END LOOP;

  RETURN QUERY SELECT ...;
END $$;
```

**Belangrijk obstakel:** match_all_sources output bevat geen embeddings. Voor MMR moet je de embeddings ophalen via `id` per source. Twee opties:
- Optie 1: nieuwe RPC die embeddings includeert (`vector` kolom in TABLE return — werkt in PG 15+)
- Optie 2: client-side MMR in de Edge Function `autodraft-rag-prefill` — daar embedding van de query al beschikbaar, en je doet het tóch maar 1× per draft

**Optie 2 is praktischer**. Geef de prefill-function ruwe embeddings mee, doe MMR in TypeScript:

```typescript
function mmrRerank(
  candidates: Match[],
  queryEmbedding: number[],
  topK: number,
  lambda: number
): Match[] {
  const selected: Match[] = [];
  const remaining = [...candidates];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      const simToQuery = c.similarity;
      const simToSelected = selected.length === 0
        ? 0
        : Math.max(...selected.map(s => cosineSim(c.embedding!, s.embedding!)));
      const score = lambda * simToQuery - (1 - lambda) * simToSelected;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}
```

## F.3 — Recency-bias

Implementatie zit straks in `match_all_sources(recency_weight, recency_decay_days)`. Zie `references/retrieval.md` § Recente match.

Ijking-vraag: welke decay? Voor advocatenkantoor-context is **90 dagen halfwaarde** redelijk (een offerte van 3 maanden geleden is nog half-relevant). Voor sales-pipeline misschien 30 dagen.

Per skill kunnen verschillende defaults: AutoDraft prefill gebruikt 90 dagen, sales-followups 30.

## F.4 — Citation-format

Output van `match_all_sources` krijgt extra veld `citation text`:

```sql
-- In de SELECT van elke CTE:
'mail' = source: 'mail van ' || coalesce(from_label, 'onbekend') || ' op ' || to_char(occurred_at, 'DD-Mon-YYYY')
'jira' = source: 'Jira ' || id || ' (' || meta->>'status' || ')'
'deal' = source: 'Deal ' || subject || ' (' || meta->>'stage' || ')'
'engagement' = source: meta->>'engagement_type' || ' van ' || coalesce(from_label, 'HubSpot')
'company' = source: 'Bedrijf ' || subject
'contact' = source: 'Contact ' || subject || coalesce(', ' || from_label, '')
```

Skill plakt dit dan inline in de draft als markdown-footnote of inline-quote:
- `> Eerder besproken: [mail van Veerle, 12 maart] — "kunnen we volgende week..."`

## F.5 — Skill-update (cowork-plugin)

Cowork plugin update vereist re-approval per skill. Coördineer met `agent-manager`. Volgorde:
1. `auto-draft` als eerste — meest impact, makkelijkst te meten
2. `daily-admin` — gebruikt RAG voor categorie-keuze
3. `sales-followups` — gebruikt RAG voor follow-up tone

Per skill: in skill-prompt sectie toevoegen:
```
## RAG-context

Lees `autodraft_mails.rag_context.matches[]` (jsonb) voordat je drafted. Voor elke match met similarity >= 0.6:
- Subject + preview kort citeren in een denkstap
- Tone matchen aan eerder

Format de citaties zoals het `citation` veld zegt.
```

## F.6 — A/B-eindmeting

Repeat F.1 protocol op 30 mails. Variants:
- `without_rag` (control)
- `full_quality` (MMR + recency + citation, all features on)

Compare:
- Acceptance-rate (% accept)
- Cost-per-acceptable-draft = total tokens / accepted count

**Go/no-go criterion**: acceptance-rate-uplift moet >5 percentage-punten zijn én cost-per-acceptable-draft moet niet >50% gestegen zijn.

## F.7 — Negative-example loop (optioneel)

Wanneer `autodraft_decisions(action='amend')`: schrijf de meegestuurde `rag_context.matches[]` naar `rag_negative_examples`. Use case:
- Per match een counter-example flag → kan retrieval-tuning informeren ("matches met deze company-id leiden vaak tot amend = filter strakker")
- Toekomstig: fine-tuning data voor custom embedding-model (out of scope nu)

```sql
CREATE TABLE rag_negative_examples (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  autodraft_decision_id uuid,
  match_source text,
  match_id text,
  match_similarity numeric,
  reason text,
  created_at timestamptz DEFAULT now()
);

-- Insert via trigger op autodraft_decisions
CREATE OR REPLACE FUNCTION log_amend_rag_neg() RETURNS trigger AS $$
BEGIN
  IF NEW.action = 'amend' THEN
    INSERT INTO rag_negative_examples (autodraft_decision_id, match_source, match_id, match_similarity)
    SELECT NEW.id, m->>'source', m->>'id', (m->>'similarity')::numeric
      FROM jsonb_array_elements(
        (SELECT rag_context->'matches' FROM autodraft_mails WHERE id = NEW.autodraft_mail_id)
      ) m;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

## Metrics-glossarium

| Metric | Hoe meten | Doel |
|---|---|---|
| **Acceptance-rate** | `count(accept) / count(*)` per variant | Primary success-metric |
| **Amend-rate** | `count(amend) / count(*)` | Secondary — minder amends = betere first-shot |
| **Avg top-similarity** | `avg(matches[0].similarity)` | Embedding-quality proxy |
| **Diversity-score** | `1 - avg pairwise sim within top-K` | MMR-effectiviteit |
| **Cost-per-acceptable-draft** | `total_tokens × prijs / accept_count` | ROI-metric |
| **First-token latency** | Time-to-first-byte op LLM-call | UX-metric (niet kritisch voor scheduled skills) |
