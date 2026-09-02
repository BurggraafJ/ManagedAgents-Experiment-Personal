-- =============================================================================
-- Migratie F — de tweede factor dekt óók de user-scoped tabellen
-- Security review 2026-09-02 · sluit een gat in migratie D
-- =============================================================================
-- Wat er misging in D:
--   `session_mfa_ok()` is in `is_admin_or_higher()` gevouwen, en het rapport
--   ging ervan uit dat daarmee "alle datatabellen" gedekt waren. Dat geldt voor
--   de 74 + 25 tabellen die uitsluitend op dat predicate leunen. Maar 47 andere
--   tabellen hebben een policy van de vorm
--
--       ((user_id = auth.uid()) OR is_admin_or_higher())
--
--   en daar is het eerste been van de OR genoeg. Gemeten op productie direct na
--   het aanzetten van enforcement: `mfa_status` gaf `session_ok: false`, en
--   `contact_directory` (view over `mail_messages`) gaf **toch rijen terug** —
--   want Jelle's eigen mail voldoet aan `user_id = auth.uid()`.
--
--   Dat is precies de data waar het om gaat. Een tweede factor die de mailinhoud
--   niet dekt, is geen tweede factor.
--
-- Wat deze migratie doet:
--   Elke `TO authenticated`-policy met een niet-admin pad wordt
--       public.session_mfa_ok() AND (<oorspronkelijk predicate>)
--   Het admin-been blijft werken omdat `is_admin_or_higher()` zelf al
--   `session_mfa_ok()` bevat — de AND is dus geen dubbele eis, alleen een
--   ondergrens voor het eigenaar-been.
--
-- Eén uitzondering, met opzet:
--   `user_roles_self_select` — `(auth.uid() = user_id)`. De app moet vóór de
--   OTP-stap z'n eigen rol kunnen lezen (`useUserRole`), anders weet de UI niet
--   wie er inlogt en kan het Verificatiecode-scherm niet eens renderen.
--   Die policy geeft één rij met alleen `user_id`, `app_role` en `display_name`
--   van de aanvrager zelf.
--
-- Idempotent: policies die `session_mfa_ok` al noemen worden overgeslagen.
-- =============================================================================

begin;

do $migratie_f$
declare
  p record;
  n_changed int := 0;
  n_skipped int := 0;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and roles::text like '%authenticated%'
      and coalesce(qual, '') || coalesce(with_check, '') not like '%session_mfa_ok%'
      and (coalesce(qual, '') || coalesce(with_check, '') like '%auth.uid()%'
        or coalesce(qual, '') || coalesce(with_check, '') like '%is_secret%')
      -- de enige uitzondering: eigen rol lezen moet vóór de OTP-stap kunnen
      and not (tablename = 'user_roles' and policyname = 'user_roles_self_select')
    order by tablename, policyname
  loop
    if p.qual is not null and p.with_check is not null then
      execute format(
        'alter policy %I on %I.%I using (public.session_mfa_ok() and (%s)) with check (public.session_mfa_ok() and (%s))',
        p.policyname, p.schemaname, p.tablename, p.qual, p.with_check);
    elsif p.qual is not null then
      execute format(
        'alter policy %I on %I.%I using (public.session_mfa_ok() and (%s))',
        p.policyname, p.schemaname, p.tablename, p.qual);
    else
      execute format(
        'alter policy %I on %I.%I with check (public.session_mfa_ok() and (%s))',
        p.policyname, p.schemaname, p.tablename, p.with_check);
    end if;
    n_changed := n_changed + 1;
  end loop;

  select count(*) into n_skipped
  from pg_policies
  where schemaname = 'public'
    and roles::text like '%authenticated%'
    and coalesce(qual, '') || coalesce(with_check, '') like '%session_mfa_ok%';

  raise notice 'Migratie F: % policies voorzien van session_mfa_ok(); % policies noemen het nu', n_changed, n_skipped;
end;
$migratie_f$;

-- -----------------------------------------------------------------------------
-- Vangnet: alleen user_roles_self_select mag nog een niet-admin pad hebben dat
-- niet door de tweede factor loopt.
-- -----------------------------------------------------------------------------
do $verify_f$
declare
  n int;
  namen text;
begin
  select count(*), string_agg(tablename || '.' || policyname, ', ')
    into n, namen
  from pg_policies
  where schemaname = 'public'
    and roles::text like '%authenticated%'
    and coalesce(qual, '') || coalesce(with_check, '') not like '%session_mfa_ok%'
    and (coalesce(qual, '') || coalesce(with_check, '') like '%auth.uid()%'
      or coalesce(qual, '') || coalesce(with_check, '') like '%is_secret%')
    and not (tablename = 'user_roles' and policyname = 'user_roles_self_select');
  if n > 0 then
    raise exception 'Migratie F: % policies nog buiten de tweede factor: %', n, namen;
  end if;
end;
$verify_f$;

commit;
