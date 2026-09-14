-- =============================================================================
-- Postvak · "Ververs" moet de baan porren die écht loopt                (v1.197)
-- =============================================================================
-- `request_mail_sync_now()` deed één ding: `manual_run_requested_at = now()`
-- zetten op twee rijen in `agent_schedules` ('mail-sync' en 'auto-draft') en
-- daarna `ok: true` teruggeven met de tekst "Orchestrator pikt op binnen ~30s".
-- Gemeten op prod, 2026-09-14 17:45 UTC:
--
--     agent_schedules  mail-sync    enabled  last_run_at 2026-09-02 13:23
--     agent_schedules  auto-draft   enabled  last_run_at 2026-09-10 05:08
--     manual_run_requested_at op beide:      2026-09-10 22:11  (nooit opgepakt)
--
-- Die twee lanes hangen aan de lokale Claude-orchestrator, en die staat stil.
-- De mailsync die wél loopt is de Edge Function `mail-sync-etl-v2`, gepord door
-- pg_cron-job `mail-sync-etl` (*/5), laatste succes 17:45:05 met
-- `mail_sync_state.last_delta_at` 17:45:14. De knop in Postvak beloofde dus een
-- sync die al twaalf dagen niet meer op die knop hing: druk erop, krijg een
-- groene toast, er gebeurt niets.
--
-- ── Wat er verandert ────────────────────────────────────────────────────────
-- 1. De functie post nu zelf naar `mail-sync-etl-v2`, met exact de headers van
--    de cron-job (vault-secret `skill:global:cron_secret`). Dát is de baan die
--    de spiegel bijwerkt.
-- 2. Ze blijft `manual_run_requested_at` zetten op de skill-lanes. Komt de
--    orchestrator terug, dan pakt hij het gewoon op; weghalen zou een werkend
--    pad slopen om een kapot pad te repareren.
-- 3. Het antwoord vertelt per baan wat er is gebeurd, inclusief hoe oud de
--    laatste run van elke lane is. Een knop die "ok" zegt zonder te zeggen wát
--    er ok is, is precies hoe dit twaalf dagen onzichtbaar bleef.
--
-- ── Wat er NIET verandert ───────────────────────────────────────────────────
-- De poort. `require_dashboard_auth()` blijft staan, ongewijzigd — spoor ∥A
-- (multi-user M2) is eigenaar van wie deze RPC's mag aanroepen; hier wordt niets
-- verbreed of versmald. CREATE OR REPLACE, geen DROP: een DROP + kale CREATE
-- zou de bestaande proacl weggooien en PUBLIC weer EXECUTE geven.
--
-- Geen secret komt in het antwoord of in een log terecht; het token wordt
-- alleen in de header gezet, net als in de cron-job.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.request_mail_sync_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_sync_at        timestamptz;
  v_draft_at       timestamptz;
  v_token          text;
  v_edge_fired     boolean := false;
  v_edge_reason    text    := null;
  v_last_claim     timestamptz;
  v_last_delta     timestamptz;
  v_sync_last_run  timestamptz;
  v_draft_last_run timestamptz;
BEGIN
  PERFORM public.require_dashboard_auth();

  -- ── 1. De baan die echt loopt: de Edge-ETL ────────────────────────────────
  -- Debounce van 15 seconden op de laatste sync-claim, zodat dubbelklikken of
  -- een vastzittende client de mailbox niet in een lus trekt. De pg_cron-tick
  -- staat 5 minuten uit elkaar, dus een echte handmatige ververs raakt deze
  -- rem nooit.
  SELECT max((a.last_claim_at ->> 'sync')::timestamptz)
    INTO v_last_claim
    FROM public.mail_accounts a
   WHERE a.enabled AND NOT a.paused;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE name = 'skill:global:cron_secret'
   LIMIT 1;

  IF v_token IS NULL THEN
    v_edge_reason := 'no_cron_secret';
  ELSIF v_last_claim IS NOT NULL AND v_last_claim > now() - interval '15 seconds' THEN
    v_edge_reason := 'recently_synced';
  ELSE
    BEGIN
      PERFORM net.http_post(
        url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-sync-etl-v2',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_token,
          'x-trigger-source', 'request_mail_sync_now'
        ),
        body := '{}'::jsonb
      );
      v_edge_fired := true;
    EXCEPTION WHEN OTHERS THEN
      -- Een HTTP-fout mag de skill-lanes hieronder niet meesleuren.
      v_edge_reason := 'http_post_failed';
    END;
  END IF;

  -- ── 2. De skill-lanes: onveranderd porren ─────────────────────────────────
  UPDATE agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'mail-sync' AND enabled = true
   RETURNING manual_run_requested_at INTO v_sync_at;

  UPDATE agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'auto-draft' AND enabled = true
   RETURNING manual_run_requested_at INTO v_draft_at;

  SELECT last_run_at INTO v_sync_last_run
    FROM agent_schedules WHERE agent_name = 'mail-sync';
  SELECT last_run_at INTO v_draft_last_run
    FROM agent_schedules WHERE agent_name = 'auto-draft';

  SELECT max(s.last_delta_at) INTO v_last_delta FROM public.mail_sync_state s;

  RETURN jsonb_build_object(
    'ok', true,
    -- De Edge-ETL: dit is wat de mailspiegel bijwerkt.
    'edge_sync_triggered', v_edge_fired,
    'edge_skip_reason', v_edge_reason,
    'mail_sync_last_delta_at', v_last_delta,
    -- De skill-lanes: aangevraagd, maar alleen zinvol als de orchestrator loopt.
    'mail_sync_requested_at', v_sync_at,
    'auto_draft_requested_at', v_draft_at,
    'mail_sync_skill_last_run_at', v_sync_last_run,
    'auto_draft_skill_last_run_at', v_draft_last_run,
    'auto_draft_skill_stale', (v_draft_last_run IS NULL OR v_draft_last_run < now() - interval '6 hours'),
    'note', CASE
      WHEN v_edge_fired THEN 'Mail-sync gestart. Verse mail binnen ~20 s.'
      WHEN v_edge_reason = 'recently_synced' THEN 'Net gesynct — de mailspiegel is bij.'
      ELSE 'Mail-sync kon niet gestart worden; de cron draait nog wel elke 5 min.'
    END
  );
END;
$function$;

COMMENT ON FUNCTION public.request_mail_sync_now() IS
  'Postvak "Ververs". Port de Edge-ETL mail-sync-etl-v2 (de baan die loopt) en '
  'zet manual_run_requested_at op de skill-lanes mail-sync/auto-draft. Geeft per '
  'baan terug wat er gebeurd is; auto_draft_skill_stale=true betekent dat de '
  'lokale orchestrator stilstaat. Poort: require_dashboard_auth().';
