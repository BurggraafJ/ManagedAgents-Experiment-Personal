-- =============================================================================
-- Multi-user M2 · a — de poort die capabilities afdwingt, en de invite-check
-- =============================================================================
-- Hoort bij RESEARCH-MULTI-USER.md §3/§4, P0-IMPL-NOTES.md ("skelet, nergens
-- gehandhaafd") en DECISIONS-2026-09-14.md.
--
-- P0 bouwde `has_capability()` en liet hem bewust los staan: eerst bewijzen dat
-- hij closed faalt (M7), dan pas handhaving. M7 staat sinds 2026-09-14 groen.
-- Deze migratie legt de handhaving erop.
--
-- ── Waarom niet rechtstreeks has_capability() in een policy ─────────────────
--
-- `has_capability()` kent GEEN tweede factor. `is_admin_or_higher()` wel
-- (= owner AND session_mfa_ok(), sinds 2026-09-02). Een policy die
-- `is_admin_or_higher()` voor `has_capability('x')` inruilt zou de MFA-eis dus
-- stilzwijgend laten vallen — een beveiligingsstap terug, verpakt als een
-- rechtenmodel. `capability_gate()` zet die eis er weer bij.
--
-- ── De vorm is ADDITIEF, en dat is het hele punt ────────────────────────────
--
--   capability_gate(k) = can_manage_dashboard()                    -- nu
--                     OR (has_capability(k) AND session_mfa_ok())  -- nieuw
--
-- `can_manage_dashboard()` dekt de drie callers die vandaag door elke poort
-- komen: intern (pg_cron, migratie, psql), server-to-server met de service-role
-- key, en de owner in de browser mét tweede factor. Die eerste arm blijft
-- ongewijzigd staan, dus **niets wat vandaag werkt stopt**. Wat erbij komt is
-- één pad: een member die het recht heeft én zijn tweede factor haalde.
--
-- Daardoor kan M6 ("de owner ziet ná de wijziging evenveel of meer") per
-- constructie niet omvallen — en dat is de assertie die er het meest toe doet
-- (geheugen `confluence-per-user-space-acl`).
--
-- Eén bewuste verbreding: waar een RPC vandaag `is_admin_or_higher()` gebruikt
-- (strikter dan can_manage_dashboard: service_role valt daar buiten, want
-- auth.uid() is leeg en current_user_role() geeft 'member') laat de nieuwe
-- poort de service-role key wél door. Dat is dezelfde regel die P0 al voor 49
-- functies vastlegde via `require_dashboard_auth()`; hem hier anders maken zou
-- twee betekenissen van "poort" opleveren.
--
-- ── acl_poort_config: één lijst, twee lezers ────────────────────────────────
--
-- `scripts/multi_user_acl_eval.cjs` droeg zijn uitzonderingen en zijn
-- poort-regex als constanten in het script. `invite_readiness()` hieronder
-- meet dezelfde dingen. Twee kopieën van dezelfde definitie lopen uit elkaar
-- en je merkt het pas als ze iets anders zeggen (geheugen
-- `doc12-definition-lives-in-three-places`: DOC-12 stond op drie plekken en
-- liep in PR #90 één commit lang uit de pas). Daarom staat de lijst nu in de
-- database en leest het script hem op.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop function public.invite_readiness(uuid);
--   drop function public.assert_capability(text);
--   drop function public.capability_gate(text);
--   drop table public.acl_poort_config;
-- =============================================================================

begin;

-- ── 1. De poort ─────────────────────────────────────────────────────────────

create or replace function public.capability_gate(p_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.can_manage_dashboard()
      or (public.has_capability(p_key) and public.session_mfa_ok());
$$;

comment on function public.capability_gate(text) is
  'De handhavingspoort van het capability-model. ADDITIEF: can_manage_dashboard() (intern, service_role, owner mét tweede factor) OF een member met dit recht mét tweede factor. Gebruik deze in policies en RPC-guards, nooit has_capability() kaal — die kent geen tweede factor en zou de MFA-eis van is_admin_or_higher() stilzwijgend laten vallen. Multi-user M2.';

create or replace function public.assert_capability(p_key text)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  if not public.capability_gate(p_key) then
    raise exception 'forbidden: recht % ontbreekt', p_key
      using errcode = 'insufficient_privilege',
            hint    = 'vraag de owner dit recht aan te vinken bij Organisatie › Rechten';
  end if;
end;
$$;

comment on function public.assert_capability(text) is
  'Raise-variant van capability_gate(), voor plpgsql-RPC''s. De foutmelding noemt het recht bij naam zodat de UI kan zeggen wát er ontbreekt in plaats van alleen "forbidden". Multi-user M2.';

revoke execute on function public.capability_gate(text) from public;
revoke execute on function public.assert_capability(text) from public;
grant  execute on function public.capability_gate(text) to authenticated, service_role;
grant  execute on function public.assert_capability(text) to authenticated, service_role;

-- ── 2. De configuratie van de ACL-poort, als data ───────────────────────────

create table if not exists public.acl_poort_config (
  soort  text not null check (soort in ('view', 'rpc', 'edge', 'patroon')),
  naam   text not null,
  waarde text,
  reden  text not null check (length(btrim(reden)) > 0),
  primary key (soort, naam)
);

comment on table public.acl_poort_config is
  'De uitzonderingslijsten en regexen van scripts/multi_user_acl_eval.cjs, als data. Twee lezers: dat script (M1/M2/M2b/M3) en invite_readiness(). Elke regel is een bewuste keuze mét reden — de CHECK op `reden` maakt een lege reden onmogelijk, want een uitzondering zonder reden is een bug. Multi-user M2.';
comment on column public.acl_poort_config.waarde is
  'Alleen gevuld bij soort=''patroon'': de regex zelf. Bij de drie lijsten staat de naam in `naam` en is `waarde` leeg.';

alter table public.acl_poort_config enable row level security;

drop policy if exists acl_poort_config_lezen on public.acl_poort_config;
create policy acl_poort_config_lezen on public.acl_poort_config
  for select to authenticated
  using (public.capability_gate('organisatie.security'));

drop policy if exists acl_poort_config_service on public.acl_poort_config;
create policy acl_poort_config_service on public.acl_poort_config
  for all to service_role using (true) with check (true);

grant select on public.acl_poort_config to authenticated;

insert into public.acl_poort_config (soort, naam, waarde, reden) values
  ('view', 'v_hubspot_future_index_acl', null,
   'geguarde ingang op een materialized view; RLS geldt daar nooit, de poort zit in het WHERE-predicaat (is_admin_or_higher)'),
  ('view', 'v_user_model_usage_month', null,
   'poort in het WHERE-predicaat; de policy op agent_chat_runs kent geen owner-tak, dus met invoker zag de owner alleen zijn eigen regel'),
  ('view', 'v_model_usage_dekking', null,
   'owner-only noemer bij v_user_model_usage_month; poort in het WHERE-predicaat'),
  ('view', 'v_user_model_usage_detail', null,
   'de vragen achter het maandbedrag (doorkijk op de Usage-pagina); zelfde twee armen en dezelfde reden als v_user_model_usage_month'),
  ('view', 'v_mailbox_link_status', null,
   'vier vlaggen uit mail_accounts (gekoppeld/enabled/paused/fout), geen mailadres en geen composio-id; poort in het WHERE-predicaat omdat authenticated geen table-grant op mail_accounts heeft en security_invoker=on de view dan voor iedereen zou laten falen'),
  ('rpc', 'rag_owner_scope_ids', null,
   'aangeroepen vanuit match_chunks() en match_chunks_for_entity(), beide SECURITY INVOKER; levert een scope-filter en geen data, de RLS op chunks staat er onverkort naast'),
  ('rpc', 'mail_scope_single_user_id', null,
   'levert één uuid; zit in vier security_invoker-views die authenticated leest'),
  ('rpc', 'rag_eval_is_bank_id', null,
   'pure expressie (een regex), raakt geen tabel; de read-only meetkant heeft hem via views nodig'),
  ('rpc', 'rag_eval_item_state', null,
   'pure expressie (een CASE), raakt geen tabel; idem'),
  ('edge', 'rag-chat', null,
   'scoping op caller_user_id in plaats van op rol — bewust, elke ingelogde gebruiker mag vragen stellen'),
  ('edge', 'mfa-email-send', null,
   'onderdeel van het inlogpad zelf; een rolcheck zou de tweede factor onbereikbaar maken'),
  ('edge', 'mfa-email-verify', null,
   'idem'),
  ('patroon', 'poort',
   'auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_admin_or_higher|is_app_owner|can_manage_dashboard|current_user_role|session_mfa_ok|has_capability|capability_gate|assert_capability|can_act_on_autodraft_mail|assert_autodraft_mail_access|confluence_allowed_spaces|app_skills_visible|require_dashboard_auth|assert_can_manage_dashboard|assert_service_role',
   'alles wat aantoonbaar naar de AANROEPER kijkt. Bewust NIET erin: rag_owner_scope_ids, mail_scope_user_ids en mail_scope_single_user_id — die heten als een poort maar vragen nooit wie er belt (geheugen `gate-helpers-that-never-ask-who-is-calling`); ze meetellen gaf op 2026-09-14 één vals groen op find_similar_sent_mails'),
  ('patroon', 'pgvector',
   '^(vector|halfvec|sparsevec|array_to_|l2_|l1_|inner_|cosine_|binary_|hamming_|jaccard_|hnsw|ivfflat|subvector|avg|sum)',
   'de pgvector-operatoren horen PUBLIC te zijn; die filteren we uit M2b'),
  ('patroon', 'storage_poort',
   'auth\.uid|is_app_owner|is_admin_or_higher|has_capability|capability_gate|foldername',
   'een storage-policy die naast bucket_id ook hierop test, kijkt naar de aanroeper (M8)'),
  ('patroon', 'edge_poort',
   'app_role|is_admin_or_higher|user_roles|has_capability|can_manage_dashboard|requireCapability|requirePaidUse|requireOwner',
   'M3 grept de repo-bron van een verify_jwt-functie op deze tokens. De drie require*-namen komen uit _shared/user-gate.ts (M2): een functie die de helper importeert doet aantoonbaar een rolcheck, ook al staat has_capability() alleen in de helper zelf')
on conflict (soort, naam) do update
  set waarde = excluded.waarde, reden = excluded.reden;

-- ── 3. De invite-check ──────────────────────────────────────────────────────
--
-- "Niet uitnodigen tot de poorten dicht zijn" was tot nu toe een zin in een
-- document. Deze functie maakt er een meting van, op het moment dat het ertoe
-- doet: als de owner op Uitnodigen drukt.
--
-- Vier structurele poorten (dezelfde vier die de ACL-eval M1/M2/M2b/M8 noemt,
-- uit dezelfde configuratie) plus, als er een persoon is meegegeven, wat die
-- persoon straks aantreft. Alleen de vier structurele zijn blokkerend: de
-- persoonsregels zijn een waarschuwing, geen slot — iemand uitnodigen die nog
-- geen mailbox gekoppeld heeft is een normale volgorde, niet een fout.

create or replace function public.invite_readiness(p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
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

  -- M1 · views die de RLS eronder overslaan
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

  -- M2 · SECURITY DEFINER-RPC's zonder poort, bereikbaar voor authenticated
  select count(*) into v_rpcs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and coalesce(p.prosrc, '') !~* v_poort_regex
     and not exists (select 1 from public.acl_poort_config u
                      where u.soort = 'rpc' and u.naam = p.proname);

  -- M2b · app-functies met EXECUTE voor PUBLIC
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

  -- M8 · storage-policies die alleen op bucket_id testen
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
                                 where public.has_capability(c.key, p_user_id)),
             'rechten_zonder_dekking', coalesce((
                select jsonb_agg(c.label order by c.sort_order)
                  from public.capabilities c
                 where public.has_capability(c.key, p_user_id)
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
$$;

comment on function public.invite_readiness(uuid) is
  'Meet op het moment van uitnodigen of de vier structurele poorten dicht staan (dezelfde vier als M1/M2/M2b/M8 in scripts/multi_user_acl_eval.cjs, uit dezelfde configuratie in acl_poort_config), plus wat de uitgenodigde persoon straks aantreft. Alleen de vier structurele poorten zijn blokkerend. Multi-user M2.';

revoke execute on function public.invite_readiness(uuid) from public;
grant  execute on function public.invite_readiness(uuid) to authenticated, service_role;

commit;
