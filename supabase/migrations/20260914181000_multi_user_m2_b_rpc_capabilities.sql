-- =============================================================================
-- Multi-user M2 · b — de RPC's en policies die het recht echt lezen
-- =============================================================================
-- Hoort bij migratie a (capability_gate / assert_capability) en bij de matrix
-- uit RESEARCH-MULTI-USER.md §3.3. P0 zette de poort neer; hier gaat hij aan.
--
-- ── Acht RPC's ──────────────────────────────────────────────────────────────
--
-- Zes agent-RPC's lezen nu `agent.uitvoeren`, één `agent.instructies` en
-- `list_users_for_admin` leest `organisatie.gebruikers`. Dat zijn precies de
-- drie rechten die de matrix in de kolom "Afdwingen in" met *RPC-poort* had
-- staan; tot nu toe stond daar een belofte.
--
-- De definities zijn NIET overgetypt. Ze komen letterlijk uit
-- `pg_get_functiondef()` van prod, met per functie precies één vervangen regel
-- ($CLAUDE_JOB_DIR/tmp/gen_b.py, dat afbreekt als de guard-regel niet exact één
-- keer voorkomt). `CREATE OR REPLACE`, nergens een `DROP FUNCTION` — die zou de
-- ACL weggooien en een kale CREATE geeft PUBLIC zijn EXECUTE terug (geheugen
-- `drop-function-verliest-proacl` en `bare-create-function-grants-public`).
--
-- ── Vijf policies, erbij en niet erover ─────────────────────────────────────
--
-- De bestaande `is_admin_or_higher()`-policies blijven ongemoeid staan. Er komt
-- een tweede, permissieve SELECT-policy naast; permissieve policies worden ge-OR'd.
-- Dat is de goedkoopste manier om te garanderen dat de owner na deze migratie
-- evenveel of meer ziet (M6): zijn pad is letterlijk niet aangeraakt.
--
-- `(select public.capability_gate(...))` met de subselect eromheen is geen
-- opmaak: zo wordt de functie één keer als InitPlan uitgevoerd in plaats van
-- per rij. De bestaande policies doen het om dezelfde reden.
--
-- ── Wat hier bewust NIET in zit ─────────────────────────────────────────────
--
-- De CRM-spiegel (`hubspot_deals` / `-companies` / `-contacts`) blijft op
-- `is_admin_or_higher()`. `administratie` en `data.crm.lezen` zitten wél in de
-- member-preset (beslissing 2), dus dat vinkje levert nog steeds niets — met
-- `levert_vandaag = false` erbij, dus het liegt er ook niet over. Drie eerdere
-- notities noemen die omzetting een eigen bewuste stap, en het is de enige
-- wijziging die de hoofdassertie van de ACL-poort (M4: "member ziet niets van
-- de gedeelde wereld") omdraait. De migratie ervoor staat kant-en-klaar in
-- M2-IMPL-NOTES.md §"De ene knop die ik niet heb omgezet".
-- =============================================================================

begin;

-- ── 1. De acht RPC's ────────────────────────────────────────────────────────

-- request_run_now(agent text) → agent.uitvoeren
CREATE OR REPLACE FUNCTION public.request_run_now(agent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  row_rec record;
BEGIN
  PERFORM public.assert_capability('agent.uitvoeren');
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
$function$;

-- set_agent_status(p_agent_name text, p_status text) → agent.uitvoeren
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
  PERFORM public.assert_capability('agent.uitvoeren');
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
$function$;

-- set_agent_overview_visibility(p_agent_name text, p_visible boolean) → agent.uitvoeren
CREATE OR REPLACE FUNCTION public.set_agent_overview_visibility(p_agent_name text, p_visible boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existed boolean;
BEGIN
  PERFORM public.assert_capability('agent.uitvoeren');
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
$function$;

-- update_agent_schedule(p_agent_name text, p_enabled boolean, p_cron_expression text, p_timeout_minutes integer, p_updated_by text) → agent.uitvoeren
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
  PERFORM public.assert_capability('agent.uitvoeren');
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
$function$;

-- trigger_autodraft_scan() → agent.uitvoeren
CREATE OR REPLACE FUNCTION public.trigger_autodraft_scan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_capability('agent.uitvoeren');
  update agent_schedules
     set manual_run_requested_at = now()
   where agent_name = 'auto-draft' and enabled = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'schedule_not_found_or_disabled');
  end if;
  return jsonb_build_object('ok', true, 'requested_at', now());
end;
$function$;

-- trigger_autodraft_execute() → agent.uitvoeren
CREATE OR REPLACE FUNCTION public.trigger_autodraft_execute()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_capability('agent.uitvoeren');
  update agent_schedules
     set manual_run_requested_at = now()
   where agent_name = 'auto-draft-execute' and enabled = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'schedule_not_found_or_disabled');
  end if;
  return jsonb_build_object('ok', true, 'requested_at', now());
end;
$function$;

-- upsert_agent_instructions(p_agent_name text, p_instructions text, p_updated_by text) → agent.instructies
CREATE OR REPLACE FUNCTION public.upsert_agent_instructions(p_agent_name text, p_instructions text, p_updated_by text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_capability('agent.instructies');
  IF p_agent_name IS NULL OR length(trim(p_agent_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_agent_name');
  END IF;
  INSERT INTO public.agent_config (agent_name, config_key, config_value)
  VALUES (trim(p_agent_name), 'custom_instructions',
    jsonb_build_object('text', COALESCE(p_instructions, ''),
                       'updated_by', p_updated_by, 'updated_at', now()::text))
  ON CONFLICT (agent_name, config_key) DO UPDATE
    SET config_value = jsonb_build_object('text', COALESCE(p_instructions, ''),
                                          'updated_by', p_updated_by, 'updated_at', now()::text),
        updated_at = now();
  RETURN jsonb_build_object('ok', true, 'agent_name', trim(p_agent_name));
END;
$function$;

-- list_users_for_admin() → organisatie.gebruikers
CREATE OR REPLACE FUNCTION public.list_users_for_admin()
 RETURNS TABLE(user_id uuid, email text, app_role text, display_name text, last_sign_in_at timestamp with time zone, created_at timestamp with time zone, email_confirmed_at timestamp with time zone, banned_until timestamp with time zone, active_sessions_count integer, last_active_at timestamp with time zone, tool_sessions_count integer, invite_sent_at timestamp with time zone, invite_deferred boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if not public.capability_gate('organisatie.gebruikers') then
    raise exception 'forbidden: admin role required';
  end if;
  return query
  select
    au.id::uuid as user_id,
    au.email::text,
    coalesce(ur.app_role, 'member')::text as app_role,
    ur.display_name::text,
    -- Blijft staan, maar is geen bewijs van gebruik: ook een geminte JWT zet
    -- hem. De UI toont hem alleen als ruwe datum, nooit als "actief".
    au.last_sign_in_at,
    au.created_at,
    au.email_confirmed_at,
    au.banned_until,
    -- Zit er nu iemand? Een sessie van een echte client die binnen twee uur nog
    -- een token heeft opgehaald. `not_after` is NULL zonder session-timebox, en
    -- NULL > now() is NULL — vandaar de expliciete coalesce-tak.
    coalesce((
      select count(*)::int
        from auth.sessions s
       where s.user_id = au.id
         and (s.not_after is null or s.not_after > now())
         and (s.user_agent ilike 'Mozilla/%'
              or exists (select 1 from public.user_session_mfa m where m.session_id = s.id))
         and coalesce(s.refreshed_at at time zone 'UTC', s.created_at) > now() - interval '2 hours'
    ), 0) as active_sessions_count,
    -- Echte activiteit, drie positieve bewijzen. GREATEST negeert NULL, dus
    -- niets = NULL = nooit gebruikt.
    greatest(
      (select max(s.refreshed_at at time zone 'UTC') from auth.sessions s
        where s.user_id = au.id),
      (select max(s.created_at) from auth.sessions s
        where s.user_id = au.id and s.user_agent ilike 'Mozilla/%'),
      (select max(m.verified_at) from public.user_session_mfa m
        where m.user_id = au.id)
    ) as last_active_at,
    -- Hoeveel sessies op dit account komen van gereedschap in plaats van van een
    -- mens. Alleen om het te kunnen uitleggen; nooit om iets op te baseren.
    coalesce((
      select count(*)::int
        from auth.sessions s
       where s.user_id = au.id
         and s.user_agent is not null
         and s.user_agent not ilike 'Mozilla/%'
         and not exists (select 1 from public.user_session_mfa m where m.session_id = s.id)
    ), 0) as tool_sessions_count,
    ur.invite_sent_at,
    -- Tekst-vergelijking, geen ::boolean-cast: metadata is vrij veld en een
    -- rare waarde mag de hele lijst niet laten klappen.
    coalesce((au.raw_user_meta_data->>'invite_deferred') in ('true', 't', '1'), false) as invite_deferred
  from auth.users au
  left join public.user_roles ur on ur.user_id = au.id
  order by au.created_at asc;
end $function$;


-- ── 2. Vijf policies erbij ──────────────────────────────────────────────────

drop policy if exists security_findings_capability on public.security_findings;
create policy security_findings_capability on public.security_findings
  for select to authenticated
  using ((select public.capability_gate('organisatie.security')));

drop policy if exists agent_runs_capability on public.agent_runs;
create policy agent_runs_capability on public.agent_runs
  for select to authenticated
  using ((select public.capability_gate('organisatie.health')));

drop policy if exists agent_schedules_capability on public.agent_schedules;
create policy agent_schedules_capability on public.agent_schedules
  for select to authenticated
  using ((select public.capability_gate('organisatie.health')));

drop policy if exists app_skills_capability on public.app_skills;
create policy app_skills_capability on public.app_skills
  for select to authenticated
  using ((select public.capability_gate('organisatie.skills')));

drop policy if exists user_roles_capability on public.user_roles;
create policy user_roles_capability on public.user_roles
  for select to authenticated
  using ((select public.capability_gate('organisatie.gebruikers')));

comment on policy security_findings_capability on public.security_findings is
  'Multi-user M2 · naast security_findings_owner, niet eroverheen. Permissieve policies worden ge-OR''d, dus het owner-pad is letterlijk niet aangeraakt.';
comment on policy agent_runs_capability on public.agent_runs is
  'Multi-user M2 · voedt Health & Issues en Long running tasks voor een member met organisatie.health.';
comment on policy agent_schedules_capability on public.agent_schedules is
  'Multi-user M2 · idem.';
comment on policy app_skills_capability on public.app_skills is
  'Multi-user M2 · Organisatie › Skills. De bestaande app_skills_read met app_skills_visible() blijft staan: die is de per-user-zichtbaarheid, deze de portaaltoegang.';
comment on policy user_roles_capability on public.user_roles is
  'Multi-user M2 · Organisatie › Gebruikers voor een gedelegeerde. Schrijven blijft user_roles_owner_full (owner mét tweede factor).';

commit;
