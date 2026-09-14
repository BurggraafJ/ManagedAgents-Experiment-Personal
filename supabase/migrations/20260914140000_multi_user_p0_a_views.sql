-- =============================================================================
-- Multi-user P0 · GAP-1 — twaalf views die de RLS volledig omzeilen  (v1.190)
-- =============================================================================
-- Onderzoek: /workspace/security/maestro-agent-architecture/multi-user/
--            RESEARCH-MULTI-USER.md §2 GAP-1 · gemeten 2026-09-14 op prod.
--
-- 102 views/matviews in public. Negentig dragen `security_invoker=on` en
-- respecteren dus de RLS van de tabel eronder. Twaalf niet. Die draaien als hun
-- eigenaar `postgres`, en `postgres` heeft `rolbypassrls = true` — de RLS van de
-- onderliggende tabellen wordt daar overgeslagen.
--
-- Wat dat vandaag betekent, gemeten met een échte member-JWT (geen MFA-sessie):
--
--   v_mail_chunk_source              17.749 rijen  subject, body_text, body_html
--   v_entity_edges_full              62.583 rijen  de volledige entiteitengraaf
--   v_entity_edges                   39.770 rijen  idem
--   v_hubspot_company_chunk_source    6.053 rijen  bedrijven, domeinen, dealnamen
--   v_hubspot_contact_chunk_source    1.558 rijen  naam, e-mail, functie
--   v_hubspot_deal_chunk_source       1.142 rijen  dealname, amount, dealstage
--   v_hubspot_future_index (matview)  1.295 rijen
--   agent_runs_health_7d / v_agent_chat_* / v_meeting_entity_link_health
--
-- Diezelfde JWT krijgt 0 rijen uit `mail_messages`, `hubspot_deals` en
-- `v_d1_deals` — de RLS werkt dus prima; alleen deze twaalf views lopen eromheen.
-- `anon` komt er niet bij (401, geen SELECT-grant), dus het is geen publiek lek:
-- je hebt een geldig account nodig. Er staan er vier klaar die nog nooit hebben
-- ingelogd.
--
-- ── De drie behandelingen ────────────────────────────────────────────────────
-- Niet elke view krijgt dezelfde. Wie een view leest bepaalt wat veilig is, en
-- een view die voor Jelle leeg wordt is een stillere storing dan een view die
-- voor een member te veel laat zien.
--
--  (1) INTREKKEN + invoker — geen enkele browserlezer. Gemeten: de vier
--      `*_chunk_source`-views worden alleen gelezen door
--      supabase/functions/chunker (service_role), de drie `v_agent_chat_*`
--      alleen door de RPC `agent_chat_health_check()` (SECURITY DEFINER, mét
--      `assert_can_manage_dashboard()`), en `v_meeting_entity_link_health` door
--      niemand. Een SECURITY DEFINER-functie draait als `postgres`, dus die
--      merkt niets van `security_invoker`; service_role heeft `bypassrls` en
--      merkt er evenmin iets van.
--
--  (2) ALLEEN invoker — er is een browserlezer, en de RLS eronder doet precies
--      wat we willen. `agent_runs_health_7d` (useAdminCounts.js:35) leest
--      agent_schedules + agent_runs, beide `is_admin_or_higher()`: de owner mét
--      tweede factor houdt zijn 28 rijen, een member krijgt er 0.
--      `v_entity_edges(_full)` zit in `match_chunks_for_entity` — en dat is een
--      SECURITY **INVOKER**-functie, dus juist dáár moet de RLS meelopen. De
--      mail- en agenda-armen dragen al `mail_row_in_scope(...)`, maar
--      `mail_scope_user_ids()` geeft NULL zodra `auth.uid()` gevuld is — "geen
--      restrictie". De HubSpot-, Jira- en Confluence-armen hadden helemaal geen
--      filter. Met invoker=on doet de RLS van de tabel eronder dat werk.
--
--  (3) MATVIEW — `v_hubspot_future_index` is materialized; RLS geldt daar nooit,
--      ongeacht welke optie je zet. De enige oplossing is de grant intrekken en
--      de lezer (useHubspotFutureIndex.js) langs een geguarde view sturen. De
--      matview zelf houdt zijn naam, want cron `refresh-hubspot-future-index`
--      (5,20,35,50 * * * *) doet REFRESH MATERIALIZED VIEW CONCURRENTLY op die
--      naam.
--
-- ── Terugdraaien ─────────────────────────────────────────────────────────────
--   alter view <naam> set (security_invoker = off);
--   grant select on <naam> to authenticated;
--   drop view public.v_hubspot_future_index_acl;
-- en `useHubspotFutureIndex.js` terug op `v_hubspot_future_index`.
-- =============================================================================

begin;

-- ── 1. Alle elf gewone views: RLS van de tabel eronder gaat gelden ───────────
alter view public.v_mail_chunk_source            set (security_invoker = on);
alter view public.v_entity_edges                 set (security_invoker = on);
alter view public.v_entity_edges_full            set (security_invoker = on);
alter view public.v_hubspot_company_chunk_source set (security_invoker = on);
alter view public.v_hubspot_contact_chunk_source set (security_invoker = on);
alter view public.v_hubspot_deal_chunk_source    set (security_invoker = on);
alter view public.agent_runs_health_7d           set (security_invoker = on);
alter view public.v_agent_chat_health            set (security_invoker = on);
alter view public.v_agent_chat_by_route          set (security_invoker = on);
alter view public.v_agent_chat_coverage          set (security_invoker = on);
alter view public.v_meeting_entity_link_health   set (security_invoker = on);

-- ── 2. Intrekken waar geen browser leest ────────────────────────────────────
-- Twee sloten op dezelfde deur, met opzet: invoker=on maakt de RLS geldig, de
-- revoke zorgt dat een toekomstige `grant select ... to authenticated` niet
-- stilletjes een gat terugzet. v_mail_chunk_source leest bovendien
-- `mail_accounts`, en dáár heeft `authenticated` geen SELECT-grant op — met
-- alleen invoker=on zou een lezer een permission-fout krijgen in plaats van
-- nul rijen. Fail closed, maar luidruchtig; de revoke maakt het eerlijk.
revoke select on public.v_mail_chunk_source            from authenticated, anon;
revoke select on public.v_hubspot_company_chunk_source from authenticated, anon;
revoke select on public.v_hubspot_contact_chunk_source from authenticated, anon;
revoke select on public.v_hubspot_deal_chunk_source    from authenticated, anon;
revoke select on public.v_agent_chat_health            from authenticated, anon;
revoke select on public.v_agent_chat_by_route          from authenticated, anon;
revoke select on public.v_agent_chat_coverage          from authenticated, anon;
revoke select on public.v_meeting_entity_link_health   from authenticated, anon;

comment on view public.v_mail_chunk_source is
  'Bron voor de chunker (service_role). GEEN browsertoegang: security_invoker=on én revoke van authenticated — de view draagt body_text/body_html van elke mail. Multi-user P0, 2026-09-14.';
comment on view public.v_agent_chat_health is
  'Telemetrie voor agent_chat_health_check() (SECURITY DEFINER + assert_can_manage_dashboard). Geen directe browsertoegang. Multi-user P0, 2026-09-14.';

-- ── 3. De materialized view ─────────────────────────────────────────────────
-- RLS geldt niet op een matview. Intrekken is dus het enige echte slot; de
-- lezer gaat langs een view die de rol expliciet toetst. Die ACL-view staat
-- bewust NIET op security_invoker: hij moet de matview namens de eigenaar
-- lezen, en doet zijn poort in het WHERE-predicaat. Dat is dezelfde afweging
-- als bij een SECURITY DEFINER-functie met een guard-helper.
revoke select on public.v_hubspot_future_index from authenticated, anon;

create or replace view public.v_hubspot_future_index_acl as
  select * from public.v_hubspot_future_index
   where public.is_admin_or_higher();

grant select on public.v_hubspot_future_index_acl to authenticated;

comment on view public.v_hubspot_future_index_acl is
  'Geguarde ingang op de matview v_hubspot_future_index (RLS geldt niet op een matview). Bewust security_invoker=off: de view leest de matview als eigenaar en toetst de aanroeper in het WHERE-predicaat. Vervang is_admin_or_higher() door has_capability(''data.crm.lezen'') zodra de CRM-leesrechten voor members bestaan. Multi-user P0, 2026-09-14.';

-- ── 4. Storage: km-excels ───────────────────────────────────────────────────
-- Research §1.5: de policy test alleen op bucket_id, dus elke ingelogde
-- gebruiker leest de bucket. Het Kilometers-product is in v1.135 gestript
-- (PR #37/#38); de bucket en zijn leesregel bleven staan. De regel gaat dicht,
-- de bucket blijft (leegmaken/verwijderen is een aparte, onomkeerbare keuze).
drop policy if exists km_excels_authenticated_select on storage.objects;

create policy km_excels_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'km-excels' and public.is_app_owner());

commit;

-- ── Verificatie (draai deze ná de migratie) ─────────────────────────────────
-- 1) Geen view meer zonder poort:
--    select c.relname,
--           coalesce((select o from unnest(c.reloptions) o where o like 'security_invoker%'),'(geen)') si,
--           has_table_privilege('authenticated', c.oid, 'SELECT') auth_select
--      from pg_class c join pg_namespace n on n.oid=c.relnamespace
--     where n.nspname='public' and c.relkind in ('v','m')
--       and has_table_privilege('authenticated', c.oid, 'SELECT')
--       and coalesce((select o from unnest(c.reloptions) o where o like 'security_invoker%'),'') <> 'security_invoker=on';
--    → verwacht: alleen v_hubspot_future_index_acl (geguard in het predicaat).
--
-- 2) Positieve controle (belangrijker dan 1): een owner-sessie MÉT tweede
--    factor moet ná deze migratie evenveel zien als ervóór —
--    agent_runs_health_7d 28, v_hubspot_future_index_acl 1.295.
--    Zie scripts/multi_user_acl_eval.cjs (M5/M6).
