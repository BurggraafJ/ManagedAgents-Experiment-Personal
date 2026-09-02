-- =============================================================================
-- Migratie G — de tweede factor mag geen sequential scan kosten
-- Security review 2026-09-02 · performance-fix bij migratie D/F
-- =============================================================================
-- Wat er misging:
--   `session_mfa_ok()` was `language plpgsql`. Zo'n functie is niet inline-baar,
--   dus Postgres evalueert hem in een RLS-qual **per rij**. Zolang hij `true`
--   gaf viel dat niet op (een `limit 1` stopt na de eerste rij), maar zodra hij
--   `false` geeft moet de planner de hele tabel langs. Gemeten op productie:
--   `select chunk_id from chunks limit 1` liep in 57014 (statement timeout) op
--   46.827 rijen.
--
-- Wat deze migratie doet:
--   1. `session_mfa_ok()` en `can_manage_dashboard()` worden pure SQL-functies.
--      Die inline't Postgres in de qual, waarna de niet-gecorreleerde
--      sub-selects als InitPlan **één keer** worden uitgevoerd in plaats van per rij.
--   2. Elke row-onafhankelijke functie-aanroep in de policies wordt in een
--      scalar subquery gezet — `is_admin_or_higher()` → `(select public.is_admin_or_higher())`.
--      Dat is het standaard RLS-performancepatroon van Supabase: zo'n subquery
--      is niet gecorreleerd en wordt daarom als InitPlan één keer geëvalueerd.
--      Dit maakt de policies ook sneller dan de oude `USING (true)`-variant op
--      grote tabellen niet was — daar was niets te evalueren, maar nu is de kost
--      O(1) in plaats van O(rijen).
--
-- Idempotent: de rewrite slaat aanroepen over die al in een subquery staan.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Pure SQL i.p.v. plpgsql, zodat de planner kan inlinen.
-- -----------------------------------------------------------------------------
create or replace function public.session_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $session_mfa_ok$
  select case
    -- Geen config of enforcement uit → tweede factor niet van toepassing.
    when not coalesce((select c.enforce from public.app_mfa_config c where c.id = 1), false)
      then true
    -- Noodpad: break-glass venster open.
    when coalesce((select c.break_glass_until from public.app_mfa_config c where c.id = 1),
                  '-infinity'::timestamptz) > now()
      then true
    -- Interne callers (pg_cron, migraties, psql) hebben geen browsersessie.
    when session_user is distinct from 'authenticator'
      then true
    -- Server-to-server met de service-role key.
    when coalesce(auth.role(), '') = 'service_role'
      then true
    else exists (
      select 1
      from public.user_session_mfa m
      where m.session_id = nullif(
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', ''
            )::uuid
        and m.user_id = auth.uid()
        and m.expires_at > now()
    )
  end
$session_mfa_ok$;

comment on function public.session_mfa_ok() is
  'True als de huidige browsersessie de e-mail-OTP-stap heeft gehaald, of als '
  'enforcement/break-glass dat overbodig maakt. Pure SQL zodat de planner hem '
  'in RLS-quals kan inlinen (migratie G) — plpgsql kostte een seq scan per rij.';

create or replace function public.can_manage_dashboard()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $can_manage$
  select case
    -- 1. Interne caller: pg_cron, een migratie, psql. PostgREST zet altijd
    --    session_user='authenticator' EN request.method; beide moeten weg zijn.
    when session_user is distinct from 'authenticator'
         and current_setting('request.method', true) is null
      then true
    -- 2. Server-to-server met de service-role key.
    when coalesce(auth.role(), '') = 'service_role'
      then true
    -- 3. De owner in de browser.
    else public.is_admin_or_higher()
  end
$can_manage$;

-- -----------------------------------------------------------------------------
-- 2. Row-onafhankelijke aanroepen in een scalar subquery zetten.
-- -----------------------------------------------------------------------------
do $migratie_g$
declare
  p record;
  new_qual text;
  new_check text;
  n_changed int := 0;

  function_calls text[] := array[
    'session_mfa_ok()',
    'is_admin_or_higher()',
    'is_app_owner()',
    'auth.uid()',
    'auth.role()'
  ];
  f text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and roles::text like '%authenticated%'
    order by tablename, policyname
  loop
    new_qual  := p.qual;
    new_check := p.with_check;

    foreach f in array function_calls loop
      -- ' SELECT <call>' betekent: staat al in een subquery — dan overslaan.
      if new_qual is not null and position('SELECT ' || f in new_qual) = 0 then
        new_qual := replace(new_qual, f,
          '( SELECT ' || case when f like 'auth.%' then f else 'public.' || f end || ')');
      end if;
      if new_check is not null and position('SELECT ' || f in new_check) = 0 then
        new_check := replace(new_check, f,
          '( SELECT ' || case when f like 'auth.%' then f else 'public.' || f end || ')');
      end if;
    end loop;

    if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
      if p.qual is not null and p.with_check is not null then
        execute format('alter policy %I on %I.%I using (%s) with check (%s)',
                       p.policyname, p.schemaname, p.tablename, new_qual, new_check);
      elsif p.qual is not null then
        execute format('alter policy %I on %I.%I using (%s)',
                       p.policyname, p.schemaname, p.tablename, new_qual);
      else
        execute format('alter policy %I on %I.%I with check (%s)',
                       p.policyname, p.schemaname, p.tablename, new_check);
      end if;
      n_changed := n_changed + 1;
    end if;
  end loop;
  raise notice 'Migratie G: % policies herschreven naar scalar subqueries', n_changed;
end;
$migratie_g$;

commit;
