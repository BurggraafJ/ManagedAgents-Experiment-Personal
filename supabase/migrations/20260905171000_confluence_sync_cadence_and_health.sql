-- =============================================================================
-- Confluence: verse spiegel + zichtbare gezondheid          (v1.145, 2026-09-05)
-- =============================================================================
-- Twee versheidsgaten, één oorzaak: de spiegel liep op 2×/dag.
--
--   inhoud    een pagina die om 07:15 wordt aangepast staat pas om 19:10 in RAG
--   verwijderd  ERGER — het archiveer-pad zit ALLEEN in de full-tak van de ETL
--               (`if (full && !truncated && seen.size > 0)`), want een delta ziet
--               per definitie alleen wat er nog is, niet wat verdween. Een pagina
--               die iemand expres weggooit blijft dus tot ~24 uur citeerbaar. Een
--               verouderd antwoord is onnauwkeurig; een antwoord uit een bewust
--               verwijderde pagina is met vol vertrouwen fout.
--
-- Gemeten (agent_runs, agent_name='confluence-sync-etl'): een VOLLEDIGE ronde
-- over alle 8 spaces / 366 pagina's kost 5,4 s (13,6 s op de koude eerste ronde);
-- delta days=3 kost 2,5 s. Wijzigingstempo ~4,6 pagina's/dag. Een full refetch
-- elke 5 minuten is op dit volume dus gewoon betaalbaar, en dat maakt het
-- ontwerp ook robuuster: geen afhankelijkheid meer van de correctheid van een
-- `updated >= x`-CQL-query, en het archiveer-pad loopt in élke ronde mee.
--
-- Her-chunken blijft uit: fetch_unchunked_source_ids('confluence') kijkt naar
-- `metadata->>'version' >= p.version`, niet naar synced_at. 366 rijen opnieuw
-- upserten kost dus geen enkele her-embedding. Nagerekend vóór deze wijziging.
--
-- De `!truncated`-guard in de ETL blijft zoals hij is: archiveren na een
-- afgekapte ronde zou de niet-doorlopen rest van de wiki als verdwenen
-- bestempelen. cron.alter_job kan de command niet wijzigen — vandaar
-- unschedule + schedule.
-- =============================================================================

-- ─── 1. De delta-cron vervalt: fast doet full, dus ook het archiveren ────────
SELECT cron.unschedule('confluence-sync-delta')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confluence-sync-delta');

SELECT cron.unschedule('confluence-sync-fast')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confluence-sync-fast');

SELECT cron.schedule('confluence-sync-fast', '*/5 * * * *', $$
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
$$);

-- confluence-sync-full (10 17 * * *) blijft ongemoeid als vangnet: idempotent,
-- kost niets, en dekt een reeks gefaalde fast-rondes af.

-- ─── 2. De ACL-sync had helemaal geen cron ──────────────────────────────────
-- confluence-acl-sync is één keer met de hand gedraaid en zou daarna nooit meer
-- draaien. Rechten wijzigen zelden, maar "zelden" is niet "nooit": wie uit
-- dienst gaat of bij MT komt, verandert anders nooit meer van grant. Dagelijks
-- is ruim genoeg; 03:40 valt buiten elk ander cron-venster.
SELECT cron.unschedule('confluence-acl-sync')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'confluence-acl-sync');

SELECT cron.schedule('confluence-acl-sync', '40 3 * * *', $$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/confluence-acl-sync',
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
$$);

-- ─── 3. sync_health: Confluence stond nergens ───────────────────────────────
-- sync_health('confluence') gaf `unknown_source`, dus de spiegel ontbrak in
-- sync_health_all() en daarmee op het gezondheidsoppervlak dat context-build bij
-- elke bundle ophaalt en dat IntelligenceHubView toont. Een spiegel die
-- stilvalt was daardoor onzichtbaar — precies het P0-patroon van 2026-06-02
-- (chunker 11 dagen 401, niemand zag het), in een ander jasje.
CREATE OR REPLACE FUNCTION public.sync_health(source_name text, max_age_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_sync timestamptz; v_count bigint; v_age_min numeric; v_max integer;
  v_fresh boolean; v_warning text; v_meta jsonb := '{}'::jsonb;
BEGIN
  v_max := COALESCE(max_age_minutes, CASE source_name
    WHEN 'mail'        THEN 30
    WHEN 'engagement'  THEN 120
    WHEN 'jira'        THEN 30
    WHEN 'deal'        THEN 30
    WHEN 'company'     THEN 30
    WHEN 'contact'     THEN 30
    WHEN 'embedding'   THEN 15
    WHEN 'meeting'     THEN 30
    WHEN 'event'       THEN 30
    WHEN 'chunks'      THEN 60
    -- 30 min = zes gemiste */5-rondes voordat er iets rood wordt.
    WHEN 'confluence'  THEN 30
    -- 26 uur: één gemiste dagelijkse ronde mag, twee niet.
    WHEN 'confluence_acl' THEN 1560
    ELSE 60
  END);

  IF source_name = 'mail' THEN
    SELECT max(synced_at), count(*) INTO v_last_sync, v_count FROM mail_messages;
    v_meta := jsonb_build_object('source_table', 'mail_messages.synced_at');
  ELSIF source_name = 'engagement' THEN
    SELECT max(synced_at), count(*) INTO v_last_sync, v_count FROM hubspot_engagements;
    v_meta := jsonb_build_object('source_table', 'hubspot_engagements.synced_at');
  ELSIF source_name = 'jira' THEN
    SELECT last_delta_sync INTO v_last_sync FROM jira_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM jira_issues;
    v_meta := jsonb_build_object('source_table', 'jira_sync_state.last_delta_sync');
  ELSIF source_name = 'deal' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_deals;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'company' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_companies;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'contact' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_contacts;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'meeting' THEN
    SELECT last_delta_sync_at INTO v_last_sync FROM fireflies_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM fireflies_meetings;
    v_meta := jsonb_build_object('source_table', 'fireflies_sync_state.last_delta_sync_at');
  ELSIF source_name = 'event' THEN
    SELECT last_delta_sync_at INTO v_last_sync FROM calendar_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM calendar_events;
    v_meta := jsonb_build_object('source_table', 'calendar_sync_state.last_delta_sync_at');
  ELSIF source_name = 'confluence' THEN
    -- greatest() en niet last_full_sync alleen: de cadans mag van full naar
    -- delta en terug zonder dat de gezondheid stilletjes op 'stale' blijft staan.
    SELECT greatest(last_full_sync, last_delta_sync) INTO v_last_sync
      FROM confluence_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM confluence_pages WHERE is_archived = false;
    v_meta := jsonb_build_object(
      'source_table', 'confluence_sync_state.greatest(last_full_sync, last_delta_sync)',
      'archived_pages', (SELECT count(*) FROM confluence_pages WHERE is_archived),
      'chunks', (SELECT count(*) FROM chunks WHERE source = 'confluence'));
  ELSIF source_name = 'confluence_acl' THEN
    -- Een ACL die stilvalt is net zo stil als een chunker die stilvalt: er komt
    -- geen fout, er verandert alleen niets meer aan wie wat mag zien.
    SELECT max(synced_at) INTO v_last_sync FROM confluence_space_grants;
    SELECT count(*) INTO v_count FROM confluence_space_grants;
    v_meta := jsonb_build_object(
      'source_table', 'confluence_space_grants.synced_at',
      'identities', (SELECT count(*) FROM confluence_identities),
      'mirrored_spaces', (SELECT count(*) FROM confluence_spaces WHERE is_mirrored));
  ELSIF source_name = 'chunks' THEN
    SELECT max(embedded_at) INTO v_last_sync FROM chunks;
    SELECT count(*) INTO v_count FROM chunks WHERE embedding IS NOT NULL;
    v_meta := jsonb_build_object('source_table', 'chunks.embedded_at');
  ELSIF source_name = 'embedding' THEN
    -- Nieuwe definitie: embedding-pipeline = chunks + jellemind_lessons
    SELECT max(t) INTO v_last_sync FROM (
      SELECT max(embedded_at) AS t FROM chunks
      UNION ALL SELECT max(embedded_at) FROM jellemind_lessons
    ) sub;
    SELECT
      (SELECT count(*) FROM chunks WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM jellemind_lessons WHERE embedding IS NOT NULL)
    INTO v_count;
    v_meta := jsonb_build_object('source_table', 'max(embedded_at) over chunks + jellemind_lessons');
  ELSE
    RETURN jsonb_build_object('source', source_name, 'is_fresh', false, 'warning', format('unknown_source: %s', source_name));
  END IF;

  IF v_last_sync IS NULL THEN
    v_age_min := NULL; v_fresh := false; v_warning := 'no_sync_yet';
  ELSE
    v_age_min := EXTRACT(EPOCH FROM (now() - v_last_sync)) / 60.0;
    v_fresh := v_age_min <= v_max;
    v_warning := CASE WHEN v_fresh THEN NULL ELSE 'stale' END;
  END IF;

  RETURN jsonb_build_object(
    'source', source_name, 'last_sync_at', v_last_sync,
    'age_minutes', v_age_min, 'max_age_minutes', v_max,
    'is_fresh', v_fresh, 'source_count', v_count,
    'warning', v_warning, 'meta', v_meta, 'checked_at', now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_health_all()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'mail', sync_health('mail'),
    'engagement', sync_health('engagement'),
    'jira', sync_health('jira'),
    'deal', sync_health('deal'),
    'company', sync_health('company'),
    'contact', sync_health('contact'),
    'meeting', sync_health('meeting'),
    'event', sync_health('event'),
    'embedding', sync_health('embedding'),
    'confluence', sync_health('confluence'),
    'confluence_acl', sync_health('confluence_acl'),
    'all_fresh', (
      (sync_health('mail')->>'is_fresh')::boolean AND
      (sync_health('engagement')->>'is_fresh')::boolean AND
      (sync_health('jira')->>'is_fresh')::boolean AND
      (sync_health('deal')->>'is_fresh')::boolean AND
      (sync_health('company')->>'is_fresh')::boolean AND
      (sync_health('contact')->>'is_fresh')::boolean AND
      (sync_health('meeting')->>'is_fresh')::boolean AND
      (sync_health('event')->>'is_fresh')::boolean AND
      (sync_health('embedding')->>'is_fresh')::boolean AND
      (sync_health('confluence')->>'is_fresh')::boolean AND
      (sync_health('confluence_acl')->>'is_fresh')::boolean
    ),
    'checked_at', now()
  )
$function$;

COMMENT ON FUNCTION public.sync_health(text, integer) IS
  'Versheid per bron. Bronnen: mail, engagement, jira, deal, company, contact, meeting, event, chunks, embedding, confluence (spiegel), confluence_acl (space-grants). Onbekende bron geeft is_fresh=false + unknown_source — stilte is nooit groen.';
