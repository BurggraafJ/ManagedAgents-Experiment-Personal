-- =============================================================================
-- Migratie C — caller-guards op de schrijvende SECURITY DEFINER-RPC's
-- Security review 2026-09-02 · findings F-03, F-04, F-19
-- =============================================================================
-- Waarom:
--   SECURITY DEFINER omzeilt RLS per definitie, dus de policy-laag uit Migratie
--   B doet in deze functies niet mee. Migratie A haalde anon van de EXECUTE-lijst,
--   maar elke ingelogde gebruiker (ook een member) kon deze RPC's nog aanroepen
--   en daarmee de agent-workflow en de HubSpot-configuratie muteren. En
--   set_secret_value(key, plaintext) schreef een meegegeven waarde naar
--   agent_config voor elke key in secrets_inventory — zonder enige caller-check.
--
--   require_dashboard_auth() is hiervoor niet genoeg: die test alleen
--   auth.role() IN ('authenticated','service_role'), dus elke member glipt erdoor.
--
-- Hoe:
--   Eén helper — assert_can_manage_dashboard() — als eerste statement in de body.
--   Die laat drie soorten callers door:
--     1. interne callers (pg_cron, migraties, psql): die komen nooit via
--        PostgREST, dus session_user <> 'authenticator' EN request.method is null.
--        Empirisch geverifieerd op Development 2026-09-02: PostgREST zet
--        session_user='authenticator' + request.method, pg_cron/psql geen van beide.
--     2. server-to-server met de service-role key (Edge Functions, ETL's):
--        auth.role() = 'service_role'.
--     3. de owner in de browser: is_admin_or_higher().
--   Al het andere krijgt 42501.
--
--   Trigger-functies zijn bewust NIET geguard — die vuren binnen transacties van
--   cron en service_role en zouden inserts breken.
--
-- Idempotent: alleen CREATE OR REPLACE en DROP IF EXISTS.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. De helper.
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_dashboard()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $can_manage$
begin
  -- 1. Interne caller: pg_cron, een migratie, psql. PostgREST zet altijd
  --    session_user='authenticator' EN request.method; beide moeten afwezig zijn.
  if session_user is distinct from 'authenticator'
     and current_setting('request.method', true) is null then
    return true;
  end if;

  -- 2. Server-to-server met de service-role key (Edge Functions, ETL's, cron-relay).
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;

  -- 3. De owner in de browser.
  return public.is_admin_or_higher();
end;
$can_manage$;

comment on function public.can_manage_dashboard() is
  'Caller-gate voor schrijvende SECURITY DEFINER-RPC''s (F-03/F-04). Laat door: '
  'interne callers (cron/psql), service_role, en de owner. Zie migratie C.';

create or replace function public.assert_can_manage_dashboard()
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $assert_can_manage$
begin
  if not public.can_manage_dashboard() then
    raise exception 'forbidden: deze actie vereist de owner-rol'
      using errcode = 'insufficient_privilege',
            hint    = 'log in als owner van het dashboard';
  end if;
end;
$assert_can_manage$;

revoke execute on function public.can_manage_dashboard() from public, anon;
revoke execute on function public.assert_can_manage_dashboard() from public, anon;
grant  execute on function public.can_manage_dashboard() to authenticated, service_role;
grant  execute on function public.assert_can_manage_dashboard() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Dode token-RPC's (F-19). Ze verwijzen naar tabel dashboard_tokens, die niet
--    meer bestaat, en hadden nog SECURITY DEFINER + EXECUTE voor anon.
-- -----------------------------------------------------------------------------
drop function if exists public.validate_dashboard_token(uuid);
drop function if exists public.revoke_dashboard_token(uuid);

-- -----------------------------------------------------------------------------
-- 3. De 45 ongeguarde schrijvende RPC's. set_secret_value staat vooraan.
-- -----------------------------------------------------------------------------

-- set_secret_value(p_key_name text, p_plaintext text)
CREATE OR REPLACE FUNCTION public.set_secret_value(p_key_name text, p_plaintext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_storage_location text;
  v_storage_ref text;
  v_agent_name text;
  v_config_key text;
  v_last_4 text;
  v_split_idx int;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_plaintext IS NULL OR length(p_plaintext) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'value_empty');
  END IF;

  SELECT storage_location, storage_ref INTO v_storage_location, v_storage_ref
  FROM secrets_inventory WHERE key_name = p_key_name;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'key_not_found');
  END IF;

  v_last_4 := right(p_plaintext, 4);

  IF v_storage_location = 'agent_config' THEN
    v_split_idx := position('.' in v_storage_ref);
    IF v_split_idx = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_storage_ref_format');
    END IF;
    v_agent_name := substring(v_storage_ref from 1 for v_split_idx - 1);
    v_config_key := substring(v_storage_ref from v_split_idx + 1);

    INSERT INTO agent_config (agent_name, config_key, config_value, is_secret)
    VALUES (v_agent_name, v_config_key, to_jsonb(p_plaintext),
            EXISTS(SELECT 1 FROM agent_config WHERE agent_name=v_agent_name AND config_key=v_config_key AND is_secret=true)
              OR p_key_name NOT IN ('atlassian_email','composio_outlook_connection_id'))
    ON CONFLICT (agent_name, config_key) DO UPDATE
      SET config_value = EXCLUDED.config_value, updated_at = now();

    UPDATE secrets_inventory
    SET status = 'green_dashboard_only',
        last_4 = v_last_4,
        last_status_change_at = now(),
        last_status_change_by = 'dashboard_user'
    WHERE key_name = p_key_name;

    RETURN jsonb_build_object('ok', true, 'last_4', v_last_4, 'storage', 'agent_config');

  ELSIF v_storage_location IN ('edge_function_secret','composio_managed','vault') THEN
    RETURN jsonb_build_object('ok', false,
      'reason', 'unsupported_storage_use_external_dashboard',
      'storage_location', v_storage_location,
      'hint', CASE v_storage_location
        WHEN 'edge_function_secret' THEN 'Set via Supabase dashboard → Project Settings → Edge Functions → Secrets'
        WHEN 'composio_managed' THEN 'Composio dashboard handles OAuth — geen directe edit hier'
        WHEN 'vault' THEN 'Vault edit niet ondersteund vanuit dashboard'
      END);
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_storage_location');
  END IF;
END;
$function$;

-- add_ignore_rule(p_mail_id text, p_pattern_type text, p_pattern_value text, p_reason text, p_reason_kind text)
CREATE OR REPLACE FUNCTION public.add_ignore_rule(p_mail_id text, p_pattern_type text, p_pattern_value text, p_reason text, p_reason_kind text DEFAULT 'unwanted'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_pattern_type NOT IN ('domain','sender','subject_keyword','category') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_pattern_type');
  END IF;
  IF p_reason_kind NOT IN ('unwanted','handled_by_colleague','newsletter','calendar','automated','other') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_reason_kind');
  END IF;
  IF p_pattern_value IS NULL OR length(trim(p_pattern_value)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pattern_value_required');
  END IF;

  INSERT INTO autodraft_ignore_rules (pattern_type, pattern_value, reason, reason_kind, source_mail_id)
  VALUES (p_pattern_type, lower(trim(p_pattern_value)), p_reason, p_reason_kind, p_mail_id)
  ON CONFLICT (pattern_type, pattern_value, reason_kind) DO UPDATE SET
    active = true,
    last_hit_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$function$;

-- apply_legal_ai_thesis_update(p_proposal_id uuid, p_decision text, p_amended jsonb)
CREATE OR REPLACE FUNCTION public.apply_legal_ai_thesis_update(p_proposal_id uuid, p_decision text, p_amended jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal      record;
  v_payload       jsonb;
  v_target        text;
  v_action        text;
  v_thesis_id     bigint;
  v_track         text;
  v_new_thesis_id bigint;
  v_result        jsonb;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_decision NOT IN ('accept','reject','amend') THEN
    RAISE EXCEPTION 'invalid_decision: must be accept|reject|amend';
  END IF;

  SELECT * INTO v_proposal FROM agent_proposals
  WHERE id = p_proposal_id AND agent_name = 'legal-ai-vision-update';
  IF v_proposal IS NULL THEN
    RAISE EXCEPTION 'proposal_not_found';
  END IF;

  -- Merge amend-overrides over de proposal-payload
  v_payload := COALESCE(v_proposal.proposal, '{}'::jsonb);
  IF p_decision = 'amend' AND p_amended IS NOT NULL THEN
    v_payload := v_payload || p_amended;
  END IF;

  v_target := v_payload ->> 'target';
  v_action := v_payload ->> 'action';
  v_track  := v_payload ->> 'track';

  IF p_decision = 'reject' THEN
    UPDATE agent_proposals
    SET status = 'rejected', reviewed_at = now()
    WHERE id = p_proposal_id;
    RETURN jsonb_build_object('decision','reject','proposal_id', p_proposal_id);
  END IF;

  -- accept of amend → mutaties op legal_ai_theses
  IF v_target LIKE 'thesis_%' THEN
    v_thesis_id := substring(v_target from 'thesis_(\d+)$')::bigint;
    IF v_thesis_id IS NULL THEN RAISE EXCEPTION 'invalid_target_format'; END IF;

    IF v_action IN ('strengthen','weaken') THEN
      UPDATE legal_ai_theses
      SET confidence = LEAST(1.0, GREATEST(0.0,
            COALESCE((v_payload ->> 'proposed_confidence')::numeric, confidence))),
          rationale  = COALESCE(v_payload ->> 'reason', rationale),
          amended_at = now(),
          updated_at = now()
      WHERE id = v_thesis_id;

    ELSIF v_action = 'replace_statement' THEN
      UPDATE legal_ai_theses
      SET statement  = COALESCE(v_payload ->> 'proposed_statement', statement),
          rationale  = COALESCE(v_payload ->> 'reason', rationale),
          amended_at = now(),
          updated_at = now()
      WHERE id = v_thesis_id;

    ELSIF v_action = 'retire' THEN
      UPDATE legal_ai_theses
      SET status = 'retired', amended_at = now(), updated_at = now()
      WHERE id = v_thesis_id;
    END IF;

  ELSIF v_target = 'new_thesis' THEN
    INSERT INTO legal_ai_theses
      (track, statement, rationale, confidence, status)
    VALUES (
      v_track,
      COALESCE(v_payload ->> 'proposed_statement', '(geen statement opgegeven)'),
      v_payload ->> 'reason',
      LEAST(1.0, GREATEST(0.0,
        COALESCE((v_payload ->> 'proposed_confidence')::numeric, 0.50))),
      'active'
    ) RETURNING id INTO v_new_thesis_id;
  END IF;

  UPDATE agent_proposals
  SET status        = CASE p_decision WHEN 'accept' THEN 'accepted' ELSE 'amended' END,
      reviewed_at   = now(),
      executed_at   = now(),
      amendment     = CASE p_decision WHEN 'amend' THEN p_amended::text ELSE NULL END,
      execution_result = jsonb_build_object(
        'thesis_id_affected', COALESCE(v_thesis_id, v_new_thesis_id),
        'action_applied', v_action
      )
  WHERE id = p_proposal_id;

  v_result := jsonb_build_object(
    'decision', p_decision,
    'proposal_id', p_proposal_id,
    'thesis_id_affected', COALESCE(v_thesis_id, v_new_thesis_id),
    'action_applied', v_action
  );
  RETURN v_result;
END;
$function$;

-- autodraft_proposals_autofill()
CREATE OR REPLACE FUNCTION public.autodraft_proposals_autofill()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted   int := 0;
  v_superseded int := 0;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- (0) Sluit verweesde open voorstellen af (ONGEWIJZIGD).
  WITH closed AS (
    UPDATE autodraft_action_decisions d
       SET outcome = 'superseded',
           decided_at = now(),
           execution_result = COALESCE(d.execution_result, '{}'::jsonb)
             || jsonb_build_object('reason', 'mail_no_longer_pending', 'closed_by', 'autofill-cron')
     WHERE d.outcome IS NULL
       AND d.was_suggested = true
       AND NOT EXISTS (
             SELECT 1 FROM autodraft_mails m
              WHERE m.mail_id = d.mail_id AND m.status IN ('pending','amended')
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_superseded FROM closed;

  -- (1) Vul ontbrekende voorstellen voor nog-open mails.
  WITH open_mails AS (
    SELECT m.mail_id, m.conversation_id, m.audience, m.suggested_action,
           m.draft_variants, m.target_folder,
           m.draft_subject, m.draft_body,
           CASE
             WHEN m.target_folder ILIKE '%Boekhouding%' OR m.target_folder ILIKE '%Fiscaliteit%' THEN 'forward.finance'
             WHEN m.target_folder ILIKE '%/Personeel%' OR m.target_folder ILIKE '%Afdelingen/Personeel%' THEN 'forward.hr'
             WHEN m.target_folder ILIKE '%/Klanten/%' OR m.target_folder ILIKE 'Inbox/Klanten' OR m.target_folder ILIKE '%Customer Succes%' THEN 'file.client-known'
             WHEN m.target_folder ILIKE '%JIRA%' THEN 'delegate.jira-lemind'
             WHEN m.target_folder ILIKE '%In Afwachting%' OR m.target_folder ILIKE 'Inbox/Todo''s' THEN 'file.in-afwachting'
             ELSE NULL
           END AS folder_action_slug,
           COALESCE(jsonb_array_length(m.draft_variants), 0) AS n_variants,
           rep.action_slug AS router_reply_slug,
           rep.confidence  AS router_reply_conf,
           rep.tier        AS router_reply_tier
    FROM   autodraft_mails m
    LEFT JOIN LATERAL (
      SELECT rr.action_slug, rr.confidence, rr.tier
        FROM resolve_action_from_metadata(m.mail_id, 6) rr
        JOIN public.autodraft_actions a2 ON a2.slug = rr.action_slug AND a2.enabled = true
       WHERE rr.action_slug LIKE 'reply.%'
       ORDER BY rr.rank
       LIMIT 1
    ) rep ON true
    WHERE  m.status NOT IN ('stale','sent','ignored','failed')
      AND  NOT EXISTS (
             SELECT 1 FROM autodraft_action_decisions d
              WHERE d.mail_id = m.mail_id AND d.was_suggested = true
           )
  ),
  expanded AS (
    -- RANK 1 — for_you: router reply-pick (op doel) met embedded draft; not_for_you: file.archive
    SELECT o.mail_id, o.conversation_id, 1 AS rank,
           CASE WHEN o.audience = 'not_for_you' THEN 'file.archive'
                ELSE COALESCE(o.router_reply_slug, 'reply.neutraal') END AS slug,
           CASE WHEN o.audience = 'not_for_you'
                  THEN jsonb_build_object('target_folder', COALESCE(o.target_folder, 'Archive'), 'source', 'autofill')
                ELSE public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 0) END AS payload,
           CASE WHEN o.audience = 'for_you' AND o.router_reply_slug IS NOT NULL THEN 'metadata_router'
                ELSE 'deterministic' END AS source,
           CASE WHEN o.audience = 'for_you' THEN COALESCE(o.router_reply_tier, 'reasoned') ELSE 'reasoned' END AS tier,
           CASE WHEN o.audience = 'for_you' THEN COALESCE(o.router_reply_conf, 0.5) ELSE 0.5 END AS conf,
           CASE WHEN o.audience = 'for_you' AND o.router_reply_slug IS NOT NULL
                  THEN 'Autofill cron — router reply-pick (' || o.router_reply_slug || ') uit mail-verrijking. Geen Sonnet-call.'
                ELSE 'Autofill cron — deterministisch op basis van autodraft_mails. Geen Sonnet-call.' END AS reasoning
      FROM open_mails o
    UNION ALL
    -- RANK 2 — deterministisch alternatief (folder-heuristiek = skill's target_folder, sterker signaal dan metadata-only)
    SELECT o.mail_id, o.conversation_id, 2 AS rank,
           CASE
             WHEN o.audience = 'not_for_you'                      THEN 'defer.decline'
             WHEN o.folder_action_slug IS NOT NULL                THEN o.folder_action_slug
             WHEN o.n_variants > 1                                THEN 'reply.uitgebreid'
             ELSE 'file.in-afwachting'
           END AS slug,
           CASE
             WHEN o.audience = 'not_for_you'                      THEN jsonb_build_object('reason', 'audience=not_for_you', 'source', 'autofill')
             WHEN o.folder_action_slug LIKE 'forward.%'           THEN jsonb_build_object('to', CASE o.folder_action_slug WHEN 'forward.finance' THEN 'finance@legal-mind.nl' WHEN 'forward.hr' THEN 'personeel@legal-mind.nl' ELSE '' END, 'source', 'autofill')
             WHEN o.folder_action_slug = 'delegate.jira-lemind'   THEN jsonb_build_object('system', 'jira', 'target', 'LEMIND', 'source', 'autofill')
             WHEN o.folder_action_slug IS NOT NULL                THEN jsonb_build_object('target_folder', o.target_folder, 'source', 'autofill')
             WHEN o.n_variants > 1                                THEN public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 1)
             ELSE                                                      jsonb_build_object('target_folder', 'Inbox/Todo''s', 'source', 'autofill')
           END AS payload,
           'deterministic' AS source, 'reasoned' AS tier, 0.5 AS conf,
           'Autofill cron — deterministisch alternatief. Geen Sonnet-call.' AS reasoning
      FROM open_mails o
    UNION ALL
    -- RANK 3 — deterministisch (ONGEWIJZIGD)
    SELECT o.mail_id, o.conversation_id, 3 AS rank,
           CASE WHEN o.audience = 'not_for_you' THEN 'reply.kort' ELSE 'defer.decline' END AS slug,
           CASE WHEN o.audience = 'not_for_you' THEN public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 0)
                ELSE jsonb_build_object('reason', 'als geen actie nodig', 'source', 'autofill') END AS payload,
           'deterministic' AS source, 'reasoned' AS tier, 0.5 AS conf,
           'Autofill cron — deterministisch alternatief. Geen Sonnet-call.' AS reasoning
      FROM open_mails o
  )
  INSERT INTO autodraft_action_decisions (
    mail_id, conversation_id, action_slug, payload,
    was_suggested, suggested_rank, classifier_confidence, classifier_reasoning,
    outcome, decided_at, executed_at, created_at,
    classifier_source, tier
  )
  SELECT e.mail_id, e.conversation_id, e.slug,
         e.payload || jsonb_build_object('backfill_version', 'autofill-cron'),
         true, e.rank, e.conf, e.reasoning,
         NULL, NULL, NULL, now(),
         e.source, e.tier
  FROM   expanded e
  JOIN   public.autodraft_actions a ON a.slug = e.slug AND a.enabled = true;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'rows_inserted', v_inserted, 'orphans_superseded', v_superseded,
                            'ran_at', now(), 'version', 'router-reply-pick-2026-06-03');
END $function$;

-- autodraft_rescan_postvak()
CREATE OR REPLACE FUNCTION public.autodraft_rescan_postvak()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_superseded int := 0;
  v_wiped      int := 0;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- 1. Huidige open voorstellen op pending/amended mails → 'superseded' (recorded).
  WITH s AS (
    UPDATE autodraft_action_decisions d
       SET outcome = 'superseded',
           decided_at = now(),
           execution_result = COALESCE(d.execution_result, '{}'::jsonb)
             || jsonb_build_object('reason', 'rescan_requested', 'closed_by', 'rescan-postvak')
     WHERE d.outcome IS NULL
       AND d.was_suggested = true
       AND EXISTS (
             SELECT 1 FROM autodraft_mails m
              WHERE m.mail_id = d.mail_id AND m.status IN ('pending','amended')
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_superseded FROM s;

  -- 2. Wis de pending/amended draft-rijen zodat de skill ze opnieuw oppakt
  --    (intake sluit alleen niet-stale autodraft_mails uit → verwijderd = vers).
  --    Guarded tegen de 2 FK's (execute-queue + rag-baselines).
  WITH w AS (
    DELETE FROM autodraft_mails m
     WHERE m.status IN ('pending','amended')
       AND NOT EXISTS (SELECT 1 FROM autodraft_decisions ad WHERE ad.mail_id = m.mail_id)
       AND NOT EXISTS (SELECT 1 FROM rag_quality_baselines rb WHERE rb.autodraft_mail_id = m.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_wiped FROM w;

  -- 3. Nudge auto-draft (scan draait nooit een send — alleen draften).
  UPDATE public.agent_schedules SET manual_run_requested_at = now() WHERE agent_name = 'auto-draft';

  RETURN jsonb_build_object('ok', true, 'proposals_superseded', v_superseded, 'drafts_wiped', v_wiped, 'nudged', true);
END $function$;

-- check_enrichment_budget(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.check_enrichment_budget(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_budget public.mail_enrichment_budget%ROWTYPE;
  v_spent_today numeric;
  v_spent_week numeric;
  v_spent_month numeric;
  v_status text;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO v_budget FROM public.mail_enrichment_budget WHERE user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.mail_enrichment_budget (user_id) VALUES (p_user_id)
      ON CONFLICT (user_id) DO NOTHING;
    SELECT * INTO v_budget FROM public.mail_enrichment_budget WHERE user_id = p_user_id;
  END IF;

  SELECT COALESCE(SUM(enrichment_cost_usd), 0) INTO v_spent_today
    FROM public.mail_enrichment
    WHERE user_id = p_user_id AND enriched_at >= date_trunc('day', now() AT TIME ZONE 'UTC');

  SELECT COALESCE(SUM(enrichment_cost_usd), 0) INTO v_spent_week
    FROM public.mail_enrichment
    WHERE user_id = p_user_id AND enriched_at >= date_trunc('week', now() AT TIME ZONE 'UTC');

  SELECT COALESCE(SUM(enrichment_cost_usd), 0) INTO v_spent_month
    FROM public.mail_enrichment
    WHERE user_id = p_user_id AND enriched_at >= date_trunc('month', now() AT TIME ZONE 'UTC');

  v_status := CASE
    WHEN v_budget.paused THEN 'paused'
    WHEN v_spent_month >= v_budget.monthly_hard_cap_usd THEN 'hard_block'
    WHEN v_spent_today >= v_budget.daily_cap_usd THEN 'daily_block'
    WHEN v_spent_week >= v_budget.weekly_cap_usd THEN 'weekly_block'
    WHEN v_spent_month >= v_budget.monthly_soft_cap_usd * v_budget.alert_at_pct THEN 'soft_warn'
    ELSE 'ok'
  END;

  RETURN jsonb_build_object(
    'status', v_status,
    'spent_today_usd', v_spent_today,
    'spent_week_usd',  v_spent_week,
    'spent_month_usd', v_spent_month,
    'daily_cap_usd',   v_budget.daily_cap_usd,
    'weekly_cap_usd',  v_budget.weekly_cap_usd,
    'monthly_soft_cap_usd', v_budget.monthly_soft_cap_usd,
    'monthly_hard_cap_usd', v_budget.monthly_hard_cap_usd,
    'paused', v_budget.paused,
    'paused_reason', v_budget.paused_reason
  );
END $function$;

-- cleanup_agent_runs(p_max_rows integer)
CREATE OR REPLACE FUNCTION public.cleanup_agent_runs(p_max_rows integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted int;
  v_clamp   int := GREATEST(1, LEAST(p_max_rows, 50000));
BEGIN
  perform public.assert_can_manage_dashboard();
  WITH to_delete AS (
    SELECT r.id
      FROM public.agent_runs r
      JOIN public.agent_schedules s ON s.agent_name = r.agent_name
     WHERE r.started_at < now() - CASE
         WHEN s.tier = 'source' THEN interval '30 days'
         WHEN s.tier = 'infra'  THEN interval '90 days'
         ELSE interval '365 days'
       END
     ORDER BY r.started_at ASC
     LIMIT v_clamp
  )
  DELETE FROM public.agent_runs WHERE id IN (SELECT id FROM to_delete);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'deleted',     v_deleted,
    'cap',         v_clamp,
    'requested',   p_max_rows,
    'at',          now()
  );
END
$function$;

-- clone_as_proposal(source_id uuid)
CREATE OR REPLACE FUNCTION public.clone_as_proposal(source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE src record; new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO src FROM agent_proposals WHERE id = source_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO agent_proposals (agent_name, category, subject, summary, proposal,
                               default_action, context, confidence,
                               has_fireflies_context, needs_info, status)
  VALUES (src.agent_name, src.category, src.subject,
          'Opnieuw voorgesteld: ' || src.summary,
          src.proposal, src.default_action,
          COALESCE(src.context, '{}'::jsonb) || jsonb_build_object('cloned_from', src.id),
          src.confidence, src.has_fireflies_context, true, 'pending')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$function$;

-- create_manual_proposal(subject text, category text, description text, target_agent text)
CREATE OR REPLACE FUNCTION public.create_manual_proposal(subject text, category text DEFAULT 'overig'::text, description text DEFAULT NULL::text, target_agent text DEFAULT 'hubspot-daily-sync'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF subject IS NULL OR length(trim(subject)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_subject');
  END IF;
  IF category NOT IN ('klant','partner','recruitment','overig') THEN
    category := 'overig';
  END IF;

  INSERT INTO agent_proposals (agent_name, category, subject, summary, proposal,
                               default_action, context, confidence,
                               has_fireflies_context, needs_info, status, amendment)
  VALUES (target_agent, category, trim(subject),
          COALESCE('Handmatig toegevoegd: ' || trim(subject),
                   'Handmatig toegevoegd voorstel'),
          jsonb_build_object('actions', jsonb_build_array(), 'target', jsonb_build_object('type','manual')),
          'Wacht op Jelle-input hoe aan te pakken',
          jsonb_build_object('source', 'manual_entry', 'created_by', 'jelle'),
          NULL, false, true, 'pending',
          description)
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$function$;

-- delete_terminology(p_id uuid)
CREATE OR REPLACE FUNCTION public.delete_terminology(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  perform public.assert_can_manage_dashboard();
  DELETE FROM public.terminology_corrections WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- detect_mail_completion(p_lookback_days integer, p_min_similarity real, p_apply boolean)
CREATE OR REPLACE FUNCTION public.detect_mail_completion(p_lookback_days integer DEFAULT 14, p_min_similarity real DEFAULT 0.5, p_apply boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_candidates int := 0;
  v_applied int := 0;
  v_examples jsonb;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- Vind voor elke open taak (eventueel) een outgoing mail die de taak voltooit:
  --   - is_from_me=true, gestuurd ná task.created_at, binnen lookback
  --   - match op contact_email OF fuzzy match op subject vs task title
  --   - beste (hoogste similarity) per taak wint
  CREATE TEMP TABLE _tmp_mail_completion ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id)
           t.id        AS task_id,
           t.title     AS task_title,
           m.id        AS mail_id,
           m.subject   AS mail_subject,
           m.received_at,
           m.to_recipients,
           greatest(
             similarity(coalesce(t.title, ''), coalesce(m.subject, '')),
             0.0::real
           ) AS sim_score
      FROM public.tasks t
      JOIN public.mail_messages m
        ON m.is_from_me = true
       AND m.received_at > t.created_at
       AND m.received_at > now() - (p_lookback_days || ' days')::interval
       AND (
         (t.contact_email IS NOT NULL
           AND m.to_recipients::text ILIKE '%' || t.contact_email || '%')
         OR similarity(coalesce(t.title, ''), coalesce(m.subject, '')) >= p_min_similarity
       )
     WHERE t.status = 'open'
       AND coalesce(t.completion_candidate, false) = false
       AND t.created_at > now() - (p_lookback_days || ' days')::interval
     ORDER BY t.id, sim_score DESC NULLS LAST, m.received_at DESC;

  SELECT count(*) INTO v_candidates FROM _tmp_mail_completion;

  IF p_apply AND v_candidates > 0 THEN
    UPDATE public.tasks t
       SET completion_candidate  = true,
           completion_evidence   = 'Mail "' || left(coalesce(c.mail_subject, ''), 80)
                                   || '" verzonden op '
                                   || to_char(c.received_at, 'DD mon HH24:MI'),
           completion_detected_at = now(),
           completion_source      = 'mail'
      FROM _tmp_mail_completion c
     WHERE t.id = c.task_id;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  END IF;

  -- Sample voor diagnostiek
  SELECT jsonb_agg(jsonb_build_object(
    'task_id',     task_id,
    'task_title',  left(task_title, 60),
    'mail_subject', left(mail_subject, 60),
    'sim_score',   round(sim_score::numeric, 3)
  )) INTO v_examples
  FROM (SELECT * FROM _tmp_mail_completion LIMIT 5) s;

  RETURN jsonb_build_object(
    'candidates',     v_candidates,
    'applied',        v_applied,
    'lookback_days',  p_lookback_days,
    'min_similarity', p_min_similarity,
    'examples',       coalesce(v_examples, '[]'::jsonb)
  );
END;
$function$;

-- dismiss_awaiting(p_conversation_id text, p_reason text)
CREATE OR REPLACE FUNCTION public.dismiss_awaiting(p_conversation_id text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'conversation_id_required');
  END IF;
  INSERT INTO awaiting_dismissed (conversation_id, reason)
  VALUES (p_conversation_id, p_reason)
  ON CONFLICT (conversation_id) DO UPDATE SET
    dismissed_at = now(),
    reason = COALESCE(EXCLUDED.reason, awaiting_dismissed.reason);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- enrich_contact_categories()
CREATE OR REPLACE FUNCTION public.enrich_contact_categories()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_overrides_applied  int := 0;
  v_subdomain_renamed  int := 0;
  v_retag_via_regex    int := 0;
  v_subdomain_rebased  int := 0;
  v_leverancier_set    int := 0;
  v_intern_corrected   int := 0;
BEGIN
  perform public.assert_can_manage_dashboard();

  -- =====================================================
  -- STAP A: Pas firm_type_overrides toe (handmatige lookup)
  -- =====================================================
  UPDATE public.firms f
  SET firm_type = o.firm_type,
      properties = COALESCE(f.properties, '{}'::jsonb) || jsonb_build_object('override_reden', o.reden),
      updated_at = now()
  FROM public.firm_type_overrides o
  WHERE f.domein = o.domein
    AND (f.firm_type != o.firm_type OR f.firm_type IS NULL);
  GET DIAGNOSTICS v_overrides_applied = ROW_COUNT;

  -- =====================================================
  -- STAP B: Subdomain auto-firms mergen naar base-domein
  -- Per-firm loop met conflict-handling:
  --   - Als base-firm bestaat: move contacten naar base, delete sub-firm
  --   - Als base-firm niet bestaat: rename sub-firm naar base-domein
  -- =====================================================
  DECLARE
    v_sub_id      uuid;
    v_sub_dom     text;
    v_base_dom    text;
    v_base_id     uuid;
    v_base_naam   text;
  BEGIN
    FOR v_sub_id, v_sub_dom IN
      SELECT id, domein FROM public.firms
      WHERE properties->>'auto_created' = 'true'
        AND public.strip_mail_subdomain(domein) IS NOT NULL
        AND public.strip_mail_subdomain(domein) != domein
    LOOP
      v_base_dom := public.strip_mail_subdomain(v_sub_dom);
      v_base_naam := INITCAP(REGEXP_REPLACE(SPLIT_PART(v_base_dom, '.', 1), '[-_]', ' ', 'g'));

      -- Bestaat base-firm al?
      SELECT id INTO v_base_id FROM public.firms WHERE domein = v_base_dom AND id != v_sub_id LIMIT 1;

      IF v_base_id IS NOT NULL THEN
        -- Merge: verhuis contactpersonen naar base-firm, delete sub-firm
        UPDATE public.contactpersonen SET firm_id = v_base_id, firm_naam = (SELECT naam FROM public.firms WHERE id = v_base_id), updated_at = now() WHERE firm_id = v_sub_id;
        DELETE FROM public.firms WHERE id = v_sub_id;
      ELSE
        -- Geen conflict: hernoem sub-firm naar base-domein
        UPDATE public.firms SET domein = v_base_dom, naam = v_base_naam, updated_at = now() WHERE id = v_sub_id;
      END IF;
      v_subdomain_rebased := v_subdomain_rebased + 1;
      v_base_id := NULL;
    END LOOP;
  END;

  -- Update email_domein van bijbehorende contactpersonen - maar laat email/email_domein staan
  -- (firm_naam wel updaten zodat dashboard juiste naam toont)
  UPDATE public.contactpersonen cp
  SET firm_naam = f.naam,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.firm_naam != f.naam;
  GET DIAGNOSTICS v_subdomain_renamed = ROW_COUNT;

  -- =====================================================
  -- STAP C: Her-tag alle firms met verbeterde regex
  -- =====================================================
  UPDATE public.firms f
  SET firm_type = public.detect_firm_type(
        f.naam,
        f.domein,
        (SELECT industry FROM public.hubspot_companies hc WHERE hc.company_id = f.hubspot_company_id LIMIT 1)
      ),
      updated_at = now()
  WHERE NOT f.is_deleted
    -- Skip firms die override hebben (die zijn handmatig gezet)
    AND f.domein NOT IN (SELECT domein FROM public.firm_type_overrides)
    AND f.firm_type != public.detect_firm_type(
        f.naam,
        f.domein,
        (SELECT industry FROM public.hubspot_companies hc WHERE hc.company_id = f.hubspot_company_id LIMIT 1)
      );
  GET DIAGNOSTICS v_retag_via_regex = ROW_COUNT;

  -- =====================================================
  -- STAP D: Sync firm_naam in contactpersonen na tagger-changes
  -- (firm_type-update kan firm_naam niet hebben veranderd, maar zekerheid)
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET firm_naam = f.naam,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.firm_naam IS DISTINCT FROM f.naam;

  -- =====================================================
  -- STAP E: contact_type='leverancier' voor tech-firm contacten
  -- (alleen waar contact_type='overig' - klant/prospect-status uit HubSpot blijft)
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET contact_type = 'leverancier',
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.contact_type = 'overig'
    AND f.firm_type = 'tech'
    AND NOT cp.is_deleted;
  GET DIAGNOSTICS v_leverancier_set = ROW_COUNT;

  -- =====================================================
  -- STAP F: contact_type='intern' voor internal-firm contacten
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET contact_type = 'intern',
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.contact_type IN ('overig', 'leverancier')
    AND f.firm_type = 'internal'
    AND NOT cp.is_deleted;
  GET DIAGNOSTICS v_intern_corrected = ROW_COUNT;

  -- =====================================================
  -- STAP G: contact_type voor publieke sector
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET contact_type = CASE f.firm_type
        WHEN 'rechtbank'      THEN 'rechtbank'
        WHEN 'overheid'       THEN 'overheid'
        WHEN 'advocatenorde'  THEN 'advocatenorde'
        ELSE cp.contact_type
      END,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.contact_type IN ('overig', 'leverancier')
    AND f.firm_type IN ('rechtbank','overheid','advocatenorde')
    AND NOT cp.is_deleted;

  RETURN jsonb_build_object(
    'status',              'ok',
    'overrides_applied',   v_overrides_applied,
    'subdomain_rebased',   v_subdomain_rebased,
    'subdomain_renamed',   v_subdomain_renamed,
    'retag_via_regex',     v_retag_via_regex,
    'leverancier_set',     v_leverancier_set,
    'intern_corrected',    v_intern_corrected,
    'firm_type_distribution', (SELECT jsonb_object_agg(firm_type, n) FROM (SELECT firm_type, COUNT(*) AS n FROM public.firms WHERE NOT is_deleted GROUP BY firm_type) t),
    'contact_type_distribution', (SELECT jsonb_object_agg(contact_type, n) FROM (SELECT contact_type, COUNT(*) AS n FROM public.contactpersonen WHERE NOT is_deleted GROUP BY contact_type) t),
    'unlinked',            (SELECT COUNT(*) FROM public.contactpersonen WHERE firm_id IS NULL AND NOT is_deleted),
    'firms_overig',        (SELECT COUNT(*) FROM public.firms WHERE firm_type = 'overig' AND NOT is_deleted)
  );
END;
$function$;

-- finalize_jellemind_proposals(p_candidates jsonb, p_cap integer, p_min_signals integer, p_min_confidence numeric, p_dedup_similarity_threshold numeric)
CREATE OR REPLACE FUNCTION public.finalize_jellemind_proposals(p_candidates jsonb DEFAULT '[]'::jsonb, p_cap integer DEFAULT 5, p_min_signals integer DEFAULT 3, p_min_confidence numeric DEFAULT 0.5, p_dedup_similarity_threshold numeric DEFAULT 0.55)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_safe_cap integer := greatest(0, least(p_cap, 50));
  v_safe_min_signals integer := greatest(2, least(p_min_signals, 100));
  v_safe_min_conf numeric := greatest(0.0, least(p_min_confidence, 1.0));
  v_inserted_count int := 0;
  v_skipped_dup int := 0;
  v_skipped_low_conf int := 0;
  v_skipped_few_signals int := 0;
  v_skipped_contradicting int := 0;
  v_reemit_count int := 0;
  v_by_scope jsonb := '{"jelle":0,"skill":0,"legalmind":0}'::jsonb;
  v_proposal_ids uuid[] := ARRAY[]::uuid[];
  v_rec record;
  v_cand jsonb;
  v_n_signals int;
  v_signal_ids uuid[];
  v_agent_names text[];
  v_rule_class text;
  v_lesson_text text;
  v_proposed_question text;
  v_evidence_summary text;
  v_skill_scope text;
  v_skill_type text;
  v_mind_scope text;
  v_lesson_type text;
  v_applies_to text[];
  v_confidence numeric;
  v_existing_match_id uuid;
  v_new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- =========================================================================
  -- STEP 1 -- RE-EMIT AMENDED PROPOSALS
  -- For each amended proposal, the skill should pass it back via candidates
  -- with a fresh lesson_text. Here we just mark old ones as 'merged' once
  -- a new proposal references its signal_ids fully.
  -- =========================================================================

  -- Note: re-emit logic is simple — skill writes a new pending proposal with
  -- the amended text, then this RPC marks the original 'amended' rows whose
  -- signal_ids fully overlap with the new one as 'merged'. We do that AFTER
  -- inserts below.

  -- =========================================================================
  -- STEP 2 -- PROCESS NEW CANDIDATES
  -- Sort by (n_signals DESC, last_at DESC) and apply cap.
  -- =========================================================================

  FOR v_rec IN
    SELECT
      c.cand,
      coalesce((c.cand->>'n_signals')::int, 0) AS n_signals,
      c.cand->>'rule_class' AS rule_class,
      coalesce(c.cand->>'last_at', '1970-01-01')::timestamptz AS last_at,
      coalesce((c.cand->>'_skill_confidence_override')::numeric,
               least(1.0, coalesce((c.cand->>'n_signals')::int, 0)::numeric / 5.0)) AS confidence
    FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS c(cand, ord)
    ORDER BY n_signals DESC, last_at DESC
  LOOP
    v_cand := v_rec.cand;
    v_n_signals := v_rec.n_signals;
    v_rule_class := v_rec.rule_class;
    v_confidence := v_rec.confidence;

    -- Cap check (after sorting, new inserts won't exceed cap)
    EXIT WHEN v_inserted_count >= v_safe_cap;

    -- Min signals check
    IF v_n_signals < v_safe_min_signals THEN
      v_skipped_few_signals := v_skipped_few_signals + 1;
      CONTINUE;
    END IF;

    -- Min confidence check
    IF v_confidence < v_safe_min_conf THEN
      v_skipped_low_conf := v_skipped_low_conf + 1;
      CONTINUE;
    END IF;

    -- Required fields from skill
    v_lesson_text := nullif(trim(v_cand->>'lesson_text'), '');
    IF v_lesson_text IS NULL THEN
      -- Skill must provide lesson_text; skip if missing
      v_skipped_low_conf := v_skipped_low_conf + 1;
      CONTINUE;
    END IF;

    v_proposed_question := nullif(trim(v_cand->>'proposed_question'), '');
    v_evidence_summary := nullif(trim(v_cand->>'evidence_summary'), '');

    -- Parse signal_ids and agent_names from candidate
    SELECT array_agg(x::uuid) INTO v_signal_ids
      FROM jsonb_array_elements_text(coalesce(v_cand->'signal_ids', '[]'::jsonb)) AS x
     WHERE x IS NOT NULL;

    SELECT array_agg(x) INTO v_agent_names
      FROM jsonb_array_elements_text(coalesce(v_cand->'agent_names', '[]'::jsonb)) AS x
     WHERE x IS NOT NULL;

    IF v_signal_ids IS NULL OR array_length(v_signal_ids, 1) IS NULL THEN
      v_skipped_few_signals := v_skipped_few_signals + 1;
      CONTINUE;
    END IF;

    -- Optional skill overrides
    v_skill_scope := nullif(v_cand->>'mind_scope', '');
    v_skill_type := nullif(v_cand->>'lesson_type', '');

    -- Determine lesson_type from rule_class (skill can override)
    v_lesson_type := coalesce(
      v_skill_type,
      CASE v_rule_class
        WHEN 'pronoun_je_vs_u' THEN 'tone'
        WHEN 'formal_to_casual' THEN 'tone'
        WHEN 'casual_to_formal' THEN 'tone'
        WHEN 'length_shorter' THEN 'format'
        WHEN 'length_longer' THEN 'format'
        WHEN 'deadline_added' THEN 'format'
        WHEN 'terminology_swap' THEN 'terminology'
        ELSE 'preference'
      END
    );

    -- Validate lesson_type
    IF v_lesson_type NOT IN ('tone','terminology','format','preference','workflow') THEN
      v_lesson_type := 'preference';
    END IF;

    -- Determine mind_scope: skill override wins, else heuristic on lesson_text
    v_mind_scope := coalesce(v_skill_scope,
      CASE
        WHEN v_lesson_text ~* '\m(agent|skill|moet eerst|workflow|self.?research|zelf taak|hubspot.?check|kvk.?check|advocatenorde|self-research|skill moet)\M' THEN 'skill'
        WHEN v_lesson_text ~* '\m(legal mind|onze klant|trial duurt|sales pipeline|kantoor|stage|lead|demo|won|lost|trial|proposal)\M' THEN 'legalmind'
        ELSE 'jelle'
      END
    );

    IF v_mind_scope NOT IN ('jelle','skill','legalmind') THEN
      v_mind_scope := 'jelle';
    END IF;

    -- applies_to: distinct agent_names from signals; '*' if multi-agent
    IF v_agent_names IS NULL OR array_length(v_agent_names, 1) IS NULL THEN
      v_applies_to := ARRAY['*'];
    ELSIF array_length(v_agent_names, 1) >= 2 THEN
      v_applies_to := ARRAY['*'];
    ELSE
      v_applies_to := v_agent_names;
    END IF;

    -- Dedup against existing active lessons via trigram similarity
    SELECT id INTO v_existing_match_id
      FROM jellemind_lessons
     WHERE active = true
       AND mind_scope = v_mind_scope
       AND similarity(lesson_text, v_lesson_text) >= p_dedup_similarity_threshold
     ORDER BY similarity(lesson_text, v_lesson_text) DESC
     LIMIT 1;

    IF v_existing_match_id IS NOT NULL THEN
      v_skipped_dup := v_skipped_dup + 1;
      CONTINUE;
    END IF;

    -- Dedup against pending proposals (avoid double-proposing)
    SELECT id INTO v_existing_match_id
      FROM jellemind_lesson_proposals
     WHERE status = 'pending'
       AND mind_scope = v_mind_scope
       AND similarity(lesson_text, v_lesson_text) >= p_dedup_similarity_threshold
     ORDER BY similarity(lesson_text, v_lesson_text) DESC
     LIMIT 1;

    IF v_existing_match_id IS NOT NULL THEN
      v_skipped_dup := v_skipped_dup + 1;
      CONTINUE;
    END IF;

    -- Insert proposal
    INSERT INTO jellemind_lesson_proposals (
      lesson_text, lesson_type, applies_to, evidence_summary,
      signal_ids, proposed_question, confidence, status,
      created_at, created_by, mind_scope
    )
    VALUES (
      v_lesson_text, v_lesson_type, v_applies_to, v_evidence_summary,
      v_signal_ids, v_proposed_question, v_confidence, 'pending',
      now(), 'jellemind-rpc', v_mind_scope
    )
    RETURNING id INTO v_new_id;

    v_proposal_ids := array_append(v_proposal_ids, v_new_id);
    v_inserted_count := v_inserted_count + 1;

    -- Update by_scope counter
    v_by_scope := jsonb_set(
      v_by_scope,
      ARRAY[v_mind_scope],
      to_jsonb(coalesce((v_by_scope->>v_mind_scope)::int, 0) + 1)
    );

    -- Mark these signals as processed
    UPDATE jellemind_signals
       SET processed = true, processed_at = now()
     WHERE id = ANY(v_signal_ids)
       AND processed = false;
  END LOOP;

  -- =========================================================================
  -- STEP 3 -- MERGE AMENDED ORIGINALS THAT HAVE NEW REPLACEMENTS
  -- If skill passed candidates with `_replaces_proposal_id`, mark originals merged.
  -- =========================================================================

  WITH replaced AS (
    SELECT (c.cand->>'_replaces_proposal_id')::uuid AS old_id
      FROM jsonb_array_elements(p_candidates) AS c(cand)
     WHERE c.cand ? '_replaces_proposal_id'
       AND nullif(c.cand->>'_replaces_proposal_id','') IS NOT NULL
  ),
  upd AS (
    UPDATE jellemind_lesson_proposals p
       SET status = 'merged', reviewed_at = now(), reviewed_by = 'jellemind-rpc'
      FROM replaced r
     WHERE p.id = r.old_id
       AND p.status = 'amended'
    RETURNING 1
  )
  SELECT count(*) INTO v_reemit_count FROM upd;

  RETURN jsonb_build_object(
    'inserted', v_inserted_count,
    'skipped_dup', v_skipped_dup,
    'skipped_low_conf', v_skipped_low_conf,
    'skipped_few_signals', v_skipped_few_signals,
    'skipped_contradicting', v_skipped_contradicting,
    'merged_amended', v_reemit_count,
    'by_scope', v_by_scope,
    'cap_reached', v_inserted_count >= v_safe_cap,
    'proposal_ids', to_jsonb(v_proposal_ids)
  );
END;
$function$;

-- force_propose(record_id uuid)
CREATE OR REPLACE FUNCTION public.force_propose(record_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record; new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO rec FROM daily_admin_filtered_records WHERE id = record_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF rec.forced_proposal_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_forced', 'proposal_id', rec.forced_proposal_id);
  END IF;

  INSERT INTO agent_proposals (agent_name, category, subject, summary, proposal, default_action,
                               context, confidence, has_fireflies_context, needs_info, status)
  VALUES (rec.agent_name, 'overig',
          COALESCE(rec.company_guess, rec.sender_domain, rec.subject, 'onbekend'),
          COALESCE('Geforceerd uit gefilterd: ' || rec.subject, 'Geforceerd voorstel uit gefilterde records'),
          jsonb_build_object('actions', jsonb_build_array(), 'target', jsonb_build_object('type','unknown')),
          'Jelle heeft dit item geforceerd uit gefilterde records — kies aanpak',
          COALESCE(rec.context, '{}'::jsonb) || jsonb_build_object('forced_from_filtered', rec.id, 'source', rec.source, 'sender', rec.sender),
          rec.confidence, false, true, 'pending')
  RETURNING id INTO new_id;

  UPDATE daily_admin_filtered_records
  SET forced_at = now(), forced_proposal_id = new_id
  WHERE id = record_id;

  RETURN jsonb_build_object('ok', true, 'proposal_id', new_id);
END;
$function$;

-- harvest_and_cluster_jellemind(p_window_hours integer, p_max_signals_first_run integer)
CREATE OR REPLACE FUNCTION public.harvest_and_cluster_jellemind(p_window_hours integer DEFAULT 24, p_max_signals_first_run integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window_start timestamptz := now() - (p_window_hours || ' hours')::interval;
  v_inserted_autodraft int := 0;
  v_inserted_proposal int := 0;
  v_inserted_feedback int := 0;
  v_inserted_task int := 0;
  v_inserted_note int := 0;
  v_total_unprocessed int;
  v_candidates jsonb;
  v_n_unique_classes int := 0;
  v_n_clusters_min3 int := 0;
  v_result jsonb;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- =========================================================================
  -- PASS 1 -- HARVEST
  -- =========================================================================

  -- 1a. Mail-amendments from autodraft_decisions
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'autodraft_amended',
      'auto-draft',
      'autodraft_decisions',
      d.id::text,
      d.source_draft_body,
      d.final_body,
      left(coalesce(
        nullif(d.amend_instructions, ''),
        case
          when length(d.final_body) < 0.7 * length(d.source_draft_body) then 'Jelle verkortte de tekst.'
          when length(d.final_body) > 1.4 * length(d.source_draft_body) then 'Jelle breidde de tekst uit.'
          else 'Jelle paste mail-tekst aan.'
        end
      ), 120),
      d.decided_at
    FROM autodraft_decisions d
    WHERE d.action = 'amend'
      AND d.decided_at >= v_window_start
      AND d.source_draft_body IS NOT NULL
      AND d.final_body IS NOT NULL
      AND d.source_draft_body <> d.final_body
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_autodraft FROM ins;

  -- 1b. Proposal-amendments from agent_proposals
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'proposal_amended',
      coalesce(p.agent_name, 'unknown'),
      'agent_proposals',
      p.id::text,
      coalesce(p.summary, '') || E'\n' || coalesce(p.proposal::text, ''),
      p.amendment,
      left('Jelle paste voorstel aan ('|| coalesce(p.agent_name,'agent') ||').', 120),
      p.reviewed_at
    FROM agent_proposals p
    WHERE p.status = 'amended'
      AND p.reviewed_at >= v_window_start
      AND p.amendment IS NOT NULL
      AND length(p.amendment) > 0
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_proposal FROM ins;

  -- 1c. Direct feedback from agent_feedback
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'direct_feedback',
      coalesce(f.source, 'unknown'),
      'agent_feedback',
      f.id::text,
      NULL,
      f.feedback_text,
      left(f.feedback_text, 120),
      f.created_at
    FROM agent_feedback f
    WHERE f.status = 'unprocessed'
      AND f.created_at >= v_window_start
      AND f.feedback_text IS NOT NULL
      AND length(f.feedback_text) > 0
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_feedback FROM ins;

  -- Mark harvested feedback as processed
  UPDATE agent_feedback
     SET status = 'processed', processed_at = now()
   WHERE status = 'unprocessed'
     AND created_at >= v_window_start
     AND feedback_text IS NOT NULL;

  -- 1d. Task-edits (where Jelle edited after AI processing)
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'task_edited',
      'task-organizer',
      'tasks',
      t.id::text,
      coalesce(t.ai_reasoning, ''),
      '[user edited project/priority/deadline after AI assignment]',
      'Jelle paste taak aan na AI-keuze.',
      t.updated_at
    FROM tasks t
    WHERE t.ai_processed = true
      AND t.ai_last_review IS NOT NULL
      AND t.updated_at > t.ai_last_review + interval '5 minutes'
      AND t.updated_at >= v_window_start
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_task FROM ins;

  -- 1e. Sales-on-road note rewrites — guarded: column might not exist yet
  BEGIN
    EXECUTE $sql$
      WITH ins AS (
        INSERT INTO jellemind_signals (
          signal_type, agent_name, source_table, source_id,
          before_text, after_text, delta_summary, occurred_at
        )
        SELECT
          'note_rewritten',
          'sales-on-road',
          'sales_on_road_events',
          e.id::text,
          e.notes_proposed,
          e.notes_final,
          'Jelle herschreef gespreksnotitie.',
          coalesce(e.processed_at, e.updated_at)
        FROM sales_on_road_events e
        WHERE e.status = 'processed'
          AND e.notes_proposed IS NOT NULL
          AND e.notes_final IS NOT NULL
          AND e.notes_proposed <> e.notes_final
          AND coalesce(e.processed_at, e.updated_at) >= $1
        ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
        RETURNING 1
      )
      SELECT count(*) FROM ins
    $sql$
    INTO v_inserted_note
    USING v_window_start;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_inserted_note := 0;
  END;

  -- =========================================================================
  -- PASS 2 -- CLUSTER (rule-based)
  -- =========================================================================

  -- Hard cap: if too many unprocessed signals, only take top 200 most recent
  SELECT count(*) INTO v_total_unprocessed
    FROM jellemind_signals
   WHERE processed = false
     AND harvested_at >= now() - interval '14 days';

  -- Build candidates per rule class
  WITH workset AS (
    SELECT
      id,
      signal_type,
      agent_name,
      coalesce(before_text,'') AS before_text,
      coalesce(after_text,'') AS after_text,
      coalesce(delta_summary,'') AS delta_summary,
      occurred_at
    FROM jellemind_signals
    WHERE processed = false
      AND harvested_at >= now() - interval '14 days'
    ORDER BY occurred_at DESC
    LIMIT p_max_signals_first_run
  ),
  classified AS (
    SELECT
      w.*,
      ARRAY(
        SELECT cls FROM (VALUES
          (
            'pronoun_je_vs_u',
            (w.before_text ~ '\m[Uu]\M' OR w.before_text ~ '\m[Uu]w\M')
              AND (w.after_text ~ '\m[Jj]e\M' OR w.after_text ~ '\m[Jj]ouw\M')
            OR
            (w.before_text ~ '\m[Jj]e\M' OR w.before_text ~ '\m[Jj]ouw\M')
              AND (w.after_text ~ '\m[Uu]\M' OR w.after_text ~ '\m[Uu]w\M')
          ),
          (
            'length_shorter',
            length(w.after_text) > 0
              AND length(w.before_text) > 0
              AND length(w.after_text) < 0.7 * length(w.before_text)
          ),
          (
            'length_longer',
            length(w.after_text) > 0
              AND length(w.before_text) > 0
              AND length(w.after_text) > 1.4 * length(w.before_text)
          ),
          (
            'formal_to_casual',
            (w.before_text ~* '\m(geachte|hooggeachte|met vriendelijke groet)\M')
              AND (w.after_text ~* '\m(hoi|hey|hallo|groet|groetjes)\M')
          ),
          (
            'casual_to_formal',
            (w.before_text ~* '\m(hoi|hey|hallo|groetjes)\M')
              AND (w.after_text ~* '\m(geachte|met vriendelijke groet|hartelijke groet)\M')
          ),
          (
            'deadline_added',
            w.after_text ~ '\m[0-9]{1,2}[-/][0-9]{1,2}'
              AND w.before_text !~ '\m[0-9]{1,2}[-/][0-9]{1,2}'
          )
        ) AS t(cls, hit)
        WHERE t.hit
      ) AS rule_classes
    FROM workset w
  ),
  exploded AS (
    -- One row per (signal, rule_class)
    SELECT c.id, c.signal_type, c.agent_name, c.before_text, c.after_text, c.delta_summary, c.occurred_at,
           unnest(c.rule_classes) AS rule_class
    FROM classified c
    WHERE array_length(c.rule_classes, 1) IS NOT NULL
    UNION ALL
    -- Signals without any rule class get 'unclassified'
    SELECT c.id, c.signal_type, c.agent_name, c.before_text, c.after_text, c.delta_summary, c.occurred_at,
           'unclassified' AS rule_class
    FROM classified c
    WHERE array_length(c.rule_classes, 1) IS NULL
  ),
  grouped AS (
    SELECT
      rule_class,
      count(*) AS n_signals,
      array_agg(DISTINCT agent_name) AS agent_names,
      array_agg(id ORDER BY occurred_at DESC) AS signal_ids,
      array_agg(
        DISTINCT left(
          coalesce(nullif(delta_summary,''), left(coalesce(after_text, before_text), 100)),
          120
        )
      ) FILTER (WHERE delta_summary IS NOT NULL OR after_text IS NOT NULL OR before_text IS NOT NULL) AS evidence_fragments,
      min(occurred_at) AS first_at,
      max(occurred_at) AS last_at
    FROM exploded
    WHERE rule_class <> 'unclassified'
    GROUP BY rule_class
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'rule_class', rule_class,
        'n_signals', n_signals,
        'agent_names', to_jsonb(agent_names),
        'signal_ids', to_jsonb(signal_ids),
        'evidence_fragments', to_jsonb(evidence_fragments[1:5]),
        'first_at', first_at,
        'last_at', last_at
      )
      ORDER BY n_signals DESC, last_at DESC
    ), '[]'::jsonb),
    count(*) FILTER (WHERE n_signals >= 3),
    count(*)
  INTO v_candidates, v_n_clusters_min3, v_n_unique_classes
  FROM grouped;

  -- =========================================================================
  -- BUILD RESULT
  -- =========================================================================

  v_result := jsonb_build_object(
    'harvest', jsonb_build_object(
      'autodraft_amended', v_inserted_autodraft,
      'proposal_amended', v_inserted_proposal,
      'direct_feedback', v_inserted_feedback,
      'task_edited', v_inserted_task,
      'note_rewritten', v_inserted_note,
      'total_new_signals',
        v_inserted_autodraft + v_inserted_proposal + v_inserted_feedback +
        v_inserted_task + v_inserted_note
    ),
    'cluster', jsonb_build_object(
      'unprocessed_signals_in_window', v_total_unprocessed,
      'unique_rule_classes', coalesce(v_n_unique_classes, 0),
      'clusters_with_min_3', coalesce(v_n_clusters_min3, 0)
    ),
    'candidates', v_candidates,
    'window', jsonb_build_object(
      'harvest_from', v_window_start,
      'harvest_to', now()
    )
  );

  RETURN v_result;
END;
$function$;

-- improve_firm_matching()
CREATE OR REPLACE FUNCTION public.improve_firm_matching()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_freemail_unlinked  int := 0;
  v_freemail_persoonlijk int := 0;
  v_subdomain_matched  int := 0;
  v_fuzzy_matched      int := 0;
  v_autofirms_created  int := 0;
  v_firmtype_updated   int := 0;
  v_contacttype_updated int := 0;
BEGIN
  perform public.assert_can_manage_dashboard();

  -- =====================================================
  -- STAP A: Free-mail providers - geen firm-link, type=persoonlijk
  -- =====================================================
  -- Verwijder firm-koppeling waar email-domein een free-mail provider is
  UPDATE public.contactpersonen cp
  SET firm_id = NULL,
      firm_naam = NULL,
      updated_at = now()
  WHERE cp.email_domein IN (SELECT domein FROM public.free_mail_providers)
    AND cp.firm_id IS NOT NULL;
  GET DIAGNOSTICS v_freemail_unlinked = ROW_COUNT;

  -- Zet contact_type='persoonlijk' bij free-mail (alleen als nog op overig staat)
  UPDATE public.contactpersonen cp
  SET contact_type = 'persoonlijk',
      updated_at = now()
  WHERE cp.email_domein IN (SELECT domein FROM public.free_mail_providers)
    AND cp.contact_type = 'overig';
  GET DIAGNOSTICS v_freemail_persoonlijk = ROW_COUNT;

  -- =====================================================
  -- STAP B: Subdomain-unwrap - koppel mail.foo.com aan firm met domein foo.com
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET firm_id    = f.id,
      firm_naam  = f.naam,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id IS NULL
    AND cp.email_domein IS NOT NULL
    AND cp.email_domein NOT IN (SELECT domein FROM public.free_mail_providers)
    AND f.domein = public.strip_mail_subdomain(cp.email_domein)
    AND f.domein != cp.email_domein
    AND NOT cp.is_deleted
    AND NOT f.is_deleted;
  GET DIAGNOSTICS v_subdomain_matched = ROW_COUNT;

  -- =====================================================
  -- STAP C: Fuzzy naam-match
  -- Voor contacten zonder firm: kijk of een herkenbare bedrijfsnaam in
  -- display_naam zit die similar is aan een firm.naam (trigram similarity)
  -- Drempel: 0.5 (van 0..1) - voldoende om "Smeets Gijbels" aan
  -- "Smeets Gijbels Advocaten" te koppelen, maar geen wilde matches
  -- =====================================================
  WITH candidates AS (
    SELECT DISTINCT ON (cp.id)
      cp.id AS contact_id,
      f.id AS firm_id,
      f.naam AS firm_naam,
      similarity(LOWER(cp.display_naam), LOWER(f.naam)) AS sim
    FROM public.contactpersonen cp
    JOIN public.firms f ON LOWER(cp.display_naam) % LOWER(f.naam)
    WHERE cp.firm_id IS NULL
      AND cp.display_naam IS NOT NULL
      AND LENGTH(cp.display_naam) > 4
      AND f.naam IS NOT NULL
      AND LENGTH(f.naam) > 4
      AND cp.email_domein IN (SELECT domein FROM public.free_mail_providers)
      AND similarity(LOWER(cp.display_naam), LOWER(f.naam)) > 0.5
      AND NOT cp.is_deleted
      AND NOT f.is_deleted
    ORDER BY cp.id, sim DESC
  )
  UPDATE public.contactpersonen cp
  SET firm_id    = c.firm_id,
      firm_naam  = c.firm_naam,
      updated_at = now()
  FROM candidates c
  WHERE cp.id = c.contact_id;
  GET DIAGNOSTICS v_fuzzy_matched = ROW_COUNT;

  -- =====================================================
  -- STAP D: Auto-firms voor top-ongekoppelde zakelijke domeinen
  -- Voor elk uniek email_domein dat nog geen firm heeft (en geen free-mail is),
  -- maak een firm aan met naam afgeleid van het domein
  -- =====================================================
  WITH new_firms AS (
    INSERT INTO public.firms (naam, domein, firm_type, properties, synced_at)
    SELECT
      -- Naam: bedrijfsnaam van domein zonder TLD, eerste letter hoofdletter
      INITCAP(REGEXP_REPLACE(SPLIT_PART(cp.email_domein, '.', 1), '[-_]', ' ', 'g')),
      cp.email_domein,
      public.detect_firm_type(
        INITCAP(REGEXP_REPLACE(SPLIT_PART(cp.email_domein, '.', 1), '[-_]', ' ', 'g')),
        cp.email_domein,
        NULL
      ),
      jsonb_build_object('auto_created', true, 'source', 'email_domein'),
      now()
    FROM (
      SELECT DISTINCT email_domein
      FROM public.contactpersonen
      WHERE firm_id IS NULL
        AND email_domein IS NOT NULL
        AND email_domein NOT IN (SELECT domein FROM public.free_mail_providers)
        AND email_domein NOT IN (SELECT domein FROM public.firms WHERE domein IS NOT NULL)
        -- Geen subdomeinen die naar bestaand base-domein wijzen
        AND public.strip_mail_subdomain(email_domein) NOT IN (SELECT domein FROM public.firms WHERE domein IS NOT NULL)
    ) cp
    ON CONFLICT (domein) WHERE domein IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_autofirms_created FROM new_firms;

  -- Koppel contacten aan deze nieuwe firms
  UPDATE public.contactpersonen cp
  SET firm_id    = f.id,
      firm_naam  = f.naam,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id IS NULL
    AND cp.email_domein = f.domein
    AND NOT cp.is_deleted;

  -- =====================================================
  -- STAP E: Verbeterde firm_type tagger draait over ALLE firms
  -- (her-tag, ook voor bestaande firms uit HubSpot waar industry leeg was)
  -- =====================================================
  UPDATE public.firms f
  SET firm_type = public.detect_firm_type(
        f.naam,
        f.domein,
        (SELECT industry FROM public.hubspot_companies hc WHERE hc.company_id = f.hubspot_company_id LIMIT 1)
      ),
      updated_at = now()
  WHERE NOT f.is_deleted
    AND f.firm_type != public.detect_firm_type(
        f.naam,
        f.domein,
        (SELECT industry FROM public.hubspot_companies hc WHERE hc.company_id = f.hubspot_company_id LIMIT 1)
      );
  GET DIAGNOSTICS v_firmtype_updated = ROW_COUNT;

  -- =====================================================
  -- STAP F: contact_type afleiden van firm_type
  -- (alleen waar contact_type=overig - bestaande klant/prospect/intern blijven)
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET contact_type = CASE f.firm_type
        WHEN 'rechtbank'      THEN 'rechtbank'
        WHEN 'overheid'       THEN 'overheid'
        WHEN 'advocatenorde'  THEN 'advocatenorde'
        WHEN 'internal'       THEN 'intern'
        ELSE cp.contact_type
      END,
      updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id = f.id
    AND cp.contact_type = 'overig'
    AND f.firm_type IN ('rechtbank','overheid','advocatenorde','internal')
    AND NOT cp.is_deleted;
  GET DIAGNOSTICS v_contacttype_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'status',                'ok',
    'freemail_unlinked',     v_freemail_unlinked,
    'freemail_persoonlijk',  v_freemail_persoonlijk,
    'subdomain_matched',     v_subdomain_matched,
    'fuzzy_matched',         v_fuzzy_matched,
    'autofirms_created',     v_autofirms_created,
    'firmtype_updated',      v_firmtype_updated,
    'contacttype_updated',   v_contacttype_updated,
    'total_contacten',       (SELECT COUNT(*) FROM public.contactpersonen WHERE NOT is_deleted),
    'total_firms',           (SELECT COUNT(*) FROM public.firms WHERE NOT is_deleted),
    'unlinked_contacten',    (SELECT COUNT(*) FROM public.contactpersonen WHERE firm_id IS NULL AND NOT is_deleted)
  );
END;
$function$;

-- ingest_jira_into_tasks(p_user_email text, p_user_name_pattern text)
CREATE OR REPLACE FUNCTION public.ingest_jira_into_tasks(p_user_email text DEFAULT 'burggraaf@legal-mind.nl'::text, p_user_name_pattern text DEFAULT '%burggraaf%'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted int := 0;
  v_updated int := 0;
  v_auto_closed int := 0;
  v_skipped_cleanup boolean := false;
  v_jira_state record;
  v_boards jsonb;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO v_jira_state FROM jira_sync_state WHERE id = 1;

  WITH open_for_jelle AS (
    SELECT i.*, p.category AS board_category
      FROM jira_issues i
      LEFT JOIN jira_projects p ON p.key = i.project_key
     WHERE i.status_category <> 'done'
       AND (
         i.assignee_email = p_user_email
         OR lower(coalesce(i.assignee_name,'')) LIKE p_user_name_pattern
       )
  ),
  upsert AS (
    INSERT INTO tasks (
      title, notes, deadline, priority,
      source, source_ref, source_url,
      ai_processed, ai_last_review, ai_reasoning,
      jira_status, jira_status_category, jira_in_backlog,
      jira_board, jira_priority, jira_issue_type, jira_last_synced,
      is_newly_found, discovered_at, status, created_at, updated_at
    )
    SELECT
      o.summary,
      left(coalesce(o.description, ''), 500),
      o.due_date,
      CASE
        WHEN o.priority IN ('Highest','High') THEN 'high'
        WHEN o.priority = 'Lowest' THEN 'low'
        ELSE 'normal'
      END,
      'jira', o.issue_key, o.url,
      true, now(),
      'Uit Jira ' || coalesce(o.board_category, o.project_key) || ' (' || o.issue_key || ')',
      o.status, o.status_category, o.in_backlog,
      o.board_category, o.priority, o.issue_type, o.synced_at,
      true, now(), 'open', now(), now()
    FROM open_for_jelle o
    ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE
      SET title = excluded.title,
          notes = excluded.notes,
          deadline = excluded.deadline,
          priority = excluded.priority,
          source_url = excluded.source_url,
          ai_last_review = now(),
          ai_reasoning = excluded.ai_reasoning,
          jira_status = excluded.jira_status,
          jira_status_category = excluded.jira_status_category,
          jira_in_backlog = excluded.jira_in_backlog,
          jira_board = excluded.jira_board,
          jira_priority = excluded.jira_priority,
          jira_issue_type = excluded.jira_issue_type,
          jira_last_synced = excluded.jira_last_synced,
          updated_at = now()
    RETURNING (xmax = 0) AS is_insert
  )
  SELECT
    count(*) FILTER (WHERE is_insert),
    count(*) FILTER (WHERE NOT is_insert)
  INTO v_inserted, v_updated
  FROM upsert;

  IF v_jira_state.last_error IS NULL THEN
    WITH closed AS (
      UPDATE tasks t
         SET status = 'done',
             completed_at = coalesce(t.completed_at, now()),
             ai_reasoning = 'Auto-closed - Jira-issue ' || t.source_ref || ' is niet meer open of niet aan Jelle toegewezen',
             ai_last_review = now(),
             updated_at = now()
       WHERE t.source = 'jira'
         AND t.status NOT IN ('done','dropped')
         AND NOT EXISTS (
           SELECT 1 FROM jira_issues i
            WHERE i.issue_key = t.source_ref
              AND i.status_category <> 'done'
              AND (i.assignee_email = p_user_email
                   OR lower(coalesce(i.assignee_name,'')) LIKE p_user_name_pattern)
         )
       RETURNING 1
    )
    SELECT count(*) INTO v_auto_closed FROM closed;
  ELSE
    v_skipped_cleanup := true;
  END IF;

  SELECT to_jsonb(array_agg(DISTINCT category))
    INTO v_boards
    FROM (
      SELECT DISTINCT p.category
        FROM jira_projects p
        JOIN jira_issues i ON i.project_key = p.key
       WHERE i.status_category <> 'done'
         AND (i.assignee_email = p_user_email
              OR lower(coalesce(i.assignee_name,'')) LIKE p_user_name_pattern)
    ) sub(category);

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'updated', v_updated,
    'auto_closed', v_auto_closed,
    'cleanup_skipped', v_skipped_cleanup,
    'boards', coalesce(v_boards, '[]'::jsonb),
    'jira_last_delta_sync', v_jira_state.last_delta_sync,
    'jira_last_error', v_jira_state.last_error
  );
END;
$function$;

-- log_chat_feedback(p_user_message text, p_assistant_answer text, p_citations jsonb, p_bundle_id uuid, p_retrieval_strategy text, p_entity_used jsonb, p_model text, p_rating text, p_comment text, p_tokens_used integer, p_timing_ms integer)
CREATE OR REPLACE FUNCTION public.log_chat_feedback(p_user_message text, p_assistant_answer text, p_citations jsonb DEFAULT NULL::jsonb, p_bundle_id uuid DEFAULT NULL::uuid, p_retrieval_strategy text DEFAULT NULL::text, p_entity_used jsonb DEFAULT NULL::jsonb, p_model text DEFAULT NULL::text, p_rating text DEFAULT NULL::text, p_comment text DEFAULT NULL::text, p_tokens_used integer DEFAULT NULL::integer, p_timing_ms integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  INSERT INTO public.rag_chat_feedback (
    user_message, assistant_answer, citations, bundle_id,
    retrieval_strategy, entity_used, model, rating, comment,
    tokens_used, timing_ms
  ) VALUES (
    p_user_message, p_assistant_answer, p_citations, p_bundle_id,
    p_retrieval_strategy, p_entity_used, p_model, p_rating, p_comment,
    p_tokens_used, p_timing_ms
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- log_context_bundle(p_intent text, p_audience text, p_trigger_type text, p_trigger_ref_id text, p_primary_record jsonb, p_related_chunks jsonb, p_entity_used jsonb, p_freshness jsonb, p_retrieval_meta jsonb, p_reranked boolean, p_tokens_used integer, p_build_ms integer)
CREATE OR REPLACE FUNCTION public.log_context_bundle(p_intent text, p_audience text, p_trigger_type text, p_trigger_ref_id text, p_primary_record jsonb, p_related_chunks jsonb, p_entity_used jsonb, p_freshness jsonb, p_retrieval_meta jsonb, p_reranked boolean DEFAULT false, p_tokens_used integer DEFAULT NULL::integer, p_build_ms integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle_id uuid;
  v_total_chunks integer;
  v_avg_sim numeric(5,4);
BEGIN
  perform public.assert_can_manage_dashboard();
  v_total_chunks := jsonb_array_length(coalesce(p_related_chunks, '[]'::jsonb));
  IF v_total_chunks > 0 THEN
    SELECT round(avg((c->>'similarity')::numeric)::numeric, 4) INTO v_avg_sim
      FROM jsonb_array_elements(p_related_chunks) c;
  END IF;
  INSERT INTO context_bundles (
    intent, audience, trigger_type, trigger_ref_id,
    primary_record, related_chunks, entity_used, freshness, retrieval_meta,
    reranked, total_chunks, avg_top_similarity, tokens_used, build_ms
  ) VALUES (
    p_intent, p_audience, p_trigger_type, p_trigger_ref_id,
    p_primary_record, p_related_chunks, p_entity_used, p_freshness, p_retrieval_meta,
    p_reranked, v_total_chunks, v_avg_sim, p_tokens_used, p_build_ms
  ) RETURNING bundle_id INTO v_bundle_id;
  RETURN v_bundle_id;
END $function$;

-- log_rag_outcome(p_source_type text, p_source_id uuid, p_decision_action text, p_chunks_used jsonb, p_retrieval_strategy text, p_retrieval_params jsonb, p_tokens_input integer, p_tokens_output integer, p_outcome text)
CREATE OR REPLACE FUNCTION public.log_rag_outcome(p_source_type text, p_source_id uuid, p_decision_action text, p_chunks_used jsonb, p_retrieval_strategy text DEFAULT 'match_all_sources'::text, p_retrieval_params jsonb DEFAULT '{}'::jsonb, p_tokens_input integer DEFAULT NULL::integer, p_tokens_output integer DEFAULT NULL::integer, p_outcome text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_avg_sim numeric(5,4);
  v_total int;
BEGIN
  perform public.assert_can_manage_dashboard();
  v_total := jsonb_array_length(coalesce(p_chunks_used, '[]'::jsonb));
  IF v_total > 0 THEN
    -- vector_score = cosine; fallback op similarity (combined) als vector_score ontbreekt
    SELECT round(avg(COALESCE((c->>'vector_score')::numeric, (c->>'similarity')::numeric))::numeric, 4)
      INTO v_avg_sim FROM jsonb_array_elements(p_chunks_used) c;
  END IF;
  INSERT INTO rag_outcomes (
    source_type, source_id, decision_action, chunks_used, total_chunks,
    avg_top_similarity, retrieval_strategy, retrieval_params,
    tokens_input, tokens_output, outcome, outcome_at
  ) VALUES (
    p_source_type, p_source_id, p_decision_action, p_chunks_used, v_total,
    v_avg_sim, p_retrieval_strategy, p_retrieval_params,
    p_tokens_input, p_tokens_output, p_outcome,
    CASE WHEN p_outcome IS NOT NULL THEN now() END
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- log_rag_outcome_from_bundle(p_source_type text, p_source_id uuid, p_decision_action text, p_bundle_id uuid, p_outcome text)
CREATE OR REPLACE FUNCTION public.log_rag_outcome_from_bundle(p_source_type text, p_source_id uuid, p_decision_action text, p_bundle_id uuid, p_outcome text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b      context_bundles%ROWTYPE;
  v_chunks jsonb;
  v_avg    numeric;
  v_id     uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- Bestaat er al een (pending) outcome voor deze bron? Dan alleen patchen.
  SELECT id INTO v_id FROM rag_outcomes
   WHERE source_type=p_source_type AND source_id=p_source_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE rag_outcomes
       SET outcome = p_outcome, outcome_at = now(),
           decision_action = COALESCE(p_decision_action, decision_action)
     WHERE id = v_id AND (outcome IS NULL OR outcome = 'pending');
    RETURN v_id;
  END IF;

  -- Anders: alleen opbouwen als er een bundle is om aan te hangen.
  IF p_bundle_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_b FROM context_bundles WHERE bundle_id = p_bundle_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_chunks := COALESCE(v_b.related_chunks, '[]'::jsonb);
  SELECT round(avg(COALESCE((c->>'vector_score')::numeric, (c->>'similarity')::numeric))::numeric, 4)
    INTO v_avg FROM jsonb_array_elements(v_chunks) c;

  INSERT INTO rag_outcomes (
    source_type, source_id, decision_action, bundle_id, context_bundle_id,
    chunks_used, total_chunks, avg_top_similarity, retrieval_strategy, retrieval_params,
    outcome, outcome_at
  ) VALUES (
    p_source_type, p_source_id, p_decision_action, p_bundle_id, p_bundle_id,
    v_chunks, COALESCE(jsonb_array_length(v_chunks), 0), v_avg,
    COALESCE(v_b.retrieval_meta->>'strategy', 'context-build/'||COALESCE(v_b.intent,'?')),
    COALESCE(v_b.retrieval_meta, '{}'::jsonb), p_outcome, now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

-- log_search_feedback(p_bundle_id uuid, p_chunk_id uuid, p_chunk_source text, p_chunk_score double precision, p_outcome text, p_query text)
CREATE OR REPLACE FUNCTION public.log_search_feedback(p_bundle_id uuid, p_chunk_id uuid, p_chunk_source text, p_chunk_score double precision, p_outcome text, p_query text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_outcome NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'invalid_outcome: %', p_outcome USING ERRCODE = '22023';
  END IF;

  -- Idempotent: één feedback per (bundle, chunk) combinatie
  -- Bij re-click vervangen we de outcome
  DELETE FROM rag_outcomes
  WHERE source_type = 'search'
    AND context_bundle_id = p_bundle_id
    AND (chunks_used -> 0 ->> 'chunk_id')::uuid = p_chunk_id;

  INSERT INTO rag_outcomes (
    source_type, source_id, decision_action,
    chunks_used, total_chunks, avg_top_similarity,
    retrieval_strategy, retrieval_params,
    outcome, outcome_at, outcome_notes,
    context_bundle_id
  )
  VALUES (
    'search',
    uuid_generate_v4(),                                -- per feedback nieuw id
    'feedback',
    jsonb_build_array(jsonb_build_object(
      'chunk_id', p_chunk_id,
      'source', p_chunk_source,
      'similarity', p_chunk_score
    )),
    1,
    p_chunk_score::numeric(5,4),
    'search-page-feedback',
    jsonb_build_object('query', p_query, 'feedback_origin', 'rag_search_view'),
    p_outcome,
    now(),
    CASE WHEN p_outcome = 'accept' THEN 'user_marked_useful' ELSE 'user_marked_noise' END,
    p_bundle_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- mail_enrichment_claim_batch(p_user_id uuid, p_limit integer)
CREATE OR REPLACE FUNCTION public.mail_enrichment_claim_batch(p_user_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mail_id text;
  v_filter jsonb;
  v_mail_ids_for_llm text[] := ARRAY[]::text[];
  v_skip_count int := 0;
  v_skip_breakdown jsonb := '{}'::jsonb;
  v_reason text;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- Pak mails die nog geen enrichment hebben (SKIP LOCKED tegen race)
  FOR v_mail_id IN
    SELECT m.id FROM public.mail_messages m
    WHERE m.user_id = p_user_id
      AND (m.is_deleted IS NULL OR m.is_deleted = false)
      AND NOT EXISTS (SELECT 1 FROM public.mail_enrichment e WHERE e.mail_id = m.id)
    ORDER BY m.received_at DESC
    LIMIT p_limit
    FOR UPDATE OF m SKIP LOCKED
  LOOP
    v_filter := public.mail_enrichment_pre_filter(v_mail_id);
    IF (v_filter->>'skip')::boolean THEN
      -- Insert direct met deterministische velden, cost=0
      v_reason := v_filter->>'reason';
      BEGIN
        INSERT INTO public.mail_enrichment (
          mail_id, user_id, enricher_version, party_type,
          speech_act, intent_object, urgency, sentiment, language,
          topics, summary_one_line,
          enrichment_model, enrichment_cost_usd, enrichment_confidence, enrichment_notes
        ) VALUES (
          v_mail_id, p_user_id, 'v1.0',
          COALESCE(v_filter->>'party_type', 'onbekend'),
          v_filter->>'speech_act', v_filter->>'intent_object',
          'normal',
          COALESCE(v_filter->>'sentiment', 'neutral'),
          'nl',
          CASE WHEN v_filter ? 'topics'
               THEN ARRAY(SELECT jsonb_array_elements_text(v_filter->'topics'))
               ELSE NULL END,
          v_filter->>'summary_one_line',
          'pre_filter:' || v_reason, 0, 1.0,
          'Deterministisch gelabeld: ' || v_reason
        );
        v_skip_count := v_skip_count + 1;
        v_skip_breakdown := v_skip_breakdown ||
          jsonb_build_object(v_reason, COALESCE((v_skip_breakdown->>v_reason)::int, 0) + 1);
      EXCEPTION WHEN unique_violation THEN
        -- Andere claim was eerder, skip
        NULL;
      END;
    ELSE
      v_mail_ids_for_llm := array_append(v_mail_ids_for_llm, v_mail_id);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', v_skip_count,
    'skip_breakdown', v_skip_breakdown,
    'mail_ids_for_llm', to_jsonb(v_mail_ids_for_llm),
    'llm_count', array_length(v_mail_ids_for_llm, 1)
  );
END $function$;

-- mark_mail_processed(p_mail_id text, p_reason text)
CREATE OR REPLACE FUNCTION public.mark_mail_processed(p_mail_id text, p_reason text DEFAULT 'Al verwerkt in Outlook'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mail autodraft_mails%rowtype;
  v_decision_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id = p_mail_id;
  IF NOT FOUND THEN
    -- Maak een minimale decision-record voor pseudo-pending mails
    INSERT INTO autodraft_decisions (mail_id, action, decided_by, execution_status, target_folder, amend_instructions)
    VALUES (p_mail_id, 'ignore', 'dashboard', 'done', '__already_done__', p_reason)
    RETURNING id INTO v_decision_id;
    RETURN jsonb_build_object('ok', true, 'decision_id', v_decision_id, 'pseudo', true);
  END IF;

  IF v_mail.status IN ('sent','ignored','stale') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_'||v_mail.status);
  END IF;

  INSERT INTO autodraft_decisions
    (mail_id, action, decided_by, execution_status, target_folder, amend_instructions)
  VALUES
    (p_mail_id, 'ignore', 'dashboard', 'done', '__already_done__', p_reason)
  RETURNING id INTO v_decision_id;

  UPDATE autodraft_mails
     SET status = 'ignored', updated_at = now()
   WHERE mail_id = p_mail_id;

  RETURN jsonb_build_object('ok', true, 'decision_id', v_decision_id);
END;
$function$;

-- rag_pipeline_staleness_check()
CREATE OR REPLACE FUNCTION public.rag_pipeline_staleness_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_chunk    timestamptz;
  v_age_min       numeric;
  v_pending       boolean;
  v_is_stale      boolean;
  v_finding_id    uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT max(created_at) INTO v_last_chunk FROM chunks;
  v_age_min := EXTRACT(EPOCH FROM (now() - v_last_chunk)) / 60.0;

  -- Is er ongechunkte mail van de afgelopen 3u? (cheap, indexed via chunks(source,source_id))
  SELECT EXISTS (
    SELECT 1 FROM mail_messages m
     WHERE m.received_at > now() - interval '3 hours'
       AND COALESCE(m.is_deleted, false) = false
       AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source='mail' AND c.source_id = m.id)
  ) INTO v_pending;

  v_is_stale := (v_age_min > 30) AND v_pending;

  IF v_is_stale THEN
    -- Dedup: alleen nieuwe finding als geen open finding in de afgelopen 6u.
    IF NOT EXISTS (
      SELECT 1 FROM security_findings
       WHERE affected_object='chunker' AND scan_type='rag_pipeline_guard'
         AND status='open' AND found_at > now() - interval '6 hours'
    ) THEN
      INSERT INTO security_findings (scan_type, severity, category, title, detail, affected_object, status)
      VALUES ('rag_pipeline_guard', 'high', 'pipeline_staleness',
        'Chunker stil >30 min terwijl er ongechunkte mail wacht',
        format('Laatste chunk %s min geleden (%s). Ongechunkte mail aanwezig. Check chunker-cron (jobid 18) + verify_jwt:false + edge-logs.',
               round(v_age_min)::text, COALESCE(v_last_chunk::text,'NULL')),
        'chunker', 'open')
      RETURNING id INTO v_finding_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'is_stale', v_is_stale, 'last_chunk_at', v_last_chunk,
    'age_minutes', round(v_age_min,1), 'pending_unchunked_mail', v_pending,
    'finding_created', v_finding_id);
END $function$;

-- refresh_entity_resolution()
CREATE OR REPLACE FUNCTION public.refresh_entity_resolution()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email_count   int := 0;
  v_domain_count  int := 0;
  v_name_count    int := 0;
  v_started_at    timestamptz := now();
BEGIN
  perform public.assert_can_manage_dashboard();
  -- 1. email → contact
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(c.email))
         'email', lower(c.email), 'contact', c.contact_id, 1.000, 'hubspot_mirror'
    FROM hubspot_contacts c
   WHERE c.email IS NOT NULL AND length(trim(c.email)) > 0
   ORDER BY lower(c.email), c.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_email_count = ROW_COUNT;

  -- 2. email_domain → company  (uit hubspot_companies.domain). Blocklist: consumer-domeinen
  --    + eigen/test-domeinen (RAG v3 F.1: legal-mind.nl/test.nl/test1.nl niet naar eigen company).
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(co.domain))
         'email_domain', lower(co.domain), 'company', co.company_id, 0.900, 'hubspot_mirror'
    FROM hubspot_companies co
   WHERE co.domain IS NOT NULL AND length(trim(co.domain)) > 0
     AND lower(co.domain) NOT IN ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','live.com','live.nl','protonmail.com','proton.me','ziggo.nl','kpn.nl','xs4all.nl','planet.nl','telfort.nl','online.nl','home.nl','quicknet.nl','t-online.de','legal-mind.nl','test.nl','test1.nl')
   ORDER BY lower(co.domain), co.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_domain_count = ROW_COUNT;

  -- 3. name → contact (firstname + lastname concat, lowercase)
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(trim(c.firstname || ' ' || c.lastname)))
         'name', lower(trim(c.firstname || ' ' || c.lastname)), 'contact', c.contact_id, 0.700, 'hubspot_mirror'
    FROM hubspot_contacts c
   WHERE c.firstname IS NOT NULL AND length(trim(c.firstname)) > 0
     AND c.lastname  IS NOT NULL AND length(trim(c.lastname)) > 0
   ORDER BY lower(trim(c.firstname || ' ' || c.lastname)), c.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_name_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'started_at', v_started_at, 'completed_at', now(),
    'duration_ms', extract(milliseconds from (now() - v_started_at))::int,
    'inserted_or_updated', jsonb_build_object(
      'email_to_contact', v_email_count, 'domain_to_company', v_domain_count,
      'name_to_contact', v_name_count, 'total', v_email_count + v_domain_count + v_name_count
    )
  );
END $function$;

-- refresh_rag_chunk_signals()
CREATE OR REPLACE FUNCTION public.refresh_rag_chunk_signals()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  perform public.assert_can_manage_dashboard();
  DELETE FROM rag_chunk_signals;
  WITH expanded AS (
    SELECT (c->>'chunk_id')::uuid AS chunk_id, o.outcome,
           COALESCE(o.outcome_at, o.created_at) AS at
    FROM rag_outcomes o, jsonb_array_elements(o.chunks_used) c
    WHERE o.outcome IN ('accept','amend','reject')
      AND c->>'chunk_id' IS NOT NULL AND length(c->>'chunk_id') = 36
  ),
  agg AS (
    SELECT chunk_id,
      count(*)                                  AS times_retrieved,
      count(*) FILTER (WHERE outcome='accept')  AS acc,
      count(*) FILTER (WHERE outcome='amend')   AS amd,
      count(*) FILTER (WHERE outcome='reject')  AS rej,
      max(at)                                   AS last_retrieved_at,
      max(at) FILTER (WHERE outcome='accept')   AS last_acc
    FROM expanded GROUP BY chunk_id
  )
  INSERT INTO rag_chunk_signals
    (chunk_id, times_retrieved, times_in_accepted, times_in_amended, times_in_rejected,
     last_retrieved_at, last_acceptance_at, updated_at)
  SELECT chunk_id, times_retrieved, acc, amd, rej, last_retrieved_at, last_acc, now()
  FROM agg;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- register_fireflies_action_items(p_items jsonb, p_dedup_days integer, p_dedup_threshold real, p_cap integer)
CREATE OR REPLACE FUNCTION public.register_fireflies_action_items(p_items jsonb, p_dedup_days integer DEFAULT 14, p_dedup_threshold real DEFAULT 0.85, p_cap integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_inserted int := 0;
  v_skipped_dup int := 0;
  v_skipped_exists int := 0;
  v_skipped_cap int := 0;
  v_inserted_ids uuid[] := ARRAY[]::uuid[];
  v_item jsonb;
  v_new_id uuid;
  v_dup_id uuid;
  v_safe_cap int := greatest(0, least(p_cap, 100));
BEGIN
  perform public.assert_can_manage_dashboard();
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  LOOP
    IF v_item->>'title' IS NULL OR length(trim(v_item->>'title')) = 0 THEN
      CONTINUE;
    END IF;

    -- Cap check (cap remaining inserts)
    IF v_inserted >= v_safe_cap THEN
      v_skipped_cap := v_skipped_cap + 1;
      CONTINUE;
    END IF;

    -- Exact dedup by source_ref
    IF v_item->>'source_ref' IS NOT NULL AND EXISTS (
      SELECT 1 FROM tasks
       WHERE source = 'fireflies'
         AND source_ref = v_item->>'source_ref'
    ) THEN
      v_skipped_exists := v_skipped_exists + 1;
      CONTINUE;
    END IF;

    -- Fuzzy dedup against recent open tasks
    SELECT id INTO v_dup_id
      FROM tasks
     WHERE created_at >= now() - (p_dedup_days || ' days')::interval
       AND status NOT IN ('done','dropped')
       AND title IS NOT NULL
       AND similarity(title, v_item->>'title') >= p_dedup_threshold
     ORDER BY similarity(title, v_item->>'title') DESC
     LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      v_skipped_dup := v_skipped_dup + 1;
      CONTINUE;
    END IF;

    INSERT INTO tasks (
      title, notes, source, source_ref, source_url,
      is_newly_found, discovered_at, ai_processed,
      status, created_at, updated_at, created_by
    ) VALUES (
      left(v_item->>'title', 500),
      v_item->>'notes',
      'fireflies',
      v_item->>'source_ref',
      v_item->>'source_url',
      true, now(), false,
      'open', now(), now(),
      coalesce(v_item->>'created_by', 'fireflies-edge')
    )
    RETURNING id INTO v_new_id;

    v_inserted_ids := array_append(v_inserted_ids, v_new_id);
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'skipped_duplicate', v_skipped_dup,
    'skipped_existing', v_skipped_exists,
    'skipped_cap', v_skipped_cap,
    'inserted_ids', to_jsonb(v_inserted_ids)
  );
END;
$function$;

-- register_secret_via_chat(p_key_name text, p_last_4 text, p_used_by text[], p_purpose text, p_rotation_url text, p_storage_location text, p_storage_ref text, p_display_name text)
CREATE OR REPLACE FUNCTION public.register_secret_via_chat(p_key_name text, p_last_4 text, p_used_by text[] DEFAULT NULL::text[], p_purpose text DEFAULT NULL::text, p_rotation_url text DEFAULT NULL::text, p_storage_location text DEFAULT 'edge_function_secret'::text, p_storage_ref text DEFAULT NULL::text, p_display_name text DEFAULT NULL::text)
 RETURNS secrets_inventory
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row secrets_inventory;
BEGIN
  perform public.assert_can_manage_dashboard();
  INSERT INTO secrets_inventory (
    key_name, display_name, purpose, used_by, storage_location, storage_ref,
    status, last_4, last_status_change_at, last_status_change_by, rotation_url
  )
  VALUES (
    p_key_name,
    COALESCE(p_display_name, p_key_name),
    COALESCE(p_purpose, '— niet ingevuld —'),
    COALESCE(p_used_by, ARRAY[]::text[]),
    p_storage_location,
    p_storage_ref,
    'red_chat_just_received',
    p_last_4,
    now(),
    'agent_manager_via_chat',
    p_rotation_url
  )
  ON CONFLICT (key_name) DO UPDATE SET
    status = 'red_chat_just_received',
    last_4 = EXCLUDED.last_4,
    last_status_change_at = now(),
    last_status_change_by = 'agent_manager_via_chat',
    used_by = COALESCE(EXCLUDED.used_by, secrets_inventory.used_by),
    purpose = COALESCE(NULLIF(EXCLUDED.purpose, '— niet ingevuld —'), secrets_inventory.purpose),
    rotation_url = COALESCE(EXCLUDED.rotation_url, secrets_inventory.rotation_url)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- request_meeting_briefing(p_event_id uuid)
CREATE OR REPLACE FUNCTION public.request_meeting_briefing(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_evt public.calendar_events;
  v_row public.meeting_briefings;
begin
  perform public.assert_can_manage_dashboard();
  select * into v_evt from public.calendar_events
   where id = p_event_id and coalesce(is_deleted,false) = false;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  insert into public.meeting_briefings (calendar_event_id, status, event_start_time, regenerate_requested_at, updated_at)
  values (p_event_id, 'queued', v_evt.start_time, now(), now())
  on conflict (calendar_event_id) do update
    set status = 'queued',
        regenerate_requested_at = now(),
        error_text = null,
        updated_at = now();

  select * into v_row from public.meeting_briefings where calendar_event_id = p_event_id;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
end;
$function$;

-- restore_proposal(p_id uuid)
CREATE OR REPLACE FUNCTION public.restore_proposal(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row agent_proposals;
  v_new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO v_row FROM agent_proposals WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Rejected / accepted (nog niet executed) → in-place revert
  IF v_row.status IN ('rejected', 'accepted', 'amended', 'failed', 'expired', 'superseded') THEN
    UPDATE agent_proposals
       SET status = 'pending',
           reviewed_at = NULL,
           executed_at = NULL,
           execution_result = NULL,
           amendment = NULL,
           expires_at = NOW() + INTERVAL '7 days'
     WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'mode', 'reverted', 'id', p_id);
  END IF;

  -- Executed → clone als nieuw pending-proposal. Origineel blijft staan.
  IF v_row.status = 'executed' THEN
    INSERT INTO agent_proposals (
      agent_name, category, subject, summary, proposal, default_action,
      context, status, has_fireflies_context, confidence, needs_info,
      amended_from, confidence_reasons, context_bundle_id,
      created_at, expires_at
    )
    VALUES (
      v_row.agent_name, v_row.category,
      v_row.subject || ' (heropend)',
      COALESCE(v_row.summary, '') || E'\n\n_Origineel uitgevoerd op ' || to_char(v_row.executed_at, 'DD-MM-YYYY HH24:MI') || '_',
      v_row.proposal, v_row.default_action,
      v_row.context, 'pending', v_row.has_fireflies_context, v_row.confidence, v_row.needs_info,
      v_row.id, v_row.confidence_reasons, v_row.context_bundle_id,
      NOW(), NOW() + INTERVAL '7 days'
    )
    RETURNING id INTO v_new_id;
    RETURN jsonb_build_object('ok', true, 'mode', 'cloned', 'id', v_new_id, 'original_id', v_row.id);
  END IF;

  -- Pending → niets te doen
  IF v_row.status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_pending');
  END IF;

  RETURN jsonb_build_object('ok', false, 'reason', 'unknown_status_' || v_row.status);
END;
$function$;

-- seed_contactpersonen()
CREATE OR REPLACE FUNCTION public.seed_contactpersonen()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_firms_inserted int := 0;
  v_firms_updated  int := 0;
  v_hs_inserted    int := 0;
  v_hs_updated     int := 0;
  v_mail_inserted  int := 0;
  v_mail_skipped   int := 0;
BEGIN
  perform public.assert_can_manage_dashboard();

  -- =====================================================
  -- STAP 1: HubSpot Companies ? firms (2-pass: link + insert)
  -- Pass 1a: link bestaande auto-firms aan HubSpot company_id (op domein-match)
  -- Pass 1b: insert HubSpot-companies die nog niet bestaan
  -- =====================================================

  -- Pass 1a: bestaande firms (auto of niet) op domein-match ? koppelen aan HubSpot
  WITH hs_dedup AS (
    SELECT DISTINCT ON (LOWER(TRIM(hc.domain)))
      hc.name, NULLIF(LOWER(TRIM(hc.domain)), '') AS domein, hc.company_id,
      hc.industry, hc.lifecyclestage, hc.city, hc.synced_at
    FROM public.hubspot_companies hc
    WHERE NOT hc.is_archived AND hc.name IS NOT NULL
    ORDER BY LOWER(TRIM(hc.domain)), hc.hs_lastmodifieddate DESC NULLS LAST
  )
  UPDATE public.firms f
  SET hubspot_company_id = h.company_id,
      naam               = h.name,
      firm_type          = CASE
        WHEN h.industry ILIKE '%law%' OR h.industry ILIKE '%legal%' OR h.industry ILIKE '%advo%' THEN 'advocatenkantoor'
        WHEN h.industry ILIKE '%tech%' OR h.industry ILIKE '%software%' OR h.industry ILIKE '%saas%' THEN 'tech'
        WHEN h.industry ILIKE '%consult%' THEN 'consulting'
        WHEN h.industry ILIKE '%notari%' THEN 'notariaat'
        WHEN h.industry ILIKE '%overheid%' OR h.industry ILIKE '%government%' THEN 'overheid'
        ELSE f.firm_type  -- behoud bestaande tagging
      END,
      is_klant           = COALESCE((h.lifecyclestage = 'customer'), false),
      stad               = COALESCE(h.city, f.stad),
      synced_at          = h.synced_at,
      updated_at         = now()
  FROM hs_dedup h
  WHERE f.domein = h.domein
    AND f.hubspot_company_id IS NULL
    AND h.company_id IS NOT NULL;

  -- Pass 1b: HubSpot-companies die nog NIET bestaan in firms (op domein �n op company_id)
  INSERT INTO public.firms (naam, domein, hubspot_company_id, firm_type, is_klant, stad, synced_at)
  WITH hs_dedup AS (
    SELECT DISTINCT ON (LOWER(TRIM(hc.domain)))
      hc.name, NULLIF(LOWER(TRIM(hc.domain)), '') AS domein, hc.company_id,
      hc.industry, hc.lifecyclestage, hc.city, hc.synced_at
    FROM public.hubspot_companies hc
    WHERE NOT hc.is_archived AND hc.name IS NOT NULL
    ORDER BY LOWER(TRIM(hc.domain)), hc.hs_lastmodifieddate DESC NULLS LAST
  )
  SELECT
    h.name, h.domein, h.company_id,
    CASE
      WHEN h.industry ILIKE '%law%' OR h.industry ILIKE '%legal%' OR h.industry ILIKE '%advo%' THEN 'advocatenkantoor'
      WHEN h.industry ILIKE '%tech%' OR h.industry ILIKE '%software%' OR h.industry ILIKE '%saas%' THEN 'tech'
      WHEN h.industry ILIKE '%consult%' THEN 'consulting'
      WHEN h.industry ILIKE '%notari%' THEN 'notariaat'
      WHEN h.industry ILIKE '%overheid%' OR h.industry ILIKE '%government%' THEN 'overheid'
      ELSE 'overig'
    END,
    COALESCE((h.lifecyclestage = 'customer'), false),
    h.city, h.synced_at
  FROM hs_dedup h
  WHERE NOT EXISTS (
    SELECT 1 FROM public.firms f
    WHERE f.hubspot_company_id = h.company_id
       OR (h.domein IS NOT NULL AND f.domein = h.domein)
  )
  ON CONFLICT (hubspot_company_id) WHERE hubspot_company_id IS NOT NULL
  DO UPDATE SET
    naam       = EXCLUDED.naam,
    firm_type  = EXCLUDED.firm_type,
    is_klant   = EXCLUDED.is_klant,
    stad       = EXCLUDED.stad,
    synced_at  = now(),
    updated_at = now();

  GET DIAGNOSTICS v_firms_inserted = ROW_COUNT;

  -- =====================================================
  -- STAP 2: HubSpot Contacts ? contactpersonen
  -- =====================================================
  INSERT INTO public.contactpersonen (
    email, voornaam, achternaam, display_naam, telefoonnummer, functietitel,
    contact_type, firm_id, firm_naam, email_domein,
    sources, hubspot_contact_id, properties, synced_at
  )
  SELECT
    LOWER(TRIM(hcon.email)),
    hcon.firstname,
    hcon.lastname,
    TRIM(COALESCE(hcon.firstname, '') || ' ' || COALESCE(hcon.lastname, '')),
    hcon.phone,
    hcon.jobtitle,
    -- map lifecyclestage ? contact_type
    CASE hcon.lifecyclestage
      WHEN 'customer'              THEN 'klant'
      WHEN 'evangelist'            THEN 'klant'
      WHEN 'lead'                  THEN 'prospect'
      WHEN 'marketingqualifiedlead' THEN 'prospect'
      WHEN 'salesqualifiedlead'    THEN 'prospect'
      WHEN 'opportunity'           THEN 'prospect'
      WHEN 'subscriber'            THEN 'prospect'
      ELSE 'overig'
    END,
    f.id,
    f.naam,
    SPLIT_PART(LOWER(TRIM(hcon.email)), '@', 2),
    ARRAY['hubspot'],
    hcon.contact_id,
    hcon.properties,
    hcon.synced_at
  FROM public.hubspot_contacts hcon
  LEFT JOIN public.firms f ON f.hubspot_company_id = hcon.associated_company_id
  WHERE NOT hcon.is_archived
    AND hcon.email IS NOT NULL
    AND hcon.email != ''
  ON CONFLICT (email)
  DO UPDATE SET
    voornaam          = EXCLUDED.voornaam,
    achternaam        = EXCLUDED.achternaam,
    display_naam      = EXCLUDED.display_naam,
    telefoonnummer    = COALESCE(EXCLUDED.telefoonnummer, contactpersonen.telefoonnummer),
    functietitel      = COALESCE(EXCLUDED.functietitel, contactpersonen.functietitel),
    contact_type      = EXCLUDED.contact_type,
    firm_id           = COALESCE(EXCLUDED.firm_id, contactpersonen.firm_id),
    firm_naam         = COALESCE(EXCLUDED.firm_naam, contactpersonen.firm_naam),
    email_domein      = EXCLUDED.email_domein,
    sources           = ARRAY(SELECT DISTINCT UNNEST(contactpersonen.sources || EXCLUDED.sources)),
    hubspot_contact_id = EXCLUDED.hubspot_contact_id,
    properties        = EXCLUDED.properties,
    synced_at         = now(),
    updated_at        = now();

  GET DIAGNOSTICS v_hs_inserted = ROW_COUNT;

  -- =====================================================
  -- STAP 3: Outlook senders ? contactpersonen
  -- Groepeer alleen op email (niet op naam) om duplicates te voorkomen
  -- Neem de meest voorkomende naam per email-adres
  -- =====================================================
  INSERT INTO public.contactpersonen (
    email, voornaam, achternaam, display_naam, email_domein,
    contact_type, sources, last_seen_at, first_seen_at, email_count
  )
  WITH sender_stats AS (
    SELECT
      LOWER(TRIM(m.from_email)) AS email,
      MAX(COALESCE(m.received_at, m.sent_at)) AS last_seen_at,
      MIN(COALESCE(m.received_at, m.sent_at)) AS first_seen_at,
      COUNT(*)::int AS email_count
    FROM public.mail_messages m
    WHERE m.from_email IS NOT NULL
      AND m.from_email != ''
      AND m.from_email NOT ILIKE '%mailer-daemon%'
      AND m.from_email NOT ILIKE '%noreply%'
      AND m.from_email NOT ILIKE '%no-reply%'
    GROUP BY LOWER(TRIM(m.from_email))
  ),
  sender_names AS (
    SELECT DISTINCT ON (LOWER(TRIM(m.from_email)))
      LOWER(TRIM(m.from_email)) AS email,
      TRIM(m.from_name) AS display_naam
    FROM public.mail_messages m
    WHERE m.from_email IS NOT NULL AND m.from_name IS NOT NULL AND m.from_name != ''
    ORDER BY LOWER(TRIM(m.from_email)), m.received_at DESC NULLS LAST
  )
  SELECT
    s.email,
    SPLIT_PART(COALESCE(n.display_naam, ''), ' ', 1) AS voornaam,
    CASE
      WHEN array_length(string_to_array(COALESCE(n.display_naam, ''), ' '), 1) > 1
      THEN TRIM(SPLIT_PART(COALESCE(n.display_naam, ''), ' ', 2))
      ELSE NULL
    END AS achternaam,
    n.display_naam,
    SPLIT_PART(s.email, '@', 2) AS email_domein,
    CASE
      WHEN SPLIT_PART(s.email, '@', 2) = 'legal-mind.nl' THEN 'intern'
      ELSE 'overig'
    END AS contact_type,
    ARRAY['outlook'] AS sources,
    s.last_seen_at,
    s.first_seen_at,
    s.email_count
  FROM sender_stats s
  LEFT JOIN sender_names n ON n.email = s.email
  ON CONFLICT (email)
  DO UPDATE SET
    -- alleen toevoegen wat HubSpot niet al wist
    display_naam    = CASE WHEN contactpersonen.display_naam IS NULL OR contactpersonen.display_naam = '' THEN EXCLUDED.display_naam ELSE contactpersonen.display_naam END,
    voornaam        = CASE WHEN contactpersonen.voornaam IS NULL THEN EXCLUDED.voornaam ELSE contactpersonen.voornaam END,
    achternaam      = CASE WHEN contactpersonen.achternaam IS NULL THEN EXCLUDED.achternaam ELSE contactpersonen.achternaam END,
    last_seen_at    = GREATEST(contactpersonen.last_seen_at, EXCLUDED.last_seen_at),
    first_seen_at   = LEAST(contactpersonen.first_seen_at, EXCLUDED.first_seen_at),
    email_count     = contactpersonen.email_count + EXCLUDED.email_count,
    sources         = ARRAY(SELECT DISTINCT UNNEST(contactpersonen.sources || EXCLUDED.sources)),
    updated_at      = now();

  GET DIAGNOSTICS v_mail_inserted = ROW_COUNT;

  -- =====================================================
  -- STAP 4: Outlook recipients ? contactpersonen (to + cc)
  -- Pakt unieke emailadressen uit jsonb arrays
  -- =====================================================
  WITH recipient_emails AS (
    SELECT DISTINCT
      LOWER(TRIM(r->>'emailAddress')) AS email,
      TRIM(r->>'name') AS display_naam,
      MAX(COALESCE(m.received_at, m.sent_at)) OVER (PARTITION BY LOWER(TRIM(r->>'emailAddress'))) AS last_seen_at,
      MIN(COALESCE(m.received_at, m.sent_at)) OVER (PARTITION BY LOWER(TRIM(r->>'emailAddress'))) AS first_seen_at
    FROM public.mail_messages m
    CROSS JOIN LATERAL (
      SELECT jsonb_array_elements(m.to_recipients) AS r
      UNION ALL
      SELECT jsonb_array_elements(m.cc_recipients) AS r
    ) recipients
    WHERE (m.to_recipients IS NOT NULL OR m.cc_recipients IS NOT NULL)
  ),
  deduped AS (
    SELECT
      email,
      MAX(display_naam) AS display_naam,
      MAX(last_seen_at) AS last_seen_at,
      MIN(first_seen_at) AS first_seen_at
    FROM recipient_emails
    WHERE email IS NOT NULL AND email != ''
      AND email NOT ILIKE '%mailer-daemon%'
    GROUP BY email
  )
  INSERT INTO public.contactpersonen (
    email, display_naam, email_domein, contact_type,
    sources, last_seen_at, first_seen_at
  )
  SELECT
    d.email,
    d.display_naam,
    SPLIT_PART(d.email, '@', 2) AS email_domein,
    CASE
      WHEN SPLIT_PART(d.email, '@', 2) = 'legal-mind.nl' THEN 'intern'
      ELSE 'overig'
    END,
    ARRAY['outlook'],
    d.last_seen_at,
    d.first_seen_at
  FROM deduped d
  ON CONFLICT (email)
  DO UPDATE SET
    display_naam  = CASE WHEN contactpersonen.display_naam IS NULL THEN EXCLUDED.display_naam ELSE contactpersonen.display_naam END,
    last_seen_at  = GREATEST(contactpersonen.last_seen_at, EXCLUDED.last_seen_at),
    first_seen_at = LEAST(contactpersonen.first_seen_at, EXCLUDED.first_seen_at),
    sources       = ARRAY(SELECT DISTINCT UNNEST(contactpersonen.sources || EXCLUDED.sources)),
    updated_at    = now();

  GET DIAGNOSTICS v_mail_skipped = ROW_COUNT;

  -- =====================================================
  -- STAP 5: Firm-koppeling voor contactpersonen zonder firm_id
  -- Matcht op email_domein ? firms.domein
  -- =====================================================
  UPDATE public.contactpersonen cp
  SET
    firm_id   = f.id,
    firm_naam = f.naam,
    updated_at = now()
  FROM public.firms f
  WHERE cp.firm_id IS NULL
    AND cp.email_domein IS NOT NULL
    AND cp.email_domein != ''
    AND f.domein = cp.email_domein
    AND NOT cp.is_deleted;

  -- =====================================================
  -- STAP 6: contact_type = 'intern' voor @legal-mind.nl
  -- =====================================================
  UPDATE public.contactpersonen
  SET contact_type = 'intern', updated_at = now()
  WHERE email_domein = 'legal-mind.nl'
    AND contact_type = 'overig';

  -- =====================================================
  -- STAP 7: display_naam fallback = email
  -- =====================================================
  UPDATE public.contactpersonen
  SET display_naam = email, updated_at = now()
  WHERE (display_naam IS NULL OR TRIM(display_naam) = '')
    AND NOT is_deleted;

  -- Update sync state
  UPDATE public.contactpersonen_sync_state
  SET last_sync_at = now(), last_delta_sync = now(),
      total_synced = (SELECT COUNT(*) FROM public.contactpersonen),
      updated_at = now()
  WHERE source IN ('hubspot', 'outlook');

  RETURN jsonb_build_object(
    'status',         'ok',
    'firms_upserted', v_firms_inserted,
    'hs_contacts',    v_hs_inserted,
    'mail_senders',   v_mail_inserted,
    'mail_recipients', v_mail_skipped,
    'total',          (SELECT COUNT(*) FROM public.contactpersonen)
  );
END;
$function$;

-- seed_lifecycle_log_from_hubspot(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.seed_lifecycle_log_from_hubspot(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_deals_processed int := 0;
  v_stage text;
  v_rec RECORD;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- Wis bestaande hubspot-historie voor deze user (idempotent)
  DELETE FROM public.mail_party_lifecycle_log
    WHERE user_id = p_user_id AND source = 'hubspot_deal_history';

  -- Per company: maak één rij per stage-transition (best-effort, geen echte history)
  -- We weten alleen huidige stage + hs_created_at + hs_lastmodifieddate
  -- Heuristic: stage X is geldig vanaf hs_lastmodifieddate (laatste verandering), terug naar hs_created_at
  FOR v_rec IN
    SELECT DISTINCT
      company_id_text::text AS company_id,
      d.dealstage,
      d.pipeline_id,
      d.hs_created_at,
      d.hs_lastmodifieddate
    FROM public.hubspot_deals d
    CROSS JOIN LATERAL unnest(d.associated_company_ids) AS company_id_text
    WHERE NOT d.is_archived
  LOOP
    -- Map dealstage naar lifecycle-stage
    v_stage := CASE
      WHEN v_rec.dealstage IN ('3504527569','4841337018','4759855332','4896974066') THEN 'trial'
      WHEN v_rec.dealstage IN ('3136444618','5052825799','5184563446','3417083067','4759855333','4759855334') THEN 'active'
      WHEN v_rec.dealstage IN ('3504650455') THEN 'churned'
      WHEN v_rec.pipeline_id IN ('default','3571993844','2562718926','2557844668','3534570692','2971054291') THEN 'prospect'
      ELSE NULL
    END;
    CONTINUE WHEN v_stage IS NULL;

    -- Insert one row: stage geldig van hs_created_at → NULL (huidig)
    -- (Lossy reconstructie: we kennen alleen huidige stage, niet voorgangers)
    INSERT INTO public.mail_party_lifecycle_log
      (user_id, company_id, stage, valid_from, valid_to, source, notes)
    VALUES
      (p_user_id, v_rec.company_id, v_stage,
       v_rec.hs_created_at,
       NULL,
       'hubspot_deal_history',
       'Reconstructie uit huidige dealstage: ' || v_rec.dealstage || ' / pipeline: ' || v_rec.pipeline_id);

    v_inserted := v_inserted + 1;
    v_deals_processed := v_deals_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', v_inserted,
    'deals_processed', v_deals_processed,
    'note', 'Lossy reconstructie — we kennen alleen huidige stages, niet voorgangers. lifecycle_at_moment voor pre-current-stage mails wordt geinferreerd via resolve_party_at_moment fallback.'
  );
END $function$;

-- send_chat_message(message text, target text, category text)
CREATE OR REPLACE FUNCTION public.send_chat_message(message text, target text DEFAULT NULL::text, category text DEFAULT 'chat'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE new_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF message IS NULL OR length(trim(message)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_message');
  END IF;
  IF category NOT IN ('question','improvement','action_request','chat') THEN
    category := 'chat';
  END IF;
  INSERT INTO agent_chat_messages (author, target_skill, user_message, category, status)
  VALUES ('user', target, trim(message), category, 'pending')
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$function$;

-- send_chat_message(message text, target text, category text, session_id uuid)
CREATE OR REPLACE FUNCTION public.send_chat_message(message text, target text DEFAULT NULL::text, category text DEFAULT 'chat'::text, session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  new_id   uuid;
  use_sid  uuid;
  title    text;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF message IS NULL OR length(trim(message)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_message');
  END IF;
  IF category NOT IN ('question','improvement','action_request','chat') THEN
    category := 'chat';
  END IF;

  use_sid := COALESCE(session_id, gen_random_uuid());
  title   := substring(trim(message) FROM 1 FOR 80);

  INSERT INTO agent_chat_messages
    (author, target_skill, user_message, category, status, session_id, session_title)
  VALUES
    ('user', target, trim(message), category, 'pending', use_sid,
      -- Alleen titel zetten als dit het eerste bericht in de sessie is
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM agent_chat_messages WHERE agent_chat_messages.session_id = use_sid)
        THEN title
        ELSE NULL
      END
    )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'id', new_id, 'session_id', use_sid);
END;
$function$;

-- set_mail_flag(p_mail_id text, p_flag boolean)
CREATE OR REPLACE FUNCTION public.set_mail_flag(p_mail_id text, p_flag boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_existing record;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT id, flag_status INTO v_existing FROM mail_messages WHERE id = p_mail_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mail_not_found');
  END IF;

  -- Optimistic local update — auto-draft-execute syncht straks naar Outlook
  UPDATE mail_messages
     SET flag_status = CASE WHEN p_flag THEN 'flagged' ELSE NULL END,
         last_modified_at = now()
   WHERE id = p_mail_id;

  -- Insert decision-record voor de skill (autodraft_mails-row hoeft niet te bestaan)
  INSERT INTO autodraft_decisions (mail_id, action, decided_by, execution_status)
  VALUES (p_mail_id, CASE WHEN p_flag THEN 'flag' ELSE 'unflag' END, 'dashboard', 'pending')
  ON CONFLICT DO NOTHING;

  -- Trigger execute-skill via manual_run_requested_at
  UPDATE agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'auto-draft-execute';

  RETURN jsonb_build_object('ok', true, 'flag_status', CASE WHEN p_flag THEN 'flagged' ELSE NULL END);
END;
$function$;

-- submit_action_decision(p_decision_id uuid, p_outcome text, p_payload_override jsonb)
CREATE OR REPLACE FUNCTION public.submit_action_decision(p_decision_id uuid, p_outcome text, p_payload_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  perform public.assert_can_manage_dashboard();
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

    WHEN 'schedule' THEN
      -- v3.1 werkstroom-G: een schedule-voorstel is een reply met voorgestelde
      -- agenda-slots. Map op het reply-pad zodat auto-draft-execute de draft
      -- (met slots, uit autodraft_mails) als Outlook-concept plaatst — nooit verstuurt.
      v_resolved_action := 'send';
      v_resolved_kind   := 'reply';
      v_chosen_idx      := COALESCE((v_eff_payload->>'variant_index')::int, v_mail.selected_variant_index, 0);

    WHEN 'forward' THEN
      v_resolved_action := 'send';
      v_resolved_kind   := 'forward';
      v_final_to        := ARRAY[
        COALESCE(v_eff_payload->>'to', v_act.target_value)
      ]::text[];

    WHEN 'file' THEN
      v_resolved_action := 'ignore';
      v_resolved_kind   := 'reply';
      v_target_folder   := COALESCE(
        v_eff_payload->>'target_folder',
        v_act.target_value,
        v_mail.target_folder,
        'Archive'
      );

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
        'ok', false,
        'outcome', 'accept',
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
    v_dec.mail_id,
    v_resolved_action,
    COALESCE(v_resolved_kind, 'reply'),
    v_target_folder,
    v_final_to,
    v_chosen_idx,
    v_mail.draft_subject,
    v_mail.draft_body,
    now(),
    'action_card',
    'pending'
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
    'ok', true,
    'outcome', 'accept',
    'autodraft_decision_id', v_decision_id_new,
    'category', v_act.category,
    'action_slug', v_act.slug,
    'resolved_action', v_resolved_action,
    'target_folder', v_target_folder
  );
END $function$;

-- submit_jellemind_decision(p_proposal_id uuid, p_action text, p_amendment text, p_reason text, p_lesson_text_override text, p_applies_to_override text[], p_mind_scope_override text)
CREATE OR REPLACE FUNCTION public.submit_jellemind_decision(p_proposal_id uuid, p_action text, p_amendment text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_lesson_text_override text DEFAULT NULL::text, p_applies_to_override text[] DEFAULT NULL::text[], p_mind_scope_override text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal record;
  v_new_lesson_id uuid;
  v_final_text text;
  v_final_applies_to text[];
  v_final_scope text;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_action NOT IN ('accept','reject','amend') THEN
    RAISE EXCEPTION 'invalid action: %', p_action USING ERRCODE = '22023';
  END IF;

  IF p_mind_scope_override IS NOT NULL
     AND p_mind_scope_override NOT IN ('jelle','skill','legalmind') THEN
    RAISE EXCEPTION 'invalid mind_scope: %', p_mind_scope_override USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_proposal
    FROM public.jellemind_lesson_proposals
   WHERE id = p_proposal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal not found: %', p_proposal_id USING ERRCODE = '22023';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal already reviewed: status=%', v_proposal.status USING ERRCODE = '22023';
  END IF;

  IF p_action = 'accept' THEN
    v_final_text := COALESCE(p_lesson_text_override, v_proposal.lesson_text);
    v_final_applies_to := COALESCE(p_applies_to_override, v_proposal.applies_to);
    v_final_scope := COALESCE(p_mind_scope_override, v_proposal.mind_scope);

    INSERT INTO public.jellemind_lessons (
      lesson_text, lesson_type, applies_to, evidence_summary, created_from_proposal_id, mind_scope
    ) VALUES (
      v_final_text, v_proposal.lesson_type, v_final_applies_to,
      v_proposal.evidence_summary, v_proposal.id, v_final_scope
    )
    RETURNING id INTO v_new_lesson_id;

    UPDATE public.jellemind_lesson_proposals
       SET status = 'accepted',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           resulting_lesson_id = v_new_lesson_id
     WHERE id = p_proposal_id;

    UPDATE public.jellemind_signals
       SET processed = true, processed_at = now()
     WHERE id = ANY (v_proposal.signal_ids) AND processed = false;

    RETURN jsonb_build_object(
      'ok', true, 'action', 'accept',
      'proposal_id', p_proposal_id,
      'lesson_id', v_new_lesson_id,
      'mind_scope', v_final_scope
    );

  ELSIF p_action = 'reject' THEN
    UPDATE public.jellemind_lesson_proposals
       SET status = 'rejected',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           review_reason = p_reason
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object('ok', true, 'action', 'reject', 'proposal_id', p_proposal_id);

  ELSE  -- amend
    IF p_amendment IS NULL OR length(trim(p_amendment)) = 0 THEN
      RAISE EXCEPTION 'amend requires amendment text' USING ERRCODE = '22023';
    END IF;

    UPDATE public.jellemind_lesson_proposals
       SET status = 'amended',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           amend_instructions = p_amendment
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object('ok', true, 'action', 'amend', 'proposal_id', p_proposal_id);
  END IF;
END;
$function$;

-- submit_km_trip(p_datum date, p_van text, p_naar text, p_doel text, p_parkeerkosten numeric, p_raw_text text)
CREATE OR REPLACE FUNCTION public.submit_km_trip(p_datum date, p_van text, p_naar text, p_doel text DEFAULT NULL::text, p_parkeerkosten numeric DEFAULT NULL::numeric, p_raw_text text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'datum verplicht';
  END IF;
  IF (p_van IS NULL OR length(trim(p_van)) = 0) AND (p_raw_text IS NULL OR length(trim(p_raw_text)) = 0) THEN
    RAISE EXCEPTION 'van of raw_text verplicht';
  END IF;
  INSERT INTO public.km_trips_inbox (datum, van, naar, doel, parkeerkosten, raw_text, source)
  VALUES (
    p_datum,
    NULLIF(trim(coalesce(p_van,'')), ''),
    NULLIF(trim(coalesce(p_naar,'')), ''),
    NULLIF(trim(coalesce(p_doel,'')), ''),
    p_parkeerkosten,
    NULLIF(trim(coalesce(p_raw_text,'')), ''),
    'dashboard'
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- submit_sales_on_road_note(p_text text)
CREATE OR REPLACE FUNCTION public.submit_sales_on_road_note(p_text text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_text IS NULL OR length(trim(p_text)) = 0 THEN
    RAISE EXCEPTION 'note tekst is leeg';
  END IF;
  INSERT INTO public.sales_on_road_inbox (raw_text, source)
  VALUES (trim(p_text), 'dashboard')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- submit_style_iteration_decision(p_proposal_id uuid, p_action text, p_accepted_value jsonb, p_amend_instructions text, p_decided_by uuid)
CREATE OR REPLACE FUNCTION public.submit_style_iteration_decision(p_proposal_id uuid, p_action text, p_accepted_value jsonb DEFAULT NULL::jsonb, p_amend_instructions text DEFAULT NULL::text, p_decided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prop        public.style_iteration_proposals%ROWTYPE;
  v_value       jsonb;
  v_before      jsonb;
  v_col         text;
  v_new_id      uuid;
  v_profile_cols text[] := ARRAY['core_identity','greetings','closings','tone_per_context','structure',
                                 'language_patterns','length_patterns','never_do','signature_variations',
                                 'audience_tone_matrix','category_style_hints'];
  v_contact_cols text[] := ARRAY['display_name','relationship_type','tone','preferred_greetings',
                                 'preferred_closings','emoji_ok','quirks','notes'];
  v_target_table text;
  v_target_id    uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  SELECT * INTO v_prop FROM public.style_iteration_proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_found', 'proposal_id', p_proposal_id);
  END IF;

  IF v_prop.status NOT IN ('pending','amended') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'proposal_not_actionable',
                              'current_status', v_prop.status);
  END IF;

  -- REJECT
  IF p_action = 'reject' THEN
    UPDATE public.style_iteration_proposals
       SET status='rejected', decided_at=now(), decided_by=p_decided_by
     WHERE id = p_proposal_id;
    RETURN jsonb_build_object('ok', true, 'action','reject', 'proposal_id', p_proposal_id);
  END IF;

  -- AMEND (skill re-emit volgende run)
  IF p_action = 'amend' THEN
    UPDATE public.style_iteration_proposals
       SET status='amended', amend_instructions=p_amend_instructions,
           decided_at=now(), decided_by=p_decided_by
     WHERE id = p_proposal_id;
    RETURN jsonb_build_object('ok', true, 'action','amend', 'proposal_id', p_proposal_id);
  END IF;

  IF p_action <> 'accept' THEN
    RETURN jsonb_build_object('ok', false, 'error','unknown_action', 'action', p_action);
  END IF;

  -- ACCEPT — bepaal effectieve waarde
  v_value := COALESCE(p_accepted_value, v_prop.proposed_value);

  IF v_prop.iteration_type = 'profile_field' THEN
    v_col := v_prop.field_path;
    IF NOT (v_col = ANY(v_profile_cols)) THEN
      RETURN jsonb_build_object('ok', false, 'error','field_not_whitelisted','field_path', v_col);
    END IF;
    v_target_table := 'style_profiles';
    SELECT id INTO v_target_id FROM public.style_profiles WHERE user_id = v_prop.user_id;
    IF v_target_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error','no_profile_for_user','user_id', v_prop.user_id);
    END IF;
    -- before-state
    EXECUTE format('SELECT to_jsonb(%I) FROM public.style_profiles WHERE id = $1', v_col)
      INTO v_before USING v_target_id;
    -- apply: text-kolom (core_identity) krijgt scalar text, rest krijgt jsonb
    IF v_col = 'core_identity' THEN
      EXECUTE 'UPDATE public.style_profiles SET core_identity = $1 WHERE id = $2'
        USING (v_value #>> '{}'), v_target_id;
    ELSE
      EXECUTE format('UPDATE public.style_profiles SET %I = $1 WHERE id = $2', v_col)
        USING v_value, v_target_id;
    END IF;
    UPDATE public.style_profiles SET last_iterated_at=now(), iterated_by='draft-style' WHERE id = v_target_id;

  ELSIF v_prop.iteration_type = 'contact_profile' THEN
    v_col := v_prop.field_path;
    IF NOT (v_col = ANY(v_contact_cols)) THEN
      RETURN jsonb_build_object('ok', false, 'error','field_not_whitelisted','field_path', v_col);
    END IF;
    v_target_table := 'style_contact_profiles';
    v_target_id := v_prop.target_id;
    IF v_target_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.style_contact_profiles WHERE id = v_target_id) THEN
      RETURN jsonb_build_object('ok', false, 'error','contact_profile_not_found','target_id', v_target_id);
    END IF;
    EXECUTE format('SELECT to_jsonb(%I) FROM public.style_contact_profiles WHERE id = $1', v_col)
      INTO v_before USING v_target_id;
    -- text[] kolommen vs scalar vs jsonb
    IF v_col IN ('preferred_greetings','preferred_closings') THEN
      EXECUTE format('UPDATE public.style_contact_profiles SET %I = $1 WHERE id = $2', v_col)
        USING ARRAY(SELECT jsonb_array_elements_text(v_value)), v_target_id;
    ELSIF v_col = 'emoji_ok' THEN
      EXECUTE 'UPDATE public.style_contact_profiles SET emoji_ok = $1 WHERE id = $2'
        USING (v_value #>> '{}')::boolean, v_target_id;
    ELSIF v_col IN ('quirks') THEN
      EXECUTE 'UPDATE public.style_contact_profiles SET quirks = $1 WHERE id = $2'
        USING v_value, v_target_id;
    ELSE  -- display_name, relationship_type, tone, notes (text)
      EXECUTE format('UPDATE public.style_contact_profiles SET %I = $1 WHERE id = $2', v_col)
        USING (v_value #>> '{}'), v_target_id;
    END IF;
    UPDATE public.style_contact_profiles SET last_iterated_at=now() WHERE id = v_target_id;

  ELSIF v_prop.iteration_type = 'new_contact' THEN
    -- proposed_value moet user_id/scope_type/scope_value + velden bevatten
    v_target_table := 'style_contact_profiles';
    INSERT INTO public.style_contact_profiles (
      user_id, scope_type, scope_value, display_name, relationship_type, tone,
      preferred_greetings, preferred_closings, emoji_ok, quirks, notes,
      mail_count, auto_generated, source, last_iterated_at
    )
    SELECT
      v_prop.user_id,
      v_value->>'scope_type',
      lower(v_value->>'scope_value'),
      v_value->>'display_name',
      v_value->>'relationship_type',
      v_value->>'tone',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_value->'preferred_greetings')), '{}'),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_value->'preferred_closings')), '{}'),
      CASE WHEN v_value ? 'emoji_ok' THEN (v_value->>'emoji_ok')::boolean ELSE NULL END,
      COALESCE(v_value->'quirks', '{}'::jsonb),
      v_value->>'notes',
      CASE WHEN v_value ? 'mail_count' THEN (v_value->>'mail_count')::int ELSE NULL END,
      true,
      'draft-style:iterate',
      now()
    ON CONFLICT (user_id, scope_type, scope_value) DO NOTHING
    RETURNING id INTO v_new_id;
    v_target_id := v_new_id;
    v_before := NULL;

  ELSIF v_prop.iteration_type = 'category_style' THEN
    -- merge in style_profiles.category_style_hints (field_path = category_key)
    v_target_table := 'style_profiles';
    SELECT id, category_style_hints INTO v_target_id, v_before
      FROM public.style_profiles WHERE user_id = v_prop.user_id;
    IF v_target_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error','no_profile_for_user');
    END IF;
    UPDATE public.style_profiles
       SET category_style_hints = category_style_hints || jsonb_build_object(v_prop.field_path, v_value),
           last_iterated_at = now(), iterated_by='draft-style'
     WHERE id = v_target_id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'error','iteration_type_unsupported_in_v1',
                              'iteration_type', v_prop.iteration_type);
  END IF;

  -- audit
  INSERT INTO public.style_iterations (
    user_id, run_id, iteration_type, target_table, target_id,
    before_state, after_state, summary
  ) VALUES (
    v_prop.user_id, v_prop.run_id,
    CASE v_prop.iteration_type
      WHEN 'profile_field'   THEN 'profile'
      WHEN 'category_style'  THEN 'category_hint'
      WHEN 'contact_profile' THEN 'contact'
      WHEN 'new_contact'     THEN 'contact'
      ELSE 'profile'
    END,
    v_target_table, v_target_id,
    v_before, v_value,
    'Accepted proposal '||p_proposal_id::text||' ('||v_prop.iteration_type||
      COALESCE(' / '||v_prop.field_path,'')||')'
  );

  UPDATE public.style_iteration_proposals
     SET status='executed', decided_at=now(), decided_by=p_decided_by, accepted_value=v_value
   WHERE id = p_proposal_id;

  RETURN jsonb_build_object(
    'ok', true, 'action','accept', 'proposal_id', p_proposal_id,
    'iteration_type', v_prop.iteration_type, 'target_table', v_target_table,
    'target_id', v_target_id, 'applied', true
  );
END;
$function$;

-- sync_contactpersonen_full()
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
  perform public.assert_can_manage_dashboard();
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

-- upsert_hubspot_pipeline(p_pipeline_id text, p_label text, p_purpose text, p_stages jsonb, p_sort_order integer, p_is_active boolean, p_updated_by text)
CREATE OR REPLACE FUNCTION public.upsert_hubspot_pipeline(p_pipeline_id text, p_label text, p_purpose text, p_stages jsonb, p_sort_order integer DEFAULT NULL::integer, p_is_active boolean DEFAULT NULL::boolean, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_pipeline_id IS NULL OR length(trim(p_pipeline_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_pipeline_id');
  END IF;
  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_label');
  END IF;

  INSERT INTO public.hubspot_pipelines (pipeline_id, label, purpose, stages, sort_order, is_active, updated_by)
  VALUES (trim(p_pipeline_id), trim(p_label), p_purpose,
          COALESCE(p_stages, '[]'::jsonb),
          COALESCE(p_sort_order, 100),
          COALESCE(p_is_active, true),
          p_updated_by)
  ON CONFLICT (pipeline_id) DO UPDATE
    SET label      = EXCLUDED.label,
        purpose    = EXCLUDED.purpose,
        stages     = EXCLUDED.stages,
        sort_order = COALESCE(p_sort_order, hubspot_pipelines.sort_order),
        is_active  = COALESCE(p_is_active, hubspot_pipelines.is_active),
        updated_by = EXCLUDED.updated_by,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'pipeline_id', trim(p_pipeline_id));
END;
$function$;

-- upsert_terminology(p_id uuid, p_incorrect text, p_correct text, p_category text, p_notes text, p_case_sensitive boolean, p_is_active boolean, p_updated_by text)
CREATE OR REPLACE FUNCTION public.upsert_terminology(p_id uuid, p_incorrect text, p_correct text, p_category text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_case_sensitive boolean DEFAULT NULL::boolean, p_is_active boolean DEFAULT NULL::boolean, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result_id uuid;
BEGIN
  perform public.assert_can_manage_dashboard();
  IF p_incorrect IS NULL OR length(trim(p_incorrect)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_incorrect');
  END IF;
  IF p_correct IS NULL OR length(trim(p_correct)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_correct');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE public.terminology_corrections
       SET incorrect      = trim(p_incorrect),
           correct        = trim(p_correct),
           category       = p_category,
           notes          = p_notes,
           case_sensitive = COALESCE(p_case_sensitive, case_sensitive),
           is_active      = COALESCE(p_is_active, is_active),
           updated_by     = p_updated_by
     WHERE id = p_id
     RETURNING id INTO result_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
  ELSE
    -- Insert; dedupe op incorrect-term (case-insensitive).
    INSERT INTO public.terminology_corrections
      (incorrect, correct, category, notes, case_sensitive, is_active, updated_by)
    VALUES (trim(p_incorrect), trim(p_correct), p_category, p_notes,
            COALESCE(p_case_sensitive, false),
            COALESCE(p_is_active, true),
            p_updated_by)
    ON CONFLICT (incorrect) DO UPDATE
      SET correct        = EXCLUDED.correct,
          category       = EXCLUDED.category,
          notes          = EXCLUDED.notes,
          case_sensitive = EXCLUDED.case_sensitive,
          is_active      = EXCLUDED.is_active,
          updated_by     = EXCLUDED.updated_by,
          updated_at     = now()
    RETURNING id INTO result_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', result_id);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 4. Vangnet: elke geguarde functie moet de helper daadwerkelijk aanroepen.
-- -----------------------------------------------------------------------------
do $verify$
declare
  n int;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname = 'set_secret_value'
    and p.prosrc like '%assert_can_manage_dashboard%';
  if n <> 1 then
    raise exception 'Migratie C: set_secret_value heeft geen caller-guard';
  end if;
end;
$verify$;

commit;
