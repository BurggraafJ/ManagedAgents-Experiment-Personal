-- =============================================================================
-- Stuurinformatie-fundament A — parameters en gebeurtenissen      (v1.173)
-- =============================================================================
-- Twee kleine tabellen die onder álle commerciële borden (D1, D9, D10) liggen.
-- Ze bestaan omdat twee soorten keuzes nooit in code of in JSX horen:
--
--   dash_parameters    drempels, doelen en prijzen. "Geen volgende stap na 14
--                      dagen" is een keuze, geen natuurwet; hij hoort zichtbaar
--                      in de legenda van het bord te staan en op één plek
--                      gewijzigd te kunnen worden. Elke rij draagt zijn eigen
--                      peildatum en bron, zodat een doel uit augustus niet stil
--                      naast data van vandaag komt te staan (Methodiek 8).
--
--   events_annotaties  de gebeurtenissen die een knik in een lijn verklaren:
--                      prijswijziging, start van de SDR, herdefinitie van een
--                      KPI. Getekend als verticale markering op elke tijdas.
--                      De goedkoopste vorm van "waarom" die er bestaat.
--
-- Bron: dashboarding-onderzoek 2026-09-12 §8 stap 0b; skill `dashboarding`
-- (bouwproces.md "Metric layer, snapshots en gebeurtenissenlog").
--
-- Rechten: lezen mag elke ingelogde gebruiker (een drempel is geen geheim en de
-- legenda van een bord moet hem kunnen tonen); schrijven is admin-only. De
-- borden zelf zijn admin-only omdat hun data dat is, niet omdat de parameter
-- dat is.
--
-- Terugdraaien: `drop table public.dash_parameters, public.events_annotaties;`
-- =============================================================================

-- ── 1. dash_parameters ───────────────────────────────────────────────────────
create table if not exists public.dash_parameters (
  sleutel       text primary key,
  waarde        numeric,
  eenheid       text,
  geldig_vanaf  date        not null default current_date,
  bron          text,
  peildatum     date,
  toelichting   text,
  updated_at    timestamptz not null default now()
);

comment on table public.dash_parameters is
  'Drempels, doelen en prijzen achter de commerciële borden (D1/D9/D10). Eén rij per keuze, met de bron en de peildatum van díé keuze. De UI toont de waarde in de legenda en rekent er niet zelf mee. waarde mag NULL zijn: dat betekent "nog niet vastgelegd" en hoort op het bord als lege plek te verschijnen, niet als 0.';
comment on column public.dash_parameters.peildatum is
  'Peildatum van de bron van deze parameter — NIET de peildatum van de data. Een bord dat beide toont, mengt ze nooit stil (Methodiek 8).';

alter table public.dash_parameters enable row level security;

drop policy if exists dash_parameters_read on public.dash_parameters;
create policy dash_parameters_read on public.dash_parameters
  for select to authenticated using (true);

drop policy if exists dash_parameters_admin_write on public.dash_parameters;
create policy dash_parameters_admin_write on public.dash_parameters
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists dash_parameters_service on public.dash_parameters;
create policy dash_parameters_service on public.dash_parameters
  for all to service_role using (true) with check (true);

grant select on public.dash_parameters to authenticated;

-- ── 2. events_annotaties ─────────────────────────────────────────────────────
create table if not exists public.events_annotaties (
  id           uuid primary key default gen_random_uuid(),
  datum        date not null,
  gebeurtenis  text not null,
  borden       text[] not null default '{}',
  bron         text,
  toelichting  text,
  created_at   timestamptz not null default now(),
  unique (datum, gebeurtenis)
);

comment on table public.events_annotaties is
  'Gebeurtenissenlog voor de tijdassen van de commerciële borden: prijswijziging, start SDR, herdefinitie van een KPI. borden = de D-nummers die de markering tonen (bv. {D1,D10}).';

create index if not exists events_annotaties_datum_idx on public.events_annotaties (datum);

alter table public.events_annotaties enable row level security;

drop policy if exists events_annotaties_read on public.events_annotaties;
create policy events_annotaties_read on public.events_annotaties
  for select to authenticated using (true);

drop policy if exists events_annotaties_admin_write on public.events_annotaties;
create policy events_annotaties_admin_write on public.events_annotaties
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists events_annotaties_service on public.events_annotaties;
create policy events_annotaties_service on public.events_annotaties
  for all to service_role using (true) with check (true);

grant select on public.events_annotaties to authenticated;

-- ── 3. Seed — precies de parameters uit het onderzoek, niets verzonnen ───────
-- `on conflict do nothing`: een latere wijziging door Jelle wint van deze seed.
insert into public.dash_parameters (sleutel, waarde, eenheid, geldig_vanaf, bron, peildatum, toelichting) values
  ('h4_geen_next_step_dagen', 14, 'dagen', '2026-09-12',
   'Dashboarding-onderzoek 2026-09-12 (OB-5), open definitiepunt op KPI-definities 554795050', '2026-09-12',
   'Vanaf hoeveel dagen zonder geplande volgende activiteit een open deal op hygiënecheck H4 komt. Werkvoorstel: ruim beginnen, na drie weken evalueren.'),

  ('bc_duurgrens_dagen', 365, 'dagen', '2026-09-12',
   'Dashboarding-onderzoek 2026-09-12 (OB-1), Methodiek 3 (623017987)', '2026-09-12',
   'Grens tussen soort B (proef niet omgezet) en soort C (opzegging = churn) op D10. Dit is een duurregel, geen statusveld: verlengde proeven worden administratief nergens vastgelegd.'),

  ('bc_grensmarge_dagen', 35, 'dagen', '2026-09-12',
   'Dashboarding-onderzoek 2026-09-12 (OB-1)', '2026-09-12',
   'Marge rond de duurgrens waarbinnen een verlies op D10 als "grensgeval" wordt gemarkeerd. Gemeten 12-09-2026: B loopt tot 364 dagen, C begint op 380 — de wolken liggen 16 dagen uit elkaar, dus de regel is dun.'),

  ('kwartaaldoel_mrr', null, 'euro_per_maand', '2026-07-01',
   'Omzet & Doelen (Confluence 554762268)', '2026-08-12',
   'NOG NIET VASTGELEGD. Het kwartaaldoel staat handmatig op Omzet & Doelen met peildatum 12-08-2026 en realisatie t/m juni, in euro per maand en niet in licenties per kwartaal (OB-3). Zolang waarde NULL is toont D1 de dekkingskaart als lege plek met deze reden — nooit een verzonnen doel.'),

  ('prijs_kantoorbreed', 175, 'euro_per_gebruiker_per_maand', '2026-10-01',
   'Dashboarding-onderzoek 2026-09-12 (OB-4 / TODO 1)', '2026-09-12',
   'Lijstprijs kantoorbreed vanaf 01-10-2026. Waardering gebruikt verwachte_prijs waar gevuld, anders deze lijstprijs; de nieuwe prijzen gelden alleen bij een beslisdatum op of na 01-10-2026.'),

  ('prijs_zelfstandig', 135, 'euro_per_gebruiker_per_maand', '2026-10-01',
   'Dashboarding-onderzoek 2026-09-12 (OB-4 / TODO 1)', '2026-09-12',
   'Lijstprijs zelfstandig vanaf 01-10-2026. Zie prijs_kantoorbreed voor de toepassingsregel.')
on conflict (sleutel) do nothing;

insert into public.events_annotaties (datum, gebeurtenis, borden, bron, toelichting) values
  ('2026-10-01', 'Nieuwe prijsstelling van kracht', '{D1,D10}',
   'Dashboarding-onderzoek 2026-09-12 §8 (TODO 1)',
   'Vanaf deze datum gelden de nieuwe lijstprijzen. Deals met een beslisdatum vóór 01-10 worden op de oude prijs gewaardeerd; de markering op de tijdas maakt de knik leesbaar.'),
  ('2026-09-11', 'Start SDR — critical number 6 kennismakingen per week', '{D1}',
   'Dashboarding 642449420 §3, SDR-map 635633696',
   'Sinds 11-09-2026 is "gehouden kennismakingen per week" het critical number van de SDR, met doel 6.')
on conflict (datum, gebeurtenis) do nothing;
