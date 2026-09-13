-- =============================================================================
-- Stuurinformatie-fundament B — dim_stage (fase-mapping als data)   (v1.173)
-- =============================================================================
-- De vertaling van een HubSpot-stage-ID naar een fase ("fase 3", "verloren",
-- "proef") is een Methodiek-keuze, geen implementatiedetail. Hij mag dus niet
-- in JSX staan en ook niet in een CASE-expressie verspreid over vijf views:
-- wijzigt de keuze, dan wijzigt de tabel en niet de code
-- (skill `dashboarding`, bouwproces.md "Dimensietabellen").
--
-- Twee objecten:
--
--   dim_stage_fase   de mapping zelf — één rij per stage, met fase, of de
--                    stage nog "loopt", en of hij tot de kern-klantdeals hoort.
--                    Deze tabel is de bron voor élke berekening; ze staat los
--                    van de mirror, zodat een lege of afgeschermde
--                    hubspot_pipelines nooit stilletjes alle tellingen op nul
--                    zet. Dat is precies de faalwijze die een hygiënebord moet
--                    uitsluiten.
--
--   dim_stage        de presentatielaag: de mapping plus de lévende labels uit
--                    hubspot_pipelines. `fase_onbekend` markeert een stage die
--                    HubSpot wel kent maar deze mapping niet — dat is zelf een
--                    hygiënesignaal.
--
-- Stage-ID's en labels: dashboarding-onderzoek 2026-09-12 §1.1, geteld op de
-- mirror (Sales Pipeline 108 actieve deals, Customer Base 129) en één-op-één
-- aansluitend op de state-check van Confluence 642449420 van diezelfde dag.
--
-- Terugdraaien: `drop view public.dim_stage; drop table public.dim_stage_fase;`
-- =============================================================================

-- ── 1. De mapping ────────────────────────────────────────────────────────────
create table if not exists public.dim_stage_fase (
  stage_id     text primary key,
  pipeline_id  text not null,
  stage_label  text not null,
  fase         text not null,
  fase_label   text not null,
  is_open      boolean not null default false,
  is_kern      boolean not null default false,
  sort_order   integer not null default 0,
  bron         text,
  updated_at   timestamptz not null default now()
);

comment on table public.dim_stage_fase is
  'Stage-ID → fase, voor alle commerciële borden. Bewust een tabel en geen CASE in een view: de fase-indeling is een Methodiek-keuze die zonder deploy moet kunnen wijzigen.';
comment on column public.dim_stage_fase.is_open is
  'Loopt dit traject nog? Sales Pipeline: fase 1 t/m 3. Customer Base: proef, actief, niet gestart en self-service — een vernieuwde deal is administratief afgesloten (de relatie loopt door in de opvolger) en telt hier dus niet als open.';
comment on column public.dim_stage_fase.is_kern is
  'Kern-klantdeal: Actieve deals + Vernieuwd + Proeftijd. Dit is de populatie van hygiënecheck H8 (n=83 op 12-09-2026). Beëindigde deals staan er bewust buiten: die zijn historie en hun velden worden niet meer bijgewerkt.';

alter table public.dim_stage_fase enable row level security;

drop policy if exists dim_stage_fase_read on public.dim_stage_fase;
create policy dim_stage_fase_read on public.dim_stage_fase
  for select to authenticated using (true);

drop policy if exists dim_stage_fase_admin_write on public.dim_stage_fase;
create policy dim_stage_fase_admin_write on public.dim_stage_fase
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists dim_stage_fase_service on public.dim_stage_fase;
create policy dim_stage_fase_service on public.dim_stage_fase
  for all to service_role using (true) with check (true);

grant select on public.dim_stage_fase to authenticated;

-- ── 2. Seed — Sales Pipeline (`default`) ─────────────────────────────────────
insert into public.dim_stage_fase
  (stage_id, pipeline_id, stage_label, fase, fase_label, is_open, is_kern, sort_order, bron) values
  ('appointmentscheduled', 'default', 'Kennismaking plaatsgevonden',   '1',        'Fase 1 · Kennismaking',                   true,  false, 10, 'Methodiek 2 (623673345)'),
  ('4077073627',           'default', 'Offerte sturen',                '2',        'Fase 2 · Offerte sturen',                 true,  false, 20, 'Methodiek 2 (623673345)'),
  ('3206386936',           'default', 'Offerte gestuurd',              '3',        'Fase 3 · Offerte gestuurd',               true,  false, 30, 'Methodiek 2 (623673345)'),
  ('5732535537',           'default', 'In afwachting / onderhandeling','3',        'Fase 3 · In afwachting / onderhandeling', true,  false, 31, 'Methodiek 2 (623673345)'),
  ('contractsent',         'default', 'Mondeling/mail/offerte akkoord','3',        'Fase 3 · Mondeling akkoord',              true,  false, 32, 'Methodiek 2 (623673345)'),
  ('4075158742',           'default', 'Licentieovereenkomst gestuurd', '3',        'Fase 3 · Licentieovereenkomst gestuurd',  true,  false, 33, 'Methodiek 2 (623673345)'),
  ('3453858021',           'default', 'Gesloten & Gescoord',           'gewonnen', 'Gewonnen',                                false, false, 40, 'Methodiek 2 (623673345)'),
  ('3206386937',           'default', 'Afgevallen na demo',            'verloren', 'Verloren · Afgevallen na demo',           false, false, 50, 'Methodiek 2 (623673345)'),
  ('3206387898',           'default', 'Backburner na demo',            'verloren', 'Verloren · Backburner',                   false, false, 51, 'Methodiek 2 — backburner conservatief als verloren'),
  ('4984103151',           'default', 'Afgevallen 1-pitters',          'buiten',   'Buiten scope · 1-pitters',                false, false, 60, 'Methodiek 2 (623673345)')
on conflict (stage_id) do nothing;

-- ── 3. Seed — Customer Base (`2299277539`) ───────────────────────────────────
-- Let op: álle negen CB-stages dragen in HubSpot `isClosed = true` (gemeten
-- 12-09-2026). Dat is precies waarom `is_open` uit déze tabel komt en niet uit
-- de vlag van HubSpot: die zegt "deze stage sluit de deal", niet "deze klant is
-- weg". Zou een view op hubspot_is_closed leunen, dan telde de app nul actieve
-- klanten.
insert into public.dim_stage_fase
  (stage_id, pipeline_id, stage_label, fase, fase_label, is_open, is_kern, sort_order, bron) values
  ('4441727186', '2299277539', 'Not started',                             'niet_gestart', 'Niet gestart',              true,  false,  5, 'Methodiek 3 (623017987)'),
  ('5732554974', '2299277539', 'Kennismaking/Training plannen',           'onboarding',   'Onboarding',                true,  false,  7, 'Live stage-lijst 12-09-2026 (0 deals) — staat niet op de D9-pagina'),
  ('3504527569', '2299277539', 'Proeftijd',                               'proef',        'Proef',                     true,  true,  10, 'Methodiek 3 (623017987)'),
  ('3136444618', '2299277539', 'Actieve deals',                           'actief',       'Actief',                    true,  true,  20, 'Methodiek 3 (623017987)'),
  ('3417083067', '2299277539', 'Afgesloten - Vernieuwd',                  'vernieuwd',    'Vernieuwd',                 false, true,  30, 'Methodiek 3 (623017987)'),
  ('3504650455', '2299277539', 'Afgesloten - Beeindigd na gebruik',       'beeindigd',    'Beëindigd',                 false, false, 40, 'Methodiek 3 — B/C-splitsing op duur, zie dash_parameters.bc_duurgrens_dagen'),
  ('5184563446', '2299277539', 'Self-service',                            'self_service', 'Self-service',              true,  false, 50, 'Methodiek 3 (623017987)'),
  ('5052825799', '2299277539', 'Eenpitters / kleine kantoren',            'buiten',       'Buiten scope · eenpitters', false, false, 60, 'Methodiek 3 (623017987)'),
  ('4972849395', '2299277539', 'Archief – Afgewezen of uitgesloten deals','buiten',       'Archief',                   false, false, 70, 'Methodiek 3 (623017987)')
on conflict (stage_id) do nothing;

-- ── 4. dim_stage — mapping + de levende labels uit de mirror ─────────────────
create or replace view public.dim_stage
with (security_invoker = on) as
select
  s.stage_id,
  coalesce(f.pipeline_id, p.pipeline_id)      as pipeline_id,
  p.label                                     as pipeline_label,
  coalesce(s.stage_label, f.stage_label)      as stage_label,
  f.fase,
  f.fase_label,
  coalesce(f.is_open, false)                  as is_open,
  coalesce(f.is_kern, false)                  as is_kern,
  coalesce(f.sort_order, s.display_order, 0)  as sort_order,
  s.is_closed                                 as hubspot_is_closed,
  (f.stage_id is null)                        as fase_onbekend
from public.hubspot_pipelines p
cross join lateral (
  select
    e->>'id'                                 as stage_id,
    e->>'label'                              as stage_label,
    nullif(e->>'displayOrder', '')::int      as display_order,
    coalesce((e->>'isClosed')::boolean, false) as is_closed
  from jsonb_array_elements(coalesce(p.stages, '[]'::jsonb)) e
) s
left join public.dim_stage_fase f on f.stage_id = s.stage_id;

comment on view public.dim_stage is
  'Fase-mapping (dim_stage_fase) verrijkt met de levende stage- en pipeline-labels uit de mirror. Berekeningen lezen dim_stage_fase; dit is de presentatielaag. fase_onbekend = HubSpot kent deze stage, de mapping niet: verwacht voor de elf niet-commerciële pipelines (88 stages in totaal op 12-09-2026, waarvan 19 in Sales Pipeline + Customer Base), een signaal zodra het een stage in díé twee betreft.';

grant select on public.dim_stage to authenticated;
