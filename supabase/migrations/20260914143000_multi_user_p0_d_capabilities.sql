-- =============================================================================
-- Multi-user P0 · skelet — capabilities, presets en het maandplafond  (v1.190)
-- =============================================================================
-- Hoort bij RESEARCH-MULTI-USER.md §4.4 en DESIGN-NOTES.md (optie C), en legt
-- Jelle's vijf beslissingen van 2026-09-14 vast in de database.
--
-- ⚠ Dit is een SKELET. Geen enkele policy, RPC of view leest vandaag
-- `has_capability()`. Dat is met opzet: de poort moet eerst bewezen zijn (M7:
-- faalt closed) voordat er handhaving aan hangt. Stap 3 van DESIGN-NOTES —
-- nav-filter en OrganisatieView van `isOwner` naar `has_capability(...)` — is
-- een aparte PR, en zolang `role_capabilities` voor de owner álles bevat is die
-- omzetting voor Jelle een no-op.
--
-- ── Het model ───────────────────────────────────────────────────────────────
--     effectieve rechten (user) = preset(app_role) Δ overrides(user)
--
-- Twee rollen blijven (`owner`, `member`); de CHECK-constraint op
-- user_roles.app_role gaat niet open. Wie "bijna owner" moet zijn krijgt
-- vinkjes. Dat is letterlijk wat Jelle vroeg: "standaard dingen die we
-- afgesproken hebben auto gevinkt; ik kan Organisatie etc. erbij vinken."
--
-- ── Drie kolommen die niet in het onderzoek stonden ─────────────────────────
-- `ui_bundle`    Beslissing 3 = **één vinkje** voor Organisatie. De database
--                houdt de vijf rechten los (zodat zeven vinkjes later een
--                UI-wijziging zijn en geen migratie), de UI zet ze samen via
--                deze kolom. Platform en API Keys zitten bewust NIET in de
--                bundel: die zijn `grantable = false`.
-- `levert_vandaag`  Het gevaarlijkste beeld in dit scherm is een vinkje dat
--                aan staat en niets doet (DESIGN-NOTES, de amberregel). Deze
--                kolom zegt eerlijk of een recht bij een member vandaag ook
--                écht data oplevert. `false` + `toelichting` = amberregel.
-- `afdwingen_in` De laatste kolom uit de researchmatrix, als data in plaats van
--                als tekst in een document dat veroudert.
--
-- ── Beslissing 2 staat er al in, en levert nog niets ────────────────────────
-- "Member: CRM-spiegel lezen mag." Dat staat hieronder in de member-preset
-- (`administratie`, `data.crm.lezen`) met `levert_vandaag = false`: de RLS op
-- hubspot_deals/-companies/-contacts is vandaag `is_admin_or_higher()`, dus een
-- member ziet er nul rijen. De omzetting is één policy-migratie en een bewuste
-- stap — het vinkje staat er alvast, maar liegt niet over wat het doet.
--
-- ── Terugdraaien ────────────────────────────────────────────────────────────
--   drop function public.my_capabilities, public.user_capabilities_overview,
--                 public.has_capability;
--   drop table public.user_capabilities, public.role_capabilities,
--              public.capabilities, public.user_model_budget;
--   drop view public.v_user_model_usage_month, public.v_model_usage_dekking;
-- =============================================================================

begin;

-- ── 1. De catalogus ─────────────────────────────────────────────────────────
create table if not exists public.capabilities (
  key            text primary key,
  soort          text not null check (soort in ('module','data','handeling')),
  groep          text not null,
  label          text not null,
  omschrijving   text,
  grantable      boolean not null default true,
  levert_vandaag boolean not null default false,
  afdwingen_in   text,
  ui_bundle      text,
  toelichting    text,
  sort_order     int not null default 0
);

comment on table public.capabilities is
  'Catalogus van rechten: één rij per recht, data en geen enum — de UI tekent hieruit. Drie assen in `soort`: module (wat zie ik in de nav), data (wiens gegevens zie ik daarbinnen), handeling (wat mag ik doen). Multi-user P0, RESEARCH-MULTI-USER.md §3.3.';
comment on column public.capabilities.grantable is
  'false = hard owner-only, niet uit te delen. Een override op zo''n recht telt niet mee (secrets, platform, API keys).';
comment on column public.capabilities.levert_vandaag is
  'false = het vinkje kan aan staan maar levert een member vandaag geen data — de amberregel uit DESIGN-NOTES. Lees `toelichting` voor de reden.';
comment on column public.capabilities.ui_bundle is
  'Rechten met dezelfde bundelnaam worden in de UI als één vinkje getoond (beslissing 3: Organisatie = één vinkje). De handhaving blijft per recht.';

-- ── 2. De preset per rol ────────────────────────────────────────────────────
create table if not exists public.role_capabilities (
  app_role   text not null check (app_role in ('owner','member')),
  capability text not null references public.capabilities(key) on delete cascade,
  primary key (app_role, capability)
);
comment on table public.role_capabilities is
  'De afgesproken standaard per rol — "auto gevinkt". Zolang de owner-rij álles bevat, is het omzetten van een policy van is_admin_or_higher() naar has_capability() voor Jelle een no-op.';

-- ── 3. De afwijking per persoon ─────────────────────────────────────────────
create table if not exists public.user_capabilities (
  user_id    uuid not null references auth.users(id) on delete cascade,
  capability text not null references public.capabilities(key) on delete cascade,
  effect     text not null check (effect in ('grant','revoke')),
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  note       text,
  primary key (user_id, capability)
);
comment on table public.user_capabilities is
  'Het vinkje dat de owner zelf zet of weghaalt bij één persoon. Wint altijd van de preset — ook als hij iets wéghaalt. Multi-user P0.';

-- ── 4. De catalogus vullen ──────────────────────────────────────────────────
insert into public.capabilities (key, soort, groep, label, omschrijving, grantable, levert_vandaag, afdwingen_in, ui_bundle, toelichting, sort_order) values
 -- As A · modules — werk
 ('home',                 'module','Werk','Dashboard','De startpagina met de stuurkaarten.',                                  true, true,  'UI',              null, null, 10),
 ('analyse',              'module','Werk','Chat en vragenbak','Vragen stellen over de eigen bronnen.',                        true, true,  'UI + rag-chat',   null, 'De caller-scope in rag-chat bepaalt wat er terugkomt; zonder space-grants is dat de org-baseline.', 20),
 ('postvak',              'module','Werk','Postvak','Inbox, drafts en de postvak-instellingen.',                              true, true,  'UI + RLS',        null, 'Werkt pas als de persoon een eigen mailbox-koppeling heeft (beslissing 4); zonder rij in mail_accounts blijft het leeg.', 30),
 ('agenda',               'module','Werk','Agenda','Afspraken en de spelregels eromheen.',                                    true, true,  'UI + RLS',        null, null, 40),
 ('taken',                'module','Werk','Taken','Mijn taken en projecten.',                                                 true, true,  'UI + RLS',        null, null, 50),
 ('kennisbank.lezen',     'module','Werk','Kennisbank lezen','Artikelen raadplegen.',                                         true, true,  'UI + RLS',        null, null, 60),
 ('instellingen.eigen',   'module','Werk','Eigen instellingen','Profiel, connectors, tweede factor.',                         true, true,  'UI',              null, null, 70),
 ('kennisbank.beheren',   'module','Werk','Kennisbank beheren','Review-queue en artikelen vaststellen.',                      true, false, 'RLS',             null, 'De kb_*-tabellen staan op eigen rijen; een member ziet zijn eigen (nul) voorstellen.', 80),
 -- As A · modules — stuurinformatie
 ('administratie',        'module','Stuurinformatie','Administratie','De HubSpot-spiegel: deals, bedrijven, contacten.',      true, false, 'nog niet (RLS)',  null, 'Beslissing 2 zegt: member mag de CRM-spiegel lezen. De RLS op hubspot_deals/-companies/-contacts is vandaag is_admin_or_higher(), dus dit levert nu nul rijen. Omzetten is één policy-migratie.', 110),
 ('pipeline',             'module','Stuurinformatie','Pijplijn (D1)','Het commerciële stuurbord.',                            true, false, 'nog niet (RLS)',  null, 'Leest de HubSpot-spiegel; zie administratie.', 120),
 ('datakwaliteit',        'module','Stuurinformatie','Datakwaliteit (D9)','Hygiënechecks op de CRM-data.',                    true, false, 'nog niet (RLS)',  null, 'Leest de HubSpot-spiegel; zie administratie.', 130),
 ('klantverlies',         'module','Stuurinformatie','Klantverlies (D10)','Wie is weggegaan en waarom.',                      true, false, 'nog niet (RLS)',  null, 'Leest de HubSpot-spiegel; zie administratie.', 140),
 ('klantbase',            'module','Stuurinformatie','Klantbase','Overdracht en verlengingen.',                               true, false, 'nog niet (RLS)',  null, 'Leest de HubSpot-spiegel; zie administratie.', 150),
 ('kwartaaldiagnose',     'module','Stuurinformatie','Kwartaaldiagnose','Het kwartaalbeeld.',                                 true, false, 'nog niet (RLS)',  null, 'Leest de HubSpot-spiegel; zie administratie.', 160),
 ('legalai',              'module','Stuurinformatie','Legal AI','Het marktbeeld.',                                            true, false, 'UI + RLS',        null, null, 170),
 -- As A · modules — organisatie (beslissing 3: één vinkje, bundel `organisatie`)
 ('organisatie.gebruikers','module','Organisatie','Gebruikers','Mensen toevoegen, uitnodigen, rechten zetten.',               true, false, 'RPC + RLS',       'organisatie', 'list_users_for_admin() eist vandaag de owner-rol.', 210),
 ('organisatie.health',   'module','Organisatie','Health','Draaien de agents.',                                              true, false, 'RLS',             'organisatie', 'agent_runs + agent_schedules staan op is_admin_or_higher().', 220),
 ('organisatie.security', 'module','Organisatie','Security','Bevindingen en meldingen.',                                      true, false, 'RLS',             'organisatie', null, 230),
 ('organisatie.skills',   'module','Organisatie','Skills','De org-skills en hun injectie.',                                   true, false, 'RLS',             'organisatie', null, 240),
 ('organisatie.pijplijn', 'module','Organisatie','Pijplijn','De RAG-keten van bron tot antwoord.',                            true, false, 'RLS',             'organisatie', null, 250),
 ('instellingen.beheer',  'module','Organisatie','Beheerinstellingen','Agents, terminologie, templates, externe partijen.',   true, false, 'nog niet (UI)',   null, 'SettingsView.jsx heeft een lege ADMIN_ONLY_PAGES; de afscherming zit vandaag alleen in de RLS eronder.', 260),
 ('organisatie.platform', 'module','Organisatie','Platform','Config, edge functions, database.',                              false, false,'hard owner-only', null, 'Niet uit te delen (research §3.3).', 270),
 ('organisatie.apikeys',  'module','Organisatie','API keys','Tokens en sleutels.',                                            false, false,'hard owner-only', null, 'Niet uit te delen (research §3.3).', 280),
 -- As B · data-bereik
 ('data.mail.eigen',      'data','Bereik','Eigen mail','De eigen mailbox en drafts.',                                         true, true,  'RLS',             null, null, 310),
 ('data.agenda.eigen',    'data','Bereik','Eigen agenda','De eigen afspraken.',                                               true, true,  'RLS',             null, null, 320),
 ('data.confluence.spaces','data','Bereik','Confluence-spaces','Per space, via confluence_space_grants.',                     true, true,  'confluence_space_grants', null, 'Het enige per-user bereik dat vandaag volledig werkt. Zonder grants ziet iemand alleen de org-baseline.', 330),
 ('data.crm.lezen',       'data','Bereik','CRM-spiegel lezen','HubSpot-deals, -bedrijven en -contacten.',                     true, false, 'nog niet (RLS)',  null, 'Beslissing 2 = ja. De policy-omzetting moet nog gebeuren; tot dan nul rijen.', 340),
 ('data.crm.schrijven',   'data','Bereik','CRM-spiegel schrijven','Terugschrijven naar HubSpot.',                             true, false, 'nog niet (edge)', null, 'hubspot-write doet geen rolcheck (GAP-3, P1).', 350),
 ('data.telemetrie',      'data','Bereik','Telemetrie','agent_runs, claude_api_*, evalresultaten.',                           true, false, 'RLS',             null, null, 360),
 ('data.mail.collega',    'data','Bereik','Mail van een collega','De mailbox van iemand anders inzien.',                      false, false,'bestaat niet',    null, 'Fase 3 uit het meiplan. Niet ontworpen, niet gebouwd, niet uit te delen.', 370),
 -- As C · handelingen
 ('agent.uitvoeren',      'handeling','Handelingen','Agents starten','request_run_now en de trigger-RPC''s.',                 true, false, 'RPC-poort',       null, 'De RPC eist sinds multi-user P0 de owner-rol; de capability wordt daar nog niet gelezen.', 410),
 ('agent.instructies',    'handeling','Handelingen','Agent-instructies wijzigen','upsert_agent_instructions.',                true, false, 'RPC-poort',       null, 'Idem.', 420),
 ('mail.versturen',       'handeling','Handelingen','Mailbesluit uitvoeren','Een draft als Outlook-concept plaatsen.',        true, false, 'RPC-poort',       null, 'Vandaag owner-only via require_dashboard_auth(); wordt per-user zodra members een eigen mailbox hebben.', 430),
 ('modellen.gebruiken',   'handeling','Handelingen','Betaalde model-calls','Taalcheck, transcribe, kb-compose, chat.',        true, true,  'nog niet (edge)', null, 'Zes user-callable Edge Functions doen model-calls zonder rolcheck (GAP-3, P1). Het plafond uit beslissing 5 staat in user_model_budget maar wordt nog nergens afgedwongen.', 440),
 ('secrets.beheren',      'handeling','Handelingen','Secrets','Sleutels zetten, roteren, intrekken.',                         false, false,'hard owner-only', null, 'Niet uit te delen.', 450),
 ('gebruikers.beheren',   'handeling','Handelingen','Gebruikers beheren','Aanmaken, uitnodigen, rol wijzigen.',               false, false,'edge (staat al)', null, 'create-user en invite-user doen al een eigen rolcheck.', 460)
on conflict (key) do nothing;

-- ── 5. De presets ───────────────────────────────────────────────────────────
-- Owner: alles. Dat is de reden dat een policy van is_admin_or_higher() naar
-- has_capability() omzetten voor Jelle niets verandert.
insert into public.role_capabilities (app_role, capability)
  select 'owner', key from public.capabilities
on conflict do nothing;

-- Member: de zeven werk-modules, het eigen bereik, en de twee CRM-rechten uit
-- beslissing 2 (die vandaag nog niets opleveren — zie levert_vandaag).
insert into public.role_capabilities (app_role, capability) values
 ('member','home'), ('member','analyse'), ('member','postvak'), ('member','agenda'),
 ('member','taken'), ('member','kennisbank.lezen'), ('member','instellingen.eigen'),
 ('member','data.mail.eigen'), ('member','data.agenda.eigen'), ('member','data.confluence.spaces'),
 ('member','administratie'), ('member','data.crm.lezen'),
 ('member','mail.versturen'), ('member','modellen.gebruiken')
on conflict do nothing;

-- ── 6. De afdwinger ─────────────────────────────────────────────────────────
create or replace function public.has_capability(p_key text, p_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with caller as (
    -- Zelfde tak als confluence_allowed_spaces(): een browsersessie mag NOOIT
    -- namens een ander vragen. Alleen interne callers geven p_user mee.
    select case
      when coalesce(auth.role(), '') in ('authenticated', 'anon')
        then (select auth.uid())
      else coalesce(p_user, (select auth.uid()))
    end as uid
  ),
  rol as (
    -- Rechtstreeks op de caller-uid, NOOIT via current_user_role(): die geeft
    -- 'member' bij een lege auth.uid() en faalt dus open (geheugen
    -- current-user-role-fails-open-without-uid).
    select r.app_role from public.user_roles r
     where r.user_id = (select uid from caller)
  )
  select coalesce((
    select case
      -- Geen uid of geen rol ⇒ dicht.
      when (select app_role from rol) is null then false
      -- Niet uit te delen ⇒ alleen de owner, ook als er een override staat.
      when not c.grantable then (select app_role from rol) = 'owner'
      -- Persoonlijke afwijking wint van de preset, in beide richtingen.
      else coalesce(
        (select uc.effect = 'grant'
           from public.user_capabilities uc
          where uc.user_id = (select uid from caller) and uc.capability = c.key),
        exists (select 1 from public.role_capabilities rc
                 where rc.app_role = (select app_role from rol) and rc.capability = c.key))
    end
    from public.capabilities c
    where c.key = p_key
  ), false);   -- onbekende key ⇒ dicht
$function$;

comment on function public.has_capability(text, uuid) is
  'De enige plek waar een recht wordt uitgerekend: preset(rol) Δ override(persoon). Faalt closed op een onbekende key, een lege uid en een onbekende rol. Nog nergens in een policy gebruikt — skelet, multi-user P0.';

revoke execute on function public.has_capability(text, uuid) from public, anon;
grant  execute on function public.has_capability(text, uuid) to authenticated, service_role;

-- ── 7. Eén RPC voor de UI ───────────────────────────────────────────────────
create or replace function public.my_capabilities()
returns table(capability text, soort text, groep text, label text, omschrijving text,
              actief boolean, bron text, grantable boolean, levert_vandaag boolean,
              afdwingen_in text, ui_bundle text, toelichting text, sort_order int)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select c.key, c.soort, c.groep, c.label, c.omschrijving,
         public.has_capability(c.key) as actief,
         case
           when not c.grantable then 'vast'
           when exists (select 1 from public.user_capabilities uc
                         where uc.user_id = (select auth.uid()) and uc.capability = c.key)
             then 'persoonlijk'
           else 'rol'
         end as bron,
         c.grantable, c.levert_vandaag, c.afdwingen_in, c.ui_bundle, c.toelichting, c.sort_order
    from public.capabilities c
   order by c.sort_order;
$function$;

comment on function public.my_capabilities() is
  'De effectieve rechten van de ingelogde gebruiker, mét de catalogus eromheen zodat de UI niet hoeft te raden. Vervangt op termijn de handgeschreven lijst in MemberInfoModal (UsersPage.jsx:51), die aantoonbaar niet meer klopt. Multi-user P0.';

revoke execute on function public.my_capabilities() from public, anon;
grant  execute on function public.my_capabilities() to authenticated, service_role;

-- ── 8. De doorkijk voor de owner ────────────────────────────────────────────
-- "Wat ziet Victor?" — de derde kolom van optie C. Owner-only, en afgeleid uit
-- dezelfde bron als de handhaving, zodat die tekst niet kan verouderen.
create or replace function public.user_capabilities_overview(p_user uuid)
returns table(capability text, soort text, groep text, label text,
              actief boolean, bron text, grantable boolean, levert_vandaag boolean,
              ui_bundle text, toelichting text, sort_order int)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.assert_can_manage_dashboard();
  return query
    select c.key, c.soort, c.groep, c.label,
           public.has_capability(c.key, p_user) as actief,
           case
             when not c.grantable then 'vast'
             when exists (select 1 from public.user_capabilities uc
                           where uc.user_id = p_user and uc.capability = c.key)
               then 'persoonlijk'
             else 'rol'
           end as bron,
           c.grantable, c.levert_vandaag, c.ui_bundle, c.toelichting, c.sort_order
      from public.capabilities c
     order by c.sort_order;
end;
$function$;

revoke execute on function public.user_capabilities_overview(uuid) from public, anon;
grant  execute on function public.user_capabilities_overview(uuid) to authenticated, service_role;

-- ── 9. RLS op de drie tabellen ──────────────────────────────────────────────
alter table public.capabilities      enable row level security;
alter table public.role_capabilities enable row level security;
alter table public.user_capabilities enable row level security;

drop policy if exists capabilities_read        on public.capabilities;
drop policy if exists capabilities_owner_write on public.capabilities;
create policy capabilities_read on public.capabilities
  for select to authenticated using (true);
create policy capabilities_owner_write on public.capabilities
  for all to authenticated using (public.is_admin_or_higher()) with check (public.is_admin_or_higher());

drop policy if exists role_capabilities_read        on public.role_capabilities;
drop policy if exists role_capabilities_owner_write on public.role_capabilities;
create policy role_capabilities_read on public.role_capabilities
  for select to authenticated using (true);
create policy role_capabilities_owner_write on public.role_capabilities
  for all to authenticated using (public.is_admin_or_higher()) with check (public.is_admin_or_higher());

drop policy if exists user_capabilities_read_self_or_owner on public.user_capabilities;
drop policy if exists user_capabilities_owner_write        on public.user_capabilities;
create policy user_capabilities_read_self_or_owner on public.user_capabilities
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_or_higher());
create policy user_capabilities_owner_write on public.user_capabilities
  for all to authenticated
  using (public.is_admin_or_higher()) with check (public.is_admin_or_higher());

-- ── 10. Het maandplafond (beslissing 5) ─────────────────────────────────────
-- Default €50 per member per maand. Zelfde vorm als mail_enrichment_budget, de
-- enige budgetmachinerie die dit project al had.
create table if not exists public.user_model_budget (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  monthly_cap_eur  numeric not null default 50 check (monthly_cap_eur >= 0),
  alert_at_pct     numeric not null default 80 check (alert_at_pct between 1 and 100),
  paused           boolean not null default false,
  paused_reason    text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id)
);

comment on table public.user_model_budget is
  'Plafond op betaalde model-calls per persoon per maand (beslissing 5, 2026-09-14: default €50). Nog NERGENS afgedwongen: de zes user-callable Edge Functions die model-calls doen hebben geen rolcheck en lezen dit plafond niet (GAP-3, P1). Een rij ontbreken = het default-plafond geldt; zie v_user_model_budget.';

alter table public.user_model_budget enable row level security;
drop policy if exists user_model_budget_read_self_or_owner on public.user_model_budget;
drop policy if exists user_model_budget_owner_write        on public.user_model_budget;
create policy user_model_budget_read_self_or_owner on public.user_model_budget
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin_or_higher());
create policy user_model_budget_owner_write on public.user_model_budget
  for all to authenticated
  using (public.is_admin_or_higher()) with check (public.is_admin_or_higher());

-- Iedereen een rij, ook zonder expliciete instelling: het plafond is de regel,
-- niet de uitzondering.
create or replace view public.v_user_model_budget
with (security_invoker = on) as
  select r.user_id,
         coalesce(b.monthly_cap_eur, 50)::numeric as monthly_cap_eur,
         coalesce(b.alert_at_pct, 80)::numeric    as alert_at_pct,
         coalesce(b.paused, false)                as paused,
         (b.user_id is not null)                  as expliciet_gezet
    from public.user_roles r
    left join public.user_model_budget b on b.user_id = r.user_id;

grant select on public.v_user_model_budget to authenticated;

-- ── 11. Wat er vandaag écht te meten valt ───────────────────────────────────
-- Geen verzonnen cijfers. Wat er is:
--   • rag_chat_query_log.est_cost_usd  — 311 vragen in september, $4,98
--   • agent_chat_runs.caller_user_id   — de enige kolom in dit hele schema die
--     een model-call aan een persoon koppelt
--   • claude_api_calls                 — 253 rijen, laatste 2026-05-19: dood
-- Gemeten 2026-09-14: van de 311 septembervragen zijn er **37 toewijsbaar**
-- ($0,66 van $4,98). De Usage-pagina moet dus niet één totaalbedrag per persoon
-- tonen alsof dat het hele verhaal is, maar het toegewezen deel mét de noemer —
-- zelfde regel als DOC-10/11/12 in de agent-docs: `1/4` is een ander bericht
-- dan `1/1`, en `0/0` is geen groen maar een onthouding.
create or replace view public.v_user_model_usage_month
with (security_invoker = on) as
  select r.caller_user_id                      as user_id,
         date_trunc('month', q.asked_at)::date as maand,
         count(*)                              as vragen,
         round(sum(q.est_cost_usd)::numeric, 4) as cost_usd
    from public.rag_chat_query_log q
    join public.agent_chat_runs r on r.id = q.run_id
   where r.caller_user_id is not null
     and not q.meta ? 'eval_run_id'
   group by 1, 2;

comment on view public.v_user_model_usage_month is
  'Model-kosten per persoon per maand, voor zover toewijsbaar. Bron: rag_chat_query_log.est_cost_usd via agent_chat_runs.caller_user_id — de enige echte koppeling tussen een model-call en een mens die dit schema vandaag heeft. Lees hem NOOIT zonder v_model_usage_dekking ernaast: in september was 12% van de vragen toewijsbaar. Multi-user P0.';

create or replace view public.v_model_usage_dekking
with (security_invoker = on) as
  select date_trunc('month', q.asked_at)::date  as maand,
         count(*)                                as vragen_totaal,
         count(*) filter (where r.caller_user_id is not null) as vragen_toegewezen,
         round(sum(q.est_cost_usd)::numeric, 4)  as usd_totaal,
         round(sum(q.est_cost_usd) filter (where r.caller_user_id is not null)::numeric, 4) as usd_toegewezen
    from public.rag_chat_query_log q
    left join public.agent_chat_runs r on r.id = q.run_id
   where not q.meta ? 'eval_run_id'
   group by 1;

comment on view public.v_model_usage_dekking is
  'De noemer bij v_user_model_usage_month: hoeveel van de model-kosten is überhaupt aan een persoon toe te wijzen. Zonder deze view leest een Usage-pagina als volledig terwijl ze in september 13% van de kosten laat zien.';

grant select on public.v_user_model_usage_month, public.v_model_usage_dekking to authenticated;

-- De omrekening naar euro is een keuze, geen meting. Hij staat als parameter
-- met waarde NULL — zelfde patroon als kwartaaldoel_mrr: zolang de waarde leeg
-- is toont de UI een lege plek mét reden, nooit een verzonnen koers.
insert into public.dash_parameters (sleutel, waarde, eenheid, geldig_vanaf, bron, peildatum, toelichting) values
 ('model_budget_usd_per_eur', null, 'usd_per_euro', current_date,
  'Multi-user P0, beslissing 5 (2026-09-14)', current_date,
  'NOG NIET VASTGELEGD. Het plafond uit beslissing 5 staat in euro (€50/maand), de gemeten kosten staan in dollar (rag_chat_query_log.est_cost_usd). Zolang deze koers NULL is toont de Usage-pagina dollars en een lege plek waar de euro hoort — nooit een zelf gekozen wisselkoers.')
on conflict (sleutel) do nothing;

commit;

-- ── Verificatie ─────────────────────────────────────────────────────────────
-- M7 (faalt closed):
--   select public.has_capability('bestaat.niet')        -> false
--   select public.has_capability('home', null)          -> false zonder auth.uid()
--   select public.has_capability('organisatie.platform',
--            '<member-uuid>')                           -> false (grantable=false)
-- Preset:
--   select count(*) from public.role_capabilities where app_role='owner'   -> 36
--   select count(*) from public.role_capabilities where app_role='member'  -> 14
