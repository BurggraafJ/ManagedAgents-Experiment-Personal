-- =============================================================================
-- Uitnodigen mag tot iemand de app écht gebruikt heeft                 (v1.213)
-- =============================================================================
-- Jelle, 2026-09-15: "Uitnodigen doet niets — hij zegt dat ze al eens ingelogd
-- zijn, maar ze hebben nooit een mail gehad."
--
-- ── Wat er gebeurde ─────────────────────────────────────────────────────────
-- v1.192 (20260914161000) heeft de LIJST al geleerd dat `last_sign_in_at` geen
-- bewijs van gebruik is: `scripts/lib/user-jwt.cjs` mint echte user-JWT's via
-- admin generate_link + /auth/v1/verify, en GoTrue schuift die kolom dan alsof
-- er een mens inlogde. De UI rekent sindsdien met `last_active_at`.
--
-- De POORT in de edge function `invite-user` is toen blijven staan op
-- `target.last_sign_in_at` en gaf 409 'already-signed-in'. Gemeten op prod
-- (2026-09-15): vijf van de zeven members hebben een `last_sign_in_at` die
-- alleen van meetgereedschap komt, nul van hen heeft een `invite_sent_at`, en
-- bij alle vijf is `last_active_at` NULL. De knop stond dus aan (terecht) en de
-- functie weigerde (onterecht), met een melding die zegt dat de uitnodiging al
-- gedaan is. Er was geen weg naar voren: opnieuw sturen stuitte op dezelfde
-- poort.
--
-- ── De regel ────────────────────────────────────────────────────────────────
-- Uitnodigen mag zolang de gebruiker de app nog nooit ÉCHT heeft gebruikt.
-- "Echt" is dezelfde drieledige, positieve meting als in de lijst:
--   1. `auth.sessions.refreshed_at`   een client kwam terug voor een nieuw token
--   2. een sessie met een browser-user-agent
--   3. `user_session_mfa.verified_at` de tweede factor gehaald
-- Alle drie positief: onbekend gereedschap telt niet mee in plaats van per
-- ongeluk wel.
--
-- ── Eén bron van waarheid ───────────────────────────────────────────────────
-- Die drie regels stonden tot nu toe uitgeschreven in `list_users_for_admin()`.
-- Een tweede lezer (de edge function) erbij betekent een tweede kopie, en dat
-- is precies hoe dit uit de pas ging lopen. Daarom staat de definitie nu één
-- keer, in `user_last_active_at(uuid)`, en roepen beide lezers die aan:
--   • `list_users_for_admin()` — de lijst in Organisatie › Gebruikers
--   • edge `invite-user` — de poort vóór het mailen (via service_role)
--
-- ── Wie mag hem aanroepen ───────────────────────────────────────────────────
-- Alleen `service_role`. Niet `authenticated`: de enige browser-lezer is
-- `list_users_for_admin()`, en die is zelf SECURITY DEFINER (eigenaar postgres)
-- en heeft de grant dus niet nodig. Zo blijft M2 buiten schot — de assertie
-- kijkt alleen naar DEFINER-functies die `authenticated` mag aanroepen — en
-- M2b ook, want de proacl is na de revoke niet leeg en kent geen PUBLIC.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop function if exists public.user_last_active_at(uuid);
-- en zet de drie subqueries in `list_users_for_admin()` terug zoals ze in
-- 20260914161000_multi_user_j_echte_activiteit.sql regel 121-128 staan.
-- ⚠ Hier bewust `create or replace` voor `list_users_for_admin()` (de
-- returns-lijst wijzigt niet), zodat de proacl blijft staan — een DROP gooit
-- hem weg (geheugen: drop-function-verliest-proacl).
-- =============================================================================

begin;

-- Echte activiteit voor één gebruiker. NULL = nooit gebruikt.
-- GREATEST negeert NULL, dus geen van de drie bewijzen = NULL.
create or replace function public.user_last_active_at(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select greatest(
    -- 1. een client kwam terug voor een nieuw token
    (select max(s.refreshed_at at time zone 'UTC')
       from auth.sessions s
      where s.user_id = p_user_id),
    -- 2. een sessie met een browser-user-agent
    (select max(s.created_at)
       from auth.sessions s
      where s.user_id = p_user_id
        and s.user_agent ilike 'Mozilla/%'),
    -- 3. de tweede factor gehaald
    (select max(m.verified_at)
       from public.user_session_mfa m
      where m.user_id = p_user_id)
  );
$$;

comment on function public.user_last_active_at(uuid) is
  'Laatste ECHTE activiteit van één gebruiker, of NULL als die er nooit was. Drie positieve bewijzen: een ververste sessie, een sessie van een browser, of een gehaalde tweede factor. `auth.users.last_sign_in_at` telt bewust NIET mee — onze meetscripts minten JWT''s via generate_link + verify en zetten die kolom zonder dat er een mens was. Eén bron van waarheid voor twee lezers: list_users_for_admin() (de lijst) en edge invite-user (de poort vóór het mailen). Alleen service_role mag hem rechtstreeks aanroepen; list_users_for_admin() is zelf DEFINER en komt er als eigenaar langs.';

revoke execute on function public.user_last_active_at(uuid) from public, anon, authenticated;
grant  execute on function public.user_last_active_at(uuid) to service_role;

-- `list_users_for_admin()` leest nu dezelfde definitie in plaats van zijn eigen
-- kopie. Alleen die ene expressie wijzigt; de returns-lijst is ongemoeid, dus
-- `create or replace` volstaat en de proacl blijft staan.
create or replace function public.list_users_for_admin()
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
    -- Echte activiteit — één bron van waarheid, gedeeld met edge invite-user.
    public.user_last_active_at(au.id) as last_active_at,
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

comment on function public.list_users_for_admin() is
  'Multi-user (v5 2026-09-15): admin-only RPC met analytics. `last_active_at` komt sinds v5 uit public.user_last_active_at() — dezelfde definitie die edge invite-user als poort gebruikt, zodat lijst en poort niet uit de pas kunnen lopen. Telt alleen ECHTE activiteit: een ververste sessie, een sessie van een browser, of een gehaalde tweede factor. `auth.users.last_sign_in_at` telt daar bewust niet in mee (geminte JWT''s van de meetscripts zetten hem zonder mens). `active_sessions_count` telt sessies van een echte client die binnen twee uur nog een token ophaalden. `tool_sessions_count` is er alleen om dat verschil te kunnen uitleggen. SECURITY DEFINER + rolcheck.';

commit;

-- PostgREST cachet zijn functielijst; zonder deze notify geeft de edge-call
-- naar user_last_active_at een 404 tot de volgende reload.
notify pgrst, 'reload schema';

-- ── Verificatie (na deploy draaien) ─────────────────────────────────────────
--   -- 1. lijst en poort geven hetzelfde
--   select display_name,
--          last_sign_in_at is not null as ooit_sign_in,
--          last_active_at,
--          tool_sessions_count
--     from public.list_users_for_admin();
--   -- verwacht: ongewijzigd t.o.v. v4 — owner gevuld, members NULL
--
--   -- 2. de grants staan zoals bedoeld
--   select has_function_privilege('authenticated', 'public.user_last_active_at(uuid)', 'EXECUTE') as auth_mag,
--          has_function_privilege('service_role',  'public.user_last_active_at(uuid)', 'EXECUTE') as sr_mag;
--   -- verwacht: false, true
--
--   select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'list_users_for_admin';
--   -- verwacht: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
--   -- 3. de poort zelf, zonder te mailen
--   --    POST /functions/v1/invite-user  { "email": "<member>", "dry_run": true }
--   --    verwacht: 200 met mode invite|recovery, niet 409
