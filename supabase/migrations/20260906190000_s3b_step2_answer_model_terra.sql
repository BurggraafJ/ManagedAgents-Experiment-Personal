-- =============================================================================
-- 20260906190000_s3b_step2_answer_model_terra.sql — ANSWER-STACK S3b, stap 2
-- =============================================================================
-- rag-chat v5.9 leest het antwoordmodel uit agent_config ('rag-chat',
-- 'answer_model'). Deze migratie zet die rij op gpt-5.6-terra: Terra schrijft
-- het semantische/structured/sweep-antwoord, en de agentic route geeft de
-- eindbeurt van de Sol-lus rechtstreeks terug (geen Grok-navertelling).
-- Beslissing: /workspace/security/maestro-agent-architecture/00-orchestration/
-- ANSWER-STACK-RESEARCH.md §6 S3b + §8 stap 2 (Jelle, 2026-09-06).
--
-- Rollback (één release): zet de waarde op '"grok-4.3"'::jsonb — dan gaat het
-- antwoord weer via api.x.ai mét de oude navertelling. Geen deploy nodig.
-- Een waarde die rag-chat niet kent valt terug op terra en meldt dat in
-- rag_chat_query_log.meta.answer_model_fallback. Op een oudere rag-chat
-- (≤ v5.8) is deze rij onschadelijk: die code leest hem niet.
--
-- Idempotent en Dev-veilig: UPDATE-als-anders + INSERT-als-afwezig in plaats
-- van ON CONFLICT (agent_name, config_key) — die unieke index bestaat op prod
-- wél en op Dev (sylsewoxnyzdbubdemzi) niet (zie 20260906170000). Twee keer
-- draaien = nul wijzigingen.
-- =============================================================================

UPDATE public.agent_config
   SET config_value = '"gpt-5.6-terra"'::jsonb,
       updated_at   = now()
 WHERE agent_name = 'rag-chat'
   AND config_key = 'answer_model'
   AND config_value IS DISTINCT FROM '"gpt-5.6-terra"'::jsonb;

INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
SELECT 'rag-chat', 'answer_model', '"gpt-5.6-terra"'::jsonb, false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.agent_config
    WHERE agent_name = 'rag-chat' AND config_key = 'answer_model'
 );

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906190000', 's3b_step2_answer_model_terra')
ON CONFLICT (version) DO NOTHING;
