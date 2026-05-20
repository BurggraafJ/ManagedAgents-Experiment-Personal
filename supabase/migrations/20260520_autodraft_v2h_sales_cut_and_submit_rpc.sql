-- =====================================================================
-- AutoDraft v2 — Fase 2c + #3 antwoorden (Jelle bevestigd 2026-05-20)
-- =====================================================================
-- (1) resolve_klant_subtype: sales-lead vs sales-opvolging cut bij
--     'Kennismaking plaatsgevonden' (stage appointmentscheduled / 4896974067).
-- (2) submit_action_decision RPC — bridge naar autodraft_decisions
--     zodat auto-draft-execute v9 ongewijzigd kan blijven.
--
-- Mapping per category:
--   reply.*     → action='send', decision_kind='reply', chosen_variant_index
--   forward.*   → action='send', decision_kind='forward', final_to=catalog.target_value
--   file.*      → action='ignore', target_folder=payload of catalog
--   defer.*     → action='ignore', target_folder=catalog of 'Archive'
--   delegate.*  → NIET via bridge — aparte Jira-pad (TODO Fase 2d)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.resolve_klant_subtype(p_from_email text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH domain AS (
    SELECT lower(split_part(p_from_email, '@', 2)) AS d
    WHERE p_from_email IS NOT NULL AND p_from_email <> ''
  ),
  company AS (
    SELECT er.entity_id::text AS company_id
      FROM public.entity_resolution er
      JOIN domain ON er.alias_value = domain.d
     WHERE er.alias_type = 'email_domain'
       AND er.entity_type = 'company'
     LIMIT 1
  ),
  stages AS (
    SELECT d.dealstage, d.pipeline_id, d.hs_lastmodifieddate
      FROM public.hubspot_deals d
      JOIN company c ON c.company_id = ANY(d.associated_company_ids)
     WHERE NOT d.is_archived
     ORDER BY d.hs_lastmodifieddate DESC
     LIMIT 5
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM stages WHERE dealstage IN ('3504527569','4841337018'))
      THEN 'klant_pilot'
    WHEN EXISTS (SELECT 1 FROM stages WHERE dealstage = '5184563446')
      THEN 'klant_customer_base_self_service'
    WHEN EXISTS (SELECT 1 FROM stages WHERE dealstage IN ('3136444618','5052825799','3417083067'))
      THEN 'klant_customer_base'
    WHEN EXISTS (
      SELECT 1 FROM stages WHERE dealstage IN (
        'appointmentscheduled', '4077073627', '3206386936', 'contractsent',
        '4075158742', '3453858021', '3206386937', '3206387898', '4984103151',
        '4896974067', '4896974068', '4896974069', '4896974070',
        '4896974071', '4896974072', '4896974073', '4896975034'
      )
    )
      THEN 'klant_sales_opvolging'
    WHEN EXISTS (
      SELECT 1 FROM stages
       WHERE pipeline_id IN ('default','3571993844','2562718926','2557844668','3534570692','2971054291')
    )
      THEN 'klant_sales_lead'
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.resolve_klant_subtype(text) IS
  'AutoDraft v2 — deterministische klant-tak via HubSpot pipeline+stage. '
  'Sales cut (2026-05-20, Jelle): vanaf appointmentscheduled / 4896974067 '
  '(Kennismaking plaatsgevonden) = opvolging. Eerder = lead.';

-- ---------------------------------------------------------------------
-- submit_action_decision RPC
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_action_decision(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.submit_action_decision(
  p_decision_id      uuid,
  p_outcome          text,
  p_payload_override jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dec        public.autodraft_action_decisions%ROWTYPE;
  v_act        public.autodraft_actions%ROWTYPE;
  v_mail       public.autodraft_mails%ROWTYPE;
  v_eff_payload      jsonb;
  v_resolved_action  text;
  v_resolved_kind    text;
  v_target_folder    text;
  v_final_to         text[];
  v_chosen_idx       int;
  v_decision_id_new  uuid;
BEGIN
  IF p_outcome NOT IN ('accept','amend','reject') THEN
    RAISE EXCEPTION 'invalid_outcome: must be accept | amend | reject';
  END IF;

  SELECT * INTO v_dec FROM autodraft_action_decisions WHERE id = p_decision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision_not_found: %', p_decision_id; END IF;

  IF v_dec.outcome IS NOT NULL THEN
    RAISE EXCEPTION 'already_decided: outcome=% set at %', v_dec.outcome, v_dec.decided_at;
  END IF;

  SELECT * INTO v_act FROM autodraft_actions WHERE slug = v_dec.action_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_action_slug: %', v_dec.action_slug; END IF;

  v_eff_payload := COALESCE(p_payload_override, v_dec.payload, '{}'::jsonb);

  UPDATE autodraft_action_decisions
     SET outcome    = p_outcome,
         payload    = v_eff_payload,
         decided_at = now()
   WHERE id = p_decision_id;

  IF p_outcome <> 'accept' THEN
    RETURN jsonb_build_object('ok', true, 'outcome', p_outcome, 'autodraft_decision_id', NULL);
  END IF;

  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id = v_dec.mail_id ORDER BY scanned_at DESC LIMIT 1;

  CASE v_act.category
    WHEN 'reply' THEN
      v_resolved_action := 'send';
      v_resolved_kind   := 'reply';
      v_chosen_idx      := COALESCE((v_eff_payload->>'variant_index')::int, v_mail.selected_variant_index, 0);
    WHEN 'forward' THEN
      v_resolved_action := 'send';
      v_resolved_kind   := 'forward';
      v_final_to        := ARRAY[COALESCE(v_eff_payload->>'to', v_act.target_value)]::text[];
    WHEN 'file' THEN
      v_resolved_action := 'ignore';
      v_resolved_kind   := 'reply';
      v_target_folder   := COALESCE(v_eff_payload->>'target_folder', v_act.target_value, v_mail.target_folder, 'Archive');
    WHEN 'defer' THEN
      v_resolved_action := 'ignore';
      v_resolved_kind   := 'reply';
      v_target_folder   := COALESCE(v_act.target_value, 'Archive');
    WHEN 'delegate' THEN
      UPDATE autodraft_action_decisions
         SET execution_result = jsonb_build_object(
               'ok', false,
               'reason', 'delegate_not_yet_supported',
               'planned', 'Jira-issue via aparte Edge Function (Fase 2d)'
             ),
             executed_at = now()
       WHERE id = p_decision_id;
      RETURN jsonb_build_object(
        'ok', false, 'outcome', 'accept',
        'warning', 'delegate_pending_implementation',
        'action_slug', v_act.slug
      );
    ELSE
      RAISE EXCEPTION 'unknown_category: %', v_act.category;
  END CASE;

  INSERT INTO autodraft_decisions (
    mail_id, action, decision_kind, target_folder, final_to,
    chosen_variant_index, source_draft_subject, source_draft_body,
    decided_at, decided_by, execution_status
  ) VALUES (
    v_dec.mail_id, v_resolved_action, COALESCE(v_resolved_kind, 'reply'),
    v_target_folder, v_final_to, v_chosen_idx,
    v_mail.draft_subject, v_mail.draft_body,
    now(), 'action_card', 'pending'
  )
  RETURNING id INTO v_decision_id_new;

  UPDATE autodraft_action_decisions
     SET execution_result = jsonb_build_object(
           'ok', true,
           'bridged_to', 'autodraft_decisions',
           'autodraft_decision_id', v_decision_id_new::text,
           'resolved_action', v_resolved_action,
           'resolved_kind',   COALESCE(v_resolved_kind, 'reply'),
           'target_folder',   v_target_folder,
           'final_to',        v_final_to
         )
   WHERE id = p_decision_id;

  UPDATE public.agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'auto-draft-execute';

  RETURN jsonb_build_object(
    'ok', true, 'outcome', 'accept',
    'autodraft_decision_id', v_decision_id_new,
    'category', v_act.category,
    'action_slug', v_act.slug,
    'resolved_action', v_resolved_action,
    'target_folder', v_target_folder
  );
END $$;

COMMENT ON FUNCTION public.submit_action_decision(uuid, text, jsonb) IS
  'AutoDraft v2 Fase 2c — bridge van autodraft_action_decisions naar '
  'bestaande autodraft_decisions. Per category: reply.*/forward.* → send. '
  'file.*/defer.* → ignore. delegate.* → warning (Fase 2d). Outcome accept '
  '= bridge + executor-trigger. reject/amend = alleen update.';

GRANT EXECUTE ON FUNCTION public.submit_action_decision(uuid, text, jsonb) TO service_role, authenticated;
