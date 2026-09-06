# Changelog — Maestro-chat

Alleen wijzigingen die het gedrag van de chat raken. Voor het waaróm: `DECISIONS.md`.

---

## 2026-09-06 · Spoor 06f-α — mechanica en hygiëne in `match_chunks` (backend-only, geen `APP_VERSION`-bump)

Geen UI-wijziging; wel ander retrieval-gedrag voor élke aanroeper van `match_chunks`
(rag-chat, autodraft, daily-admin, meeting-briefing). Besluiten en metingen:
`DECISIONS.md` 2026-09-06 (06f-α) en `06-rag-per-source/IMPLEMENT-NOTES.md`.

**Retrieval (migratie `20260906210000_06f_alpha_match_chunks_mechanics`)**
- `match_chunks` is plpgsql en zet `hnsw.ef_search` zelf: 80 op het vector-only pad en onder
  de iteratieve scan, 40 op het ongefilterde hybride pad (BM25 zit daar tegen de 8 s-timeout,
  gemeten onder de 6-parallelle evallane); bij een hard filter
  (`filter_sources`, `filter_after`, `filter_entity_id`, audience/category/enrichment-filters,
  uitgesloten bronnen) ook `hnsw.iterative_scan=relaxed_order` met `max_scan_tuples=4000`.
  Gemeten: mail + 90 d gaf 1 van 40 rijen, alleen meeting 0 → nu 40/40. Echte pad (8 vragen):
  meeting-filter mediaan 0 → 40, confluence+kb-filter 0 → 40.
- LIMIT in de vector-arm: `top_k*10` alleen met `query_text`; `top_k*2` bij caps; anders
  `top_k`. rag-chat krijgt nu de gevraagde 60 kandidaten (was stil 40).
- Nieuwe parameters `max_per_record`, `max_per_source`, `source_overrides` (match_chunks) en
  `p_max_per_record`, `p_source_overrides` (match_chunks_for_entity). Default NULL = uit.
- Recency-klem: een `occurred_at` in de toekomst telt met zijn afstand tot nu in plaats van
  1,0; `event` blijft `future_ok` (default, per recept uit te zetten).
- proacl beide functies hersteld op `{postgres,authenticated,service_role}` (geen PUBLIC).

**Recepten (migratie `20260906211000_06f_alpha_recipe_caps`, `context-build` v2.10)**
- `context_intents.max_per_record / max_per_source / source_overrides`; `search_fast` = 2 / 12.
  Gemeten vóór op 20 benchvragen: max 40 meeting-chunks per bundel, max 11 chunks van één
  record. `context-build` v2.10 geeft de kolommen door en logt ze in `retrieval_meta`.

**Hygiëne (migratie `20260906212000_06f_alpha_rag_chunks_reconcile`)**
- Onder de iteratieve scan is de vector-LIMIT begrensd op `greatest(top_k, 120)`: met 450
  kostte een mail-gefilterde hybride call 2,1 s extra en liep de BM25-arm in de 8 s-timeout.
- `chunks` krijgt een eigen autovacuum-drempel (200 dode tuples, scale 0): verwijderde chunks
  blijven anders als tombstones in de HNSW-graaf meetellen in `ef_search` (probe 80 → 60 levende
  rijen). Een VACUUM-cron faalt op de 120 s `statement_timeout` van de cron-sessie.
- `rag_chunks_reconcile(p_dry_run, p_max_fraction)` + cron `rag-chunks-reconcile-daily`
  (03:50 UTC): chunks van verwijderde mails, race-dubbelen per mail, gearchiveerde
  deals/engagements, geannuleerde of soft-deleted events, niet-gevalideerde kb-artikelen,
  gearchiveerde Confluence-pagina's, personal meetings, inactieve lessons, actions zonder
  besluit, verdwenen company/contact/jira. Vangnet > 50 én > 25 % per bron. Logt in `agent_runs`
  (`rag-chunks-reconcile`, run_type `pg_cron`).
- `fetch_unchunked_source_ids('event')` slaat soft-deleted events over.

**Evalbank**
- Runner `rag-eval-cron` v3.2: `expect_min_chunks`, `max_chunks_per_record`, `top1_not_future`,
  `expect_sources_live` (DB-check op `mail_messages.is_deleted`), `options.filter_after_days`.
- Items RO51–RO54 (= 06F-R01..R04): gefilterde recall, flooding, wezen, toekomstdatum.

---

## v1.148 — 2026-09-06 · Answer-stack S3b, stap 1: Sol op de lus, Luna op de hulpmodellen, echte tarieven

Geen zichtbare wijziging: Grok 4.3 schrijft nog elk antwoord, ook de navertelling
van de agent-conclusie. Stap 2 (Terra semantisch, Sol streamt zelf) volgt in een
eigen PR met een blokkerende A/B. Beslissing: `ANSWER-STACK-RESEARCH.md` §8.

**Modelpins**
- `agent_config('rag-chat','agentic_model')` → `gpt-5.6-sol` via migratie
  `20260906170000_s3b_step1_agentic_model_sol` (prod + Dev). `agentic.ts` kent nu
  sol/terra/luna in `PRICE_PER_M`; een onbekend model valt terug op gpt-5.5 en
  meldt dat in `dbg.agentic_model_fallback` in plaats van stil.
- De gpt-5.6-familie accepteert function-tools op `/v1/chat/completions` alleen
  met `reasoning_effort: "none"` (live gemeten, HTTP 400 anders). Sol draait op de
  lus dus zonder redeneer-tokens; redenerend Sol vraagt de Responses API = stap 2.
- Router en sweep-verdicts (`analytics.ts`), HyDE-rewrite en LLM-rerank
  (`context-build` v2.9) en de evaljudge (`rag-eval-cron` v3.1) → `gpt-5.6-luna`.
- De agent-lus roept in zijn eerste beurt verplicht een tool aan
  (`tool_choice: "required"`, daarna `auto`). De eerste rookronde onder de Luna-router
  liet vijf vage vragen op de agentic route eindigen met een wedervraag zonder tool;
  via het 0-rijen-blok en de Grok-navertelling werd dat vijf stille leegtes en één
  verzonnen bevestiging (NE08). Zie `DECISIONS.md`.

**Kosten eerlijk**
- `PRICE_USD` grok 3,00/15,00 → 1,25/2,50 (xAI-lijstprijs); `PRICE_PER_M` gpt-5.5
  1,25/10 → 5/30, gpt-5.4-mini 0,15/0,60 → 0,75/4,50. Semantische vragen waren
  2,4-6× te duur gelogd, agentische ~3× te goedkoop.
- `usage.prompt_tokens_details.cached_tokens` wordt gelogd en tegen het
  cache-tarief geprijsd: `analytics.cost.tokens_cached` (agent-lus) en
  `rag_eval_results.envelope_compact.judge_usage` (judge).
- G5 (kosten) is hiermee opnieuw geijkt: runs van vóór v1.148 zijn op `cost_usd`
  niet vergelijkbaar met runs erna. `rook-s3b-step1` is de nieuwe kostenbasis.

## v1.147 — 2026-09-06 · Spoor 01: evalbank + validatiepoort

**Bank geladen (WP1/WP2)**
- Migratie `20260906120000_agent_eval_bank_v1`: `rag_eval_questions` krijgt `lane`,
  `category`, `persona`, `history`, `ground_truth_status`, `tags`, `bank_version`,
  `source_hash`; `rag_eval_results` krijgt `latency_ms`, `cost_usd`, `route`,
  `caller_identified`, `sources`, `coverage_reason`, `tools_used`, `pending_asserts`,
  `envelope_compact`; `rag_eval_runs` krijgt `status`, `suite`, `params`,
  `persona_check`, `gates`, kosten en latency. Nieuw: `rag_eval_personas`,
  `rag_eval_run_items`, views `v_agent_eval_by_category` / `_core_trend` / `_runs`,
  RPC's `rag_eval_start_run`, `rag_eval_claim_batch`, `rag_eval_persona_check`,
  `rag_eval_finish_if_done`, `rag_eval_compare` (G1–G7).
- `scripts/agent_eval_load.cjs`: 364 bankitems geladen (435 actief, 22 `is_core`
  byte-gelijk, 0 placeholders over). Bank v1.1: `wiki-acl` meet bronnen per space
  (`expect_sources_include_space` / `exclude_space`) in plaats van
  `coverage.reason`; WI36/WI37 op `search_docs`; RO31 hoort groen.

**Runner (WP3)**
- `rag-eval-cron` v3.0: werk wordt uit de DB geclaimd (3 chat / 16 retrieval / solo
  voor `kosten` en `max_latency_ms > 100 s`), geen `MAX_CHAIN` meer; pomp-modus
  `{"_pump":true}` pakt gestrande runs op. Persona-JWT per hop via `generate_link`
  + `token_hash`, uitloggen na de hop, nooit opgeslagen. Preconditie
  `rag_eval_persona_check` → `invalid_persona`. Alle assert-keys van `rubrics.md`;
  onbekend of niet meetbaar = `pending`. Eerste rookronde: 36 items, 310 s, $0,76,
  `n_identity_unreliable` 0.

**Evalverkeer herkenbaar (WP4)**
- `rag-chat` v5.7 (2 regels): `body.eval_run_id` → `rag_chat_query_log.meta.eval_run_id`.
- Migratie `20260906130000_agent_chat_health_exclude_eval`: `v_agent_chat_health`,
  `v_agent_chat_by_route`, `v_agent_chat_coverage` en `agent_chat_health_check()`
  sluiten `meta ? 'eval_run_id'` uit.

**CLI en cadans (WP5/WP6)**
- `scripts/agent_eval_run.cjs`: kick / poll / `--status` / `--compare` / `--gate [strict]`
  / `--json`; weigert bij een lopende run. CLAUDE.md pre-flight punt 8 krijgt de rookronde.
- Crons: `rag-eval-weekly` → zondag 04:30 CEST, suite `full`; nieuw `rag-eval-pump`
  (elke minuut 06–23); `rag-eval-nightly` bestaat maar staat uit via
  `agent_config('rag-eval-cron','nightly_enabled') = false`.
- `scripts/confluence_acl_eval.cjs` schrijft zijn run-rij nu met `suite = 'acl'`,
  `status = 'done'` en `started_at`/`finished_at`: sinds `status` een default `queued`
  heeft, bleef elke ACL-ronde anders als `queued` in `v_agent_eval_runs` staan (twee
  rijen van 2026-09-06 met de hand op `done` gezet).

---

## v1.146 — 2026-09-05 · WP0 t/m WP4

**Retrieval (WP1)**
- Nieuw recept `context_intents.search_fast`: vector-only, geen HyDE, geen
  entity-anchors, geen rerank in `context-build`. De gewone chatvraag gaat
  hierheen; documentatievragen blijven op `search_docs`.
  Gemeten p50 13.282 → 2.370 ms, p95 23.318 → 3.071 ms, 90 % → 0 % boven de
  6 s-grens, 2 → 0 lege bundels.
- `context_intents.bm25_enabled` (default `true`, dus geen enkel bestaand recept
  verandert). `false` = `query_text` gaat als NULL naar `match_chunks`, waarmee
  de lexicale arm zichzelf overslaat.
- `context-build` v2.8: de drie opstart-RPC's parallel, de JelleMind-scopes
  parallel, en `options.async_bundle` schrijft de bundelrij ná de response.
  Samen ~1,5 s van het kritieke pad.
- `rag-chat` stuurt `enable_rerank: false` — de eerste van twee Cohere-rondes
  was een pure herordening die de tweede meteen overschreef.
- `CHAT_CONTEXT_CHUNKS = 24`: de reranker krijgt weer een pool om uit te kiezen.

**Leegte (WP2)**
- `coverage.reason` (`timeout | acl_filtered | below_threshold | truly_empty |
  not_tracked`) van `context-build` → `rag-chat` → het antwoord → het querylog.
- Nieuw blokje in de chat (`CoverageNote`) dat de reden in gewone taal toont.
- Eén tweede poging bij < 3 fragmenten: `min_similarity` 0,15 en geen bronfilter.
- ILIKE-entityresolutie verwijderd; alleen `rag_resolve_entity` blijft.
- Zelfheling kijkt naar bruikbare context (`matches.length < 3`) in plaats van
  naar `!entityHint`.

**Meten (WP3)**
- `v_agent_chat_health`, `v_agent_chat_by_route`, `v_agent_chat_coverage`.
- `agent_chat_health_check()` + cron `agent-chat-health-guard` (25 7-22):
  meldt in `security_findings` bij een leeg antwoord zónder reden (high) en bij
  een leeg-ratio boven 25 % (medium).
- `est_cost_usd` wordt nu op **elke** route gevuld, ook semantisch. `meta.usage`
  bewaart de ruwe tokens per leverancier.

**Antwoord en artefacten (WP4)**
- Antwoordcontract `envelope` v1 naast de vrije markdown.
- `agent_artifacts` + private bucket `agent-artifacts` (eigenaar-only).
- Edge function `agent-artifact-build` (verify_jwt: true): Excel/CSV met een
  tabblad "Verantwoording", signed URL van 24 uur.
- Downloadknoppen onder een antwoord met een tabel; PDF via `window.print()` met
  een print-stylesheet.

**Documentatie en eval**
- `docs/agent/` — dit bestand plus `ARCHITECTURE.md`, `DECISIONS.md`,
  `TOOLS.md` (gegenereerd), `SKILLS.md`.
- `docs/agent/vragenbank/` — 364 vragen met placeholders, klaar om te laden.
- Nieuwe scripts: `agent_retrieval_bench.cjs`, `agent_chat_smoke.cjs`,
  `agent_artifact_smoke.cjs`, `agent_docs_generate.cjs`, `lib/user-jwt.cjs`.

---

## v1.145 — 2026-09-05

- Per-user Confluence-space-ACL in `match_chunks` (`p_caller_user_id`).
- `search_docs`-recept voor documentatievragen.
- `vector_error` / `vector_timed_out` / `vector_fetch_ms` in het querylog — de
  telemetrie die de v1.146-diagnose mogelijk maakte.

## v5.5 en eerder

Zie de kopcommentaren in `supabase/functions/rag-chat/index.ts`.
