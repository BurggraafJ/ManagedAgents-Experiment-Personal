-- =============================================================================
-- 20260906170000_s3b_step1_agentic_model_sol.sql — ANSWER-STACK S3b, stap 1
-- =============================================================================
-- De agent-lus van rag-chat leest zijn model uit agent_config
-- ('rag-chat','agentic_model'). Deze migratie zet die rij op gpt-5.6-sol.
-- Beslissing: /workspace/security/maestro-agent-architecture/00-orchestration/
-- ANSWER-STACK-RESEARCH.md §8 (Jelle, 2026-09-06). Stap 1 verandert niets
-- zichtbaars: Grok blijft het antwoord schrijven, Sol doet alleen het onderzoek.
--
-- Hoort bij rag-chat v5.8 (agentic.ts kent sol/terra/luna in PRICE_PER_M). Op
-- een oudere rag-chat is deze rij onschadelijk: een model dat niet in
-- PRICE_PER_M staat valt daar terug op gpt-5.5 en meldt dat in
-- dbg.agentic_model_fallback.
--
-- Idempotent en Dev-veilig: UPDATE-als-anders + INSERT-als-afwezig in plaats
-- van ON CONFLICT (agent_name, config_key) — die unieke index bestaat op prod
-- wél en op Dev (sylsewoxnyzdbubdemzi) niet (zie 20260904091000). Twee keer
-- draaien = nul wijzigingen.
-- Terugdraaien: dezelfde twee statements met '"gpt-5.5"'::jsonb.
-- =============================================================================

UPDATE public.agent_config
   SET config_value = '"gpt-5.6-sol"'::jsonb,
       updated_at   = now()
 WHERE agent_name = 'rag-chat'
   AND config_key = 'agentic_model'
   AND config_value IS DISTINCT FROM '"gpt-5.6-sol"'::jsonb;

INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
SELECT 'rag-chat', 'agentic_model', '"gpt-5.6-sol"'::jsonb, false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.agent_config
    WHERE agent_name = 'rag-chat' AND config_key = 'agentic_model'
 );

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906170000', 's3b_step1_agentic_model_sol')
ON CONFLICT (version) DO NOTHING;
