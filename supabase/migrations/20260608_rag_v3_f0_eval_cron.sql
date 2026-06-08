-- RAG v3 F.0 — continue meetbaarheid: wekelijkse shadow-eval cron.
-- Live toegepast 2026-06-08; dit bestand is de repo-mirror (replay-veilig).
--
-- Edge Function `rag-eval-cron` (verify_jwt:false, eigen cron_secret/service_role-auth) draait de
-- vaste 12-vragen gold-set door de LIVE context-build pipeline + gpt-5.5 reference-free judge en
-- schrijft één rij in rag_eval_runs + rag_eval_results (label='cron-weekly'). Zo wordt retrieval-
-- regressie zichtbaar over tijd zonder handmatige scripts/rag_eval_baseline.cjs-runs.
--
-- De Edge Function staat in supabase/functions/rag-eval-cron/index.ts (deploy via MCP/CLI).
-- Smoketest 2026-06-08: 12/12 scored, F=1.0 R=0.767 P=0.531 (~d237d81f baseline), 33s wall.

-- Idempotent: unschedule een eventuele bestaande job met dezelfde naam vóór (her)schedule.
SELECT cron.unschedule('rag-eval-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-eval-weekly');

SELECT cron.schedule(
  'rag-eval-weekly',
  '0 5 * * 1',  -- maandag 05:00 (buiten kantooruren; ~33s, 12 context-build + 12 gpt-5.5 calls)
  $cron$SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/rag-eval-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1),
      'x-trigger-source','pg_cron'),
    body := jsonb_build_object('label','cron-weekly'),
    timeout_milliseconds := 120000
  );$cron$
);
