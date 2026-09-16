-- =============================================================================
-- user_roles.deactivated_at — uit dienst, zonder het account te slopen  (v1.222)
-- =============================================================================
-- Jelle: mensen die uit dienst zijn moeten uit de actieve gebruikerslijst, maar
-- niet uit de administratie. Een ban of een delete in auth.users doet het
-- tweede wél: de historie (wie stuurde die mail, wie was deal-eigenaar) hangt
-- aan het user_id, en die gaat mee.
--
-- Daarom een zacht veld naast `invite_sent_at`, in dezelfde tabel en met
-- dezelfde betekenislaag: NULL = actief, gezet = uit dienst. Geen Auth-ban,
-- geen delete, geen RLS-wijziging. Wie uit dienst is houdt zijn rechten op
-- papier maar verdwijnt uit het beeld waarin de owner werkt — en de
-- Uitnodigen-knop gaat voor hem uit (lib/users.js → canInvite).
--
-- Wie er precies uit dienst is staat NIET in deze migratie. Deze repo is
-- publiek; de dienstverbanden van bij naam genoemde collega's horen daar niet
-- in. Het zetten van de vijf rijen is een losse prod-handeling, vastgelegd in
-- de operatie-notitie buiten de repo.
--
-- ⚠ De RETURNS TABLE van list_users_for_admin verandert, en dat kan niet met
-- `create or replace`. Dus drop + create — en daarmee verliest de functie haar
-- proacl (zie memory drop-function-verliest-proacl). De grants staan hieronder
-- expliciet terug, inclusief een revoke van PUBLIC/anon: een kale CREATE geeft
-- PUBLIC execute terug, en `revoke from public` alleen mist `authenticated`
-- niet, maar laat wél een gat als de rol het recht los had.
-- =============================================================================

begin;

-- 1 · Het veld ---------------------------------------------------------------
alter table public.user_roles
  add column if not exists deactivated_at timestamptz;

comment on column public.user_roles.deactivated_at is
  'NULL = actief; gezet = uit dienst / inactive (soft). Geen Auth ban/delete.';

-- 2 · De RPC geeft het veld door ---------------------------------------------
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
  invite_deferred boolean,
  deactivated_at timestamptz
)
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
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
    au.last_sign_in_at,
    au.created_at,
    au.email_confirmed_at,
    au.banned_until,
    coalesce((
      select count(*)::int
        from auth.sessions s
       where s.user_id = au.id
         and (s.not_after is null or s.not_after > now())
         and (s.user_agent ilike 'Mozilla/%'
              or exists (select 1 from public.user_session_mfa m where m.session_id = s.id))
         and coalesce(s.refreshed_at at time zone 'UTC', s.created_at) > now() - interval '2 hours'
    ), 0) as active_sessions_count,
    public.user_last_active_at(au.id) as last_active_at,
    coalesce((
      select count(*)::int
        from auth.sessions s
       where s.user_id = au.id
         and s.user_agent is not null
         and s.user_agent not ilike 'Mozilla/%'
         and not exists (select 1 from public.user_session_mfa m where m.session_id = s.id)
    ), 0) as tool_sessions_count,
    ur.invite_sent_at,
    coalesce((au.raw_user_meta_data->>'invite_deferred') in ('true', 't', '1'), false) as invite_deferred,
    ur.deactivated_at
  from auth.users au
  left join public.user_roles ur on ur.user_id = au.id
  order by au.created_at asc;
end $function$;

comment on function public.list_users_for_admin() is
  'Multi-user (v6 2026-09-16): admin-only RPC met analytics. Poort is capability_gate(organisatie.gebruikers) (M2). last_active_at komt uit public.user_last_active_at(); deactivated_at uit user_roles (NULL = actief, gezet = uit dienst). SECURITY DEFINER + capability-poort.';

-- 3 · De ACL terug, precies zoals hij stond -----------------------------------
-- Voor de drop: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- anon stond er niet in en hoort er niet in.
revoke all on function public.list_users_for_admin() from public;
revoke all on function public.list_users_for_admin() from anon;
revoke all on function public.list_users_for_admin() from authenticated;
grant execute on function public.list_users_for_admin() to authenticated;
grant execute on function public.list_users_for_admin() to service_role;

commit;
