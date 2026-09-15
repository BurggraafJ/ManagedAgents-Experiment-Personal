-- =============================================================================
-- Multi-user SECURITY PR-B follow-up — task_projects = persoonlijk per user
-- =============================================================================
-- Jelle 2026-09-15: task_projects is NIET kantoor-gedeeld. De eerdere PR-B
-- migratie (20260915130000) opende SELECT via capability_gate('taken') — dat
-- was de verkeerde default. Deze follow-up:
--   1. voegt user_id toe (eigenaar-kolom, zelfde model als tasks)
--   2. backfill bestaande 9 projecten naar de owner
--   3. drop de kantoor-gedeelde capability_gate SELECT-policy
--   4. vervangt owner-only read/write door self-or-admin (mét MFA)
--
-- Andere S2-catalogi (autodraft_actions, kb_categories, cities_lookup) blijven
-- kantoor-gedeeld via capability_gate — ongemoeid.
--
-- Replay-veilig: drop policy if exists · add column if not exists · idempotente
-- backfill. Schrijven door members: eigen projecten (insert/update/delete).
-- Owner (is_admin_or_higher) blijft alles zien/schrijven.
-- =============================================================================

begin;

-- 1. Eigenaar-kolom (zoals tasks.user_id)
alter table public.task_projects
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- 2. Backfill: bestaande catalogus → de owner (één rij in user_roles)
update public.task_projects
   set user_id = (
     select ur.user_id
       from public.user_roles ur
      where ur.app_role = 'owner'
      order by ur.created_at
      limit 1
   )
 where user_id is null;

-- Zonder owner-rij mag de migratie niet stilletjes NOT NULL zetten op nulls.
do $$
begin
  if exists (select 1 from public.task_projects where user_id is null) then
    raise exception 'task_projects.user_id backfill faalde: geen owner in user_roles of nog nulls';
  end if;
end $$;

alter table public.task_projects
  alter column user_id set not null,
  alter column user_id set default auth.uid();

comment on column public.task_projects.user_id is
  'Eigenaar van dit project (SECURITY PR-B follow-up, 2026-09-15). Persoonlijk per user — niet kantoor-gedeeld. Default auth.uid() zodat een member-insert vanzelf van hem is. RLS: eigen rijen of is_admin_or_higher().';

create index if not exists idx_task_projects_user_id
  on public.task_projects using btree (user_id);

-- 3. Drop kantoor-gedeelde SELECT (uit 20260915130000) + oude owner-only policies
drop policy if exists task_projects_capability on public.task_projects;
drop policy if exists task_projects_read_authenticated on public.task_projects;
drop policy if exists task_projects_write_owner on public.task_projects;
drop policy if exists task_projects_read_self_or_admin on public.task_projects;
drop policy if exists task_projects_write_self_or_admin on public.task_projects;

-- 4. Zelfde vorm als tasks_read/write_self_or_admin
create policy task_projects_read_self_or_admin on public.task_projects
  for select to authenticated
  using (
    (select public.session_mfa_ok())
    and (
      user_id = (select auth.uid())
      or (select public.is_admin_or_higher())
    )
  );

create policy task_projects_write_self_or_admin on public.task_projects
  for all to authenticated
  using (
    (select public.session_mfa_ok())
    and (
      user_id = (select auth.uid())
      or (select public.is_admin_or_higher())
    )
  )
  with check (
    (select public.session_mfa_ok())
    and (
      user_id = (select auth.uid())
      or (select public.is_admin_or_higher())
    )
  );

comment on policy task_projects_read_self_or_admin on public.task_projects is
  'Multi-user SECURITY PR-B follow-up · persoonlijk per user. Member ziet alleen eigen projecten; owner (is_admin_or_higher) ziet alles. Vervangt task_projects_capability (kantoor-gedeeld) en task_projects_read_authenticated.';
comment on policy task_projects_write_self_or_admin on public.task_projects is
  'Multi-user SECURITY PR-B follow-up · member mag eigen projecten schrijven; owner alles. Vervangt task_projects_write_owner.';

commit;
