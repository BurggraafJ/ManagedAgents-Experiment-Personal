-- RAG v3.2: rag-eval-weekly (jobid 42) timeout 120s → 380s.
-- De suite-v1 (50 vragen) draait via self-chaining in ~3 min; met 120s zou pg_net de
-- verbinding sluiten vóór de keten klaar is. Toegepast live via cron.alter_job op 2026-06-11.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'rag-eval-weekly'),
  command := $cmd$SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/rag-eval-cron',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1),
      'x-trigger-source','pg_cron'),
    body := jsonb_build_object('label','cron-weekly'),
    timeout_milliseconds := 380000
  );$cmd$
);
