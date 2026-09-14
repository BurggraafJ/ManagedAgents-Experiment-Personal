-- =============================================================================
-- Multi-user · "Vandaag actief" mag alleen over een mens gaan         (v1.192)
-- =============================================================================
-- Jelle, 2026-09-14: "Julia staat op Vandaag actief terwijl ze vandaag niet
-- actief is geweest en geen mail heeft gehad."
--
-- ── Wat er gebeurde ─────────────────────────────────────────────────────────
-- Onze eigen meetscripts loggen haar in. `scripts/lib/user-jwt.cjs` mint een
-- echte user-JWT via admin `generate_link` + `/auth/v1/verify`, en GoTrue
-- behandelt dat als een gewone login: er komt een rij in `auth.sessions` en
-- `auth.users.last_sign_in_at` schuift naar nu. `multi_user_acl_eval.cjs` doet
-- dat twee keer per run (owner + member), en de pre-flight in CLAUDE.md eist
-- die run vóór én ná elke RLS-wijziging.
--
-- Gemeten op prod, 2026-09-14 15:20 UTC:
--
--   sessies per soort           n   ooit ververst   nieuwste
--   legal-mind-dashboard-…/1.0  25              0   2026-09-14 11:51
--   een browser (Mozilla/…)      2              2   2026-09-13 13:02
--
--   user_session_mfa (tweede factor gehaald): 28 rijen, allemaal van de owner
--
-- Julia had precies één sessie: de mint van 11:51 uur. Geen browser, geen
-- tweede factor, nooit ververst. De lijst las `last_sign_in_at`, zag vandaag,
-- en schreef "Vandaag actief". Jay Alberts stond op dezelfde leugen (13 van
-- die sessies); de andere vier members hadden er nul en klopten wel.
--
-- ── De regel die daaruit volgt ──────────────────────────────────────────────
-- `auth.users.last_sign_in_at` is GEEN bewijs van gebruik. Het zegt dat er een
-- sessie voor deze identiteit is aangemaakt — door een mens of door ons.
-- Activiteit vraagt bewijs dat er een échte client aan de andere kant zat:
--
--   1. `auth.sessions.refreshed_at`        een client kwam terug voor een nieuw
--                                          token — 0 van 25 toolsessies, 2 van 2
--                                          browsersessies
--   2. een sessie met een browser-user-agent
--   3. `user_session_mfa.verified_at`      de tweede factor gehaald; sinds
--                                          2026-09-02 komt een mens er niet
--                                          langs zonder
--
-- Alle drie zijn POSITIEVE tests: onbekend gereedschap telt niet mee in plaats
-- van per ongeluk wel. Een nieuw script met een andere naam kan deze kolom dus
-- niet opnieuw vervuilen — dat is het verschil met de user-agent van ons eigen
-- gereedschap op een zwarte lijst zetten.
--
-- `tool_sessions_count` staat erbij zodat de UI kan uitleggen waarom een account
-- met een gevulde `last_sign_in_at` toch "nog nooit gebruikt" heet.
--
-- ── En de sessieteller ──────────────────────────────────────────────────────
-- `active_sessions_count` telde `not_after > now()`. `not_after` is NULL zolang
-- er geen session-timebox is ingesteld, en dat is hier zo: 27 van de 27 sessies
-- hebben NULL. De teller stond dus sinds v3 permanent op nul en de "Live"-pil
-- heeft nooit één keer gebrand. Nu: een sessie van een echte client die binnen
-- twee uur nog een token heeft opgehaald. Dat is het dichtst bij "zit er nu
-- iemand" dat dit schema kan bewijzen, en de UI zegt het ook zo.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
-- De v3-definitie staat in 20260912174758_users_invite_split.sql regel 47-97.
-- ⚠ DROP FUNCTION gooit de proacl weg; de GRANT/REVOKE hieronder zet hem terug
-- (geheugen drop-function-verliest-proacl). Meet na afloop:
--   select proacl from pg_proc where proname = 'list_users_for_admin';
-- =============================================================================

begin;

-- De returns-lijst wijzigt (last_seen_at → last_active_at, tool_sessions_count
-- erbij), dus DROP + CREATE. De hernoeming is met opzet: een lezer die nog de
-- oude betekenis verwacht hoort te breken, niet stil iets anders te tonen.
drop function if exists public.list_users_for_admin();

create function public.list_users_for_admin()
returns table(
  user_id uuid,
  email text,
  app_role text,
  display_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  active_sessions_count integer,
  last_active_at timestamptz,
  tool_sessions_count integer,
  invite_sent_at timestamptz,
  invite_deferred boolean
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not public.is_admin_or_higher() then
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

revoke execute on function public.list_users_for_admin() from public, anon;
grant execute on function public.list_users_for_admin() to authenticated, service_role;

comment on function public.list_users_for_admin() is
  'Multi-user (v4 2026-09-14): admin-only RPC met analytics. `last_active_at` vervangt `last_seen_at` en telt alleen ECHTE activiteit — een ververste sessie, een sessie van een browser, of een gehaalde tweede factor. `auth.users.last_sign_in_at` telt daar bewust niet in mee: onze eigen meetscripts minten JWT''s via generate_link + verify en zetten hem dus zonder dat er een mens was (Julia stond daardoor op "Vandaag actief"). `active_sessions_count` telt sessies van een echte client die binnen twee uur nog een token ophaalden; de oude test (not_after > now()) stond permanent op nul omdat not_after NULL is zonder session-timebox. `tool_sessions_count` is er alleen om dat verschil te kunnen uitleggen. SECURITY DEFINER + rolcheck.';

commit;

-- ── Verificatie (gemeten 2026-09-14) ────────────────────────────────────────
--   select display_name, last_sign_in_at is not null as ooit_sign_in,
--          last_active_at, active_sessions_count, tool_sessions_count
--     from public.list_users_for_admin();
--
--   owner   : last_active_at gevuld (browser, ververst), tool_sessions 11
--   Julia   : last_active_at NULL, tool_sessions 1   ← was "Vandaag actief"
--   Jay     : last_active_at NULL, tool_sessions 13  ← dezelfde leugen
--   4 anderen: last_active_at NULL, tool_sessions 0  ← klopte al
--
--   select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'list_users_for_admin';
--   -> {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
