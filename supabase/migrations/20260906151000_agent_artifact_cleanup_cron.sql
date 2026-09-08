-- =============================================================================
-- agent-artifact-cleanup-nightly — de bewaartermijn krijgt een uitvoerder
-- =============================================================================
-- `expires_at` stond sinds 20260905183000 op 30 dagen en niets deed er iets
-- mee: 0 van de 42 cronjobs noemde `agent_artifact*`. De eerste vervaldatum is
-- 2026-10-05; tot die dag is het verschil tussen "opruimer" en "geen opruimer"
-- onzichtbaar. Dat is precies het patroon van de chunker-P0 — stilte geeft geen
-- fout — en daarom staat het alarm ín de functie (security_findings bij een
-- achterstand) en niet in het hoofd van wie het ooit gebouwd heeft.
--
-- 03:45 is vrij (gemeten 2026-09-06: bezet zijn 03:00, 03:20, 03:30 ×2, 03:33,
-- 03:40 en 03:55).
--
-- BEWUST NIET GATED. Het `WHERE EXISTS`-patroon is er voor `*/5`-jobs die anders
-- de klok rond een lege functie wakker maken. Eén HTTP-call per nacht kost niets,
-- en de wezensweep moet óók draaien in een nacht waarin niets verlopen is.
-- =============================================================================

SELECT cron.unschedule('agent-artifact-cleanup-nightly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-artifact-cleanup-nightly');

SELECT cron.schedule('agent-artifact-cleanup-nightly', '45 3 * * *', $$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/agent-artifact-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets
                                      WHERE name = 'skill:global:cron_secret'),
      'x-trigger-source', 'pg_cron'),
    body := '{}'::jsonb);
$$);
