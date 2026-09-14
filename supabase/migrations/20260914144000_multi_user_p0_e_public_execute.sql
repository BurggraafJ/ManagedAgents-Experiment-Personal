-- =============================================================================
-- Multi-user P0 · GAP-2c — de PUBLIC-grant die de revoke overleefde  (v1.190)
-- =============================================================================
-- Gemeten ná migratie 20260914141000: `confluence_space_page_counts()` gaf een
-- member nog steeds 200 · 8 rijen, terwijl er een
--
--     revoke execute on function ... from authenticated, anon;
--
-- overheen was gegaan. De reden staat in de ACL:
--
--     {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--       ^^ lege grantee = PUBLIC
--
-- `authenticated` en `anon` erven EXECUTE via PUBLIC, en die grant haal je niet
-- weg door de rollen zelf te revoken. Dit is precies het geheugen
-- `bare-create-function-grants-public`: een kale CREATE FUNCTION geeft PUBLIC
-- execute, en elke revoke die de rol noemt in plaats van PUBLIC laat het gat
-- open. De les die dit oplevert is de meetregel, niet de fix: controleer na een
-- revoke of `has_function_privilege('authenticated', ...)` ook echt `false`
-- geeft — de revoke zelf slaagt namelijk zonder klacht.
--
-- Zes functies dragen zo'n PUBLIC-grant en raken data. Die gaan hier dicht.
--
-- ── Twee blijven bewust staan ───────────────────────────────────────────────
-- `rag_eval_is_bank_id(text)` en `rag_eval_item_state(boolean, text[])` zijn
-- pure expressies — een regex en een CASE, geen enkele tabel. Ze worden
-- gebruikt in `v_agent_eval_runs` en `v_agent_eval_by_category`, die door de
-- read-only meetkant (`supabase_read_only_user`, zonder eigen grant) gelezen
-- worden. Ze staan op de uitzonderingslijst van M2 met deze reden; er valt via
-- een CASE niets te lekken.
--
-- ── supabase_read_only_user ─────────────────────────────────────────────────
-- `confluence_acl_debug()` wordt aangeroepen door
-- `scripts/confluence_acl_eval.cjs` (pre-flight punt 8) via de Management API
-- met `read_only:true` — dus als `supabase_read_only_user`, en die had zijn
-- EXECUTE uitsluitend via PUBLIC. Gemeten in een rollback-transactie: na de
-- revoke geeft `has_function_privilege('supabase_read_only_user', ...)` false,
-- en de poort van punt 8 zou stil omvallen. Vandaar de expliciete grant terug.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   grant execute on function public.<naam>(<args>) to public;
-- =============================================================================

begin;

revoke execute on function public.confluence_space_page_counts()          from public;
revoke execute on function public.confluence_recompute_grants()           from public;
revoke execute on function public.hs_engagement_company_domain_refresh()  from public;
revoke execute on function public.hs_engagement_mail_duplicates_refresh() from public;
revoke execute on function public.confluence_allowed_spaces(uuid)         from public;
revoke execute on function public.confluence_acl_debug(uuid)              from public;

-- confluence_allowed_spaces houdt zijn EXECUTE voor authenticated: hij wordt
-- van binnenuit match_chunks() en match_chunks_for_entity() aangeroepen, en
-- die zijn SECURITY INVOKER. Hij heeft zijn eigen auth.role()-tak.
grant execute on function public.confluence_allowed_spaces(uuid) to authenticated, service_role;

-- confluence_acl_debug is een diagnose-functie, geen productpad. De browser
-- heeft hem niet nodig; de meetkant wel.
revoke execute on function public.confluence_acl_debug(uuid) from authenticated;
grant  execute on function public.confluence_acl_debug(uuid) to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    execute 'grant execute on function public.confluence_acl_debug(uuid) to supabase_read_only_user';
  end if;
end $$;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- select p.proname, p.proacl::text
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
--  where p.prorettype <> 'trigger'::regtype
--    and exists (select 1 from aclexplode(p.proacl) a
--                 where a.grantee = 0 and a.privilege_type='EXECUTE')
--    and p.proname !~ '^(vector|halfvec|sparsevec|array_to_|l2_|l1_|inner_|cosine_|binary_|hamming_|jaccard_|hnsw|ivfflat|subvector|avg|sum)';
-- → verwacht: alleen rag_eval_is_bank_id en rag_eval_item_state.
--
-- En de echte controle, want een revoke slaagt ook als hij niets doet:
-- select has_function_privilege('authenticated','public.confluence_space_page_counts()','EXECUTE');  -> false
