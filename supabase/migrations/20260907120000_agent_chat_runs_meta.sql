-- =============================================================================
-- Spoor 02 · I2 (v1.151) — agent_chat_runs.meta
-- =============================================================================
-- I1 gaf de run-rij alles wat het ANTWOORD is (answer_md, envelope, citations,
-- analytics, spent, steps). Wat er niet in zat, is wat de chat-UI náást het
-- antwoord toont en tot v1.150 uit het `meta`-frame van het SSE-pad haalde:
-- de entity-badge, de retrieval-strategie, het bundle-id, het debug-paneel
-- (RetrievalDebug), het antwoordmodel, de web-citaten en de tokens/timing die
-- de feedback-RPC (`log_chat_feedback`) meestuurt.
--
-- Zonder die kolom levert de run-modus een UI die stiller is dan het oude pad:
-- geen badge, leeg debug-paneel, geen web-tab in het bronnenpaneel, en
-- feedback zonder model/strategie. Dat is precies de stille verschraling die
-- de design-migratie-hard-rule verbiedt. Vandaar één additieve kolom.
--
-- Klein gehouden (de rij is gepubliceerd; realtime laat velden vallen boven
-- ~1 MB): rag-chat schrijft hier alleen de compacte UI-payload, nooit de
-- matches, de agent-lus of de compose-payload — die blijven in
-- agent_chat_run_state (service-only).
--
-- Idempotent: `add column if not exists`. Geen RLS-wijziging — `meta` valt
-- onder hetzelfde owner-only select-beleid als de rest van de rij.
-- =============================================================================

ALTER TABLE public.agent_chat_runs
  ADD COLUMN IF NOT EXISTS meta jsonb;

COMMENT ON COLUMN public.agent_chat_runs.meta IS
  'Compacte UI-payload (spoor 02 I2): entity_used, retrieval_strategy, bundle_id, debug_pipeline, model, web_citations (<= 20), web_search_used/calls, tokens.retrieval, grok_ms, finish_reason. Bron voor de chat-UI naast het antwoord; nooit matches/loop-state (die horen in agent_chat_run_state).';
