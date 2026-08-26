-- ===========================================================================
-- 20260826_request_sync_rpcs.sql
-- Project: Mobile Postvak & Agenda sync triggers
--
-- Creates RPC functions to trigger mail-sync-etl-v2 and outlook-calendar-sync-etl
-- Edge Functions from the frontend (mobile/desktop). Auth'd users can force a
-- sync via tappable sync-time control.
--
-- Pattern: POST naar de Edge Function met cron_secret (ophalen uit agent_config)
-- via net.http_post. Edge Functions draaien op verify_jwt:false (CRON auth) dus
-- frontend kan ze niet direct callen — vandaar deze RPC-wrapper.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. request_mail_sync_now — trigger mail-sync-etl-v2 Edge Function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_mail_sync_now() 
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public 
AS $$
DECLARE
  v_cron_secret text;
  v_url text;
  v_response record;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN 
    RAISE EXCEPTION 'not authenticated'; 
  END IF;

  -- Haal cron_secret op uit agent_config (global)
  SELECT config_value::text INTO v_cron_secret
  FROM public.agent_config
  WHERE agent_name = 'global' 
    AND config_key = 'cron_secret'
  LIMIT 1;

  IF v_cron_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cron_secret_missing');
  END IF;

  -- Edge Function URL (replace met jouw Supabase project URL)
  v_url := current_setting('app.supabase_url', true) || '/functions/v1/mail-sync-etl-v2';

  -- POST naar Edge Function met cron_secret als Bearer token
  SELECT * INTO v_response FROM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret,
      'x-trigger-source', 'user_force_sync'
    ),
    body := '{}'::jsonb
  );

  -- Edge Function accepteert cron_secret; status 200 = geslaagd
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

-- ---------------------------------------------------------------------------
-- 2. request_calendar_sync_now — trigger outlook-calendar-sync-etl Edge Function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_calendar_sync_now() 
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public 
AS $$
DECLARE
  v_cron_secret text;
  v_url text;
  v_response record;
BEGIN
  -- Auth check
  IF auth.uid() IS NULL THEN 
    RAISE EXCEPTION 'not authenticated'; 
  END IF;

  -- Haal cron_secret op uit agent_config (global)
  SELECT config_value::text INTO v_cron_secret
  FROM public.agent_config
  WHERE agent_name = 'global' 
    AND config_key = 'cron_secret'
  LIMIT 1;

  IF v_cron_secret IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cron_secret_missing');
  END IF;

  -- Edge Function URL
  v_url := current_setting('app.supabase_url', true) || '/functions/v1/outlook-calendar-sync-etl';

  -- POST naar Edge Function met cron_secret als Bearer token
  SELECT * INTO v_response FROM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron_secret,
      'x-trigger-source', 'user_force_sync'
    ),
    body := '{}'::jsonb
  );

  -- Edge Function accepteert cron_secret; status 200 = geslaagd
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

COMMIT;
