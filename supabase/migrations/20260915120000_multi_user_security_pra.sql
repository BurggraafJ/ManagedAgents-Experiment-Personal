-- =============================================================================
-- Multi-user SECURITY PR-A — het vinkje vertelt de waarheid
-- =============================================================================
-- S1  has_capability(p_key, p_user) negeert p_user op het browserpad (anti-
--     impersonatie). Dat is goed voor handhaving; fout voor de doorkijk.
--     Nieuwe helper has_capability_for() ernaást, met owner-guard. De twee
--     call-sites (user_capabilities_overview, invite_readiness) gaan hierlangs.
--     has_capability() zelf blijft ongewijzigd.
--
-- S4  capabilities.levert_vandaag (+ afdwingen_in / toelichting) bijwerken voor
--     wat sinds M2 wél wordt afgedwongen: modellen.gebruiken (requirePaidUse in
--     zeven gedeployde bundels), organisatie.health (capability_gate-policy +
--     M9), mail.versturen (per-user-tak in negen RPC's). Plus de overige M2-
--     handhaving die nog op false stond (security/skills/gebruikers/agent.*/
--     instellingen.beheer). CRM-spiegel (S3) en opzoektabellen (S2) blijven
--     false — die zitten in PR-B / ASK.
--
-- S6  connectors.outlook_auth_config_id vastzetten (spiegel van confluence).
--     Bron: Composio auth_configs toolkit=outlook → ac_XaP4Sx1FYKXP; gelijk aan
--     de auth_config van de actieve org-connectie ca_SO3uHQpkDc-z.
--
-- Geen policy-wijziging. M4/M5/M6 kunnen per constructie niet omvallen.
-- CREATE OR REPLACE (geen DROP) — geheugen drop-function-verliest-proacl +
-- bare-create-function-grants-public. Grants expliciet hersteld + gemeten.
-- =============================================================================

begin;

-- ── S1 · has_capability_for ─────────────────────────────────────────────────

create or replace function public.has_capability_for(p_key text, p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  -- Alleen de owner mag namens een ander vragen. De anti-impersonatie-tak van
  -- has_capability() blijft staan voor handhaving; dit is de geguarde leesvariant.
  perform public.assert_can_manage_dashboard();

  if p_user is null then
    return false;
  end if;

  -- Zelfde rekenregel als has_capability(), maar altijd met p_user als uid —
  -- zonder de auth.role()-tak: die is hier al vervangen door de guard hierboven.
  return coalesce((
    with rol as (
      select r.app_role from public.user_roles r
       where r.user_id = p_user
    )
    select case
      when (select app_role from rol) is null then false
      when not c.grantable then (select app_role from rol) = 'owner'
      else coalesce(
        (select uc.effect = 'grant'
           from public.user_capabilities uc
          where uc.user_id = p_user and uc.capability = c.key),
        exists (select 1 from public.role_capabilities rc
                 where rc.app_role = (select app_role from rol)
                   and rc.capability = c.key))
    end
    from public.capabilities c
    where c.key = p_key
  ), false);
end;
$function$;

comment on function public.has_capability_for(text, uuid) is
  'Geguarde doorkijk: wat ziet deze persoon? Alleen can_manage_dashboard() mag vragen. Zelfde rekenregel als has_capability(), maar p_user telt altijd. has_capability() zelf blijft de anti-impersonatie-tak houden voor handhaving. Multi-user SECURITY PR-A (S1).';

revoke execute on function public.has_capability_for(text, uuid) from public, anon;
grant  execute on function public.has_capability_for(text, uuid) to authenticated, service_role;

-- Doorkijk-RPC: has_capability → has_capability_for. Guard was er al.
create or replace function public.user_capabilities_overview(p_user uuid)
returns table(capability text, soort text, groep text, label text,
              actief boolean, bron text, grantable boolean, levert_vandaag boolean,
              ui_bundle text, toelichting text, sort_order integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.assert_can_manage_dashboard();
  return query
    select c.key, c.soort, c.groep, c.label,
           public.has_capability_for(c.key, p_user) as actief,
           case
             when not c.grantable then 'vast'
             when exists (select 1 from public.user_capabilities uc
                           where uc.user_id = p_user and uc.capability = c.key)
               then 'persoonlijk'
             else 'rol'
           end as bron,
           c.grantable, c.levert_vandaag, c.ui_bundle, c.toelichting, c.sort_order
      from public.capabilities c
     order by c.sort_order;
end;
$function$;

comment on function public.user_capabilities_overview(uuid) is
  'Wat ziet deze persoon? Owner-only doorkijk, afgeleid via has_capability_for() zodat de browser-anti-impersonatie-tak van has_capability() de cijfers niet vervalst. Multi-user SECURITY PR-A (S1).';

revoke execute on function public.user_capabilities_overview(uuid) from public, anon;
grant  execute on function public.user_capabilities_overview(uuid) to authenticated, service_role;

-- invite_readiness: alleen de twee has_capability(c.key, p_user_id)-calls in het
-- persoon-blok → has_capability_for. De rest (poorten) blijft ongewijzigd.
create or replace function public.invite_readiness(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_poort_regex   text;
  v_pgvector      text;
  v_storage_regex text;
  v_views         int;
  v_rpcs          int;
  v_publiek       int;
  v_storage       int;
  v_poorten       jsonb;
  v_persoon       jsonb := null;
begin
  perform public.assert_capability('organisatie.gebruikers');

  select waarde into v_poort_regex   from public.acl_poort_config where soort = 'patroon' and naam = 'poort';
  select waarde into v_pgvector      from public.acl_poort_config where soort = 'patroon' and naam = 'pgvector';
  select waarde into v_storage_regex from public.acl_poort_config where soort = 'patroon' and naam = 'storage_poort';

  select count(*) into v_views
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('v', 'm')
     and has_table_privilege('authenticated', c.oid, 'SELECT')
     and coalesce((select o from unnest(c.reloptions) o where o like 'security_invoker%'), '')
         is distinct from 'security_invoker=on'
     and not exists (select 1 from public.acl_poort_config u
                      where u.soort = 'view' and u.naam = c.relname);

  select count(*) into v_rpcs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and coalesce(p.prosrc, '') !~* v_poort_regex
     and not exists (select 1 from public.acl_poort_config u
                      where u.soort = 'rpc' and u.naam = p.proname);

  select count(*) into v_publiek
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prorettype <> 'trigger'::regtype
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     and p.proname !~ v_pgvector
     and not exists (select 1 from public.acl_poort_config u
                      where u.soort = 'rpc' and u.naam = p.proname);

  select count(*) into v_storage
    from pg_policies p
   where p.schemaname = 'storage'
     and p.tablename = 'objects'
     and p.cmd in ('SELECT', 'ALL')
     and coalesce(p.qual, '') ~ 'bucket_id'
     and coalesce(p.qual, '') !~ v_storage_regex;

  v_poorten := jsonb_build_array(
    jsonb_build_object('sleutel', 'views_zonder_invoker', 'gemeten', v_views, 'norm', 0,
      'ok', v_views = 0, 'blokkerend', true,
      'uitleg', 'Views die als hun eigenaar draaien slaan de RLS van de tabel eronder over. Zolang er één zo''n view leesbaar is voor een ingelogde gebruiker, ziet een member daar alles in.'),
    jsonb_build_object('sleutel', 'rpcs_zonder_poort', 'gemeten', v_rpcs, 'norm', 0,
      'ok', v_rpcs = 0, 'blokkerend', true,
      'uitleg', 'SECURITY DEFINER draait als postgres; RLS beschermt daar niets. Een functie zonder poort die authenticated mag aanroepen, geeft elke member wat zij teruggeeft.'),
    jsonb_build_object('sleutel', 'execute_voor_publiek', 'gemeten', v_publiek, 'norm', 0,
      'ok', v_publiek = 0, 'blokkerend', true,
      'uitleg', 'EXECUTE voor PUBLIC erft ook anon. Een revoke op de rollen zelf haalt die grant niet weg.'),
    jsonb_build_object('sleutel', 'storage_alleen_bucket', 'gemeten', v_storage, 'norm', 0,
      'ok', v_storage = 0, 'blokkerend', true,
      'uitleg', 'Een storage-policy die alleen op bucket_id test geeft de hele bucket aan iedereen die ingelogd is.')
  );

  if p_user_id is not null then
    select jsonb_build_object(
             'user_id',    p_user_id,
             'rol',        coalesce(r.app_role, 'member'),
             'bestaat',    r.user_id is not null,
             'uitgenodigd_op', r.invite_sent_at,
             'rechten_actief', (select count(*) from public.capabilities c
                                 where public.has_capability_for(c.key, p_user_id)),
             'rechten_zonder_dekking', coalesce((
                select jsonb_agg(c.label order by c.sort_order)
                  from public.capabilities c
                 where public.has_capability_for(c.key, p_user_id)
                   and not c.levert_vandaag), '[]'::jsonb),
             'mailbox_gekoppeld', exists (select 1 from public.mail_accounts a
                                           where a.user_id = p_user_id
                                             and a.mailbox_email is not null),
             'plafond_eur', coalesce((select monthly_cap_eur from public.user_model_budget b
                                       where b.user_id = p_user_id), 50)
           )
      into v_persoon
      from (select p_user_id as uid) q
      left join public.user_roles r on r.user_id = q.uid;
  end if;

  return jsonb_build_object(
    'gemeten_op',  now(),
    'poorten',     v_poorten,
    'blokkerend',  (v_views + v_rpcs + v_publiek + v_storage) > 0,
    'persoon',     v_persoon
  );
end;
$function$;

comment on function public.invite_readiness(uuid) is
  'Meet de vier structurele ACL-poorten (zelfde bron als multi_user_acl_eval) plus optioneel de doorkijk van één persoon via has_capability_for(). Blokkeert Uitnodigen zolang één poort open staat. Multi-user SECURITY PR-A (S1).';

revoke execute on function public.invite_readiness(uuid) from public, anon;
grant  execute on function public.invite_readiness(uuid) to authenticated, service_role;

-- Poort-regex: has_capability_for mag als poort-token gelden voor toekomstige callers.
update public.acl_poort_config
   set waarde = replace(waarde, 'has_capability|', 'has_capability|has_capability_for|')
 where soort = 'patroon' and naam = 'poort'
   and waarde not like '%has_capability_for%';

-- ── S4 · levert_vandaag bijwerken ───────────────────────────────────────────

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'edge requirePaidUse + chat-trigger',
  toelichting    = 'M2: requirePaidUse in alle zeven gedeployde bundels (taalcheck-v2, transcribe, mail-taalcheck, auto-draft-spelcheck, kb-compose, mail-verbeteraar, rag-search) + trigger op agent_chat_runs. Het €50-plafond is de rem.'
where key = 'modellen.gebruiken';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RLS capability_gate',
  toelichting    = 'M2: agent_runs + agent_schedules lezen via capability_gate(''organisatie.health''). M9 bewijst: zonder recht 0 rijen, met recht > 0.'
where key = 'organisatie.health';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RPC-poort per-user (M2)',
  toelichting    = 'M2: negen Postvak-RPC''s lezen mail.versturen / postvak met eigenaarsregel (can_act_on_autodraft_mail). M10 bewijst de eigenaarsregel. Domein+rate-limit sinds postvak_mail_send_rate_limit.'
where key = 'mail.versturen';

-- Overige M2-handhaving die nog op false stond (niet S2/S3).
update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RLS capability_gate',
  toelichting    = 'M2: security_findings leest via capability_gate(''organisatie.security'').'
where key = 'organisatie.security';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RLS capability_gate',
  toelichting    = 'M2: app_skills leest via capability_gate(''organisatie.skills'') naast app_skills_visible().'
where key = 'organisatie.skills';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RPC + RLS capability_gate',
  toelichting    = 'M2: list_users_for_admin eist assert_capability(''organisatie.gebruikers''); user_roles heeft capability_gate-policy.'
where key = 'organisatie.gebruikers';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RPC assert_capability',
  toelichting    = 'M2: request_run_now e.a. eisen assert_capability(''agent.uitvoeren'').'
where key = 'agent.uitvoeren';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'RPC assert_capability',
  toelichting    = 'M2: agent-instructie-RPC eist assert_capability(''agent.instructies'').'
where key = 'agent.instructies';

update public.capabilities set
  levert_vandaag = true,
  afdwingen_in   = 'UI PAGE_CAP',
  toelichting    = 'M2: SettingsView schermt beheerpagina''s af via instellingen.beheer (ADMIN_ONLY_PAGES is niet meer leeg).'
where key = 'instellingen.beheer';

-- ── S6 · Outlook auth-config vastzetten ─────────────────────────────────────

insert into public.agent_config (agent_name, config_key, config_value, is_secret)
values ('connectors', 'outlook_auth_config_id', '"ac_XaP4Sx1FYKXP"'::jsonb, false)
on conflict (agent_name, config_key) do update
  set config_value = excluded.config_value,
      is_secret    = excluded.is_secret,
      updated_at   = now();

-- ── Asserties (goedkoop, in dezelfde migratie) ──────────────────────────────

do $$
declare
  v_auth boolean;
  v_pub  boolean;
  v_cnt  int;
  v_pin  text;
  v_miss text[];
begin
  -- S1 grants
  v_auth := has_function_privilege('authenticated', 'public.has_capability_for(text,uuid)', 'EXECUTE');
  v_pub  := has_function_privilege('public',        'public.has_capability_for(text,uuid)', 'EXECUTE');
  if not v_auth or v_pub then
    raise exception 'S1 grant-check faalde: authenticated=%, public=% (verwacht true/false)', v_auth, v_pub;
  end if;

  -- S1: has_capability zelf ongewijzigd (anti-impersonatie-tak nog aanwezig)
  if not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_capability'
      and pg_get_functiondef(p.oid) like '%auth.role()%' and pg_get_functiondef(p.oid) like '%authenticated%'
  ) then
    raise exception 'S1: has_capability() mist de anti-impersonatie-tak — niet aanraken';
  end if;

  -- S4: de drie + M2-set moeten true zijn
  select array_agg(key order by key) into v_miss
    from public.capabilities
   where key in (
     'modellen.gebruiken', 'organisatie.health', 'mail.versturen',
     'organisatie.security', 'organisatie.skills', 'organisatie.gebruikers',
     'agent.uitvoeren', 'agent.instructies', 'instellingen.beheer'
   )
     and not levert_vandaag;
  if v_miss is not null then
    raise exception 'S4: levert_vandaag nog false voor: %', v_miss;
  end if;

  -- S6 pin
  select config_value #>> '{}' into v_pin
    from public.agent_config
   where agent_name = 'connectors' and config_key = 'outlook_auth_config_id';
  if v_pin is distinct from 'ac_XaP4Sx1FYKXP' then
    raise exception 'S6: outlook_auth_config_id=% (verwacht ac_XaP4Sx1FYKXP)', v_pin;
  end if;

  -- overview + invite_readiness roepen has_capability_for aan
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('user_capabilities_overview', 'invite_readiness')
     and pg_get_functiondef(p.oid) like '%has_capability_for%';
  if v_cnt <> 2 then
    raise exception 'S1: % van 2 call-sites gebruiken has_capability_for', v_cnt;
  end if;
end $$;

commit;
