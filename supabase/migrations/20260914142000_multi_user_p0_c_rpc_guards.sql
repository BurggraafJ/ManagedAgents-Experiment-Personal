-- =============================================================================
-- Multi-user P0 · GAP-2b — tien browser-RPC's krijgen een poort     (v1.190)
-- =============================================================================
-- Hoort bij migratie 20260914141000 (_b_rpc_revokes). Daar gingen de functies
-- dicht die de browser nooit aanroept; hier staan de tien die hij wél aanroept
-- en die geen enkele poort hadden. Intrekken kan daar niet — dan breekt het
-- dashboard — dus krijgen ze er één.
--
-- | functie                          | src-aanroeper                  | raakt        |
-- |----------------------------------|--------------------------------|--------------|
-- | request_run_now                  | agents-pagina                  | agent starten|
-- | update_agent_schedule            | agents-pagina                  | cron + budget|
-- | set_agent_status                 | agents-pagina                  | enable/uit   |
-- | set_agent_overview_visibility    | agents-pagina                  | overzicht    |
-- | mark_secret_rotated              | Platform → API Keys            | secrets      |
-- | revert_autodraft_decision        | Postvak                        | mailbesluit  |
-- | submit_ignore_with_rule          | Postvak                        | mailbesluit  |
-- | get_sender_actions               | Postvak / contactpaneel        | mailhistorie |
-- | get_company_actions              | Administratie                  | mailhistorie |
-- | classify_external_party          | (trigger + externe partijen)   | directory    |
--
-- ── Hoe deze migratie is gemaakt ────────────────────────────────────────────
-- Niet overgetypt. De definities komen letterlijk uit `pg_get_functiondef()`
-- van prod (2026-09-14) en er is precies één regel ingevoegd: de guard direct
-- na de buitenste BEGIN. Voor de twee `LANGUAGE sql`-functies kan dat niet —
-- die hebben geen statement-plek — dus staat daar een predicaat vooraan in de
-- WHERE: geen rij in plaats van een fout. Dat is voor een leesfunctie het
-- juiste gedrag, en het is fail-closed: `can_manage_dashboard()` geeft
-- `false` bij een lege uid.
--
-- CREATE OR REPLACE, geen DROP: de EXECUTE-grants blijven daarmee staan zoals
-- ze waren (geheugen `drop-function-verliest-proacl` — een kale CREATE na een
-- DROP geeft PUBLIC execute terug, en dat is precies het gat dat we dichten).
--
-- ── classify_external_party — let op het triggerpad ─────────────────────────
-- Deze functie wordt ook aangeroepen vanuit `validate_agent_proposal_schema()`,
-- de trigger op `agent_proposals`. Die trigger is SECURITY INVOKER, dus de
-- guard geldt daar voor wie de INSERT doet. De agents schrijven met de
-- service-role key (can_manage_dashboard → true) en Jelle is owner, dus het
-- pad blijft heel; een member die op agent_proposals zou schrijven loopt op de
-- guard stuk — fail closed, zoals bedoeld.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
-- Dezelfde definities zonder de guard-regel; ze staan in de git-historie van
-- deze file en in de migraties waar ze vandaan komen.
-- =============================================================================

begin;

CREATE OR REPLACE FUNCTION public.classify_external_party(p_domain_or_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_input  text;
  v_email  text;
  v_domain text;
  v_row    external_party_directory;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  IF p_domain_or_email IS NULL OR p_domain_or_email = '' THEN RETURN NULL; END IF;
  v_input := lower(trim(p_domain_or_email));
  IF v_input LIKE '%@%' THEN
    v_email := v_input;
    v_domain := split_part(v_input, '@', 2);
  ELSE
    v_email := NULL;
    v_domain := v_input;
  END IF;
  -- 1. Email-level match wint (overrides domain-level)
  IF v_email IS NOT NULL THEN
    SELECT * INTO v_row FROM external_party_directory WHERE lower(email) = v_email LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'matched_on', 'email',
        'email', v_row.email,
        'domain', v_row.domain,
        'canonical_name', v_row.canonical_name,
        'classification', v_row.classification,
        'skip_proposal', v_row.skip_proposal,
        'skip_autodraft', v_row.skip_autodraft,
        'skip_admin_future', v_row.skip_admin_future,
        'notes', v_row.notes, 'source', v_row.source, 'added_at', v_row.added_at
      );
    END IF;
  END IF;
  -- 2. Domain-level fallback
  SELECT * INTO v_row FROM external_party_directory WHERE lower(domain) = v_domain LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'matched_on', 'domain',
      'email', NULL, 'domain', v_row.domain,
      'canonical_name', v_row.canonical_name,
      'classification', v_row.classification,
      'skip_proposal', v_row.skip_proposal,
      'skip_autodraft', v_row.skip_autodraft,
      'skip_admin_future', v_row.skip_admin_future,
      'notes', v_row.notes, 'source', v_row.source, 'added_at', v_row.added_at
    );
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_secret_rotated(p_key_name text, p_new_last_4 text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS secrets_inventory
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row secrets_inventory;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  UPDATE secrets_inventory
  SET status = 'green_dashboard_only',
      last_status_change_at = now(),
      last_status_change_by = 'dashboard_user',
      last_4 = COALESCE(p_new_last_4, last_4),
      notes = COALESCE(p_notes, notes)
  WHERE key_name = p_key_name
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'secret % not found in secrets_inventory', p_key_name USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.request_run_now(agent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  row_rec record;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  SELECT agent_name, enabled, is_running, next_run_at, manual_run_requested_at, last_run_at
  INTO row_rec FROM agent_schedules WHERE agent_name = agent;

  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_found'); END IF;
  IF agent IN ('orchestrator', 'dashboard-refresh', 'agent-manager') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_manually_triggerable');
  END IF;
  IF NOT row_rec.enabled THEN RETURN jsonb_build_object('ok', false, 'reason', 'agent_disabled'); END IF;
  IF row_rec.is_running THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_running'); END IF;

  -- Persistente "aanvraag staat open" als er al een openstaande request is
  IF row_rec.manual_run_requested_at IS NOT NULL
     AND (row_rec.last_run_at IS NULL OR row_rec.last_run_at < row_rec.manual_run_requested_at) THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_requested',
                              'requested_at', row_rec.manual_run_requested_at);
  END IF;

  UPDATE agent_schedules
  SET next_run_at = now(),
      manual_run_requested_at = now(),
      updated_at = now()
  WHERE agent_name = agent;

  RETURN jsonb_build_object('ok', true, 'agent', agent, 'status', 'requested',
                            'requested_at', now());
END;
$function$
;

CREATE OR REPLACE FUNCTION public.revert_autodraft_decision(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_decision autodraft_decisions%rowtype;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  SELECT * INTO v_decision FROM autodraft_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'decision_not_found');
  END IF;

  -- Reset de mail terug naar pending
  UPDATE autodraft_mails
     SET status = 'pending', updated_at = now()
   WHERE mail_id = v_decision.mail_id;

  -- Markeer originele decision als 'reverted' via execution_status
  UPDATE autodraft_decisions
     SET execution_status = 'reverted',
         execution_error = COALESCE(execution_error, 'Reverted by user via dashboard')
   WHERE id = p_decision_id;

  RETURN jsonb_build_object('ok', true, 'mail_id', v_decision.mail_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_agent_overview_visibility(p_agent_name text, p_visible boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existed boolean;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  IF p_agent_name IS NULL OR length(trim(p_agent_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_name_required');
  END IF;

  UPDATE public.agent_schedules
     SET show_in_overview = COALESCE(p_visible, true),
         updated_at = now()
   WHERE agent_name = p_agent_name
  RETURNING true INTO v_existed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'agent_name', p_agent_name, 'visible', p_visible);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_agent_status(p_agent_name text, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_enabled     boolean;
  v_maintenance boolean;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  IF p_status = 'live' THEN
    v_enabled := true;  v_maintenance := false;
  ELSIF p_status = 'maintenance' THEN
    v_enabled := true;  v_maintenance := true;
  ELSIF p_status = 'off' THEN
    v_enabled := false; v_maintenance := false;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  UPDATE agent_schedules
     SET enabled        = v_enabled,
         is_maintenance = v_maintenance,
         updated_at     = now()
   WHERE agent_name = p_agent_name;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'agent_name', p_agent_name, 'status', p_status);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_ignore_with_rule(p_mail_id text, p_target_folder text, p_pattern_type text, p_pattern_value text, p_reason text, p_reason_kind text DEFAULT 'unwanted'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_decision jsonb;
  v_rule jsonb;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  -- 1. Stel de gewone ignore-decision in via bestaande RPC
  v_decision := submit_autodraft_decision(
    p_mail_id, 'ignore', NULL, NULL, NULL, p_target_folder, 'reply', NULL
  );
  IF (v_decision->>'ok')::boolean = false THEN
    RETURN v_decision;
  END IF;
  -- 2. Voeg de leerregel toe
  IF p_pattern_value IS NOT NULL AND length(trim(p_pattern_value)) > 0 THEN
    v_rule := add_ignore_rule(p_mail_id, p_pattern_type, p_pattern_value, p_reason, p_reason_kind);
  END IF;
  RETURN jsonb_build_object('ok', true, 'decision', v_decision, 'rule', v_rule);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_agent_schedule(p_agent_name text, p_enabled boolean DEFAULT NULL::boolean, p_cron_expression text DEFAULT NULL::text, p_timeout_minutes integer DEFAULT NULL::integer, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec           record;
  old_cron      text;
  cron_changed  boolean := false;
BEGIN
  PERFORM public.assert_can_manage_dashboard();
  IF p_agent_name IS NULL OR length(trim(p_agent_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_agent_name');
  END IF;

  IF p_cron_expression IS NOT NULL THEN
    IF array_length(regexp_split_to_array(trim(p_cron_expression), E'\\s+'), 1) <> 5 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_cron_format',
        'detail', 'cron moet 5 velden hebben: minute hour day month dayofweek');
    END IF;
  END IF;

  IF trim(p_agent_name) = 'orchestrator' AND p_enabled = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_disable_orchestrator',
      'detail', 'orchestrator aanpassen kan alleen direct in DB — uitzetten legt alle agents stil');
  END IF;

  -- Haal huidige cron op om te bepalen of we next_run_at moeten invalideren.
  SELECT cron_expression INTO old_cron
  FROM public.agent_schedules
  WHERE agent_name = trim(p_agent_name);

  IF p_cron_expression IS NOT NULL AND old_cron IS DISTINCT FROM trim(p_cron_expression) THEN
    cron_changed := true;
  END IF;

  UPDATE public.agent_schedules
     SET enabled         = COALESCE(p_enabled, enabled),
         cron_expression = COALESCE(p_cron_expression, cron_expression),
         timeout_minutes = COALESCE(p_timeout_minutes, timeout_minutes),
         -- Alleen resetten als cron echt gewijzigd is — een pure aan/uit-toggle
         -- mag de gecachete next_run_at niet kwijtraken.
         next_run_at     = CASE WHEN cron_changed THEN NULL ELSE next_run_at END,
         updated_at      = now()
   WHERE agent_name = trim(p_agent_name)
  RETURNING agent_name, enabled, cron_expression, timeout_minutes, next_run_at INTO rec;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true,
    'agent_name',       rec.agent_name,
    'enabled',          rec.enabled,
    'cron_expression',  rec.cron_expression,
    'timeout_minutes',  rec.timeout_minutes,
    'next_run_at',      rec.next_run_at,
    'cron_changed',     cron_changed);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_company_actions(p_hubspot_company_id text, p_lookback_days integer DEFAULT 730)
 RETURNS TABLE(decision_id uuid, mail_id text, conversation_id text, action_slug text, action_display_name text, category text, payload jsonb, was_suggested boolean, suggested_rank integer, outcome text, decided_at timestamp with time zone, executed_at timestamp with time zone, mail_subject text, from_email text, from_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH company_domains AS (
    SELECT er.alias_value AS domain FROM public.entity_resolution er
     WHERE er.entity_type = 'company' AND er.entity_id::text = p_hubspot_company_id AND er.alias_type = 'email_domain'
  )
  SELECT d.id, d.mail_id, d.conversation_id, d.action_slug, a.display_name,
         a.category, d.payload, d.was_suggested, d.suggested_rank, d.outcome,
         d.decided_at, d.executed_at, m.subject, m.from_email, m.from_name
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  LEFT JOIN public.autodraft_actions       a  ON a.slug = d.action_slug
  JOIN   company_domains cd ON lower(m.from_domain) = cd.domain
  WHERE  public.can_manage_dashboard()          -- multi-user P0: geen rij voor een member
    AND  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT 200;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sender_actions(p_from_email text, p_lookback_days integer DEFAULT 730)
 RETURNS TABLE(decision_id uuid, mail_id text, conversation_id text, action_slug text, action_display_name text, category text, payload jsonb, was_suggested boolean, suggested_rank integer, outcome text, decided_at timestamp with time zone, executed_at timestamp with time zone, mail_subject text, from_email text, from_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.id, d.mail_id, d.conversation_id, d.action_slug, a.display_name,
         a.category, d.payload, d.was_suggested, d.suggested_rank, d.outcome,
         d.decided_at, d.executed_at, m.subject, m.from_email, m.from_name
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  LEFT JOIN public.autodraft_actions       a  ON a.slug = d.action_slug
  WHERE  public.can_manage_dashboard()          -- multi-user P0: geen rij voor een member
    AND  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  lower(m.from_email) = lower(p_from_email)
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT 100;
$function$
;


COMMENT ON FUNCTION public.get_sender_actions(text, integer) IS
  'Leest mail-historie per afzender. Poort in het WHERE-predicaat (can_manage_dashboard): een member krijgt nul rijen in plaats van een fout. Zodra members een eigen mailbox hebben moet dit een per-user-scope worden op mail_messages.user_id. Multi-user P0 GAP-2.';

COMMENT ON FUNCTION public.get_company_actions(text, integer) IS
  'Leest mail-historie per bedrijf. Zelfde poort en zelfde vervolg als get_sender_actions. Multi-user P0 GAP-2.';

commit;
