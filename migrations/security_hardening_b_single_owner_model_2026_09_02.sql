-- =============================================================================
-- Migratie B — één autorisatiemodel
-- Security review 2026-09-02 · findings F-01, F-09, F-13 (+ F-16 server-side)
-- =============================================================================
-- Waarom:
--   1. 76 policies op 74 datatabellen stonden op `TO authenticated USING (true)`.
--      Iedereen die inlogt kon daarmee de RAG-store (chunks), de CRM-mirror, de
--      meeting-briefings en de metadata van alle 15 credentials lezen. Twee
--      daarvan gaven zelfs schrijfrechten (external_party_directory ALL,
--      meeting_briefing_config UPDATE).
--   2. meeting_briefings + meeting_briefing_config hadden een `TO anon
--      USING (true)`-SELECT-policy: zonder login leesbaar.
--   3. Er bestonden twee owner-modellen naast elkaar: is_admin_or_higher()
--      (leest user_roles, 47 tabellen) en is_app_owner() (hardcoded UUID,
--      25 tabellen). Een tweede owner kreeg de helft; en als Jelle's auth-user
--      ooit opnieuw aangemaakt wordt, zijn die 25 tabellen permanent dicht.
--
-- Na deze migratie is `public.is_admin_or_higher()` het enige predicate op de
-- datatabellen. is_app_owner() blijft bestaan als thin wrapper, want 8 RPC's
-- roepen hem aan.
--
-- Wat NIET verandert: de 47 `(user_id = auth.uid()) OR is_admin_or_higher()`-
-- policies, de user-scoped policies (klantbase_*, postvak_*, rag_chat_sessions,
-- user_roles_self_select) en alle service_role-policies. Die zijn correct.
--
-- Idempotent: de ALTER POLICY-loops selecteren op `qual = 'true'`, dus een
-- tweede run vindt niets meer.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. is_app_owner() wordt een thin wrapper. Dit haalt in één keer de hardcoded
--    UUID (en daarmee het self-lockout-risico) uit alle 25 tabellen en uit de
--    8 RPC's die hem aanroepen.
-- -----------------------------------------------------------------------------
create or replace function public.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  -- Thin wrapper (2026-09-02, F-13). Was: auth.uid() = '<hardcoded uuid>'.
  -- Eén owner-model: public.user_roles via is_admin_or_higher().
  select public.is_admin_or_higher();
$$;

comment on function public.is_app_owner() is
  'DEPRECATED wrapper rond is_admin_or_higher(). Gebruik in nieuwe code direct '
  'is_admin_or_higher(). Bestaat nog omdat 8 RPC''s hem aanroepen (F-13).';

-- -----------------------------------------------------------------------------
-- 2. De twee anon-SELECT-policies droppen (F-09).
-- -----------------------------------------------------------------------------
drop policy if exists "briefings anon read"   on public.meeting_briefings;
drop policy if exists "briefing cfg anon read" on public.meeting_briefing_config;

-- -----------------------------------------------------------------------------
-- 3. Elke blanket `TO authenticated USING (true)` / `WITH CHECK (true)` wordt
--    is_admin_or_higher(). ALTER POLICY behoudt naam, cmd en rol — dus geen
--    naamswijzigingen die de rest van de codebase kunnen verrassen.
-- -----------------------------------------------------------------------------
do $$
declare
  p record;
  n_changed int := 0;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and roles::text = '{authenticated}'
      and coalesce(nullif(btrim(qual), ''), 'true') = 'true'
      and coalesce(nullif(btrim(with_check), ''), 'true') = 'true'
      and (qual is not null or with_check is not null)
    order by tablename, policyname
  loop
    if p.qual is not null and p.with_check is not null then
      execute format(
        'alter policy %I on %I.%I using (public.is_admin_or_higher()) with check (public.is_admin_or_higher())',
        p.policyname, p.schemaname, p.tablename);
    elsif p.qual is not null then
      execute format(
        'alter policy %I on %I.%I using (public.is_admin_or_higher())',
        p.policyname, p.schemaname, p.tablename);
    else
      execute format(
        'alter policy %I on %I.%I with check (public.is_admin_or_higher())',
        p.policyname, p.schemaname, p.tablename);
    end if;
    n_changed := n_changed + 1;
  end loop;
  raise notice 'Migratie B.3: % blanket authenticated-policies naar is_admin_or_higher()', n_changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. De policies die letterlijk is_app_owner() aanroepen naar het ene model
--    herschrijven, zodat het catalogus-beeld ook één model laat zien.
--    (Functioneel al gedekt door stap 1; dit is de opruiming.)
-- -----------------------------------------------------------------------------
do $$
declare
  p record;
  n_changed int := 0;
  new_qual text;
  new_check text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and roles::text = '{authenticated}'
      and (coalesce(qual, '') like '%is_app_owner()%'
        or coalesce(with_check, '') like '%is_app_owner()%')
    order by tablename, policyname
  loop
    new_qual  := replace(coalesce(p.qual, ''),       'is_app_owner()', 'public.is_admin_or_higher()');
    new_check := replace(coalesce(p.with_check, ''), 'is_app_owner()', 'public.is_admin_or_higher()');
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
  end loop;
  raise notice 'Migratie B.4: % is_app_owner()-policies herschreven', n_changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Vangnet: geen enkele authenticated-policy mag nog blanket-true zijn.
-- -----------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public'
    and roles::text like '%authenticated%'
    and (btrim(coalesce(qual, 'x')) = 'true' or btrim(coalesce(with_check, 'x')) = 'true');
  if n > 0 then
    raise exception 'Migratie B: nog % blanket authenticated-policies over', n;
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and roles::text like '%anon%';
  if n > 0 then
    raise exception 'Migratie B: nog % anon-policies over', n;
  end if;
end;
$$;

commit;
