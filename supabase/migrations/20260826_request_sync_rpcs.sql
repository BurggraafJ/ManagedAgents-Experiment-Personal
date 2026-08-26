-- ===========================================================================
-- 20260826_request_sync_rpcs.sql
-- Project: Mobile Postvak & Agenda sync triggers
--
-- ⚠️ MIGRATION SUPERSEDED — NO-OP
--
-- Original intent: Create request_mail_sync_now() and request_calendar_sync_now()
-- RPCs for mobile force-sync buttons.
--
-- Status: BEIDE RPC's bestaan al in productie met ANDERE implementatie:
--
-- 1. request_mail_sync_now() — bestaande productie-implementatie:
--    • Kicked agent_schedules.manual_run_requested_at voor 'mail-sync' + 'auto-draft'
--    • Via require_dashboard_auth() patroon (orchestrator-driven)
--    • Werkt NIET via pg_net + cron_secret naar Edge Functions
--
-- 2. request_calendar_sync_now() — bestaande productie-implementatie:
--    • Zelfde orchestrator-patroon als mail-sync
--    • agent_schedules.manual_run_requested_at voor 'outlook-calendar-sync'
--
-- Deze migratie doet NIETS — de oorspronkelijke implementatie (hieronder in
-- commentaar) zou de productie-RPC's overschrijven met een gebroken versie.
-- De frontend (MobilePostvak.jsx / MobileAgenda.jsx) roept de bestaande RPCs
-- aan en die werken correct.
--
-- Geen actie nodig. Deze file blijft staan voor git-historie.
-- ===========================================================================

BEGIN;

-- No-op migration. Zie commentaar hierboven.

COMMIT;

/*
-- ── ORIGINELE (GEBROKEN) IMPLEMENTATIE ─────────────────────────────────────
-- Deze zou de bestaande productie-RPCs overschrijven. NIET TOEPASSEN.

CREATE OR REPLACE FUNCTION public.request_mail_sync_now() 
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public 
AS $$
DECLARE
  v_cron_secret text;
  v_url text;
  v_response record;
BEGIN
  IF auth.uid() IS NULL THEN 
    RAISE EXCEPTION 'not authenticated'; 
  END IF;

  SELECT config_value::text INTO v_cron_secret
  FROM public.agent_config
  WHERE agent_name = 'global' 
    AND config_key = 'cron_secret'
  LIMIT 1;

  IF v_cron_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cron_secret_missing');
  END IF;

  v_url := current_setting('app.supabase_url', true) || '/functions/v1/mail-sync-etl-v2';

  SELECT * INTO v_response FROM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret,
      'x-trigger-source', 'user_force_sync'
    ),
    body := '{}'::jsonb
  );

  IF v_response.status = 200 OR v_response.status = 202 THEN
    RETURN jsonb_build_object('ok', true, 'status', v_response.status);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'edge_function_error', 'status', v_response.status);
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.request_mail_sync_now() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_calendar_sync_now() 
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public 
AS $$
DECLARE
  v_cron_secret text;
  v_url text;
  v_response record;
BEGIN
  IF auth.uid() IS NULL THEN 
    RAISE EXCEPTION 'not authenticated'; 
  END IF;

  SELECT config_value::text INTO v_cron_secret
  FROM public.agent_config
  WHERE agent_name = 'global' 
    AND config_key = 'cron_secret'
  LIMIT 1;

  IF v_cron_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cron_secret_missing');
  END IF;

  v_url := current_setting('app.supabase_url', true) || '/functions/v1/outlook-calendar-sync-etl';

  SELECT * INTO v_response FROM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret,
      'x-trigger-source', 'user_force_sync'
    ),
    body := '{}'::jsonb
  );

  IF v_response.status = 200 OR v_response.status = 202 THEN
    RETURN jsonb_build_object('ok', true, 'status', v_response.status);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'edge_function_error', 'status', v_response.status);
  END IF;

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'reason', SQLERRM);
END $$;

GRANT EXECUTE ON FUNCTION public.request_calendar_sync_now() TO authenticated;
*/
