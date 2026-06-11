-- RAG v3.2 V2+V3 config: query-intelligentie per intent (opt-in) + entity-anchors.
-- Toegepast live via MCP apply_migration (rag_v32_v2_query_intel_per_intent) op 2026-06-11;
-- anchor-waarden geactiveerd na aparte V2-meting (attributie V2 vs V3).
--
-- V2: alle v3-query-intel (fuzzy entity-routing, parseQueryIntent bron/tijd-hints,
-- multi-query rewrite, asks_response-auto) was hardcoded search-only
-- (applyQueryIntel = intent==='search'). Gemeten gevolg (suite-baseline 84ccf326):
-- enrich_record R=0.0, extract_actions 0/2 asserts, compose_followup 0/1.
-- Na V2 (run b01215fd): asserts 41/46 -> 44/46; E02/E13/E18/E19 groen.
--   'off'    = geen intel (draft_reply HARD off — kritiek pad)
--   'entity' = alleen fuzzy entity-resolutie (rag_resolve_entity)
--   'full'   = entity + parseQueryIntent + multi-query rewrite
--
-- V3: entity_anchor_top_n — bij entity-routing worden de N meest recente chunks
-- waarvan content de entity-NAAM bevat gegarandeerd aan de kandidatenset toegevoegd.
-- Gemeten reden: naam-only BM25-matches (deal/jira-kaarten van Rutgers/Forsyte/Kerckhoffs)
-- verliezen in RRF van vage vector-matches; naam-match vangt ook duplicate entity-records.
ALTER TABLE context_intents
  ADD COLUMN IF NOT EXISTS query_intel_level text NOT NULL DEFAULT 'off'
    CHECK (query_intel_level IN ('off','entity','full')),
  ADD COLUMN IF NOT EXISTS entity_anchor_top_n integer NOT NULL DEFAULT 0;

UPDATE context_intents SET query_intel_level = 'full'   WHERE intent = 'search';
UPDATE context_intents SET query_intel_level = 'full'   WHERE intent IN ('enrich_record','extract_actions','compose_followup');
UPDATE context_intents SET query_intel_level = 'entity' WHERE intent = 'analyze_meeting';
-- draft_reply / classify_mail_action / match_appointment / learn_pattern blijven 'off'.

-- V3-activatie (2026-06-11, ná V2-meting):
UPDATE context_intents SET entity_anchor_top_n = 4
WHERE intent IN ('search','enrich_record','compose_followup','analyze_meeting');
