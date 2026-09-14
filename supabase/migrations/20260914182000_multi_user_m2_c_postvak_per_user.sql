-- =============================================================================
-- Multi-user M2 · c — Postvak per persoon: de negen RPC's die P0 owner-only maakte
-- =============================================================================
-- Hoort bij P0-IMPL-NOTES.md §Restrisico 3 en bij beslissing 4 van 2026-09-14
-- ("iedereen een eigen inbox-koppeling").
--
-- ── Wat P0 hier deed, en waarom dat toen klopte ─────────────────────────────
--
-- `require_dashboard_auth()` betekende "ben je ingelogd" en dekte 49 functies.
-- P0 draaide hem op `can_manage_dashboard()`. Daarmee werden deze negen in één
-- klap owner-only: correct op dat moment (er was maar één mailbox, die van
-- Jelle), en onhoudbaar zodra er een tweede is. Zonder deze migratie kan een
-- member die zijn eigen Outlook koppelt wél mail gespiegeld krijgen maar er
-- niets mee doen — een Postvak dat alleen kan kijken.
--
-- ── De poort is de mail, niet de rol ────────────────────────────────────────
--
--   assert_autodraft_mail_access(mail_id, recht)
--     = can_manage_dashboard()                         -- intern / service / owner
--    OF de mail hoort bij jou én je hebt het recht én je tweede factor staat
--
-- `autodraft_mails.mail_id` heeft een UNIQUE index, dus "de mail hoort bij jou"
-- adresseert exact dezelfde rij als de `where mail_id = ...` die eronder volgt.
-- Zonder die unieke sleutel zou de controle over een andere rij kunnen gaan dan
-- de update — dat is nagekeken, niet aangenomen.
--
-- Twee rechten, want het zijn twee handelingen. Kiezen, herschrijven en een map
-- aanwijzen is `postvak`. Een besluit indienen dat een concept in Outlook zet of
-- een mail verplaatst is `mail.versturen` — die staat in de matrix als
-- "✓ eigen" en is dus precies hiervoor bedacht.
--
-- Een mail die niet bestaat geeft voor een member `forbidden` in plaats van
-- `mail_not_found`. Dat is met opzet: het bestaan van andermans mail is zelf
-- informatie. De owner krijgt `mail_not_found` zoals altijd, want die passeert
-- via de eerste arm.
--
-- ── De twee leesfuncties ────────────────────────────────────────────────────
--
-- `get_sender_actions` en `get_company_actions` zijn LANGUAGE sql en hebben geen
-- statement-plek; hun poort staat in de WHERE (P0 zette daar
-- `can_manage_dashboard()`, wat voor een member nul rijen gaf in plaats van een
-- fout — voor een leesfunctie het juiste gedrag). Er komt één arm bij: de
-- beslissingen op je eigen mail. De join op `mail_messages` draagt de
-- `user_id`, dus dat is één predicaat, geen extra join.
--
-- Bodies letterlijk uit `pg_get_functiondef()` van prod, per functie precies één
-- vervangen regel ($CLAUDE_JOB_DIR/tmp/gen_c.py breekt af bij ≠ 1 treffer).
-- `CREATE OR REPLACE`, geen `DROP FUNCTION` — geheugen
-- `drop-function-verliest-proacl`.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
-- De negen bodies van vóór deze migratie staan in de git-historie van
-- 20260914141000/20260914142000; `assert_autodraft_mail_access` droppen kan pas
-- daarna.
-- =============================================================================

begin;

-- ── 1. De poort ─────────────────────────────────────────────────────────────

create or replace function public.can_act_on_autodraft_mail(p_mail_id text, p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.can_manage_dashboard()
      or (public.has_capability(p_key)
          and public.session_mfa_ok()
          and exists (select 1 from public.autodraft_mails m
                       where m.mail_id = p_mail_id
                         and m.user_id = (select auth.uid())));
$$;

comment on function public.can_act_on_autodraft_mail(text, text) is
  'Mag deze aanroeper iets met deze mail? Owner/intern/service_role altijd; een member alleen op zijn eigen rij, met het gevraagde recht en zijn tweede factor. Multi-user M2.';

create or replace function public.assert_autodraft_mail_access(p_mail_id text, p_key text)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if not public.can_act_on_autodraft_mail(p_mail_id, p_key) then
    raise exception 'forbidden: deze mail is niet van jou, of het recht % ontbreekt', p_key
      using errcode = 'insufficient_privilege',
            hint    = 'een member handelt alleen zijn eigen Postvak af';
  end if;
end;
$$;

comment on function public.assert_autodraft_mail_access(text, text) is
  'Raise-variant van can_act_on_autodraft_mail(). Een niet-bestaande mail geeft voor een member forbidden en niet mail_not_found: het bestaan van andermans mail is zelf informatie. Multi-user M2.';

revoke execute on function public.can_act_on_autodraft_mail(text, text) from public;
revoke execute on function public.assert_autodraft_mail_access(text, text) from public;
grant  execute on function public.can_act_on_autodraft_mail(text, text) to authenticated, service_role;
grant  execute on function public.assert_autodraft_mail_access(text, text) to authenticated, service_role;

-- ── 2. De negen ─────────────────────────────────────────────────────────────

-- submit_autodraft_decision(p_mail_id text, p_action text, p_amend text, p_final_subject text, p_final_body text, p_target_folder text, p_decision_kind text, p_final_to text[], p_chosen_variant_index integer, p_chosen_variant_label text)
CREATE OR REPLACE FUNCTION public.submit_autodraft_decision(p_mail_id text, p_action text, p_amend text, p_final_subject text, p_final_body text, p_target_folder text, p_decision_kind text DEFAULT 'reply'::text, p_final_to text[] DEFAULT NULL::text[], p_chosen_variant_index integer DEFAULT NULL::integer, p_chosen_variant_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mail        autodraft_mails%rowtype;
  v_decision_id uuid;
  v_new_status  text;
BEGIN
  PERFORM public.assert_autodraft_mail_access(p_mail_id, 'mail.versturen');

  IF p_mail_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mail_id_required');
  END IF;
  IF p_action NOT IN ('send','ignore','amend','spam') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;
  IF coalesce(p_decision_kind,'reply') NOT IN ('reply','forward') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision_kind');
  END IF;
  IF p_decision_kind = 'forward' AND (p_final_to IS NULL OR array_length(p_final_to,1) IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forward_requires_final_to');
  END IF;

  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id = p_mail_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mail_not_found');
  END IF;
  IF v_mail.status IN ('sent','ignored','stale') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_'||v_mail.status);
  END IF;
  IF p_action = 'amend' AND (p_amend IS NULL OR length(trim(p_amend)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amend_instructions_required');
  END IF;

  v_new_status := CASE p_action
    WHEN 'send'   THEN 'queued_send'
    WHEN 'ignore' THEN 'queued_ignore'
    WHEN 'amend'  THEN 'queued_amend'
    WHEN 'spam'   THEN 'queued_spam'
  END;

  INSERT INTO autodraft_decisions
    (mail_id, action, amend_instructions, final_subject, final_body, target_folder,
     source_draft_body, source_draft_subject, decision_kind, final_to,
     chosen_variant_index, chosen_variant_label)
  VALUES
    (p_mail_id, p_action, p_amend, p_final_subject, p_final_body,
     coalesce(p_target_folder, v_mail.target_folder),
     v_mail.draft_body, v_mail.draft_subject,
     coalesce(p_decision_kind,'reply'), p_final_to,
     p_chosen_variant_index, p_chosen_variant_label)
  RETURNING id INTO v_decision_id;

  UPDATE autodraft_mails
     SET status = v_new_status,
         target_folder = coalesce(p_target_folder, target_folder)
   WHERE mail_id = p_mail_id;

  IF p_action = 'spam' THEN
    UPDATE mail_messages SET flagged_as_spam = true WHERE id = p_mail_id;
  END IF;

  UPDATE agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'auto-draft-execute' AND enabled = true;

  RETURN jsonb_build_object(
    'ok', true,
    'decision_id', v_decision_id,
    'status', v_new_status,
    'kind', coalesce(p_decision_kind,'reply')
  );
END;
$function$;

-- autodraft_rewrite_request(p_mail_id text, p_prompt text)
CREATE OR REPLACE FUNCTION public.autodraft_rewrite_request(p_mail_id text, p_prompt text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cron text;
  v_req_id bigint;
BEGIN
  PERFORM public.assert_autodraft_mail_access(p_mail_id, 'postvak');
  IF p_mail_id IS NULL OR length(trim(p_mail_id)) = 0 THEN
    RAISE EXCEPTION 'mail_id_required';
  END IF;
  IF p_prompt IS NULL OR length(trim(p_prompt)) < 2 THEN
    RAISE EXCEPTION 'prompt_required';
  END IF;
  v_cron := (SELECT decrypted_secret FROM vault.decrypted_secrets
             WHERE name = 'skill:global:cron_secret' LIMIT 1);
  IF v_cron IS NULL THEN
    RAISE EXCEPTION 'cron_secret_missing_from_vault';
  END IF;
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/autodraft-rewrite-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_cron,
      'x-trigger-source', 'frontend-sync'
    ),
    body := jsonb_build_object(
      'mail_id', p_mail_id,
      'prompt', p_prompt
    ),
    timeout_milliseconds := 60000
  ) INTO v_req_id;
  RETURN v_req_id;
END;
$function$;

-- reset_autodraft_mail_to_pending(p_mail_id text)
CREATE OR REPLACE FUNCTION public.reset_autodraft_mail_to_pending(p_mail_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_autodraft_mail_access(p_mail_id, 'postvak');
  update autodraft_mails
     set status = 'pending'
   where mail_id = p_mail_id
     and status in ('queued_send','queued_ignore','queued_amend','failed','amended');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_reset_needed_or_not_found');
  end if;
  -- Markeer onverwerkte decisions als skipped zodat execute ze niet alsnog oppakt
  update autodraft_decisions
     set execution_status = 'skipped', execution_error = 'reset_to_pending_by_user'
   where mail_id = p_mail_id and execution_status = 'pending';
  return jsonb_build_object('ok', true);
end;
$function$;

-- set_autodraft_mail_category(p_mail_id text, p_category_key text)
CREATE OR REPLACE FUNCTION public.set_autodraft_mail_category(p_mail_id text, p_category_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_autodraft_mail_access(p_mail_id, 'postvak');
  if p_mail_id is null then
    return jsonb_build_object('ok', false, 'reason', 'mail_id_required');
  end if;
  -- Altijd persisteren als override (werkt ook voor uitgaande/awaiting mails
  -- zonder autodraft_mails-row).
  insert into public.autodraft_mail_category_overrides (mail_id, category_key, updated_at)
    values (p_mail_id, p_category_key, now())
  on conflict (mail_id) do update
    set category_key = excluded.category_key, updated_at = now();
  -- Houd autodraft_mails in sync als die row bestaat (bestaande gedrag).
  update public.autodraft_mails set category_key = p_category_key where mail_id = p_mail_id;
  return jsonb_build_object('ok', true);
end;
$function$;

-- set_autodraft_variant(p_mail_id text, p_variant_index integer)
CREATE OR REPLACE FUNCTION public.set_autodraft_variant(p_mail_id text, p_variant_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mail autodraft_mails%rowtype;
  v_variant jsonb;
begin
  perform public.assert_autodraft_mail_access(p_mail_id, 'postvak');
  select * into v_mail from autodraft_mails where mail_id = p_mail_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if v_mail.draft_variants is null or jsonb_array_length(v_mail.draft_variants) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_variants');
  end if;
  if p_variant_index < 0 or p_variant_index >= jsonb_array_length(v_mail.draft_variants) then
    return jsonb_build_object('ok', false, 'reason', 'index_out_of_range');
  end if;

  v_variant := v_mail.draft_variants -> p_variant_index;

  update autodraft_mails
     set selected_variant_index = p_variant_index,
         draft_subject = v_variant ->> 'subject',
         draft_body    = v_variant ->> 'body',
         updated_at = now()
   where mail_id = p_mail_id;

  return jsonb_build_object('ok', true, 'variant_index', p_variant_index);
end;
$function$;

-- set_autodraft_target_folder(p_mail_id text, p_target_folder text)
CREATE OR REPLACE FUNCTION public.set_autodraft_target_folder(p_mail_id text, p_target_folder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_autodraft_mail_access(p_mail_id, 'postvak');
  update autodraft_mails set target_folder = p_target_folder where mail_id = p_mail_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'mail_not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$function$;

-- bulk_skip_autodraft_mails(p_mail_ids text[], p_target_folder text)
CREATE OR REPLACE FUNCTION public.bulk_skip_autodraft_mails(p_mail_ids text[], p_target_folder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int := 0; v_id text; v_res jsonb;
begin
  perform public.assert_capability('mail.versturen');
  if p_mail_ids is null or array_length(p_mail_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_mail_ids');
  end if;
  foreach v_id in array p_mail_ids loop
    v_res := public.submit_autodraft_decision(v_id, 'ignore', null, null, null, p_target_folder);
    if v_res ->> 'ok' = 'true' then v_count := v_count + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'queued', v_count);
end;
$function$;

-- get_sender_actions(p_from_email text, p_lookback_days integer)
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
  WHERE  (public.can_manage_dashboard()
          OR (m.user_id = (select auth.uid()) and public.session_mfa_ok()))
    AND  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  lower(m.from_email) = lower(p_from_email)
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT 100;
$function$;

-- get_company_actions(p_hubspot_company_id text, p_lookback_days integer)
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
  WHERE  (public.can_manage_dashboard()
          OR (m.user_id = (select auth.uid()) and public.session_mfa_ok()))
    AND  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT 200;
$function$;


-- ── 3. Het spiegelstatus-venster per persoon ────────────────────────────────
--
-- `v_mailbox_link_status` (migratie h) zegt óf er een koppeling is. Wat een
-- Postvak-pagina daarnaast moet weten om "leeg" van "geen recht" te kunnen
-- onderscheiden (RESEARCH §4.2), is of er al iets gespiegeld ís. Zonder dat
-- getal leest een lege lijst als "geen mail" terwijl hij "de eerste sync loopt
-- nog" betekent — en dat is precies het onderscheid dat deze hele PR maakt.

create or replace function public.my_mailbox_state()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select jsonb_build_object(
    'user_id',        (select auth.uid()),
    'mag_postvak',    public.has_capability('postvak'),
    'gekoppeld',      exists (select 1 from public.mail_accounts a
                               where a.user_id = (select auth.uid())
                                 and a.mailbox_email is not null),
    'gepauzeerd',     coalesce((select a.paused from public.mail_accounts a
                                 where a.user_id = (select auth.uid()) limit 1), false),
    'heeft_fout',     coalesce((select a.last_error is not null from public.mail_accounts a
                                 where a.user_id = (select auth.uid()) limit 1), false),
    'laatste_sync',   (select max(a.last_sync_finished_at) from public.mail_accounts a
                        where a.user_id = (select auth.uid())),
    'mails_gespiegeld', (select count(*) from public.mail_messages m
                          where m.user_id = (select auth.uid()) and m.is_deleted = false)
  );
$$;

comment on function public.my_mailbox_state() is
  'Vier vlaggen plus het aantal gespiegelde mails voor de AANROEPER zelf — nooit voor een ander, want auth.uid() staat hard in elke arm. Voedt de drie toestanden die RESEARCH §4.2 eist: data, leeg, geen recht. Multi-user M2.';

revoke execute on function public.my_mailbox_state() from public;
grant  execute on function public.my_mailbox_state() to authenticated, service_role;

commit;
