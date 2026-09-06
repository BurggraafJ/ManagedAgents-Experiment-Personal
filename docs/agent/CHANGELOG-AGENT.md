# Changelog — Maestro-chat

Alleen wijzigingen die het gedrag van de chat raken. Voor het waaróm: `DECISIONS.md`.

---

## v1.147 — 2026-09-06 · Artefacten v2 (spoor 05)

**PDF is een bestand geworden**
- Nieuw `agent-artifact-build/pdf.ts` (`pdf-lib` via esm.sh): A4 landschap zodra
  er een tabel is, staand voor een rapport; kop per pagina, herhaalde kopregel,
  getallen rechts, cellen geknipt op de échte tekstbreedte; laatste pagina is de
  *Verantwoording* inclusief kolomdefinities. Gemeten na de deploy: 3.000 bytes
  in 32 ms; lokaal 5.000 rijen → 137 pagina's in 721 ms. Kosten $0,00.
- `sanitizeWinAnsi()` vraagt de encoder zelf per codepoint om zijn oordeel en
  telt de vervangingen in de verantwoording. Zonder dat gooit één teken buiten
  CP1252 de hele export om (gemeten: `WinAnsi cannot encode "日"`).
- `ArtifactBar`: de PDF-knop bouwt nu een echt bestand langs dezelfde weg als
  xlsx/csv — ook op de telefoon, waar een printdialoog niets doet. *Afdrukken*
  blijft bestaan op desktop.

**Twee termijnen die eerst één naam deelden**
- De respons geeft `url_expires_at` (handtekening, 24 u) én `expires_at`
  (bestand, bewaartermijn). v1 gaf alleen `expires_at` — met de waarde van de
  handtekening, terwijl de kolom met diezelfde naam de bewaartermijn is.
- De bewaartermijn staat in `agent_config('agent-artifacts','retention_days')`,
  default 30. Wijzigen kost geen deploy.
- Onder de knoppen staat het nu ook gewoon: *link 24 uur geldig · bestand 30
  dagen bewaard*.

**Meerdere tabbladen en kolomdefinities**
- `sheets: [{name, columns, rows}]` → één werkblad per maand (AR06), met
  `safeSheetName()`: verboden tekens eruit, 31 tekens, uniek, en
  *Verantwoording* gereserveerd.
- `column_defs: [{key, label, definition, type, format, width}]` stuurt de
  Excel-getalnotatie, de uitlijning in de pdf, en vult het blok *kolom →
  definitie* op de verantwoording (AR09, AR32).

**De bewaartermijn krijgt een uitvoerder**
- Nieuwe functie `agent-artifact-cleanup` (`verify_jwt: false`) + cron
  `agent-artifact-cleanup-nightly` (`45 3 * * *`). Bestand eerst, rij daarna,
  harde limiet van 500 per run, droogloop met `{"dry_run":true}`.
- Wezensweep in beide richtingen ná 24 uur respijt, en een `security_findings`
  -regel zodra er werk blijft liggen. Vóór v1.147 noemde geen van de 42 cronjobs
  `agent_artifact*`.

**Lijn tussen twee bestanden**
- `params.period`, `source_artifact_id` en RPC `agent_artifact_recent()`
  (`SECURITY INVOKER`) voeden de *"Zelfde als …"*-keuze. Bewezen negatief: een
  tweede persona ziet 0 van de 14 rijen van de eerste, en anoniem geeft
  `permission denied`.

**Afdrukken**
- Eerste globale `@media print` in `src/index.css`: sidebar, mobiele topbar,
  tabbar en docks gaan eruit, de schil wordt één kolom, papier wit. Tot nu toe
  bestond er precies één printregel in de hele frontend, in een CSS-module van
  één view — de sidebar ging dus mee op papier.

**Meten**
- `agent_artifact_smoke.cjs` van 10 naar **20** asserties: pdf per formaat, een
  tweede negatieve eigenaarstest (anon-JWT), tabbladen, kolomdefinities,
  WinAnsi-sanering, niets over zijn vervaldatum, geen wezen, en
  bytes/`build_ms`/`build_cost_usd` per rij.

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
