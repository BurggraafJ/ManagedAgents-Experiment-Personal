-- =============================================================================
-- Spoor 01 — evalcadans: weekly → zondag full, pomp elke minuut, nachtelijk uit (v1.147)
-- =============================================================================
-- Gemeten (01-rook-first, 2026-09-06): 36 items in 310 s voor $0,76; een volledige
-- ronde van 435 items past ruim in een zondagnacht. De pomp maakt de keten
-- verliesvrij: een hop die wegvalt wordt binnen een minuut opgepakt, zonder
-- MAX_CHAIN. Nachtelijk draaien kost ~$9 per nacht en staat daarom uit tot een
-- implementatie op de chatketen het nodig heeft (DECISIONS 2026-09-06, V4).
--
-- Idempotent: unschedule-if-exists + schedule; agent_config via ON CONFLICT.
-- De Authorization-header komt uit Vault (skill:global:cron_secret), zoals de
-- bestaande rag-eval-weekly (20260611_rag_v32_eval_cron_timeout.sql).
-- =============================================================================

-- ── 1. Weekly: zondag 04:30 CEST (02:30 UTC), suite full ─────────────────────
SELECT cron.unschedule('rag-eval-weekly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-eval-weekly');
SELECT cron.schedule('rag-eval-weekly', '30 2 * * 0', $cmd$SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/rag-eval-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1),
      'x-trigger-source','pg_cron'),
    body := jsonb_build_object('label','weekly-full','suite','full','build_artifacts',true),
    timeout_milliseconds := 380000
  );$cmd$);

-- ── 2. Pomp: elke minuut 06–23 CEST (04–21 UTC) ──────────────────────────────
-- Zoekt runs met status running en last_activity_at ouder dan 3 minuten en draait
-- één hop. Geen gestrande run = één goedkope 200 met {"pumped":0}.
SELECT cron.unschedule('rag-eval-pump') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-eval-pump');
SELECT cron.schedule('rag-eval-pump', '* 4-21 * * *', $cmd$SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/rag-eval-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1),
      'x-trigger-source','pg_cron'),
    body := jsonb_build_object('_pump', true),
    timeout_milliseconds := 380000
  )
  WHERE EXISTS (SELECT 1 FROM public.rag_eval_runs
                 WHERE status = 'running' AND last_activity_at < now() - interval '3 minutes');$cmd$);

-- ── 3. Nachtelijk: chat-lane, di–za 03:00 CEST (01:00 UTC), ALLEEN als de schakelaar aan staat ──
INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
VALUES ('rag-eval-cron', 'nightly_enabled', 'false'::jsonb, false)
ON CONFLICT (agent_name, config_key) DO NOTHING;

SELECT cron.unschedule('rag-eval-nightly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-eval-nightly');
SELECT cron.schedule('rag-eval-nightly', '0 1 * * 2-6', $cmd$SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/rag-eval-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1),
      'x-trigger-source','pg_cron'),
    body := jsonb_build_object('label', 'nightly-chat-' || to_char(now(), 'YYYY-MM-DD'), 'suite', 'chat-lane', 'build_artifacts', false),
    timeout_milliseconds := 380000
  )
  WHERE (SELECT config_value FROM public.agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'nightly_enabled') = 'true'::jsonb;$cmd$);

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906140000', 'agent_eval_crons')
ON CONFLICT (version) DO NOTHING;
