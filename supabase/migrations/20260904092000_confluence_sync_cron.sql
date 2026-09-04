-- Cron voor de Confluence-spiegel.                          (v1.142, 2026-09-04)
--
-- Twee keer per dag, niet elke vijf minuten. Het gemeten tempo is ~2 gewijzigde
-- pagina's per dag over 30 dagen (61 in de 8 gespiegelde spaces); vaker pollen
-- levert niets op en kost alleen Confluence-calls.
--
--   05:10  delta, venster 3 dagen — vangt ook een dag waarop de cron niet liep.
--   17:10  full — haalt alles op én archiveert wat verdwenen is (inclusief het
--          opruimen van de bijbehorende chunks). Een volledige ronde over de
--          8 spaces duurde bij de eerste meting 14,7 s voor 365 pagina's, dus
--          dat is gewoon betaalbaar.
--
-- Let op: dit is een verify_jwt:FALSE-functie (cron_secret in de header). Zet
-- hem nooit op true — dan weigert de gateway de cron-bearer met 401 vóór de
-- functie-body en valt de sync stil zonder één zichtbare fout. Zie CLAUDE.md.
select cron.unschedule('confluence-sync-delta')
 where exists (select 1 from cron.job where jobname = 'confluence-sync-delta');
select cron.unschedule('confluence-sync-full')
 where exists (select 1 from cron.job where jobname = 'confluence-sync-full');

select cron.schedule('confluence-sync-delta', '10 5 * * *', $cron$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/confluence-sync-etl?days=3',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'skill:global:cron_secret' LIMIT 1
      ),
      'x-trigger-source', 'pg_cron'
    ),
    body := '{}'::jsonb
  );
$cron$);

select cron.schedule('confluence-sync-full', '10 17 * * *', $cron$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/confluence-sync-etl?full=1',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'skill:global:cron_secret' LIMIT 1
      ),
      'x-trigger-source', 'pg_cron'
    ),
    body := '{}'::jsonb
  );
$cron$);
