-- =============================================================================
-- Migratie A — dicht de anon-deur
-- Security review 2026-09-02 · findings F-02, F-04 (+ deel F-03)
-- =============================================================================
-- Waarom:
--   1. 47 van de 49 views in public stonden op security_invoker = off (de
--      PG-default) en zijn eigendom van postgres (rolbypassrls = true). RLS van
--      de caller gold dus niet, terwijl anon SELECT-grant had op alle 49.
--   2. Elke functie in public had EXECUTE voor PUBLIC *en* voor anon, dus 169
--      SECURITY DEFINER-functies waren zonder login aan te roepen.
--   3. De default privileges van Supabase geven nieuwe objecten opnieuw ALL aan
--      anon — zonder stap 3 loopt dit bij het volgende object gewoon terug.
--
-- Wat deze migratie NIET doet: anon's USAGE op schema public intrekken (niet
-- nodig, en PostgREST heeft de schemaruimte nodig), en niets aan `authenticated`
-- of `service_role` veranderen. Dat is Migratie B respectievelijk C.
--
-- Idempotent: elke stap is een SET/REVOKE die je twee keer mag draaien.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Alle views in public respecteren vanaf nu de RLS van de caller.
-- -----------------------------------------------------------------------------
do $$
declare
  v record;
  n_changed int := 0;
begin
  for v in
    select c.oid::regclass as vw
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public'
      and c.relkind = 'v'
      and coalesce(c.reloptions::text, '') not like '%security_invoker=on%'
    order by c.relname
  loop
    execute format('alter view %s set (security_invoker = on)', v.vw);
    n_changed := n_changed + 1;
  end loop;
  raise notice 'Migratie A.1: security_invoker=on gezet op % views', n_changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. anon heeft niets meer te zoeken op tabellen, views en sequences.
--    ("ALL TABLES" dekt in Postgres ook views — dat is precies de bedoeling.)
-- -----------------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- -----------------------------------------------------------------------------
-- 3. EXECUTE intrekken van anon (alle functies) en van PUBLIC (alleen de eigen
--    functies — extensie-functies zoals die van pgvector houden hun PUBLIC-
--    grant, want die worden door authenticated/service_role in queries gebruikt
--    en bevatten geen data).
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from anon;

do $$
declare
  f record;
  n_changed int := 0;
begin
  for f in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'            -- extensie-eigendom overslaan
      )
      and exists (
        select 1 from aclexplode(p.proacl) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'   -- grantee 0 = PUBLIC
      )
  loop
    execute format('revoke execute on function %s from public', f.fn);
    n_changed := n_changed + 1;
  end loop;
  raise notice 'Migratie A.3: PUBLIC-EXECUTE ingetrokken op % functies', n_changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Nieuwe objecten starten dicht. Zonder dit komt anon bij het volgende
--    `create table` / `create function` gewoon weer binnen.
--    postgres en supabase_admin zijn beide grantor van de huidige defaults.
-- -----------------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    begin
      execute format('alter default privileges for role %I in schema public revoke all on tables from anon', r);
      execute format('alter default privileges for role %I in schema public revoke all on sequences from anon', r);
      execute format('alter default privileges for role %I in schema public revoke execute on functions from anon', r);
      execute format('alter default privileges for role %I in schema public revoke execute on functions from public', r);
    exception when insufficient_privilege then
      raise notice 'Migratie A.4: geen rechten om default privileges voor % te wijzigen — handmatig doen', r;
    end;
  end loop;
end;
$$;

commit;
