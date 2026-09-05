# Changelog — Maestro-chat

Alleen wijzigingen die het gedrag van de chat raken. Voor het waaróm: `DECISIONS.md`.

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
