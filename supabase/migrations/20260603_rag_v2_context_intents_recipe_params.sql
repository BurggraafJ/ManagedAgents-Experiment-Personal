-- RAG v2 F.3 — verborgen hardcoded retrieval-params naar context_intents (tunebaar zonder redeploy).
-- max_edges was de P0-2-oorzaak (DB-default load-bearing). context-build leest deze kolommen vanaf v2.0.
ALTER TABLE context_intents ADD COLUMN IF NOT EXISTS max_edges int NOT NULL DEFAULT 300;
ALTER TABLE context_intents ADD COLUMN IF NOT EXISTS kb_min_similarity double precision NOT NULL DEFAULT 0.42;
ALTER TABLE context_intents ADD COLUMN IF NOT EXISTS jellemind_min_similarity double precision NOT NULL DEFAULT 0.40;
COMMENT ON COLUMN context_intents.max_edges IS 'RAG v2 F.3: p_max_edges voor match_chunks_for_entity (was hardcoded DB-default; P0-2-oorzaak)';
COMMENT ON COLUMN context_intents.kb_min_similarity IS 'RAG v2 F.3: min_similarity voor KB-injectie (was hardcoded 0.42)';
COMMENT ON COLUMN context_intents.jellemind_min_similarity IS 'RAG v2 F.3: min_similarity voor JelleMind-lesson-injectie (was hardcoded 0.40)';
