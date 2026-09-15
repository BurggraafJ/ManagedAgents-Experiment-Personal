-- =============================================================================
-- list_users_for_admin: poort blijft capability_gate (M2)               (v1.213)
-- =============================================================================
-- 20260915150000 verving last_active_at door user_last_active_at() via
-- create or replace. De body werd per ongeluk gekopieerd uit v4
-- (is_admin_or_higher) in plaats van uit v5/M2 (capability_gate).
-- Voor owners is de uitkomst gelijk; de ACL-betekenis niet. Zet de poort
-- terug. Returns-lijst ongewijzigd, dus create or replace, proacl blijft.
-- =============================================================================

begin;

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
    coalesce((au.raw_user_meta_data->>'invite_deferred') in ('true', 't', '1'), false) as invite_deferred
  from auth.users au
  left join public.user_roles ur on ur.user_id = au.id
  order by au.created_at asc;
end $function$;

comment on function public.list_users_for_admin() is
  'Multi-user (v5 2026-09-15): admin-only RPC met analytics. Poort is capability_gate(organisatie.gebruikers) (M2). last_active_at komt uit public.user_last_active_at(). SECURITY DEFINER + capability-poort.';

commit;
