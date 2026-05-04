# Current Architecture — RAG, Embeddings & Intelligence Layer

> **Levend document.** Dit is de single source of truth voor hoe Legal Mind's
> data-science / RAG-stack op dit moment in elkaar zit, waar de zwakheden
> zitten, en welke kant we op willen. **Iedere keer dat een skill of edge
> function de architectuur raakt, hoort dit bestand mee bijgewerkt te worden.**
>
> | Veld | Waarde |
> |---|---|
> | Owner | `datascience` skill (architectuur) — `agent-manager` (orkestratie) — `dashboard-refresh` (frontend Intelligence Hub) |
> | Laatste audit | 2026-05-03 |
> | Volgende geplande audit | bij eerstvolgende architectuur-wijziging — invariant uit §13.3 |
> | Confluence-tegenhangers | Deel 1 (id [421920819](https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/421920819)) — _Onze hersenen, hoe ze werken en hoe ze beter gaan werken_; Deel 2 (id [422969345](https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/422969345)) — _chaos, leren en geheugen voor de toekomst_ |
> | Update-trigger | nieuwe edge function · nieuwe RPC · nieuwe consumer-skill · schema-wijziging op embedding-tabel · nieuwe intent · nieuwe bron-type (zoals telefoonrecorder) · architectuurprincipe-wijziging |

---

## 0. Hoe dit document te lezen

Dit document beantwoordt vier vragen, in volgorde:

1. **Wat staat er nu?** (sectie 1-3) — feiten, geen wensen.
2. **Waar wringt het?** (sectie 4) — eerlijke kritiek op wat we hebben gebouwd.
3. **Welke principes leiden de volgende stappen?** (sectie 5) — beslissingen die we hebben genomen of nog moeten nemen.
4. **Hoe ziet de doelarchitectuur eruit en hoe komen we daar?** (sectie 6-8).

Als je deze skill triggert via een vraag als "moeten we Vector RAG vervangen", lees eerst sectie 4 + 5. Als de vraag is "hoe werkt onze pipeline", begin bij sectie 1.

---

## 1. De stack op één pagina

```
                                Legal Mind — Intelligence Stack (2026-05)
─────────────────────────────────────────────────────────────────────────────────────────
Laag           │ Wie/Wat                                                     │ Status
─────────────────────────────────────────────────────────────────────────────────────────
1 Sync         │ mail-sync-etl-v2 (Outlook → mail_messages)                  │ live
               │ outlook-calendar-sync-etl (Graph → calendar_events)         │ live (niet in repo)
               │ hubspot-sync-etl (deals/contacts/companies/engagements)     │ live
               │ jira-sync-etl                                               │ live
               │ task-organizer-fireflies (action-items, geen mirror)        │ live
               │ fireflies-sync skill (MCP, Fireflies → fireflies_meetings)  │ skill, geen edge fn
2 Storage      │ 8 truth-of-source tabellen + autodraft_*, agent_*, tasks_*  │ live (~18.764+ embed)
3 Embed        │ mail-embed v2.1 (cron */2, alle 8 tabellen)                 │ live (niet in repo)
               │ jellemind-embed (cron */30, alleen jellemind_lessons)       │ live, in repo
4 Index        │ HNSW per tabel (cosine, 1536 dim)                           │ live
5 Retrieve     │ match_all_sources(...) v2 RPC                               │ live (niet in migrations)
               │ sync_health / sync_health_all RPC's                         │ live
               │ Per-source legacy (match_mails, match_jellemind_lessons)    │ deels gedrop't
6 Pre-compute  │ autodraft-rag-prefill (cron */3, schrijft rag_context jsonb)│ live (niet in repo)
7 Consume      │ rag-search edge fn → RagSearchView (zoekpagina)             │ live
               │ jellemind skill (leest jellemind_lessons via vector-RPC)    │ live
               │ auto-draft skill (zou rag_context moeten lezen — DOET HET NIET) │ ⚠ gat
               │ daily-admin / sales-on-road / sales-followups               │ ⚠ gebruiken eigen SQL, geen RAG
8 Quality      │ rag_quality_baselines tabel                                 │ ✗ niet bestaand
               │ MMR / recency / citation / negative-loop                    │ ✗ niet geïmplementeerd
               │ A/B-meetraamwerk                                            │ ✗ niet geïmplementeerd
─────────────────────────────────────────────────────────────────────────────────────────
```

Eén-zin-samenvatting: **de pijplijn is af, de consumptie niet, en de
kwaliteitslus ontbreekt volledig.**

---

## 2. Wat er feitelijk staat (per laag)

### 2.1 Sync — truth-of-source mirrors

| Bron | Tabel | Hoe gevuld | Cadance | Embedding-kandidaat? |
|---|---|---|---|---|
| Outlook mail | `mail_messages` | mail-sync-etl-v2 (Composio) | 15 min | ✅ ja |
| Outlook agenda | `calendar_events`, `calendar_attendees` | outlook-calendar-sync-etl | 15-30 min | ✅ ja (alleen events) |
| HubSpot deals | `hubspot_deals` | hubspot-sync-etl | 1u | ✅ ja |
| HubSpot companies | `hubspot_companies` | hubspot-sync-etl | 1u | ✅ ja |
| HubSpot contacts | `hubspot_contacts` | hubspot-sync-etl | 1u | ✅ ja |
| HubSpot engagements | `hubspot_engagements` | hubspot-sync-etl | 1u | ✅ ja |
| Jira issues | `jira_issues` | jira-sync-etl | 1u | ✅ ja |
| Fireflies meetings | `fireflies_meetings` | `fireflies-sync` skill (geen edge fn) | dagelijks | ✅ ja |
| Jellemind lessons | `jellemind_lessons` | gemaakt via `submit_jellemind_decision` | event-based | ✅ ja |

**Schema-onhandigheden**:
- Tijdstempel-namen lopen uiteen (`received_at`, `created_at`, `start_time`, `occurred_at`). `match_all_sources` mapt ze naar één `occurred_at` in de output.
- `embedding_input_hash` staat per source consistent — goed.
- `embedded_at` ontbreekt op `legal_ai_findings` (gevoeligheid voor model-upgrade).

### 2.2 Storage — embedding-kolommen

Alle 8 truth-of-source tabellen hebben:
```sql
embedding              vector(1536)        -- text-embedding-3-small
embedded_at            timestamptz
embedding_model        text
embedding_input_hash   text                -- sha256 van buildInput-output
```

Plus per tabel een HNSW-index (`USING hnsw (embedding vector_cosine_ops)`).

### 2.3 Embed — pipeline

**`mail-embed` (de centrale embedder, ondanks de naam):**
- Round-robin over alle 8 tabellen, één batch van 100 per cron-tick.
- Per source een eigen `buildInput()` die de embed-tekst opmaakt (zie `embeddings.md`).
- Hash-dedup: input-tekst gelijk → hash gelijk → skip.
- HTML-strip vóór embed (`stripHtml()` + server-side `strip_html_inline()` RPC).
- Truncate op `MAX_INPUT_CHARS = 8000` (~2k tokens).
- Wall-time bewust onder 90s (Edge Function-limiet).
- Errors gelogd in `agent_runs.errors[]`.

**`jellemind-embed` (apart, in repo):**
- Alleen voor `jellemind_lessons`. Kleinere batch, kleinere cadans.
- Reden voor afsplitsing: lessen zijn user-curated en mogen niet wachten in een gedeelde queue.

### 2.4 Index — HNSW

Eén HNSW-index per embedding-tabel, cosine ops.
Defaults: `m=16, ef_construction=64`. `ef_search` standaard 40.
Bij ~20k vectoren is dit ruim voldoende; recall-gevoeligheid komt pas in zicht boven ~100k.

### 2.5 Retrieve — RPC's

**`match_all_sources(query_embedding, top_k, filter_*, min_similarity)`** — de centrale RAG-RPC.
- 8 CTE's (één per source), elk pakt `top_k * 5` candidates.
- UNION ALL + filter `>= min_similarity` + sort + LIMIT.
- Output: `(source, id, subject, preview, occurred_at, from_label, meta jsonb, similarity)`.
- Geen MMR, geen recency-bias, geen citation-tekst, geen embedding in output.

**`sync_health(source)` / `sync_health_all()`** — freshness-check.
- Voor mail/calendar/fireflies: `max(received_at)` of `max(start_time)`.
- Voor HubSpot/Jira: `last_delta_sync` uit hun sync_state-tabel (ronde-fix bij delta-runs zonder wijzigingen).
- Voor embedding: `min(embedded_at) WHERE embedding IS NULL` zou verkeerd zijn — gebruikt `count(*) WHERE embedding IS NULL` als backlog-meter.

### 2.6 Pre-compute — `autodraft-rag-prefill`

Live edge function, niet in repo (!).
- Cron: */3 min werkuren.
- Pakt elke nieuwe rij in `autodraft_mails` waar `rag_context IS NULL`.
- Embedt de mail (zelfde model als opslag).
- Roept `match_all_sources` aan met `filter_after = received_at - 12 maanden` en `top_k = 8`.
- Schrijft `{ generated_at, query_summary, matches[] }` naar `autodraft_mails.rag_context jsonb`.

### 2.7 Consume — wie leest er werkelijk RAG-context?

| Skill / Frontend | Roept aan | Leest pre-computed `rag_context`? | Bouwt eigen historie-query? |
|---|---|---|---|
| `RagSearchView` (zoekpagina) | `rag-search` edge fn → `match_all_sources` | n.v.t. (live query) | nee |
| `auto-draft` | — | **NEE** (gat — F.5 niet uitgevoerd) | ja, via mail_messages thread-lookup |
| `auto-draft-execute` | — | nee | nee (gebruikt amend_instructions) |
| `daily-admin` | — | nee | ja, eigen 14d mail-window |
| `sales-on-road` | — | nee | ja, 90d mail-window |
| `sales-followups` | — | nee | ja, deal-stage + last-respons SQL |
| `jellemind` | `match_jellemind_lessons` (vector-RPC) | nee | nee, leest direct lessons |
| `task-organizer` | — | nee | gebruikt `pg_trgm`, geen embeddings |
| `agenda` | — | nee | leest calendar + voice-notes direct |

**Patroon**: één pre-compute-pijplijn die niemand consumeert (auto-draft), en
zes skills die elk hun eigen ad-hoc historie-SQL schrijven. Dit is de grootste
inefficiëntie van het systeem.

### 2.8 Quality — afwezig

- `rag_quality_baselines` — bestaat niet.
- `rag_negative_examples` — bestaat niet.
- `rag_outcomes` (acceptance per chunk) — bestaat niet.
- A/B-framework — niet ingericht.
- Acceptance-rate-dashboards — niet aanwezig.
- Model-versie-tracking — `embedding_model` kolom bestaat, maar wordt niet gebruikt voor regressie-detectie.

---

## 3. Externe interfaces

### 3.1 Frontend `RagSearchView`
- Source-chips (8 toggles) — gebruiker kiest combinatie.
- Date-preset (all/12m/6m/3m/1m).
- min_similarity slider (0.2-0.9), default 0.3.
- top_k select (5/10/15/25/50), default 15.
- Geen feedback-loop ("dit was nuttig"-knop ontbreekt).
- Geen filter op entiteit (`filter_company_id`) — terwijl die filter in de RPC bestaat.

### 3.2 Skill ↔ Pipeline contract
Op dit moment **ongeschreven**. Geen schema-validatie op `rag_context` jsonb.
Geen contract-test tussen `autodraft-rag-prefill` en `auto-draft`.

---

## 4. Eerlijke kritiek — wat klopt niet

### 4.1 Architectuurprobleem: skills doen pipeline-werk

Iedere skill bouwt zijn eigen "wat weten we over deze persoon/deal":
- `auto-draft` Stap 5b: thread-context-query
- `daily-admin` Stap 1: mail-state-window
- `sales-on-road` Stap 4: 90-dagen email-historie
- `sales-followups` Stap 3: respons-check via `MAX(received_at)`

Dit is **datawerk in de generatie-laag**. Het hoort één laag dieper.
Skills zouden _alleen_ moeten beschrijven _hoe_ context wordt gepresenteerd
in een prompt — niet _hoe_ context wordt opgehaald.

### 4.2 De pre-compute is verspilde compute

`autodraft-rag-prefill` draait elke 3 minuten. Schrijft `rag_context` naar
elke nieuwe `autodraft_mails`-rij. Dat kost embed-calls (€) en query-tijd.
**Niemand leest het.** De auto-draft SKILL.md beschrijft `rag_context`
nergens. F.5 in het RAG Quality Engineering plan zou dit oplossen, maar
F.1-F.7 zijn geen van allen uitgevoerd.

Dit is precies de soort gat die _alleen_ kan ontstaan als pipeline en
consumenten niet via een hard contract aan elkaar zitten.

### 4.3 Chunking is "1 record = 1 vector"

Elke mail is één embedding, ongeacht of de mail 50 of 5000 woorden is.
Een lange offerte-thread van 8 messages krijgt één vector — alle nuance
gemiddeld weg. Een Fireflies-meeting van 90 minuten ook.

Gevolg:
- Lange documenten zijn slecht doorzoekbaar (signal averaging).
- Topic-shifts binnen een meeting zijn onzichtbaar.
- Korte updates en lange threads concurreren oneerlijk om de top-K plek.

### 4.4 Geen contextual augmentation

Volgens [Anthropic's Contextual Retrieval-paper](https://www.anthropic.com/news/contextual-retrieval)
geeft een korte gegenereerde context-prefix per chunk 35-49% recall-boost.
Wij doen dat niet. Onze chunks zijn naakte tekst — geen "deze mail kwam in
sales-pipeline-fase X met klant Y".

### 4.5 Geen reranking

Top-K komt direct uit HNSW-similarity. Geen LLM-rerank, geen MMR, geen
recency-bias. Dus:
- Top-5 kan 5× dezelfde thread zijn.
- Een offerte uit 2024 kan een offerte van vorige week verslaan.
- Marketing-mails van een gevoelig domein kunnen consequent "lijken op"
  echte klantmails.

### 4.6 Geen entity-laag

`match_all_sources` heeft `filter_company_id` en `filter_owner_id`, maar
die werken alleen op velden die _exact_ deze id-strings dragen (HubSpot
heeft een company_id, mails meestal niet). Er is geen tabel die zegt
"deze mail @ jansen.com hoort bij company_id 42 én contact_id 17 én staan
onder Jan Jansen, partner bij firm 9".

Gevolg: cross-source vragen ("alles over Veerle Branderhorst") zijn
slecht beantwoordbaar. Je bent afhankelijk van similarity-magie.

### 4.7 Geen feedback-loop

Als Jelle een draft amend't of weggooit, is dat _signaal_. Welke chunks
zaten erin? Wat heeft hij weggehaald? Wat heeft hij toegevoegd? Niets
hiervan wordt gelogd in een leerlus. We accumuleren feedback in
`autodraft_decisions` en `jellemind_lessons` — maar niet aan de RAG-kant.

### 4.8 Edge functions buiten versie-controle

`mail-embed`, `autodraft-rag-prefill`, `rag-search`, `outlook-calendar-sync-etl`
draaien live op Supabase maar zitten **niet in deze repo**. Dat betekent:
- Geen code-review op wijzigingen.
- Geen rollback-pad.
- Geen CI voor deze functies.
- Skills kunnen ze beschrijven, maar niet redeneren over hun werkelijke gedrag.

### 4.9 Documentatie-fictie

Confluence (zie de `Mail Backfill + Vector RAG`-pagina, id `413302794`)
zegt Fase 3 (Documentatie) is afgerond. Maar de sub-pagina staat nog op
"Pending" en de geplande runbook-pagina's bestaan niet. Twee parallelle
projecten claimen ownership van quality-werk: `RAG Quality Engineering`
(415137797) en `Intelligence Engineering` (422084620, claimt absorptie).

### 4.10 Datascience-skill is theoretisch

De vier playbooks (embeddings, retrieval, quality, graphrag) zijn goed
geschreven maar grotendeels **roadmap, niet handleiding**. F.1-F.7 staan
als "moet nog". De skill leest als een planningsdocument vermomd als
referentie.

---

## 5. Ontwerpprincipes voor de evolutie

Deze principes vervangen het bestaande, gefragmenteerde plan
(Mail-Backfill-fasen, RAG Quality Engineering, Intelligence Engineering).
Ze zijn de basis voor alle volgende keuzes.

### Principe 1 — Pipelines zijn functions, geen skills

Alles wat **deterministisch en data-zwaar** is hoort in een edge function
(of database-RPC), niet in een Claude-skill:

- Data sync (extract, normalize, dedup).
- Chunking (per source-type een eigen strategie).
- Embedding (incl. contextual augmentation).
- Indexing (HNSW + BM25-fallback).
- Retrieval (hybrid, gerankt, gefilterd).
- Context-bundling (pre-compute per use-case).

Skills zijn alléén voor **taal en oordeel**:

- Een draft schrijven gegeven een context-bundel.
- Een mail categoriseren gegeven categorieën + voorbeelden.
- Een proposal formuleren gegeven brongegevens.
- Een follow-up beslissing motiveren.

> **Concreet**: de huidige overlap waarin elke skill zijn eigen mail-historie-query
> heeft, hoort weg. Eén edge function bouwt de bundel; de skill consumeert hem.

### Principe 2 — Context-as-a-Service (CaaS)

Eén centraal endpoint `context-build` (edge function + RPC):

```
POST /context-build
{
  trigger: { type: 'mail_received' | 'voice_note' | 'deal_update' | 'meeting_ended' | 'manual',
             ref_id: string },
  intent:  'draft_reply' | 'classify' | 'extract_actions' | 'enrich_record' | 'search',
  audience: 'auto-draft' | 'sales-on-road' | 'daily-admin' | 'agenda' | ... ,
  options: { lookback_days?: int, top_k?: int, min_similarity?: float, include_entities?: bool }
}
→
{
  primary:    { source, id, content, metadata },
  thread:     [ ... ],                       // mails/messages in same conversation
  related:    [ { source, id, similarity, recency_score, citation, ... } ],
  entities:   { contacts: [...], firms: [...], deals: [...], jira_keys: [...] },
  history:    { last_meeting?, last_engagement?, open_proposals?, ... },
  knowledge:  { applicable_lessons: [...], applicable_styles: [...], category_hint: ... },
  freshness:  { mail: 'fresh', hubspot: 'stale-23m', ... },
  meta:       { total_ms, retrieval_strategy, model, version }
}
```

Eigenschappen:
- **Idempotent**: zelfde trigger + intent + audience = zelfde bundle (caching mogelijk).
- **Auditable**: elke bundle krijgt een `bundle_id` en wordt opgeslagen in
  `context_bundles` tabel. Skills citeren de `bundle_id` in hun output zodat
  reviewer kan terugkijken welke context werd gebruikt.
- **Versioned**: bundle-schema heeft `schema_version`. Skill controleert
  compatibiliteit voordat hij hem leest.

### Principe 3 — Adaptive chunking per source-type

| Source | Chunk-strategie |
|---|---|
| Mail thread | 1 thread-bundle chunk (chronologie) + 1 chunk per message (≥50 woorden) |
| Fireflies meeting | Topic-segmenten op basis van transcript-structuur (sentence-windows met topic-shift detection) |
| HubSpot deal | Master-chunk (deal-info) + per-engagement chunk + per-stage-change chunk |
| Confluence/Jira | Hierarchical: page > section > paragraph; elk chunk met breadcrumb-prefix |
| Calendar event | Event-chunk + per-attendee-context-chunk (alleen als event >30 min) |
| Korte mail (<50 woorden) | Geen sub-chunks — record zelf is de chunk |

**Plus**: contextual augmentation. Elke chunk krijgt een 50-100 token prefix
(LLM-gegenereerd) die het in context plaatst. Voorbeeld voor een mail-chunk:

> _"Deze message uit een mail-thread tussen Jelle en Veerle Branderhorst (advocate
> bij Houthoff), op 12 maart 2026, in een sales-pipeline-conversatie over een
> proefperiode bij hun kantoor."_ — gevolgd door de chunk-tekst.

Eénmalig kosten: ~€0.02 per chunk (Haiku, 100 tokens prefix). Op 20k chunks =
~€400. Eenmalig.

### Principe 4 — Hybrid retrieval, niet alleen vector

Pijpllijn:
1. **Stage A — keyword pre-filter** (PostgreSQL FTS): top 200 op BM25.
2. **Stage B — vector recall**: HNSW-search, top 50.
3. **Stage C — fusion** (Reciprocal Rank Fusion): merge stage A + B → top 30.
4. **Stage D — recency boost**: `combined_score = 0.85 × similarity + 0.15 × recency_decay`.
5. **Stage E — MMR diversity rerank**: top 15 met λ=0.6.
6. **Stage F — LLM-rerank op top 15** (Haiku, ~50ms, ~$0.0001 per query): top 5.
7. **Stage G — citation-format**: elk resultaat krijgt human-readable citation.

Ondersteunende voordelen:
- BM25 vangt named entities en woordelijke citaten waar embeddings flou worden.
- LLM-rerank is bewust minimaal — alleen top 15 door Haiku, geen Sonnet/Opus.
- MMR voorkomt 5× zelfde thread.

### Principe 5 — Entity-laag (graph-light)

Bouw op bestaande FK-velden, niet vanuit nul:

```sql
CREATE VIEW v_entities AS
  SELECT 'contact' AS type, contact_id AS id, email AS canonical, ...
  UNION ALL ...

CREATE VIEW v_entity_edges AS
  SELECT 'mail',  m.id, 'contact', c.id, 'authored_by'
   FROM mail_messages m JOIN hubspot_contacts c ON c.email = m.from_email
  UNION ALL
  SELECT 'engagement', e.id, 'deal', d, 'about'
   FROM hubspot_engagements e, unnest(e.associated_deal_ids) d
  UNION ALL ...;
```

Plus:
- `entity_resolution` tabel die aliassen mapt (vBranderhorst@houthoff.com →
  contact_id 42; Veerle Branderhorst in Fireflies-transcript → contact_id 42).
- Resolution via deterministische regels (email-domein-match) + Haiku-fallback
  voor edge cases.

Retrieval-RPC krijgt nieuwe parameter `filter_entity_id` die transparant
expandeert naar alle edges:

```
match_all_sources(query, ..., filter_entity_id := 42, hop_depth := 1)
→ alle mails, engagements, deals, meetings GEKOPPELD aan contact 42, 1-hop.
```

**Niet** volle GraphRAG. Geen Neo4j. Postgres + view + 1-hop = 80% van de
waarde, 5% van de complexiteit.

### Principe 6 — Continuous quality loop

Drie nieuwe tabellen:

```sql
context_bundles            -- elke gebouwde bundle (bundle_id, snapshot, retrieval_strategy)
rag_outcomes               -- hoe ging het: bundle_id ←→ decision (accept/amend/reject) + tokens used
rag_chunk_signals          -- per chunk: hoe vaak getoond, hoe vaak in geaccepteerde draft
```

Periodieke jobs:
- **Wekelijkse acceptance-rate per source** — als HubSpot-engagements consequent
  laag scoren in geaccepteerde drafts, weet je: ofwel hun chunking is slecht,
  ofwel ze passen niet bij dit gebruik.
- **Maandelijkse retrieval-strategy review** — A/B current vs candidate config
  (bv. λ=0.6 vs λ=0.4 in MMR) op een pool van replay-bundles.
- **Quality-dashboard** in dashboard-frontend — `IntelligenceQualityView`.

### Principe 7 — Documentatie als infrastructuur

- **`current_architecture.md`** (dit document) is de single source of truth.
- Bij elke architectuur-wijziging: dit bestand updaten in dezelfde commit.
- Confluence-pagina's zijn voor mensen (koffie-uitleg, projectplannen) — ze
  citeren dit document, niet andersom.
- Skill-references (`embeddings.md`, `retrieval.md`, `quality.md`,
  `graphrag.md`) zijn gespecialiseerd; dit document is de overzichts-laag.
- Edge functions die op Supabase live staan maar niet in repo zitten:
  worden teruggebracht onder versie-controle in `dashboard-react/supabase/functions/`.
  Geldt minstens voor `mail-embed`, `autodraft-rag-prefill`, `rag-search`,
  `outlook-calendar-sync-etl`.

---

## 6. Doelarchitectuur — wat we bouwen

```
                          Legal Mind — Intelligence Stack (doel)
─────────────────────────────────────────────────────────────────────────────────────
Laag           │ Wat                                                    │ Eigenaar
─────────────────────────────────────────────────────────────────────────────────────
1 Sync         │ (huidig, ongewijzigd)                                  │ functions
2 Chunk        │ chunker-* edge functions per source-type               │ NIEUW (functions)
               │ Schrijven naar `chunks` tabel (eenheid: chunk_id)      │
3 Embed        │ Per chunk: contextual prefix + content → embedding    │ functions
               │ chunks.embedding vector(1536), HNSW                    │
4 Index        │ HNSW + PostgreSQL FTS (tsvector kolom op chunks)       │ functions
5 Entity       │ v_entities, v_entity_edges, entity_resolution          │ NIEUW (DB views)
6 Retrieve     │ match_chunks(query, filters, strategy)                 │ functions
               │ Hybrid: BM25 → vector → fusion → recency → MMR → LLM   │
7 Bundle       │ context-build edge function (CaaS)                     │ NIEUW (functions)
               │ Schrijft `context_bundles`                             │
8 Consume      │ Skills lezen ALLEEN context_bundles via bundle_id      │ skills
               │ auto-draft / daily-admin / sales-* / agenda            │
9 Quality      │ rag_outcomes, rag_chunk_signals, A/B framework         │ NIEUW
               │ IntelligenceQualityView dashboard-pagina               │
─────────────────────────────────────────────────────────────────────────────────────
```

Belangrijkste verschillen met huidige stack:
- **Eenheid van indexing wordt `chunks`, niet `mail_messages` etc.** Truth-of-source
  blijft per system-tabel; chunks zijn een afgeleide laag.
- **Alle skills consumeren via `context_bundles.bundle_id`** — geen ad-hoc SQL meer.
- **Hybrid retrieval is default**, niet pure vector.
- **Quality-loop is ingebakken**, niet apart project.

---

## 7. Migratiepad (fasen, geen code)

Niet uitvoeren tot Jelle akkoord is op richting. Volgorde is gekozen om elke
fase op zichzelf waarde te leveren.

### Fase R.1 — Repo-hygiëne ✅ DONE (2026-05-03)

- ✅ Live edge functions teruggetrokken onder versie-controle via Supabase CLI (`supabase functions download` met `SUPABASE_ACCESS_TOKEN` uit Vault). Negen functions toegevoegd aan `dashboard-react/supabase/functions/`:
  - `vercel-relay` (721B), `transcribe` (4.5KB), `mail-backfill` (13.8KB), `hubspot-engagements-sync` (15.8KB), `mail-embed` (15.5KB), `autodraft-rag-prefill` (10.4KB), `rag-search` (5.1KB), `outlook-calendar-sync-etl` (14.5KB), `fireflies-sync-etl` (12.9KB)
  - Elk met `index.ts` (clean source van CLI), `README.md` (TODO-secties voor enrichment), `deno.json`
- ✅ RPC-snapshot in `migrations/rag_rpcs_documentation_2026_05_03.sql` (1.248 regels). 23 RPC's gevonden + gedocumenteerd, waaronder:
  - `match_all_sources` (RAG-hoofd-RPC, 8 sources, 10 filter-params, ~1000 regels SQL)
  - `sync_health`, `sync_health_all`, `assert_freshness` (freshness-checks)
  - `match_jellemind_lessons`, `submit_jellemind_decision` (JelleMind)
  - `get_skill_secret_service` (Vault-lookup)
  - 14 autodraft-RPC's, plus `search_contactpersonen`, `suggest_task_project`, `detect_task_completion_candidates`, `strip_html_inline`
  - `match_chunks` nog niet bestaand (komt in R.4) — gemarkeerd als "NOT FOUND" in migration
- ✅ Tooling: `scripts/r1-repo-hygiene/{pull-all.cjs, extract-eszip-source.cjs, README.md}` plus runbook in `r1_runbook.md`. Token via `SUPABASE_MANAGEMENT_TOKEN` env-var.

**Volgende stap**: README's invullen (per function: wat doet hij, cron, schema-impact) — kan iteratief, niet blocking voor R.2.

### Fase R.2 — Sluit het auto-draft-gat (2-3 dagen)
- Update `auto-draft` SKILL.md om `rag_context.matches[]` expliciet te lezen en
  in de prompt te citeren.
- Voeg een mini-baseline-meting toe: 20 mails met/zonder rag_context, vergelijk
  acceptance-rate. (Dit is feitelijk RAG Quality Engineering F.1, maar dan klein.)
- **Reden**: we kunnen niet gaan herarchitecturen zonder te weten wat de huidige
  stack daadwerkelijk oplevert. Dit is het leverbewijs.

### Fase R.3 — Chunks-tabel + chunker-functions (1 week)
- Nieuwe tabel `chunks (chunk_id, source, source_id, sequence, parent_chunk_id,
  content, content_with_context, embedding, fts_vector, metadata jsonb, ...)`.
- Per source een `chunker-*` edge function:
  - `chunker-mail` (thread-bundle + per-message ≥50w)
  - `chunker-meeting` (topic-segmenten)
  - `chunker-deal` (master + engagement + stage-change)
  - `chunker-confluence`, `chunker-jira` (hierarchical)
- Contextual augmentation (Haiku) als laatste stap in chunker.
- HNSW + GIN FTS-index op `chunks`.
- Backfill alle 8 truth-of-source tabellen → chunks.
- Behoud `match_all_sources` als compatibility-layer; bouw nieuwe `match_chunks`
  parallel.

### Fase R.4 — Hybrid retrieval (3-5 dagen)
- `match_chunks` RPC met BM25 + vector + RRF (Reciprocal Rank Fusion).
- Recency-decay parameter.
- MMR optie (default aan, λ=0.6).
- **Geen LLM-rerank** — die is verschoven naar R.10 als apart project (zie B.7).
- Smoke-tests + side-by-side dashboard om met `match_all_sources` te vergelijken.

### Fase R.5 — Entity-laag (3-5 dagen)
- `v_entities`, `v_entity_edges`, `entity_resolution` tabel.
- Resolution-pipeline (deterministisch + Haiku-fallback).
- Nieuwe filter `filter_entity_id` op `match_chunks`.

### Fase R.6 — Context-build endpoint (1 week)
- `context-build` edge function.
- `context_bundles` tabel (versioned, audit-able).
- Migreer `auto-draft` als eerste consumer (bouw vergelijking met huidige flow).
- Daarna `daily-admin`, `sales-on-road`, `sales-followups`, `agenda`.

### Fase R.7 — Quality loop (1 week)
- `rag_outcomes`, `rag_chunk_signals`.
- A/B-framework (twee retrieval-configs side-by-side).
- `IntelligenceQualityView` dashboard-pagina.

### Fase R.8 — Zoekpagina-revisie (2-3 dagen)
- `RagSearchView` schakelt over naar `match_chunks`.
- Filter op entity, op chunk-type.
- Feedback-knop ("dit was nuttig" / "ruis") schrijft naar `rag_outcomes`.

### Fase R.9 — Intelligence Hub dashboard-pagina (3-5 dagen)
- Sub-tab onder _Agents_ (of top-level — Jelle's keuze) — component `IntelligenceHubView`.
- Live stack-status (groen/geel/rood per onderdeel).
- Pijplijn-diagram (sync → chunk → embed → index → retrieve → bundle → consume → quality).
- Intent-recepten-overzicht (§10.2) gerendered.
- Decision-log uit `current_architecture.md` (§8) gerendered.
- Lopende A/B-experimenten met live cijfers.
- Onboarding-pad voor toekomstige sessies (§13.4).

### Fase R.10 (OPTIONEEL — apart project) — LLM-rerank pilot
- Alleen starten als R.7 (quality-loop) signaleert dat er nog uplift te halen is.
- Stage F in retrieval: Haiku-rerank op top 15 → top 5.
- Latency-cost: ~50ms per query, ~$0.0001 per query.
- Beslis op basis van A/B-meting: rechtvaardigt de uplift de extra latency en complexiteit?

**Totaal hoofdfasen R.1-R.9**: ~6-7 weken werk voor één engineer plus skill-aanpassingen. Eindresultaat:
één pijplijn, één retrieval-API, één bundling-layer, ingebouwde kwaliteits-loop, dashboard-zicht. R.10 als apart pilot-project later.

---

## 8. Beslismomenten — status na iteratie 2026-05-03

Vijf van de zes beslissingen zijn genomen. Eén staat geparkeerd in afwachting van baseline-cijfers.

### B.1 — Contextual augmentation: ✅ JA — met GPT-5-nano

**Beslist 2026-05-03.** Anthropic's contextual-retrieval-trick implementeren, gefaseerd, met GPT-5-nano in plaats van Haiku — orde van grootte goedkoper, voldoende kwaliteit voor formulaic prefix-generatie.

**Verfijnde kostenberekening** (mijn eerdere "€400 eenmalig" was fout — orde van grootte verkeerd geschat):

| Component | Model | Per chunk | Eenmalig (alle bestaande chunks ≈35.000) | Lopend per maand (~5.000 nieuwe chunks) |
|---|---|---|---|---|
| **Contextual prefix** (alle chunks) | GPT-5-nano | ~$0.00007 | ~€2.05 | ~€0.30 |
| **Topic-segmentatie** (alleen meetings) | Haiku 4.5 | ~$0.014 per meeting | ~€2.60 (200 historische) | ~€0.70 |
| **Saillante-zin-extractie** (alleen meetings) | Haiku 4.5 | ~$0.05 per meeting | ~€9.50 (200 historische) | ~€1.85 |
| **Subtotaal contextual augmentation** | | | **~€15 eenmalig** | **~€3/maand** |

**Model-keuzes per taak (definitief):**
- _Contextual prefix_: GPT-5-nano. Formulaic, korte meta-zin per chunk. $0.05/1M input, $0.40/1M output. Nano-quality is voldoende.
- _Topic-segmentatie_: Haiku 4.5. Vereist nuance om topic-shifts te herkennen in een transcript. $1/1M input, $5/1M output.
- _Saillante-zin-extractie_: Haiku 4.5. Vereist nuance om "feiten" te onderscheiden van small talk. Zelfde tarief.

**Met terugwerkende kracht alle bestaande records doen**: ja. Eenmalige kost ~€15 is ruim binnen budget.

**Categorieën / metadata** (Jelle's "1x kans dit goed te doen"-eis): zie §11.6 — twaalf source-specifieke prefix-templates met expliciete metadata-velden, plus de chunk-tabel-schema in §11.7.

### B.2 — Embedding-model upgrade (`text-embedding-3-large`): ✅ GEACTIVEERD 2026-05-03 (later op de dag)

**Beslist door Jelle**: ja, doen. Live geactiveerd in dezelfde sessie als B.1 + R.1.

**Implementatie-keuzes**:
- Model: `text-embedding-3-large` met `dimensions=3072` (volle dim voor maximum kwaliteit, niet truncated naar 1536).
- Opslag-type: **`halfvec(3072)`** (16-bit half-precision) ipv `vector(3072)`. Reden: pgvector HNSW-limiet is 2000 dims voor `vector` maar 4000 dims voor `halfvec`. Halfvec geeft ~50% geheugen-besparing met marginale kwaliteits-impact.
- Pgvector versie: ≥ 0.7 (halfvec geverifieerd live beschikbaar).
- Naast bestaande `embedding vector(1536)` → nieuwe kolom `embedding_3l halfvec(3072)`. Parallel runnen tijdens transitie. Pas wanneer match_all_sources is omgezet, droppen we de oude kolom.

**Live status (2026-05-03 16:30)**:
- ✅ Migration `migrations/embedding_3l_upgrade_2026_05_03.sql` deployed: 9 tabellen × `embedding_3l` + tracking-kolommen + HNSW-index (`halfvec_cosine_ops`, m=16, ef_construction=64).
- ✅ Edge function `mail-embed-3l` v1.1 live (`supabase/functions/mail-embed-3l/`). BATCH_SIZE=25, UPDATE_SLICE=10 (kleinere batches dan v2 i.v.m. 4× zwaardere arrays).
- ✅ Eerste manual test: **725 records geëmbed, 152.727 tokens (~$0.02), 0 warnings**.
- ✅ pg_cron job `mail-embed-3l-cron` schedule `*/3 * * * *` actief — pakt records op waar `embedding_3l IS NULL` voor alle 8 truth-of-source tabellen.
- 🔄 Backfill loopt: 1.976 done / 18.724 pending bij start cron (16:30). Verwacht klaar binnen 1.5-2 uur.
- ⏳ **TODO**: zodra alle records `embedding_3l NOT NULL`: update `match_all_sources` om `embedding_3l` te gebruiken + drop oude kolom. Dat gebeurt in een aparte migration-stap.

**Kosten**: 152.727 tokens × $0.13 / 1M = **$0.02 voor 725 records**. Bij 18.724 totaal: ~$0.50 eenmalig (2.6× hoger dan eerder geschat €2.15, maar verwaarloosbaar).

### B.2-LEGACY — Oude waarde (vóór 2026-05-03 16:30): 🟡 GEPARKEERD

> Cost is _niet_ de blocker (verwaarloosbaar — €2.15 eenmalig + €0.25/maand extra). De blocker is **ROI-onzekerheid**.

**Cost-detail** (per Jelle's vraag _"wat kost de upgrade per keer"_):

| Maat | text-embedding-3-small (huidig) | text-embedding-3-large | Verschil |
|---|---|---|---|
| Tarief | $0.02 / 1M tokens | $0.13 / 1M tokens | 6.5× |
| Per call (1 chunk ~500 tok) | $0.00001 (€0.0000094) | $0.000065 (€0.000061) | +€0.00005 |
| Per maand (~5.000 chunks) | €0.05 | €0.30 | +€0.25 |
| Eenmalige re-embed (35k chunks) | $0.35 (€0.33) | $2.30 (€2.15) | +€1.82 |

**Wat zit eraan vast** (niet de €): vector dim verandert van 1536 naar 3072 → schema-migratie nodig (nieuwe kolom, re-embed, retrieval-switch). Een week werk, niet maanden.

**Heroverwegingstrigger**: na fase R.7 hebben we baseline-acceptance-rate-cijfers per bron. Als die plateau bereiken en analyse zegt "we missen recall op specifieke nuances", dan A/B-testen. Tot die tijd: blijven bij 3-small.

**Voor nu betekent dit**: chunks-tabel (§11.7) wordt aangelegd op `vector(1536)` met een gepland migratie-pad (`embedding_v2 vector(3072)` toevoegen, re-embed in batch, retrieval-switch, drop oude kolom).

### B.3 — Volle GraphRAG (Neo4j etc.): ✅ NEE — graph-light

**Beslist 2026-05-03.** Graph-light methode (entity-laag op Postgres-views, 1-hop expansion) is voldoende voor onze schaal. Volle GraphRAG pas heroverwegen als ≥5 user-cases per maand multi-hop falen of dataset > 100k entities.

### B.4 — `autodraft-rag-prefill` vervangen door `context-build`: ✅ JA

**Beslist 2026-05-03.** In fase R.6 wordt `autodraft-rag-prefill` vervangen door het generieke `context-build` endpoint met intent-recepten (§10). Tot die fase blijft prefill draaien (functioneel doodlopend, want auto-draft leest het niet — dat lossen we al in R.2 op door auto-draft `rag_context` te laten consumeren als brug).

### B.5 — Maandelijks budget: ✅ ~€10-15/maand acceptabel

**Beslist 2026-05-03.** Verwachte lopende kosten intelligence-stack:
- Embeddings: ~€0.05/maand (3-small, huidig)
- Contextual augmentation (GPT-5-nano + Haiku): ~€3/maand
- LLM-rerank: 0 (geparkeerd, zie B.7)
- Edge function compute: nihil
- **Totaal verwacht: ~€3-5/maand structureel.** €50/maand is ruim, kan zelfs lager.

### B.6 — Owner: ✅ datascience skill is hoofd-owner

**Beslist 2026-05-03.** `datascience` skill is _de_ owner van de architectuur — dit document is haar verantwoordelijkheid. `agent-manager` bewaakt de orkestratie van skills die hieruit leven; `dashboard-refresh` bewaakt de frontend-hooks (Intelligence Hub etc.). Maar wijzigingen aan deze stack starten en eindigen bij `datascience`.

**Concrete consequenties**:
- Datascience skill is per 2026-05-03 ook gekopieerd naar `~/.claude/skills/datascience/` (bureaublad, cross-session beschikbaar).
- Sessie-checklist (§13.3) zegt expliciet: bij architectuur-wijziging is `datascience` de eerste-lezen skill.
- Skill-routerings-tabel verwijst naar dit document als startpunt.

### B.7 — LLM-rerank stage F (NIEUW, na deel-2-iteratie): 🟡 APART PROJECT, NIET NU

**Beslist 2026-05-03 op Jelle's voorstel** _"reranking als aanvullend project zien die we nu nog niet uitvoeren"_.

LLM-rerank (Stage F in Principe 4 — Haiku-rerank op top 15 → top 5) wordt **uit de hoofdfasen R.4 gehaald** en geparkeerd als optionele fase **R.10**. Reden: scope-management. Eerst BM25 + vector + recency + MMR (Stages A-E) operationeel krijgen en meten — pas dan beslissen of LLM-rerank meetbare uplift geeft die de extra latency en complexiteit waard is.

Fase R.4 wordt dus simpeler: hybrid retrieval **zonder** LLM-rerank. R.10 als losse pilot, alleen wanneer R.7 (quality-loop) signaleert dat we daar nog uplift kunnen halen.

---

## 9. Update-protocol

**Wanneer dit document bijwerken?**

| Trigger | Sectie(s) bij te werken |
|---|---|
| Nieuwe edge function gedeployd | 1, 2.3 of 2.6, 3 |
| Nieuwe RPC voor retrieval | 1, 2.5 |
| Schema-wijziging op embedding-tabel | 2.2 |
| Nieuwe consumer-skill leest RAG | 2.7, 10.2 (intent-recept toevoegen) |
| Nieuwe intent toegevoegd | 10.2 |
| Nieuw bron-type (bv. telefoonrecorder) | 2.1, 11 (uitbreiden chunking-strategie) |
| Quality-loop maakt eerste meting | 2.8, 4 (verwijder relevante kritiek), 12 |
| Migratie-fase R.x klaar | 7 (markeer fase als "done"), 1, 4 |
| Beslissing genomen op B.x | 8 (markeer "decided"), pas overige secties aan |
| Database/infra-keuze heroverwogen | 14 (update tabel + heroverwegingstrigger) |
| Continuous improvement-experiment afgerond | 12 |

**Hoe** (zie ook §13.3 sessie-checklist als invariant):
1. Update dit bestand op de relevante secties.
2. Voeg een regel toe aan §15 audit-log met datum, sessie-context, wijziging.
3. Bij architectuur-relevante wijziging: update ook de Intelligence Hub view in dashboard (zo nodig).
4. Bij _fundamentele_ verschuiving: update of schrijf een nieuwe Confluence-koffie-pagina onder parent 411271170 (deel 1: 421920819, deel 2: 422969345).
5. Als de wijziging persoonlijk-relevant is voor Jelle: update `MEMORY.md`.

---

## 10. Use-case diversiteit & intent-recepten

Het centrale `context-build` endpoint (Principe 2) bedient meerdere skills met verschillende informatiebehoeften. Niet door per skill een aparte pijplijn — dat was juist de oude fout — maar door één pijplijn met **intent-recepten**: de skill zegt _wie_ hij is en _waarvoor_ hij context nodig heeft, en de pijplijn past de drie bouwstenen (anker / kring van gerelateerd / kennislaag) in de juiste verhouding toe.

### 10.1 De drie bouwstenen

Elke context-bundle, ongeacht consument, bestaat uit:

| Bouwsteen | Wat | Waarvandaan |
|---|---|---|
| **Anker** | Het primaire document waar alles omheen draait — een mail, een meeting, een deal-update, een query, een correctie | Direct uit de truth-of-source tabel, met chunk-decompositie zoals in §11 beschreven |
| **Kring van gerelateerd** | Wat ligt semantisch / via entiteiten / via tijd dicht bij dit anker? | Hybrid retrieval (Principe 4) op `chunks` tabel met intent-specifieke filters |
| **Kennislaag** | Welke regels, lessons, voorkeuren, categorieën zijn van toepassing? | `autodraft_style_lessons`, `jellemind_lessons`, `autodraft_categories`, agenda-spelregels, sales-style-rules |

### 10.2 Intent-recepten register

Elke consumer-skill heeft één of meerdere intents. Het recept bepaalt anker-zwaarte, kring-breedte (lookback, top-k, filters), en welke kennislaag wordt opgenomen.

| Intent | Consumer-skills | Anker-zwaarte | Kring-breedte | Kennislaag |
|---|---|---|---|---|
| `draft_reply` | auto-draft | hoog (1 mail) | smal, recent (90d), thread-bias | style-lessons + categorie + jellemind-toon |
| `enrich_record` | daily-admin | midden (deal/contact) | breed (12mnd), entity-bias | categorie-mapping |
| `extract_actions` | daily-admin (meeting-pass), task-organizer | laag (meeting) | breed binnen meeting + 30d cross-source | open-tasks-check + recurrent-patterns |
| `compose_followup` | sales-followups, sales-on-road | hoog (1 deal) | medium (90d), entity-bias | sales-style + last-interaction |
| `match_appointment` | agenda | laag (verzoek) | breed (4w forward) | woensdag-intern-regel + reistijd-table |
| `search` | RagSearchView | gebruiker-bepaald | gebruiker-bepaald | geen — direct resultaat |
| `learn_pattern` | jellemind | laag (correctie) | smal, alleen amendments | bestaande lessons cross-check |
| `analyze_meeting` | sales-on-road, jellemind, daily-admin | hoog (1 meeting) | drie-laags (zie §11) + agenda-link | strategy-themes + entity-resolution |

**Toevoegingsregel**: bij elke nieuwe consumer-skill formuleer je _eerst_ het intent-recept (welke anker, welke kring, welke kennislaag) en pas _dan_ implementeer je. Het recept gaat in deze tabel + in een `context_intents` config-tabel die het endpoint leest. Geen recept zonder PR-review.

### 10.3 Roadmap-skills met nog te formuleren intent

Op het moment van schrijven (2026-05-03) zijn er twee skills op de roadmap die hun intent-recept nog moeten krijgen:

- **Telefoon/MT-recorder skill** (gepland, hangt aan Fireflies-uitbreiding) — gebruikt `analyze_meeting` met `source_subtype='phone_call'` resp. `'mt_meeting'`. Speciale vraag: hoe filteren we MT-meetings van klant-meetings voor JelleMind-relevantie? Voorstel: `metadata.audience='internal' | 'external'` op meeting-record.
- **Eventuele nieuwe consumer-skills** die voortvloeien uit fasen R.5+ — telkens opnieuw recept-eerst.

---

## 11. Fireflies & meeting-chunking — drie-laags strategie

Meeting-bronnen (Fireflies, en straks telefoongesprekken via een MT-recorder) zijn de **rijkste én moeilijkste** bron in de stack. Eén meeting van 90 minuten bevat typisch ~10.000 woorden waarvan misschien 3% écht relevant is voor latere retrieval. Een naïeve "1 meeting = 1 vector" maakt dat goud onvindbaar.

Voor meetings (en alleen meetings) gebruiken we een **drie-laags chunking-strategie**.

### 11.1 De drie lagen

| Laag | Wat | # chunks per 90-min meeting | Embed-cost (eenmalig) | Retrieval-doel |
|---|---|---|---|---|
| **Macro** | hele meeting + LLM-gegenereerde executive summary | 1 | ~$0.005 (Haiku-summary + embed) | "alle meetings met X in maart", "welke meetings gingen over Y" |
| **Topic-segmenten** | onderwerpsblokken, gedetecteerd op transcript-structuur (stiltes, sprekerwisselingen, "OK volgend punt"-cues, of LLM-detectie); elk met context-prefix `"Topic in meeting tussen [aanwezigen] op [datum]: [topic-titel]"` | 5-8 | ~$0.02 | "wat hebben we besproken over de proefperiode bij Houthoff" |
| **Saillante zinnen** | per topic-segment markeert Haiku in één pass de _feitelijke_ zinnen — toezeggingen, datums, prijzen, namen, afwijzingen, afspraken; elk wordt mini-chunk met prefix `"In het topic '[titel]' van de meeting van [datum], gezegd door [spreker]: [zin]"` | 10-50 | ~$0.05 | "wat heeft Veerle gezegd over de prijs", "is er een datum afgesproken" |

Totaal eenmalig per meeting: ~$0.075. Op een schatting van ~50 meetings/maand: ~$3.75/maand. Te verwaarlozen.

### 11.2 Implementatie — `chunker-meeting` edge function

Volgorde per meeting (parallel op de drie lagen waar mogelijk):

1. **Pull transcript** uit `fireflies_meetings` (of straks `phone_call_recordings` voor de MT-recorder).
2. **Macro-laag**: Haiku produceert een 200-300 woorden executive summary. Embed het transcript-summary samen.
3. **Topic-detectie**: LLM-pass (Haiku of Sonnet bij lange meetings) markeert topic-grenzen → `[start_ts, end_ts, topic_titel]`-segmenten. Voor korte meetings (<20 min) kan dit deterministisch op sprekerwisselingen.
4. **Saillante-zin-extractie**: per topic-segment markeert Haiku welke zinnen feitelijk zijn (toezegging/datum/prijs/naam/afwijzing/afspraak) — output is een lijst van `[ts, speaker, sentence]`.
5. **Embed laag 2 + 3** met contextual prefix.
6. Schrijf naar `chunks` met `parent_chunk_id` (saillante zin → topic-segment → macro-meeting), `chunk_type` ∈ {`meeting_macro`, `meeting_topic`, `meeting_salient`}, en metadata zoals `speaker`, `timestamp_in_meeting`, `topic_titel`.

### 11.3 Retrieval-gedrag

Bij een retrieval-call op een vraag waar meeting-relevantie waarschijnlijk is (of ALL-sources), worden alle drie de lagen doorzocht. De rerank-stap brengt ze in juiste verhouding:

- Vaak is een **saillante zin** de sterkste match (specifieke vraag, specifieke uitspraak).
- De **topic-segment** erboven helpt om die zin in context te plaatsen — hij wordt _ook_ teruggegeven als `parent` bij de match.
- De **macro-meeting** is meestal te abstract om bovenaan te komen — komt alleen mee als geen lagere laag matcht.

In de UI van de zoekpagina (en in skill-prompts) wordt een saillante-zin-match getoond mét zijn topic-context: "_In de meeting van 12 maart 2026 met Houthoff, in het onderwerp 'contractverlenging', zei Veerle: 'we tekenen voor 1 juni'._"

### 11.4 Telefoonrecorder-uitbreiding

Wanneer de MT/telefoon-recorder live gaat:
- Nieuwe sync (edge function `phone-call-sync` of breder `meeting-sync` als oogst-laag).
- Truth-of-source tabel — kandidaat-naam `phone_call_recordings`, of generieker `recorded_meetings` met een `source_type` ∈ {`fireflies`, `phone_call`, `mt_recording`}.
- Dezelfde `chunker-meeting` edge function herkent het soort aan `source_subtype` en schaalt parameters daarop (kortere telefoongesprekken hebben minder topics, etc.).
- Privacy-flag op meeting-record (`audience='internal' | 'external'`) — JelleMind ziet zowel intern als extern, daily-admin alleen extern, sales-on-road alleen extern. Kennislaag bepalen we per intent-recept.

### 11.5 Wat dit oplost

- **De ene-zin-van-Veerle** → vindbaar als saillante zin met context-prefix.
- **Topic-zoekvraag** → topic-segment-match in plaats van een gemiddelde over de hele meeting.
- **Cross-meeting-thema-zoekvraag** ("wat hebben we besproken over compliance dit kwartaal") → topic-segmenten over meetings heen mengen via hybrid retrieval.
- **Strategie-leren voor JelleMind** → saillante zinnen + topic-titels uit MT-meetings zijn rijke input voor patroon-detectie.

### 11.6 Contextual augmentation — templates per source-type

Anthropic's contextual-retrieval-trick: elke chunk krijgt een korte LLM-gegenereerde voorzin die hem in zijn context plaatst. Dit boost recall significant — vooral voor korte chunks (saillante zinnen) of generieke chunks (een mail "akkoord, doe maar" zonder context is onvindbaar; mét prefix wel).

> **Belangrijk** (Jelle's eis _"1x de kans dit echt goed te doen"_): de templates hieronder zijn **definitief en geversioneerd**. Toekomstige wijzigingen aan een template = `embedding_input_hash` van álle chunks van die source verandert = re-embed verplicht. Dat is duur in tijd (niet in geld). Dus eerst hier goed nadenken, daarna pas implementeren.

**Algemene regels voor alle prefixes**:
1. **Maximaal 80 tokens** — Anthropic's onderzoek laat zien dat langer geen extra winst geeft maar wel signaal verdunt.
2. **Beginnen met source-type** — `Mail-bericht`, `Topic-segment`, `HubSpot-deal` — zodat embedding-distance op categorisch niveau correct werkt.
3. **Datum altijd in formaat `dd-mmm-yyyy`** — voor temporal anchoring (`12-mrt-2026`, niet `2026-03-12`).
4. **Entity-namen vóór id's** — `Veerle Branderhorst` vóór `contact_id 17`; menselijk leesbare embeddings.
5. **Geen metadata die niet beschikbaar is** — `[Optioneel]` velden alleen invullen als ze er werkelijk zijn. Lege placeholders hurten embedding-quality.
6. **Geen markdown / HTML / structured tokens** — gewone Nederlandse zinnen.

**De twaalf templates** (één per chunk-type):

#### 11.6.1 Mail — single message (binnen thread)
```
Mail-bericht in thread "{subject}" op {received_at_human}, van {from_name} <{from_email}> aan {to_recipients_short}.
Conversatie loopt van {thread_first_date} tot {thread_last_date} ({thread_count} berichten).
{IF deal_match}: gerelateerd aan deal "{deal_name}" (stage: {deal_stage}).{ENDIF}
{IF folder_path}: in mailbox-folder {folder_path}.{ENDIF}
```
**Lookups vereist**: `mail_messages` (basis) + `hubspot_contacts.email = from_email` → `associated_deal_ids[0]` → `hubspot_deals` voor deal-context.

#### 11.6.2 Mail — thread bundle (alle messages samen)
```
Email-thread "{subject}" tussen {unique_participants_short} van {first_date} tot {last_date}.
{thread_count} berichten. Hoofdthema: {topic_summary_llm}.
{IF deal_match}: gerelateerd aan deal "{deal_name}" (stage: {deal_stage}).{ENDIF}
```
**LLM-call vereist**: `topic_summary_llm` is GPT-5-nano-output op de chronologische thread (één pass per thread, gecached).

#### 11.6.3 HubSpot engagement (call/email/meeting/task in CRM)
```
HubSpot-engagement van type {engagement_type} op {engagement_date}, geregistreerd door {owner_name}.
Bij deal "{deal_name}" (stage: {deal_stage}).
{IF subject}: onderwerp: {subject}.{ENDIF}
{IF associated_contact_names}: contact: {associated_contact_names_short}.{ENDIF}
```

#### 11.6.4 Jira issue
```
Jira-issue {project_key}-{issue_number} "{summary}".
Type {issue_type}, prioriteit {priority}, status {status}.
Toegewezen aan {assignee_name}, gemaakt op {created_at_human}.
{IF labels}: labels: {labels}.{ENDIF}
{IF components}: components: {components}.{ENDIF}
```

#### 11.6.5 HubSpot deal (master record)
```
HubSpot-deal "{deal_name}" — stage {deal_stage}, type {deal_type}, bedrag €{amount}.
Bij bedrijf {company_name} ({company_industry}). Eigenaar: {owner_name}.
Geopend {created_at_human}, laatste activiteit {last_activity_date_human}.
Geassocieerde contacten: {associated_contacts_short}.
```

#### 11.6.6 HubSpot company
```
Bedrijf "{company_name}" — industrie {industry}, lifecycle-stage {lifecycle_stage}.
{IF domain}: domein {domain}.{ENDIF}
{N_contacts} contacten, {N_deals} deals, totaal pipeline ~€{total_pipeline_value}.
{IF firm_type_inferred}: type kantoor: {firm_type_inferred}.{ENDIF}
```

#### 11.6.7 HubSpot contact
```
Contact {first_name} {last_name} — {job_title} bij {company_name} ({company_industry}).
Email: {email}.
{IF mail_count}: {mail_count} mails in onze archief, laatste op {last_mail_date_human}.{ENDIF}
{IF deal_count}: betrokken bij {deal_count} deal(s).{ENDIF}
```

#### 11.6.8 Calendar event
```
Agenda-afspraak "{subject}" op {start_time_human}, duur {duration_min} minuten.
Locatie: {location_text_or_online}.
Aanwezigen: {attendees_short_list}.
{IF fireflies_meeting_id}: opgenomen via Fireflies (transcript beschikbaar).{ENDIF}
{IF deal_match}: gerelateerd aan deal "{deal_name}".{ENDIF}
```

#### 11.6.9 Fireflies meeting — macro-laag (hele meeting)
```
Meeting "{meeting_title}" op {meeting_date_human}, duur {duration_min} minuten.
Aanwezigen: {participants_short}.
Hoofdonderwerpen: {topics_summary_llm} ({topic_count} topics).
{IF source_subtype = phone_call}: telefoongesprek.{ELSEIF source_subtype = mt_meeting}: MT-meeting (intern).{ENDIF}
{IF deal_match}: gerelateerd aan deal "{deal_name}".{ENDIF}
```

#### 11.6.10 Fireflies meeting — topic-segment
```
Topic-segment in meeting "{meeting_title}" ({meeting_date_human}), tussen minuut {start_min} en {end_min}.
Onderwerp: "{topic_titel_llm}" — gedetecteerd uit transcript-structuur.
Sprekers: {speakers_in_segment_short}.
Onderdeel van een meeting met {total_topics} topics, totaal {duration_min} min.
```

#### 11.6.11 Fireflies meeting — saillante zin
```
In meeting "{meeting_title}" ({meeting_date_human}), in topic "{topic_titel}", rond minuut {timestamp_min}.
Gezegd door {speaker}: feitelijke uitspraak van type {fact_type}.
{IF deal_match}: in context van deal "{deal_name}".{ENDIF}
```
(De feitelijke zin staat dan in `chunks.content` zelf.)

#### 11.6.12 JelleMind lesson
```
Lesson-regel met scope {scope: jelle/skill/legalmind}, applies_to {applies_to_array_short}.
Geaccepteerd op {accepted_at_human}, afgeleid uit {N_signals} signalen.
{IF category_inferred}: categorie: {category_inferred} (tone/terminologie/proces/voorkeur).{ENDIF}
```

#### 11.6.13 Legal AI finding
```
Legal AI markt-finding van {finding_date_human}, track {advocatuur|bedrijfsleven}.
Topic: "{topic}". Confidence-score: {confidence_score}.
Bronnen: {N_citations} citaties.
```

**Implementatie-route**: `chunker-{source}` edge function bouwt voor elke chunk de prefix volgens template, doet GPT-5-nano-call voor optionele LLM-velden (`topic_summary_llm`, `topics_summary_llm`, `topic_titel_llm`, `firm_type_inferred`, `category_inferred`), schrijft het complete `content_with_context` veld naar de chunks-tabel, en embedt _dat_ veld (niet de naakte content). Hash-dedup op `content_with_context` zodat re-embed alleen plaatsvindt bij echte content-wijziging.

### 11.7 Chunks-tabel — schema (voorlopig)

Migration komt in fase R.3. Voorlopig schema (kandidaat — tweaken bij implementatie):

```sql
CREATE TABLE chunks (
  -- Identificatie
  chunk_id              uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  source                text        NOT NULL,    -- 'mail' | 'engagement' | 'jira' | 'deal' | 'company' | 'contact' | 'event' | 'meeting' | 'lesson' | 'finding'
  source_id             text        NOT NULL,    -- de id in de truth-of-source tabel
  source_subtype        text,                    -- 'phone_call' | 'mt_meeting' | 'inbound_mail' etc.
  chunk_type            text        NOT NULL,    -- 'message' | 'thread' | 'macro' | 'topic' | 'salient' | 'document' | 'master'
  parent_chunk_id       uuid        REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  sequence              integer     NOT NULL DEFAULT 0,

  -- Content
  content               text        NOT NULL,    -- de naakte chunk-tekst
  content_with_context  text        NOT NULL,    -- prefix + content (wat we embedden)

  -- Embedding (B.2 ✅ — text-embedding-3-large, 3072 dim, halfvec voor HNSW-compat)
  embedding             halfvec(3072),
  embedded_at           timestamptz,
  embedding_model       text,                    -- 'text-embedding-3-large' (incl. versie)
  embedding_input_hash  text,                    -- sha256(content_with_context) voor dedup

  -- Keyword-half (voor hybrid retrieval, fase R.4)
  fts_vector            tsvector,

  -- Tijd-anchor
  occurred_at           timestamptz NOT NULL,    -- wanneer is dit "echt gebeurd" — bv. mail received_at, meeting start_time

  -- Entity-koppelingen (denormalized voor snelle filtering, fase R.5)
  entity_ids            text[]      DEFAULT '{}',  -- alle gerelateerde contacts/companies/deals
  primary_entity_id     text,                       -- de "hoofd"-entiteit van deze chunk

  -- Voor saillante zinnen (chunk_type='salient')
  speaker               text,
  fact_type             text,                    -- 'commitment' | 'date' | 'price' | 'name' | 'rejection' | 'agreement' | NULL
  timestamp_in_source   numeric,                 -- minuten in meeting / positie in document

  -- Voor topic-segmenten (chunk_type='topic')
  topic_title           text,
  topic_speakers        text[],

  -- Source-specifieke metadata (jsonb voor flexibiliteit)
  metadata              jsonb       DEFAULT '{}'::jsonb,

  -- Audit
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_chunks_source_id        ON chunks(source, source_id);
CREATE INDEX idx_chunks_chunk_type       ON chunks(chunk_type);
CREATE INDEX idx_chunks_parent           ON chunks(parent_chunk_id);
CREATE INDEX idx_chunks_occurred         ON chunks(occurred_at DESC);
CREATE INDEX idx_chunks_primary_entity   ON chunks(primary_entity_id);
CREATE INDEX idx_chunks_entity_ids_gin   ON chunks USING GIN(entity_ids);
CREATE INDEX idx_chunks_fts_gin          ON chunks USING GIN(fts_vector);
CREATE INDEX idx_chunks_embedding_hnsw   ON chunks USING hnsw(embedding halfvec_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX idx_chunks_input_hash       ON chunks(embedding_input_hash);

-- Triggers
-- - update updated_at on row update
-- - update fts_vector on content change
-- - cascade entity_ids invalidation on entity_resolution change (fase R.5)
```

**Beslissingen achter dit schema**:

| Veld / Keuze | Waarom |
|---|---|
| `chunk_id` als uuid (niet bigint) | Globaal uniek, kan gegenereerd worden in edge function vóór insert. |
| `source` + `source_id` als pair | Truth-of-source blijft eigenaar; we wijzen naar de bron. |
| `parent_chunk_id` self-reference | Hierarchie meeting → topic → salient zonder aparte tree-tabel. |
| `content` én `content_with_context` apart | Bij display tonen we content (zonder prefix); bij embedding/FTS gebruiken we content_with_context. |
| `embedding_input_hash` op `content_with_context` | Re-embed alleen bij echte wijziging van wat we embedden. |
| `entity_ids` als array | Snelle GIN-index lookup; één chunk kan meerdere entiteiten raken. |
| `primary_entity_id` los | Voor "wie is de hoofdpersoon" — beslist door chunker. |
| **`halfvec(3072)` HNSW met halfvec_cosine_ops** | **Per B.2-beslissing 2026-05-03**: text-embedding-3-large geeft 3072 dim → vector(3072) past niet in HNSW (limiet 2000). Halfvec(3072) wel (limiet 4000). Tabel-schema hieronder is bijgewerkt naar halfvec(3072). |
| `fts_vector` apart, niet generated column | Generated columns hebben edge cases bij triggers; aparte trigger geeft expliciete controle. |

**Wat dit schema vervangt**: de losse embedding-kolommen op `mail_messages`, `hubspot_engagements`, `hubspot_deals`, `hubspot_companies`, `hubspot_contacts`, `jira_issues`, `fireflies_meetings`, `calendar_events`, `jellemind_lessons`, `legal_ai_findings`. Die blijven bestaan als truth-of-source maar verliezen hun `embedding`-kolom in fase R.3 (cleanup); retrieval gaat dan exclusief via `chunks`.

---

## 12. Continuous improvement — drie tijdschalen

De architectuur _na de bouw_ is niet hetzelfde als de architectuur _na een jaar gebruik_. We bouwen continuous improvement in op drie tijdschalen, plus een ad-hoc loop, zodat de stack blijft verbeteren zonder dat we elke maand opnieuw vanaf nul moeten optimaliseren.

### 12.1 Wekelijkse loop — automatische tuning

**Job**: `rag-tuning-weekly` (cron zondagochtend, draait via orchestrator).

**Werkwijze**:
1. Verzamel alle `rag_outcomes` van afgelopen 7 dagen.
2. Aggregeer per `chunk_type` × `source` × `intent`: hoe vaak getoond, hoe vaak in geaccepteerde draft, gemiddelde positie in rerank-output.
3. Detecteer afwijkingen: bron-X heeft acceptance-rate gedaald van 73% naar 58% — vermoedelijke oorzaak (nieuwe content?, verkeerde chunking?, threshold-issue?).
4. Schrijf voorstellen naar `rag_tuning_proposals`: bv. _"verlaag recency-decay voor hubspot_engagements van 90 naar 60 dagen — chunks ouder dan 60d worden in 73% van gevallen niet gebruikt"_.
5. Jelle accepteert in dashboard-pagina (zoals JelleMind-style). Niets verandert zonder akkoord.

**Schaal**: typisch 0-3 voorstellen per week. Geen voorstellen wanneer alles stabiel is.

### 12.2 Maandelijkse loop — config-A/B

**Job**: `rag-experiment-monthly` (eerste maandag van de maand).

**Werkwijze**:
1. Bekijk de `rag_tuning_proposals` van de afgelopen maand — vaak komt daar een aanpassing uit die het waard is om _te testen_ in plaats van direct te adopteren.
2. Stel een **candidate config** op (bv. `mmr_lambda = 0.4` ipv 0.6, of `recency_decay_days = 60` ipv 90 voor één bron).
3. 5-10% van het `context-build` traffic wordt naar de candidate gerouteerd (`rag_experiments.variant = 'candidate'`); 90-95% blijft productie (`variant = 'production'`).
4. Routing op basis van `bundle_id % 100 < 10` — deterministisch en reproduceerbaar.
5. Na 30 dagen: vergelijk acceptance-rate, amend-rate, cost-per-acceptable-draft. Bij significant beter (≥3 percentage-punten uplift én niet >25% kostenstijging): candidate wordt nieuwe productie-config. Anders: blijven bij huidige.

**Tabellen**: `rag_experiments` (id, name, variant_config jsonb, started_at, ended_at, conclusion), `rag_outcomes` krijgt kolom `experiment_variant`.

### 12.3 Kwartaal-loop — model & techniek-review

**Cadence**: één keer per kwartaal, agenda-item op Jelle's planning.

**Vragen per review**:
- Is `text-embedding-3-small` nog state-of-the-art voor onze taal/use-case? (Vergelijken met nieuw model A/B, alleen bij baseline-cijfers > 75% acceptance.)
- Zijn er nieuwe retrieval-trucs gepubliceerd door Anthropic / OpenAI / pgvector / academia die uplift kunnen geven?
- Is onze schaal nog binnen Postgres-bereik, of nadert HNSW-recall een drempel waarbij IVFFlat of partitionering nodig wordt?
- Welke beslismomenten uit `current_architecture.md §8` zijn rijp voor heroverweging? (Bv. "embedding-model upgraden": als acceptance-rate ondertussen plateau heeft bereikt, is het tijd voor 3-large A/B.)

**Output**: een review-pagina onder _Lopende projecten_ in Confluence, plus eventuele update aan `current_architecture.md` (sectie 5 Ontwerpprincipes of §8 Beslismomenten).

### 12.4 Ad-hoc loop — intelligence-experiments-backlog

Gedurende het kwartaal komen er onverwachte signalen: een specifieke retrieval-call die slecht uitvalt, een nieuwe Anthropic-blogpost over een retrieval-truc, een gebruikspatroon dat niemand had voorzien. Die landen op een lijst:

```sql
CREATE TABLE intelligence_experiments_backlog (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  proposed_at timestamptz DEFAULT now(),
  proposed_by text,                    -- 'jelle' | 'session-id-...'
  rationale text NOT NULL,
  expected_impact text,
  estimated_effort text,
  status text DEFAULT 'queued',        -- queued | in-progress | done | abandoned
  links jsonb                          -- {paper_url, blog_url, context_bundle_id, ...}
);
```

Eén of meer ervan wordt elk kwartaal opgepakt, of vaker als het pijn doet. Toegankelijk via dashboard (Intelligence Hub, zie §13).

---

## 13. Knowledge-borging — drie lagen

Bij elke architectuur-wijziging moet de kennis op drie plekken landen, in dezelfde sessie. Dit is een **invariant** — niet "we doen het later", want anders divergeren ze (zoals nu Confluence claimt dat Fase 3 afgerond is terwijl nooit gedaan).

### 13.1 De drie lagen

| Laag | Plek | Doelgroep | Update-trigger |
|---|---|---|---|
| **A — Skill-document** | `dashboard-react/skills/datascience/references/current_architecture.md` (dit document) | Toekomstige Claude-sessies, technische lezers | Elke wijziging aan stack, RPC, edge function, beslissing |
| **B — Dashboard Intelligence Hub** | Nieuwe sub-tab onder _Agents_ (of top-level tab) — component `IntelligenceHubView` | Jelle (live status), nieuwe lezers (visueel overzicht) | Auto-rendered uit dit document + live DB-state |
| **C — Confluence koffie-pagina's** | _Concepten & uitleg_ → "Onze hersenen — deel 1, 2, ..." | Jelle (na lange afwezigheid), externe stakeholders, fundamenteel nieuwe inzichten | Bij _fundamentele_ verschuiving — niet bij elke aanpassing |

### 13.2 Wat staat waar?

| Type informatie | Laag A | Laag B | Laag C |
|---|---|---|---|
| Tabel-, RPC-, edge-fn-namen + parameters | ✅ | — | — |
| Beslissingen + audit-log | ✅ | gerendered | — |
| Live status (groen/geel/rood per onderdeel) | — | ✅ | — |
| Pijplijn-diagram | tekst | visueel | metafoor |
| Intent-recepten | ✅ tabel | gerendered | metafoor |
| Continuous-improvement experiments | tekst | live cijfers | conceptueel |
| Verhaal — waarom hebben we dit gekozen | beknopt | links | uitgebreid |

### 13.3 Sessie-checklist (invariant)

Elke sessie die een architectuur-relevante wijziging doet, doorloopt aan het eind:

- [ ] Is `current_architecture.md` bijgewerkt op de relevante secties?
- [ ] Is de audit-log onderaan voorzien van een nieuwe regel met datum + wijziging?
- [ ] Zijn er live elementen die de Intelligence Hub-view raken? (zo ja: dashboard-component update of in elk geval een DB-veld dat de view leest)
- [ ] Is de wijziging _fundamenteel_ genoeg om een nieuwe koffie-pagina (of update van een bestaande) te rechtvaardigen? (zo ja: schrijven of updaten in Confluence)
- [ ] Is de geheugen-`MEMORY.md` (Jelle's persoonlijke notitie-laag) aangevuld als de wijziging daar gevolgen voor heeft?

Een sessie sluit niet voordat dit gecheckt is. Dit is de prijs van een architectuur die niet divergeert.

### 13.4 Voor toekomstige sessies — onboarding-pad

Een nieuwe Claude-sessie (of een nieuw model over een jaar) die voor het eerst aan deze stack werkt, leest in volgorde:

1. **`current_architecture.md`** — sectie 1 + 5 + 7 voor het mentale model in 10 minuten.
2. **Confluence koffie-pagina deel 1 + 2** — voor het _waarom_ achter de keuzes, ~25 minuten.
3. **Audit-log onderaan dit document** — om de chronologie van beslissingen te zien.
4. **Intelligence Hub in dashboard** — om de live status te checken voordat hij iets aanraakt.
5. _Pas dan_ aan de slag.

De datascience-skill-routerings-tabel verwijst expliciet naar dit document als startpunt; agent-handbook noemt het in de data-science-sectie.

---

## 14. Database & infrastructuur-keuzes

Welke systemen gebruiken we, welke bewust niet, en waarom. Belangrijk om expliciet te documenteren zodat we deze discussies niet elk kwartaal opnieuw voeren.

### 14.1 Wat we gebruiken

| Systeem | Status | Reden |
|---|---|---|
| **Supabase Postgres** (met pgvector-extensie) | central | Eén database voor alles: vector + relationeel + RPC + RLS. Op onze schaal (huidig ~20k entities, projectie 100-200k) ruim voldoende. Operationeel één systeem in plaats van twee. |
| **HNSW indexes (vector_cosine_ops)** | actief | Sneller dan IVFFlat onder ~100k vectors per tabel, geen rebuild nodig bij groei. Defaults `m=16, ef_construction=64` — voldoen op huidige schaal. |
| **PostgreSQL FTS (tsvector + GIN)** | toe te voegen in fase R.4 | Voor de keyword-helft van hybrid retrieval. Onderdeel van Postgres — geen extra systeem. |
| **Supabase Vault** | actief sinds 2026-05-02 | Canonieke secret-store. Geen secrets meer in `agent_config`. Naming `skill:<name>:<key>`. |
| **Supabase Edge Functions** (Deno/TypeScript) | actief | Voor sync, chunking, embedding, context-build, rerank. Goedkoop, low-latency, in repo geversioneerd. Wall-time-limiet 90s — past bij batches. |
| **OpenAI text-embedding-3-small** (1536d) | actief | $0.02/1M tokens. Voldoende voor NL tot baseline-cijfers een upgrade rechtvaardigen. |
| **Anthropic Haiku** | toe te voegen voor contextual prefix + LLM-rerank + saillante-zin-extractie meetings | Goedkoop (~$0.0001 per chunk-prefix). Past bij grote volumes. |
| **Anthropic Sonnet/Opus** | actief in skills (auto-draft, daily-admin, sales-*, agenda) | Voor generatie waar nuance telt. Niet voor retrieval-laag. |
| **pg_cron + net.http_post** | actief | Trigger voor edge functions vanuit DB. Fallback voor on-demand triggers via RPC `manual_run_requested_at`. |

### 14.2 Wat we bewust NIET gebruiken

| Systeem | Reden voor afwijzen | Heroverwegingstrigger |
|---|---|---|
| **Neo4j / Memgraph / andere graph-DB** | Onze graph-needs zijn 1-hop entity-resolution (Veerle = mail+meeting+deal+...). Postgres-views (`v_entity_edges`) volstaan. | ≥5 user-cases per maand waar multi-hop reasoning ruis geeft, OF dataset > 100k entities en pgvector-recall onder 90%. |
| **Pinecone / Weaviate / Qdrant / Chroma** | Eén systeem minder is beter. pgvector is bewezen op onze schaal. Geen externe vector-DB die we moeten synchroniseren. | Schaal > 1M vectors per source ÉN HNSW-recall > 85% niet meer haalbaar. |
| **Elasticsearch / OpenSearch** | Postgres FTS dekt onze keyword-zoeken volledig. Eén operationeel systeem minder. | Schaal > 1M documents ÉN keyword-query-volume > 1000/min. |
| **Volledige LangChain / LlamaIndex als framework** | Willen explicietere controle over de pijplijn dan een framework geeft. Wel hergebruiken we losse trucs (Anthropic Contextual Retrieval, Reciprocal Rank Fusion, MMR) — die zijn vendor-onafhankelijke technieken, niet frameworks. | Niet in zicht. |
| **Externe LLM-routers (OpenRouter, etc.)** | Direct contract met Anthropic + OpenAI. Eén minder mogelijk faalpunt. Voorkeurmodellen zijn duidelijk en stabiel. | Niet in zicht. |
| **Externe embedding-services (Cohere, Voyage, etc.)** | OpenAI text-embedding-3-small is voldoende en goedkoop. Geen behoefte aan tweede provider-relatie. | text-embedding-3-large blijft achterhalen door benchmarks waar concurrenten nu vóór zitten. |
| **Aparte caching-laag (Redis, etc.)** | Postgres + Edge Function in-memory voor 1 request volstaat. Cache-hits voor identieke queries kunnen via een `context_bundles_cache` tabel met `bundle_id`-key. | P95-latency > 2s op `context-build`, schaal > 100 calls/min. |
| **Containerized self-hosted modellen (Ollama, vLLM)** | Wij willen state-of-the-art en geen ops. Anthropic + OpenAI is goed genoeg en niet de bottleneck. | Cost > €500/maand én privacy-eisen die hosted-models verbieden — geen zicht op. |

### 14.3 Eén-regel-samenvatter

**Alles zit in Supabase (Postgres + Vault + Edge Functions) tot er een hard meet-bewijs is dat het niet meer kan. Externe LLM's gebruiken we als API. Geen frameworks tussen ons en de pijplijn.**

Bij elke "moeten we niet ook X erbij doen?"-vraag: kijk eerst in deze tabel en zijn heroverwegings-trigger. Discussie alleen als trigger geraakt is.

---

## 15. Audit-log

| Datum | Wie | Wijziging |
|---|---|---|
| 2026-05-02 | datascience skill (initial) | Eerste versie. Vastlegging huidige stack + 7 ontwerpprincipes + 8 fasen migratiepad + 6 beslismomenten. |
| 2026-05-03 | datascience skill (Jelle iteratie 1) | Toegevoegd op basis van feedback Jelle: §10 (use-case diversiteit & 8 intent-recepten), §11 (drie-laags chunking voor Fireflies + telefoonrecorder-uitbreiding), §12 (continuous improvement op 3 tijdschalen + ad-hoc backlog), §13 (knowledge-borging als invariant + sessie-checklist + onboarding-pad), §14 (database & infrastructuur-keuzes — wel/niet gebruiken). Verwijzingen naar Confluence-koffie-pagina's deel 1 (id 421920819) en deel 2 (id 422969345) toegevoegd. |
| 2026-05-03 | datascience skill (Jelle iteratie 2 — start van R.1) | §8 beslismomenten gemarkeerd als decided: B.1 ✅ (contextual augmentation met GPT-5-nano, kostenherzien naar ~€15 eenmalig + €3/maand, was foutief €400 in iteratie 1), B.2 🟡 geparkeerd (cost niet de blocker, ROI-onbekend tot R.7), B.3 ✅ (graph-light), B.4 ✅ (vervangen in R.6), B.5 ✅ (~€10/maand), B.6 ✅ (datascience owner, skill ook op bureaublad in `~/.claude/skills/datascience/`). B.7 NIEUW (LLM-rerank uit R.4 gehaald, geparkeerd als optionele R.10 op Jelle's verzoek). §11.6 toegevoegd (12 augmentation-templates per source-type, expliciet definitief geversioneerd). §11.7 toegevoegd (chunks-tabel-schema voorlopig). §7 R.4 simpeler (zonder LLM-rerank); R.9 (Intelligence Hub) en R.10 (LLM-rerank pilot) toegevoegd. Datascience skill gekopieerd naar bureaublad `~/.claude/skills/datascience/` inclusief alle references. R.1 scripts geschreven in `dashboard-react/scripts/r1-repo-hygiene/` (pull-edge-functions.sh, pull-rag-rpcs.sh, README.md). R.1 runbook in `references/r1_runbook.md`. |
| 2026-05-03 | datascience skill (Jelle iteratie 2 — R.1 uitgevoerd) | **R.1 ✅ DONE.** Service-role key gegeven door Jelle, Management Token uit Vault gehaald via `get_skill_secret_service` RPC. Pull-script `pull-all.cjs` (Node, geen jq) draait API: 19 live functions geïdentificeerd, 9 missende gepulled via Supabase CLI (`supabase functions download` — clean source ipv eszip-bundle). 23 RAG-RPC's gedocumenteerd in `migrations/rag_rpcs_documentation_2026_05_03.sql` (1248 regels). Datascience skill als `.skill`-bestand op `C:\Users\LM\Desktop\datascience.skill` (44.691 bytes, 7 files). §7 R.1 gemarkeerd als done. Volgende sessie: README's per function invullen (TODO-secties) en R.2 starten (auto-draft `rag_context` lezen + mini-baseline-meting). |
| 2026-05-03 | datascience skill (Jelle iteratie 3 — B.2 geactiveerd) | **B.2 ✅ EMBEDDING-UPGRADE LIVE.** Jelle akkoord op `text-embedding-3-large` (3072d) — opslag als `halfvec(3072)` ivm pgvector HNSW-limiet (2000 voor vector, 4000 voor halfvec). Migration `migrations/embedding_3l_upgrade_2026_05_03.sql` deployed via Management API: 9 tabellen × `embedding_3l` halfvec kolom + tracking-kolommen + HNSW-index (halfvec_cosine_ops, m=16, ef_construction=64). Nieuwe edge function `supabase/functions/mail-embed-3l/` v1.1 (BATCH_SIZE=25, UPDATE_SLICE=10 voor memory-headroom — eerste test gaf WORKER_RESOURCE_LIMIT bij batch=100). Live invocatie: 725 records geëmbed in 5 cycles, 152.727 tokens (~$0.02), 0 warnings. pg_cron entry `mail-embed-3l-cron` (*/3 min) actief, draait tot alle 18.724 pending records klaar zijn (~1.5-2u). Mail-embed v2 blijft parallel draaien (oude `embedding` kolom) tot match_all_sources is omgeschakeld. §8 B.2 gemarkeerd als ✅ + B.2-LEGACY als historisch. |
| 2026-05-03 | datascience skill (Jelle iteratie 4 — CUTOVER COMPLEET) | **B.2 100% ✅ + LEGACY VOLLEDIG WEG.** Tussenstap-debug: pg_cron faalde (silent) doordat `agent_config(global, cron_secret)` leeg is sinds Vault-migratie 2 mei. Cron-entry naar `vault.decrypted_secrets` gefixed via `cron.alter_job`. Burst-loop (5 manual + 25 background calls) bracht backfill van 9.5% naar 100% (20.698 records totaal). **Cutover-sessie**: stop oude crons → run `migrations/embedding_3l_cleanup_2026_05_03.sql` (drop legacy + rename `embedding_3l` → `embedding` op 9 tabellen + drop+recreate `match_all_sources`/`match_jellemind_lessons` met `halfvec(3072)` parameter) → deploy 4 nieuwe edge functions (`mail-embed` v3.0, `rag-search` v2.0, `autodraft-rag-prefill` v2.0, `jellemind-embed` met 3-large) → DELETE oude `mail-embed-3l` function → schedule nieuwe `mail-embed-cron` met Vault-auth. **Smoke test**: rag-search retourneert 3 matches op "offerte advocatenkantoor" (similarity 0.63-0.65, embed 1946ms + search 2275ms = 4.2s — eenmalig cold start). Schema-check: 0 `_3l` kolommen meer, alle 9 tabellen op `halfvec(3072)`. **Skills**: niet aangepast nodig — match_all_sources keeps same return-shape, autodraft_mails.rag_context jsonb keeps same structure. |
| 2026-05-03 | datascience skill (Jelle iteratie 5 — R.2+R.3+R.4 in één sessie) | **R.2 ✅ + R.3 ✅ + R.4 ✅.** R.2: auto-draft Stap 6b toegevoegd (leest `rag_context.matches[]`, citaat-stijl bij similarity ≥ 0.6, telemetry `stats.rag_context_used`). Migration `migrations/rag_quality_telemetry_2026_05_03.sql` deployed: tabellen `rag_quality_baselines` + `rag_outcomes` + `rag_chunk_signals` + RPC `log_rag_outcome`. R.3: migration `migrations/chunks_table_r3_2026_05_03.sql` deployed (chunks-tabel met halfvec(3072) + GIN voor entity_ids/fts_vector + HNSW + FTS-trigger op tsvector). Edge function `chunker` v1.0 deployed: 9 source-types (mail, engagement, jira, deal, company, contact, meeting, event, lesson), GPT-5-nano contextual prefix per chunk (fallback gpt-4.1-nano), text-embedding-3-large embedding. Eerste test: 181 chunks gemaakt in 3 cycles, 44.329 tokens (~$0.005). pg_cron `chunker-cron` */5 min actief — backfill loopt. R.4: migration `migrations/match_chunks_r4_2026_05_03.sql` deployed: nieuwe RPC `match_chunks(query_embedding halfvec, query_text, top_k, filter_*, recency_weight=0.15, recency_decay_days=90)` — hybrid retrieval via WITH CTE: vector_hits (HNSW) + bm25_hits (FTS via plainto_tsquery dutch) + RRF (k=60) + recency-decay. Smoke test op "offerte advocatenkantoor demo": 3 hits met combined_score 0.20-0.25 (vector 0.45, bm25 0, recency 1.3-1.6). `rag-search` v3.0 + `autodraft-rag-prefill` v3.0 deployed (gebruiken nu match_chunks ipv match_all_sources). Reference updates: `jellemind/SKILL.md` + `agent-handbook/references/datascience-embeddings.md` (model→3-large, halfvec, contextual augmentation). Confluence: nieuwe koffie-pagina **id 423034942** "Onze hersenen — deel 3 — wat er nu echt staat" onder parent 411271170. **Nog open**: chunks-backfill ~25k records (loopt automatisch via cron, ~1-2 dagen tot compleet), R.2 mini-baseline-meting (20 mails A/B), R.5 entity-laag (geparkeerd tot na backfill compleet). |
| 2026-05-03 | datascience skill (Jelle iteratie 6 — twee silent-failure-fixes) | **Twee bugs gefixt die in iteratie 5 onopgemerkt waren.** (1) **Chunker-backfill stond stil op exact 30 chunks/source** — `fetchUnchunked()` ordende top-N en filterde reeds-gechunkte client-side weg. Top-N was na de eerste run altijd al gechunkt → 0 nieuwe records → einde, ondanks "succeeded" cron. **Fix**: nieuwe RPC `fetch_unchunked_source_ids(source, limit)` met server-side `NOT EXISTS` (migration `fetch_unchunked_source_ids_2026_05_03`); chunker v1.1 gedeployed. Backfill verifieerd: 30 → 200 chunks/source binnen 2 runs. (2) **6 sync-cron-jobs gaven HTTP 401 sinds 2 mei** (mail/jira/hubspot/engagements/calendar/fireflies) — lazen bearer-token uit lege `agent_config('global','cron_secret')` na Vault-migratie. `chunker-cron` en `mail-embed-cron` lazen al uit Vault, vandaar dat alleen die werkten. **Fix**: migration `cron_jobs_vault_auth_fix_2026_05_03` zet alle 6 jobs naar `vault.decrypted_secrets WHERE name='skill:global:cron_secret'`. Verifieerd: 8/9 sync_health_all keys nu fresh (was 0/9), 6 succesvolle handmatige sync-runs. **Lessen** (in IAB-22 Jira-comment): silent-failure-patroon "agent_config-secret-leeg sinds Vault-migratie" mogelijk breder; cron-job health-check op response-code ontbreekt; agent_runs.last_run is kanonniek auth-uitval-symptoom. **Volgende stap**: R.5 entity-laag voorbereiden (`v_entity_edges` view) — niet langer geblokkeerd door backfill. **R.5 prep ✅** — view `v_entity_edges` aangelegd via migration `v_entity_edges_r5_prep_2026_05_03` (13 edge-types over directe FK-velden in HubSpot/Jira/Mail/Calendar). Totaal ~21.5k edges. |
| 2026-05-03 | datascience skill (Jelle iteratie 7 — R.5 hoofdfase) | **R.5 grotendeels ✅** (zonder match_chunks-aanpassing — die wacht op Jelle ivm live RPC). Migration `entity_resolution_r5_2026_05_03`: tabel `entity_resolution(alias_type, alias_value, entity_type, entity_id, confidence, source)` met UNIQUE(alias, entity)-constraint en lookup-index. Idempotente backfill-RPC `refresh_entity_resolution()` die uit HubSpot mirror inserts: (1) email→contact (413 entries, conf 1.000), (2) email_domain→company (455 entries, conf 0.900, met blacklist voor consumer-providers gmail/outlook/etc.), (3) name→contact (418 entries, conf 0.700). Totaal **1.286 resolutions**. Migration `v_entity_edges_full_r5_2026_05_03`: nieuwe view `v_entity_edges_full` = `v_entity_edges` UNION ALL met **resolved edges** via entity_resolution: mail→contact (authored_by, 6.528), mail→company (from_company, 8.497), event→contact (attended_by, 97), meeting→contact (organized_by, 2). Resultaat: 36.661 edges totaal (vs 21.537 base) — 15.124 nieuwe resolved edges. **Cross-source vraag "geef alle interacties met klant X" werkt nu**: traverseer 1-hop via v_entity_edges_full → mails (via domain), engagements (via FK), deals (via FK), contacts (via FK), event-attendees (via email). **Open**: (a) `match_chunks` uitbreiden met `filter_entity_id` + `hop_depth` parameters om bovenstaande traversal in retrieval te integreren — vereist Jelle's go ivm live RPC; (b) `refresh_entity_resolution()` als nightly cron (kandidaat-schedule: `30 3 * * *`); (c) Haiku-fallback voor edge cases (laag-confidence aliases, fuzzy name match) — pas relevant na meer data. |
| 2026-05-03 | datascience skill (Jelle iteratie 8 — R.7 instrumentatie) | **R.7 baseline-pipeline ✅ (auto-logging zonder skill-aanpassing).** Migration `autodraft_rag_outcome_trigger_2026_05_03`: trigger-functie `log_autodraft_rag_outcome()` + 2 triggers op `autodraft_decisions` (AFTER UPDATE OF execution_status, AFTER INSERT — beide WHEN execution_status='done'). Mapping: action `send`→outcome `accept`, `amend`→`amend`, `ignore`/`spam`→`reject`. Idempotent (skip als rag_outcomes-rij voor decision al bestaat). Exception-handling: schrijft 'rag-outcome-trigger' run met status='warning' naar agent_runs bij fout, blokkeert hoofdtransactie nooit. Backfill van bestaande historie: **1 outcome gelogd** (4 chunks, avg-similarity 0.92, action=amend) — autodraft historie met `rag_context` is klein omdat de pre-fill pas sinds 2026-04-28 echt loopt en sinds 2026-05-03 v3.0 (match_chunks). Vanaf nu bouwt elke uitgevoerde decision automatisch quality-data. **Wat dit oplevert** voor R.7: na ~50-100 decisions per chunk_type kan acceptance-rate-analyse beginnen ("welke chunk-types eindigen in geaccepteerde drafts vs in amendments vs in rejects"). Dat is de eerste meetlat voor de hele intelligence-stack. **Open** voor R.7 hoofdfase: (a) `IntelligenceQualityView` dashboard-pagina; (b) wekelijkse `rag-tuning-weekly` job die patronen detecteert en `rag_tuning_proposals` aanmaakt; (c) instrumentatie uitbreiden naar sales-on-road / daily-admin / sales-followups zodra die `rag_context` consumeren. |
| 2026-05-04 | datascience skill (Jelle iteratie 9 — afronden R.5 + 2 nieuwe fixes) | **Overnight: chunker-backfill 100% klaar** in alle 8 sources (20.768 records — sneller dan de 17u-schatting). Geen errors, sync grotendeels fresh. **R.5 voltooid (op match_chunks-deploy-go na):** (a) RPC `match_chunks_for_entity(entity_type, entity_id, query_embedding, query_text, ...)` toegevoegd via migration `match_chunks_for_entity_r5_2026_05_04`. Wrapper rond match_chunks die via 1-hop traversal van `v_entity_edges_full` filtert op gerelateerde (source, source_id) tuples. **Backwards-compat**: `match_chunks` zelf onveranderd, alle bestaande consumers (rag-search, autodraft-rag-prefill) blijven werken. Smoke-test: query "offerte advocatenkantoor" + company_id 282356269251 (Barentskrans) → 5 mails gevonden via `from_company` resolved-edge, vector-scores 0.69-0.74, entity_path-bewijs in elke output. (b) `refresh_entity_resolution()` als nightly cron geschedule'd: `entity-resolution-nightly` (jobid 19, schedule `30 3 * * *`, past tussen contactpersonen-sync 02:30 en task-organizer 03:55). **Ronde-2 cron-Vault-fix**: audit op overige `agent_config(global, *)`-lookups vond 4 extra cron-jobs met dezelfde silent-401-bug als gisteren — `mail-backfill-cron`, `autodraft-rag-prefill-cron`, `task-organizer-fireflies`, `jellemind-embed-cron`. 120 unauthorized-responses in afgelopen 12u (geen agent_runs voor deze 4 skills sinds Vault-migratie). Migration `cron_jobs_vault_auth_fix_round2_2026_05_04` patcht alle 4 naar `vault.decrypted_secrets`. Verifieerd: jellemind-embed → success, autodraft-rag-prefill → running zonder 401. **Memory-update**: `vector_rag_v1_architecture.md` aangepast naar v2 (was sterk verouderd — claimde nog `match_all_sources` over 6 bronnen). **Open**: (a) `match_chunks_for_entity` is een nieuwe RPC; nog géén skill consumeert hem — Jelle's volgende beslissing: welke skill eerst migreren? (autodraft-rag-prefill is kandidaat — hij weet de mail-from al, kan dus mail.from_email resolven naar contact_id en `match_chunks_for_entity('contact', X)` doen voor extra recall); (b) hop_depth>1 nog niet geïmplementeerd in entity-traversal (recursive CTE toekomst); (c) instrumentatie uitbreiden — zie iteratie 8 punt (c). |
| 2026-05-04 | datascience skill (Jelle iteratie 10 — legacy cleanup post-chunks) | **Schoonmaak van wat er overbleef sinds R.4 cutover.** Migration `legacy_cleanup_post_chunks_2026_05_04`: (1) RPC `match_all_sources` gedropt (alle overloads, vector + halfvec); (2) RPC overload `match_jellemind_lessons(vector,...)` gedropt — halfvec-variant blijft als enige; (3) per-tabel embedding-stack (`embedding`, `embedded_at`, `embedding_model`, `embedding_input_hash`) gedropt op 8 truth-of-source tabellen (mail_messages, hubspot_engagements/deals/companies/contacts, jira_issues, fireflies_meetings, calendar_events) — HNSW-indexes auto-cascaded; (4) `legal_ai_findings.embedding` (vector type, 0/21 records gevuld, geen consumers) gedropt; (5) `sync_health(source)` herschreven: `'embedding'`-bron bekijkt nu chunks + jellemind_lessons (was: 8 truth-of-source kolommen die er niet meer zijn). Nieuwe `'chunks'`-source toegevoegd; (6) cron-job `mail-embed-cron` (jobid 17) unscheduled. **Edge Function**: `mail-embed` v6 deleted via Management API (HTTP 200). **Repo**: `dashboard-react/supabase/functions/mail-embed/` en `mail-embed-3l/` folders verwijderd. **Frontend**: 4 files (`FunctionsView.jsx`, `EdgeFunctionsPage.jsx`, `Agents.jsx`, `TruthOfSourcesView.jsx`) gepatcht — `mail-embed`-entries vervangen door `chunker`-entries waar relevant (consumedBy / NEVER_SHOW / SOURCE_FUNCTIONS / agent_runs.in()-filters). Build verifieerd: dev-server start zonder errors, console clean. Live deployed = repo (20 functions exact aligned). **Wat blijft staan**: `jellemind_lessons.embedding` (gebruikt door `match_jellemind_lessons` halfvec voor jellemind-skill — aparte parallel-pipeline), `mail-backfill` Edge Function + cron (idle nu er 0 pending records zijn, springt aan bij nieuwe folder of refresh), alle sync-ETLs. |
| 2026-05-04 | datascience skill (Jelle iteratie 11 — eerste consumer match_chunks_for_entity) | **`autodraft-rag-prefill` v4.0** — eerste skill die `match_chunks_for_entity` echt gebruikt. Twee retrieval-passes per draft: (a) **SEMANTIC** via `match_chunks` (top 5, recency_weight 0.20), (b) **ENTITY-AWARE** via `match_chunks_for_entity` zodra `from_email` of `from_domain` resolveert via `entity_resolution` (top 5). Merge + dedupe op chunk_id → top 5 final, met `source_strategy='semantic'\|'entity'` per match. `rag_context` krijgt `retrieval_strategy`, `entity_used` (type/id/via/confidence), en `passes.semantic_n / entity_n` metadata. **Bug-fix mee**: v3.0 BM25-query gebruikte `draft.subject` (undefined op autodraft_mails-row) → BM25-score altijd 0; nu correct via `mail.subject` + `mail.body_preview`. **RPC-patch `match_chunks_for_entity_edge_cap_2026_05_04`**: nieuwe param `p_max_edges` (default 2000) cap't de 1-hop traversal tegen mega-entities. SetOn Legal (7155 edges) gaf eerder statement-timeout op de entity-pass — nu sub-second. Edges geordend op `confidence DESC` zodat hoogste-zekerheid-eerst meedoet. **Smoke-tests** (3 drafts gereset + getriggerd): alle 3 entity-resolved (2 via email, 1 via domain), avg top-sim 0.21, top-source mix `entity` en `semantic`. Re-test op SetOn-mail na RPC-patch: status=success, entity_n=5 (was 0 met timeout), 0 warnings. **Open** voor volgende iteratie: (a) hop_depth>1 in match_chunks_for_entity; (b) tweede consumer-skill kandidaat (sales-followups: deal_id is bekend, kan `match_chunks_for_entity('deal', X)` doen); (c) acceptance-rate-meting via R.7 trigger zodra Jelle drafts begint te beoordelen. |
| 2026-05-04 | datascience skill (Jelle iteratie 12 — tweede consumer + skill-compat-check) | **Skill-compatibiliteits-audit** + **`sales-followups` v4 als tweede consumer**. (1) Skill-compat-check: jellemind-skill noemt `match_jellemind_lessons` alleen als reference, geen runtime-call → geen impact van vector-overload-drop. auto-draft leest `rag_context.matches[]` met legacy `similarity` field-name die v4-prefill behoudt → functioneel werkt het. **Twee plekken in auto-draft/SKILL.md** noemden nog `match_all_sources` (RPC bestaat niet meer) — geüpdatet naar de nieuwe twee-passes-beschrijving (semantic + entity-aware) + `retrieval_strategy`/`entity_used`/`passes` metadata-uitleg + telemetrie-veld `stats.rag_strategy`. (2) `sales-followups` v3→v4: nieuwe **Stap 3.5 — RAG-context per deal** vóór draft-write. Slimme query-strategie: hergebruik `chunks.embedding` van de deal-master-chunk (`source='deal' AND source_id=$deal_id`) als query-embedding — geen externe embed-call vanuit skill nodig. Roept `match_chunks_for_entity('deal', deal_id, ...)` aan met top_k=5, hop_depth=1, recency_weight=0.20. Skip-conditie: deal-master-chunk bestaat niet (te nieuw) → silent skip. Stap 4 uitgebreid met `log_rag_outcome` call zodra draft daadwerkelijk in Outlook is geplaatst → R.7-instrumentatie automatisch. Stats-block uitgebreid met `todos_with_rag_context`, `todos_skipped_rag_no_chunk`, `rag_avg_top_similarity`. **Smoke-test live deal** (PENTRA Advocaten, deal_id 501311812830): retourneerde deal-master-chunk (combined 0.221, via=self) + 4 betrokken contacts (combined 0.211, via=involves). Werkt out-of-the-box, geen extra deploy nodig (prompt-skill — volgende run is automatisch v4). **Compat samenvatting voor Jelle**: alle bestaande skills blijven functioneel werken, geen breaking changes. Twee SKILL.md-files geüpdatet voor docs-actuariteit (auto-draft + sales-followups). |
| 2026-05-04 | datascience skill (Jelle iteratie 13 — RAG-quality + 3 nieuwe consumers + .skill bundles) | **PENTRA-smoke-test-feedback verwerkt** + **derde + vierde consumer geïntegreerd**. (1) **Diagnose** PENTRA: 17 mails van pentra.nl en 1 HubSpot-engagement bestonden, maar smoke-test toonde alleen contacts. Twee oorzaken: (a) `v_entity_edges_full` had geen `mail → deal` edge — alleen `mail → company` via from_domain; (b) 5 contact-master-chunks met identieke combined_score domineerden top-5. **Migration `v_entity_edges_full_mail_to_deal_2026_05_04`**: + `mail → deal (from_contact_on_deal)` via `mail.from_email → entity_resolution → deal.associated_contact_ids` (confidence 0.95) + `mail → deal (from_company_on_deal)` via from_domain → company → deal (confidence 0.75). Voor PENTRA: 12 + 17 nieuwe mail-edges. **Migration `match_chunks_for_entity_diversity_2026_05_04`** (RPC v3): nieuwe param `p_max_per_source` (default 3) cap't aantal chunks per source-type via `ROW_NUMBER() OVER (PARTITION BY source ORDER BY combined_score DESC)`. Voorkomt monopolie. **Re-smoke PENTRA** met `top_k=8, p_max_per_source=2`: nu deal-master + company-master + 2 contacts + **engagement-note** ("Nieuwe afspraken in nieuwe licentieovereenkomst…") + **2 mails van pentra.nl** (via `from_company_on_deal`). Echte rijke mix. (2) **Daily-admin v5.2**: regel 76 ("vóór proposal: hubspot_engagements + mail_messages + hubspot_deals JOIN") vervangen door één `match_chunks_for_entity('deal', deal_id, top_k=8, p_max_per_source=2, recency_weight=0.25, recency_decay_days=60)` aanroep. Skip-fallback naar legacy losse-queries als deal/contact-chunk niet bestaat. Plus `log_rag_outcome` na proposal-create. (3) **Sales-on-road v4**: stap 4 (90d mail-historie) vervangen door `match_chunks_for_entity('company', hubspot_company_id, top_k=10, p_max_per_source=3)` voor cross-source context (mail + engagements + meetings ipv alleen mail). Legacy mail-query als fallback. (4) **Skill-bundles** op `C:\Users\LM\Desktop\` via `dashboard-react/scripts/zip-skill.cjs` (description ≤1024 chars geverifieerd voor alle 4): `sales-followups.skill` (4.9KB), `daily-admin.skill` (8.9KB), `sales-on-road.skill` (6.2KB), `auto-draft.skill` (32.6KB rebuilt na docs-update). **Open**: hop_depth>1 in match_chunks_for_entity (recursive CTE), R.6 context-build CaaS, R.8/R.9 dashboard UI. |
| 2026-05-04 | datascience skill (Jelle iteratie 14 — search-pagina entity-aware + 2 nieuwe consumers) | **R.8 zoekpagina-revisie ✅** + 2 extra consumers (5e + 6e). (1) **`rag-search` v4.0** (deployed → v5 ACTIVE): optionele params `filter_entity_type` + `filter_entity_id` + `max_per_source`. Bij beide gegeven → roept `match_chunks_for_entity` aan ipv `match_chunks`. Backwards-compat: zonder entity-params blijft de standaard hybrid retrieval werken. Response bevat nu `retrieval_strategy` ("match_chunks_v1_hybrid" of "match_chunks_for_entity_v3") + `entity_path` per match wanneer entity-pad. (2) **`RagSearchView.jsx` v2**: + `EntityPicker`-component (dropdown voor type + autocomplete-zoekbox die `hubspot_companies/contacts/deals` ilike-queriet, debounced 250ms, top 10 suggesties met klik-buiten-sluiten). Geselecteerde entity toont als chip met ✕-reset. + meeting/event source-pills (was 6, nu 8 sources). + `via_edge` zichtbaar in result-cards bij entity-pad. + retrieval_strategy zichtbaar in stats-regel. Build verifieerd: dev-server start zonder errors, console clean. (3) **task-organizer v2**: nieuwe optionele Stap 5b — bij task die een bekende klant noemt, doe één RAG-call om reasoning-string te verrijken (max 120 chars). Niet de project-toewijzing zelf — die blijft op `suggest_task_project`. Skip-fallback als geen entity-match. (4) **agenda v2**: appointment-matching krijgt entity-aware context-fetch vóór slot-detectie. Resolve afzender-email→contact (of domain→company), pak top-5 chunks via match_chunks_for_entity, gebruik voor (a) urgentie-scherpe (stilte vs. recent contact), (b) `notes_ai` thema-zin, (c) dubbele-afspraak-check (≤7d zelfde onderwerp). (5) **Skill-bundles op desktop**: `task-organizer.skill` (5.1KB), `agenda.skill` (4.4KB) toegevoegd. Description ≤1024 chars geverifieerd. **Open**: hop_depth>1 in entity-traversal (recursive CTE — pas zinvol bij concrete vraag), R.6 context-build CaaS, R.9 Intelligence Hub view, R.7 IntelligenceQualityView dashboard-pagina. |
| 2026-05-04 | datascience skill (Jelle iteratie 15 — R.9 + R.7 dashboard + Vercel deploy) | **R.9 Intelligence Hub view ✅** + **R.7 IntelligenceQualityView ✅** + **Vercel-deploy live**. (1) Push naar `main` met commit `ada7e36`: 52 files, alle RAG-werk van iteraties 1-14 (chunks-tabel, entity-resolution, match_chunks/match_chunks_for_entity, 6 consumers, search-pagina entity-aware, cleanup, mail-embed delete). Vercel auto-deploy triggert direct. (2) **`IntelligenceHubView.jsx`** (`/intelligence`, in sidebar onder Operations naast Zoeken): 7-stadia pijplijn-diagram (sync→chunk→embed→index→retrieve→consume→quality), live `sync_health_all` panel met groen/geel-dots, chunks-counts per source uit `chunks`-tabel, edges + resolutions counts, recente runs van chunker/autodraft-rag-prefill/jellemind-embed, beslissingen-log B.1-B.7 gerendered uit current_architecture.md §8. Empty-state-friendly bij <1 outcome. (3) **`IntelligenceQualityView.jsx`** (`/intelligence/quality`, sub-tab via "Diepere analyse →" link): aggregeert rag_outcomes naar acceptance-rate per `source_type` (skill), per `retrieval_strategy` (match_chunks vs match_chunks_for_entity), per chunk-source-type. Avg top-similarity per outcome. Recent-50 timeline. Empty-state met uitleg dat trigger op autodraft_decisions het automatisch vult. Hypothese-tekst over entity-aware-uplift, wacht op ≥10 outcomes per strategy voor betekenisvolle vergelijking. (4) Sidebar-icoon (target-symbool) toegevoegd voor `intelligence` view. Build verifieerd zonder errors voor beide preview-sessions. **Open** voor volgende grote stap: **R.6 context-build CaaS** — generieke `context-build` Edge Function + `context_bundles` tabel die de 6 ad-hoc skill-RAG-calls vervangt door één bundle-endpoint (Principe 2 §5). Niet blocker maar wel architectuurdoel. |
| 2026-05-04 | datascience skill (Jelle iteratie 16 — R.6 context-build CaaS + optionele Haiku-rerank) | **R.6 ✅ — Context-as-a-Service live**. Migration `context_bundles_r6_2026_05_04(_fix)`: tabel `context_intents` (config per intent — 8 recipes geseed: draft_reply / enrich_record / extract_actions / compose_followup / match_appointment / search / learn_pattern / analyze_meeting met defaults voor strategy / top_k / recency / lookback / rerank), tabel `context_bundles` (audit-trail van alle bundles, met intent / audience / trigger-link / primary_record / related_chunks / entity_used / freshness / retrieval_meta / build_ms), RPCs `get_context_intent` + `log_context_bundle`. `rag_outcomes.context_bundle_id` kolom toegevoegd voor R.7-link. **Edge Function `context-build`** v1.1 deployed (v2 ACTIVE): POST-endpoint dat per intent retrieval-params uit recipe leest, optionele entity-resolution doet, embed query, roept `match_chunks` of `match_chunks_for_entity` aan obv strategy ('hybrid' = best-effort entity-aware met fallback), schrijft naar context_bundles, retourneert {bundle_id, matches, entity_used, retrieval_meta, freshness}. **Optionele Haiku-rerank** ingebouwd (`enable_rerank` flag — default per recipe, voor `search` default AAN, rest UIT): bij true wordt top retrieveK=top_k×3 opgehaald, Haiku ranked top-K op query-relevance, fallback bij API-fail naar deterministisch vector-rang. Anthropic-key nog niet in Vault → graceful skip met warning. **autodraft-rag-prefill v5.0** (Edge Function v6 ACTIVE): retrieval-logic verwijderd, roept nu context-build aan met intent='draft_reply'. Bundle_id geschreven in `autodraft_mails.rag_context.bundle_id` voor R.7-link. **R.7 trigger v2** (`autodraft_rag_outcome_trigger_with_bundle_2026_05_04`): leest bundle_id uit rag_context en linkt naar `rag_outcomes.context_bundle_id` zodat acceptance-rate per bundle/intent meetbaar wordt. **Smoke-tests**: (a) compose_followup voor PENTRA-deal → bundle 0dd4eb5d met 5 chunks via match_chunks_for_entity in 1217ms; (b) draft_reply voor SetOn-mail → bundle c22ecd51 met entity company 337052051679 via email_domain, strategy match_chunks_for_entity, 3 chunks. End-to-end werkt: skill → context-build → entity-resolve → retrieval → bundle → autodraft_mails.rag_context.bundle_id. **Open**: 5 andere consumers migreren (sales-followups / daily-admin / sales-on-road / task-organizer / agenda) van directe RPC-calls naar context-build (alleen documentation-update — Claude-skills lezen instructies live), Anthropic-key in Vault zetten voor rerank, R.7 dashboard zal nu naast strategy ook bundles gaan tonen. |
| 2026-05-04 | datascience skill (Jelle iteratie 17 — project-afronding + 5 consumers + zoekpagina v3 + Confluence) | **Project RAG Quality Engineering AFGEROND.** (1) **5 consumer-skills naar context-build** SKILL.md geüpdatet: sales-followups v5, daily-admin v5.3, sales-on-road v5, task-organizer v3, agenda v3. Per skill: directe RPC-call vervangen door POST naar `context-build` met juiste intent + bundle_id-link in `log_rag_outcome`. (2) **rag-search v5** (Edge Function v6 ACTIVE): dunne wrapper rond context-build, returnt bundle_id naar frontend voor feedback-link. (3) **Migration `log_search_feedback_rpc_2026_05_04`**: RPC die zoekpagina-feedback (✓/✕) schrijft naar rag_outcomes met `source_type='search'`, idempotent op (bundle_id, chunk_id), context_bundle_id-link. (4) **RagSearchView v3 — kwaliteit-gerichte UI**: resultaten gegroepeerd per source-type (Mails / Engagements / Deals / etc.) met collapsible source-groups, compacte rij + expand voor full content + score-breakdown (Vector / BM25 / Recency / Combined als horizontal bars), entity_path zichtbaar bij entity-pad, per-row "✓ nuttig" / "✕ ruis" knoppen direct aan log_search_feedback, QualityBar bovenaan met source-distribution chips + retrieval-strategy + entity_used + reranked-flag + timing-breakdown + bundle_id + feedback-count, rerank-toggle (Haiku) in filters, max_per_source slider. (5) **Skill-bundles op `C:\Users\LM\Desktop\`** (rebuild met v5 docs): `sales-followups.skill` (5KB), `daily-admin.skill` (9KB), `sales-on-road.skill` (6.3KB), `task-organizer.skill` (5KB), `agenda.skill` (4.4KB), `auto-draft.skill` (32.6KB). Alle description ≤1024 chars geverifieerd, valide paths. (6) **Confluence**: project-pagina **id 415137797** geüpdatet naar "(afgerond)", verplaatst naar Afgerond folder (parent 414711809), volledige eind-rapportage met R.1-R.9 status-tabel + architectuur-diagram + cost-overzicht + verifieer-snippets. **Nieuwe koffie-pagina deel 4 — id 425754635** "Onze hersenen — deel 4 — hoe we vanaf hier blijven verbeteren" onder parent 411271170: drie improvement-loops (wekelijks tuning / maandelijks A/B / kwartaal model-review), drie soorten verbeteringen (tuning / strategy / architectuur), checklist "wanneer doen we wat", uitleg dat verbetering nu een doorlopende activiteit is ipv aparte projecten. **Vercel deploy** commit 857cb91 → main. **Eindstand**: hele R-roadmap (R.1-R.9 + R.6 CaaS) is af. R.10 LLM-rerank ingebouwd als optionele knop. Continue improvement loopt via R.7 quality-dashboard + zoekpagina-feedback. |
