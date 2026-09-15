-- =============================================================================
-- Multi-user SECURITY PR-B — de vier lege catalogi (S2)
-- =============================================================================
-- Vier modules in de member-preset lazen een owner-only opzoektabel. De module
-- opende half leeg: Taken zonder projecten, Postvak zonder actie-catalogus,
-- Kennisbank zonder categorieën, Agenda zonder stedenlijst.
--
-- Dit zijn catalogi (geen persoonsgegevens). Additieve SELECT-policies via
-- capability_gate() —zelfde vorm als migratie m2_b. Gebruik NOOIT kale
-- has_capability(): die kent geen tweede factor (geheugen
-- has-capability-has-no-mfa-arm).
--
-- Beslissingen (Jelle-default via parent, ASK-widget overgeslagen):
--   • task_projects = kantoor-gedeeld → capability_gate('taken')
--   • administratie/HubSpot = NIET openen (S3 out of scope)
--   • kb_documents blijft owner-only (categorieën volstaan voor de pagina)
--
-- M4 blijft groen (geen van de vier staat in GEHEIM). M6 kan niet omvallen
-- (additief).
-- =============================================================================

begin;

-- Opzoektabellen, geen persoonsgegevens: de module eromheen zit in de member-preset.
drop policy if exists task_projects_capability on public.task_projects;
create policy task_projects_capability on public.task_projects
  for select to authenticated
  using ((select public.capability_gate('taken')));

drop policy if exists autodraft_actions_capability on public.autodraft_actions;
create policy autodraft_actions_capability on public.autodraft_actions
  for select to authenticated
  using ((select public.capability_gate('postvak')));

drop policy if exists kb_categories_capability on public.kb_categories;
create policy kb_categories_capability on public.kb_categories
  for select to authenticated
  using ((select public.capability_gate('kennisbank')));

drop policy if exists cities_lookup_capability on public.cities_lookup;
create policy cities_lookup_capability on public.cities_lookup
  for select to authenticated
  using ((select public.capability_gate('agenda')));

comment on policy task_projects_capability on public.task_projects is
  'Multi-user SECURITY PR-B / S2 · kantoor-gedeelde projectcatalogus. Additief naast task_projects_read_authenticated (owner). Schrijven blijft owner-only.';
comment on policy autodraft_actions_capability on public.autodraft_actions is
  'Multi-user SECURITY PR-B / S2 · actie-catalogus voor Postvak. Additief naast autodraft_actions_authenticated (owner).';
comment on policy kb_categories_capability on public.kb_categories is
  'Multi-user SECURITY PR-B / S2 · categorie-catalogus voor Kennisbank. kb_documents blijft owner-only tot echte KB-uitrol.';
comment on policy cities_lookup_capability on public.cities_lookup is
  'Multi-user SECURITY PR-B / S2 · stedenlijst voor Agenda. Additief naast cities_lookup_owner.';

commit;
