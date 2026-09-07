# Changelog — Maestro-chat

Alleen wijzigingen die het gedrag van de chat raken. Voor het waaróm: `DECISIONS.md`.

---

## v1.149 — 2026-09-06 · Spoor 02 I1: een vraag is nu een run (rag-chat v6.0)

Zichtbaar voor de gebruiker verandert er in I1 nog niets — de browser-hook volgt in I2.
Onder water is elke chatvraag nu een rij in `agent_chat_runs` met toestand, budget,
stappenlog en het antwoord zelf, afgewerkt in hops van ≤ 170 s. Onderzoek en poorten:
`/workspace/security/maestro-agent-architecture/02-long-running-runs/`.

**Schema (migratie `20260906190000_agent_chat_runs`, prod 12:40 UTC)**
- `agent_chat_runs` (klein, in de realtime-publicatie, owner-only `select` met
  `session_mfa_ok()`) en `agent_chat_run_state` (zwaar: lus-berichten, evidence,
  compose-payload; service-only, geen policies). Kolommen `rag_chat_query_log.run_id`
  en `claude_api_calls.chat_run_id` (+ index; bedrading in 03a).
- RPC's: `agent_chat_run_claim_hop` (atomaire lease, fencing-token), `agent_chat_run_cancel`
  en `agent_chat_run_answer_input` (eigenaar, `SECURITY DEFINER`), `agent_chat_runs_watchdog`
  (hop_lost/budget_wall, opruimen 7 d state / 90 d runs, `security_findings`).
- View `v_agent_chat_runs_health` (per dag × verkeer: done/failed per code, hops, p95
  t.o.v. budget, kosten); cron `agent-chat-runs-watchdog` elke minuut met `WHERE EXISTS`.
- `agent_config('rag-chat','run_budgets')` (per effort `{tool_calls, wall_ms, usd, hops_max}`,
  RESEARCH §3.4) en `agent_config('rag-chat','pricing')` (één prijstabel; constanten blijven fallback).

**Motor (rag-chat v6.0, 6 bestanden)**
- `index.ts` gesplitst: `run.ts` (toestandsmachine, hops, lease, budget, spent, alle
  retrieval-helpers) en `compose.ts` (prompt, dekkingszinnen, prijzen, Grok-stream → rij).
- Body-modes: `run:true` → direct `200 {run_id}`, hop 1 in `EdgeRuntime.waitUntil`;
  `{_run_id,_hop}` (service-key, zelf-fetch); `{_run_id,resume:true}` (eigenaar of service);
  compat `stream:true|false` maakt óók een run-rij en draait de hops inline (≤ 140 s) met
  het v5.8-antwoordcontract — vork V7, weg zodra hook (I2) en runner v3.1 op `run:true` staan.
- Hop: geen nieuwe agent-beurt na 60 s (`HOP_SOFT_MS`), hard 170 s (`HOP_HARD_MS`); elke
  UPDATE eist `hop_lease = <token>`; `beforeunload` schrijft de reden en geeft de lease vrij.
- Effort: uit de body, anders route (structured/sweep → low, semantic → medium, agentic →
  high, "grondig/rapport/per klant" → xhigh); zelfheling naar de agent tilt een route-effort
  naar `high`. `spent` per hop over OpenAI (in/cached/out), router, Grok, embed, Cohere;
  `rag_chat_query_log.est_cost_usd = spent.usd`.
- Providerfouten (429/5xx van router, context-build, agent-lus, Grok) → één nieuwe poging na
  2 s, daarna `failed{provider_error, provider, http_status}` mét `spent`; de state-rij blijft
  voor `resume`. Geen stille `not_tracked` meer door een storing.
- `envelope` v1 ongewijzigd; additief blok `budget {effort, limits, spent, exhausted_by, hops}`.
- `agentic.ts`: alleen een hervat-punt (`opts`: budget, hopDeadlineAt, resume, onIteration,
  price, throwProviderErrors); tools, `execTool` en prompt-tekst ongewijzigd.
- Grok-stream met `stream_options.include_usage`: zonder die vlag stuurt xAI géén usage-chunk
  (gemeten) — het oude stream-pad logde daardoor nooit Grok-tokens voor browservragen.

**Gemeten (I1)**: `run:true` structured → done in 12 s (hop 10,3 s); agentic `xhigh` → done in
80 s over 2 hops (65,1 s + 12,7 s), 19 tool-calls, $0,163; smoke 24/24; SSE-compat groen;
100 % van de querylogrijen sinds de deploy draagt `run_id`.

**Nog niet (I2)**: `useRunFollow` op `createRealtimeChannel('agent-run')`, disconnect-test
S8, realtime-RLS-test S9, runner v3.1 leest de rij, `needs_input`-producent (ask_user-tool, 03b).

## 2026-09-07 · Spoor 06d — Confluence en de kennisbank (backend-only, geen `APP_VERSION`-bump)

Geen frontend-bestand geraakt, dus geen versiebump; wel ander gedrag voor élke documentatie-
vraag in de chat en voor elk kennisbank-artikel dat van status wisselt. Besluiten en metingen:
`DECISIONS.md` 2026-09-07 (06d) en `06-rag-per-source/06d/IMPLEMENT-NOTES.md`.

**Recept (migratie `20260907031000_06d_search_docs_max_per_record`)**
- `max_per_record = 2` op `search_docs`. 06f-α had de kolom aangelegd en alleen `search_fast`
  gevuld; het recept dat élke documentatievraag gebruikt bleef NULL. Gemeten op vijf echte
  documentatievragen, top_k 40: **23,2 → 28,4 pagina's** per bundel van 40 chunks, max per
  pagina **9 → 2**, top-1 vectorscore gelijk (0,540 → 0,538), zoektijd 742 → 742 ms op het
  chatpad. De chat houdt daarna 24 van de 40, dus ook die 24 komen uit meer pagina's.
  Terugdraaien is de kolom op NULL.

**Kennisbank (migratie `20260907030000_06d_kb_article_chunks_follow_status`)**
- Nieuwe trigger `trg_kb_article_chunks_follow_status` (`AFTER UPDATE OF status ON
  kb_articles`, `WHEN old.status IS DISTINCT FROM new.status`). Status weg van
  gevalideerd/gepubliceerd → de chunk gaat er direct uit; status terug ín die verzameling →
  `embedded_at` op NULL plus dezelfde http-post naar `kb-article-embed` die de insert-trigger
  doet, zodat concept → gevalideerd niet tot vier uur op `kb-article-embed-4h` wacht.
- Waarom: de embed-pijplijn kende alleen de "erheen"-richting (`kb_articles_fetch_dirty`
  filtert op gevalideerd/gepubliceerd, de enige trigger stond op INSERT). Het ene
  gearchiveerde artikel hield zijn chunk van 11 juni tot de 06f-α-reconcile van 6 september.
  Zonder trigger is de bleed maximaal 24 uur (`rag-chunks-reconcile-daily`, 03:50 UTC); die
  reconcile blijft het vangnet.
- Geen lus met de embedder: die schrijft alleen `embedding`/`embedded_at`/`embedding_model`
  terug en raakt `status` nooit, en een `AFTER UPDATE OF status`-trigger vuurt alleen als
  `status` in de SET-lijst staat. Rollback-test op prod (één transactie, vier overgangen):
  gevalideerd → gearchiveerd = chunk weg; gearchiveerd → verworpen = niets; verworpen →
  gevalideerd = één http-post en `embedded_at` NULL; gevalideerd → gepubliceerd = géén
  tweede post.

**Chat (`rag-chat` v63, `verify_jwt: true`)**
- `confluence_search` en `semantic_search` sturen geen `min_similarity` meer mee: het recept
  is de waarheid. Voor `intent=search` verandert niets (dat recept staat zelf op 0,30, exact
  de verwijderde hardcode); voor `search_docs` gaat de lat naar 0,42, gemeten een no-op omdat
  `bm25_enabled=true` elke chunk met een lexicale treffer doorlaat. Gecontroleerd ná de
  deploy: jelle en cron houden 8 van 8 rijen. `top_k: 8` blijft — dat is het toolbudget.
- Een leeg toolresultaat draagt nu zijn reden. `execTool` heeft naast `error` (de tool is
  stuk) een `note` (de tool draaide en gaf niets, met de reden): `acl_filtered` →
  "deze gebruiker heeft geen zichtbare Confluence-spaces", `truly_empty`, `below_threshold`,
  `timeout`, `not_tracked`. De note gaat mee **naast** de rijen, staat in de UI-trace
  ("0 resultaten — …") en in de agent-trace. Nooit een space- of paginanaam.
- Onder de kop van elk Confluence-fragment staat één herkomstregel `Confluence: <space> ›
  <pad> · v<versie> · <url>`, en `envelope.sources` draagt een `url`-veld (null voor elke
  andere bron; envelope-versie blijft 1). De titel van een Confluence-bron komt nu uit
  `metadata.title` in plaats van uit `deriveSubject`, dus zonder het
  "(deel i/n)"-achtervoegsel van de chunker.

**Wat 06d bewust niet doet:** `inject_kb` blijft uit op `search_fast` (injectie op 0,42 zou
op 1 van 12 gewone vragen een marginaal artikel toevoegen — het lek van juni; echte
kennisbankvragen halen hun artikel al met 0,48–0,56 via de bron-agnostische pool),
`min_similarity 0,42` blijft staan maar is op dit recept een no-op (drempelbeleid hoort bij
de reranker), en `kennisbank` komt niet in `DOCS_QUESTION_RE` (0 echte vragen met dat woord
in 60 dagen).

---

## 2026-09-06 · Spoor 06a — mail en de eigen mailbox (backend-only, geen `APP_VERSION`-bump)

Geen frontend-bestand geraakt, dus geen versiebump; wel ander gedrag voor mailbox-vragen in
de chat en voor elke `draft_reply`-bundel. Besluiten en metingen: `DECISIONS.md` 2026-09-06
(06a) en `06-rag-per-source/06a/IMPLEMENT-NOTES.md`.

**Recepten (migratie `20260906220000_06a_draft_reply_bm25_off`)**
- `bm25_enabled = false` op `draft_reply` en `classify_mail_action`. Een inkomende mail ís de
  zoekvraag; onder de 500-tekencap van `match_chunks` liet de lexicale arm een derde tot vier
  vijfde van de index ranken. A/B op dezelfde embedding en receptparameters: **9.924 ms met de
  arm, 563 ms zonder**, dezelfde vijf treffers. Vóór: `draft_reply`-bundels (auto-draft, 60 d)
  search p95 8.047 ms, 21 van 438 leeg.
- Nieuw recept `my_mail` (migratie `20260906223000_06a_my_mail_intent`): `match_chunks`,
  top_k 10, min_sim 0,30, recency 0,30/90, bm25 uit, `filter_sources ['mail']`,
  `max_per_record 1`, jellemind/kb uit.

**Chat (`rag-chat` v61, `verify_jwt: true`)**
- `my_mail_search` heeft een tweede arm. Naast `rag_search_my_mail` (regex, nieuwste eerst)
  loopt nu een `context-build`-call met `intent: my_mail` en `owner_user_id` = de vrager.
  Samengevoegd op mail-id: letterlijke treffers jonger dan 7 dagen eerst, dan de semantische
  op score, dan de oudere letterlijke; ≤ 12 rijen, elk met `gevonden_via` (`recent` of
  `relevantie`). Faalt de semantische arm, dan is het antwoord wat het ervoor was.
- Route-override ná `classifyRoute`: heeft de vrager een spiegel én gaat de vraag over zijn
  eigen mailbox (`mijn mail/inbox/mailbox/postvak/verzonden items/map`, of "X stuurde mij"),
  dan gaat `semantic`/`sweep` naar `agentic` — anders wordt `my_mail_search` nooit
  aangeboden. Zichtbaar als `dbg.route_override` en `rag_chat_query_log.meta.route_override`.
  De routerprompt zelf is niet aangeraakt (die is van spoor 03).

**Index (migraties `20260906221000_06a_chunker_mail_hardening`, `20260906222000_06a_mail_entity_ids`, `chunker` v12)**
- `fetchUnchunked` staat binnen de per-bron `try`: één bron die valt is een waarschuwing, geen
  run-fout. Gemeten met dezelfde fout die 2026-09-06 07:15 UTC een hele run liet vallen.
- Mail-tak van `fetch_unchunked_source_ids` kijkt eerst in een venster van 30 dagen:
  26,5 ms / 2.825 buffers tegen 63,5 ms / 15.973 warm.
- Partiële unieke index `chunks_mail_one_per_message`; een 23505 daarop is een waarschuwing.
- `v_mail_chunk_source` levert `entity_ids`/`primary_entity_id` voor de **externe** deelnemers
  (from/to/cc, eigen domein eruit); backfill 3.886 van 3.886 extern-resolvable mails, 0 met een
  intern contact, geen re-embed. Let op: `context-build` geeft `filter_entity_id` vandaag hard
  `null` mee, dus dit filter is alleen bereikbaar bij een directe `match_chunks`-aanroep.

**Vragenbank** — MA47 (eigen-mailbox, chat): relevantie boven recency, `expect_tools_include
my_mail_search` + `expect_no_empty`.

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
