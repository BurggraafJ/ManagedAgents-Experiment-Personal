-- 2026-05-12 — Cascade HubSpot-archived naar contactpersonen + firms.
--
-- Probleem (audit 2026-05-12): contactpersonen.is_deleted en firms.is_deleted
-- bestaan al maar staan altijd op false (0/927 + 0/728). HubSpot-archived
-- contacten worden door seed_contactpersonen wel bij INSERT genegeerd, maar
-- nooit bij UPDATE alsnog gemarkeerd. Gevolg: een contact die ooit gesynced
-- werd en daarna in HubSpot is gearchiveerd blijft eeuwig is_deleted=false.
--
-- Fix: nieuwe DB-functie archive_contactpersonen_from_hubspot() die als
-- vierde pass in sync_contactpersonen_full wordt aangeroepen. Mirrors
-- hubspot_contacts.is_archived → contactpersonen.is_deleted en
-- hubspot_companies.is_archived → firms.is_deleted. Werkt alleen op rijen die
-- aan een HubSpot-record gekoppeld zijn (hubspot_contact_id / hubspot_company_id
-- NIET NULL) — Outlook-only contacten worden niet geraakt (er is geen
-- betrouwbaar delete-signaal voor mail-afgeleide contacten).
--
-- Afhankelijk van hubspot-reconcile: alleen wanneer die HubSpot-mirror correct
-- is_archived flipt (commit 17aa28f, 2026-05-12), heeft deze cascade effect.
--
-- Toegepast in productie via mcp__supabase__apply_migration met dezelfde
-- naam — dit bestand is voor reproducibility bij fresh setup.

CREATE OR REPLACE FUNCTION public.archive_contactpersonen_from_hubspot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contacts_archived int := 0;
  v_contacts_revived  int := 0;
  v_firms_archived    int := 0;
  v_firms_revived     int := 0;
BEGIN
  -- Contactpersonen — archive: koppel aan archived HubSpot-contact
  WITH archived_set AS (
    SELECT contact_id FROM public.hubspot_contacts WHERE is_archived = true
  ),
  flipped AS (
    UPDATE public.contactpersonen cp
    SET is_deleted = true, updated_at = now()
    WHERE cp.hubspot_contact_id IS NOT NULL
      AND cp.is_deleted = false
      AND cp.hubspot_contact_id IN (SELECT contact_id FROM archived_set)
    RETURNING 1
  )
  SELECT count(*) INTO v_contacts_archived FROM flipped;

  -- Contactpersonen — revive: HubSpot-contact is_archived=false maar
  -- contactpersoon staat nog is_deleted=true (Jelle un-archived).
  WITH active_set AS (
    SELECT contact_id FROM public.hubspot_contacts WHERE is_archived = false
  ),
  flipped AS (
    UPDATE public.contactpersonen cp
    SET is_deleted = false, updated_at = now()
    WHERE cp.hubspot_contact_id IS NOT NULL
      AND cp.is_deleted = true
      AND cp.hubspot_contact_id IN (SELECT contact_id FROM active_set)
    RETURNING 1
  )
  SELECT count(*) INTO v_contacts_revived FROM flipped;

  -- Firms — archive
  WITH archived_set AS (
    SELECT company_id FROM public.hubspot_companies WHERE is_archived = true
  ),
  flipped AS (
    UPDATE public.firms f
    SET is_deleted = true, updated_at = now()
    WHERE f.hubspot_company_id IS NOT NULL
      AND f.is_deleted = false
      AND f.hubspot_company_id IN (SELECT company_id FROM archived_set)
    RETURNING 1
  )
  SELECT count(*) INTO v_firms_archived FROM flipped;

  -- Firms — revive
  WITH active_set AS (
    SELECT company_id FROM public.hubspot_companies WHERE is_archived = false
  ),
  flipped AS (
    UPDATE public.firms f
    SET is_deleted = false, updated_at = now()
    WHERE f.hubspot_company_id IS NOT NULL
      AND f.is_deleted = true
      AND f.hubspot_company_id IN (SELECT company_id FROM active_set)
    RETURNING 1
  )
  SELECT count(*) INTO v_firms_revived FROM flipped;

  RETURN jsonb_build_object(
    'contacts_archived', v_contacts_archived,
    'contacts_revived',  v_contacts_revived,
    'firms_archived',    v_firms_archived,
    'firms_revived',     v_firms_revived
  );
END;
$function$;

COMMENT ON FUNCTION public.archive_contactpersonen_from_hubspot() IS
  'Vierde pass in sync_contactpersonen_full (2026-05-12). Cascadeert
hubspot_contacts.is_archived naar contactpersonen.is_deleted en
hubspot_companies.is_archived naar firms.is_deleted. Werkt alleen op
HubSpot-gekoppelde rijen (hubspot_contact_id / hubspot_company_id NIET NULL).';

-- Wire de nieuwe pass in sync_contactpersonen_full (skill_version bumped naar v2).
CREATE OR REPLACE FUNCTION public.sync_contactpersonen_full()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_run_id          uuid := gen_random_uuid();
  v_started         timestamptz := now();
  v_seed_result     jsonb;
  v_improve_result  jsonb;
  v_enrich_result   jsonb;
  v_archive_result  jsonb;
  v_total_before    int;
  v_total_after     int;
  v_new_contacten   int;
BEGIN
  SELECT COUNT(*) INTO v_total_before FROM public.contactpersonen WHERE NOT is_deleted;

  INSERT INTO public.agent_runs (id, agent_name, run_type, started_at, status, summary, stats, errors)
  VALUES (v_run_id, 'contactpersonen-sync', 'scheduled', v_started, 'running', 'Delta-sync gestart',
    jsonb_build_object(
      'schema_version', '1',
      'skill_version',  'sync-contactpersonen-full-v2',
      'mode',           NULL,
      'triggered_by',   'pg_cron',
      'triggered_at',   v_started,
      'passes',         '[]'::jsonb,
      'warnings',       '[]'::jsonb,
      'counts',         '{}'::jsonb,
      'extra',          '{}'::jsonb
    ),
    '[]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  v_seed_result    := public.seed_contactpersonen();
  v_improve_result := public.improve_firm_matching();
  v_enrich_result  := public.enrich_contact_categories();
  -- v2 (2026-05-12): 4e pass — HubSpot-archived cascadeert naar
  -- contactpersonen.is_deleted + firms.is_deleted.
  v_archive_result := public.archive_contactpersonen_from_hubspot();

  SELECT COUNT(*) INTO v_total_after FROM public.contactpersonen WHERE NOT is_deleted;
  v_new_contacten := v_total_after - v_total_before;

  UPDATE public.contactpersonen_sync_state
  SET last_sync_at    = now(),
      last_delta_sync = now(),
      total_synced    = v_total_after,
      last_error      = NULL,
      updated_at      = now()
  WHERE source IN ('hubspot', 'outlook');

  UPDATE public.agent_runs
  SET status     = 'success',
      completed_at = now(),
      summary    = format('Sync OK - %s nieuwe contacten (totaal %s), %s gearchiveerd',
        v_new_contacten, v_total_after,
        (v_archive_result->>'contacts_archived')::int + (v_archive_result->>'firms_archived')::int),
      stats      = jsonb_build_object(
        'schema_version', '1',
        'skill_version',  'sync-contactpersonen-full-v2',
        'mode',           NULL,
        'triggered_by',   'pg_cron',
        'triggered_at',   v_started,
        'passes',         '[]'::jsonb,
        'warnings',       '[]'::jsonb,
        'counts',         jsonb_build_object(
          'new_contacten',   v_new_contacten,
          'total_contacten', v_total_after,
          'archived_cascade', v_archive_result
        ),
        'extra',          jsonb_build_object(
          'seed',    v_seed_result,
          'improve', v_improve_result,
          'enrich',  v_enrich_result,
          'archive', v_archive_result
        )
      )
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'status',         'ok',
    'run_id',         v_run_id,
    'duration_sec',   EXTRACT(EPOCH FROM (now() - v_started))::int,
    'new_contacten',  v_new_contacten,
    'total_contacten', v_total_after,
    'seed',           v_seed_result,
    'improve',        v_improve_result,
    'enrich',         v_enrich_result,
    'archive',        v_archive_result
  );

EXCEPTION WHEN OTHERS THEN
  UPDATE public.agent_runs
  SET status      = 'error',
      completed_at = now(),
      summary     = 'Sync gefaald: ' || SQLERRM,
      errors      = jsonb_build_array(jsonb_build_object(
        'severity', 'error',
        'code',     'sync_failure',
        'message',  SQLERRM,
        'context',  '{}'::jsonb
      ))
  WHERE id = v_run_id;

  UPDATE public.contactpersonen_sync_state
  SET last_error = SQLERRM, updated_at = now()
  WHERE source IN ('hubspot', 'outlook');

  RAISE;
END;
$function$;
