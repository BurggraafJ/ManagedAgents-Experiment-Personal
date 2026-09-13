-- =============================================================================
-- D1 · Pipeline & forecast — B: forecast, win rate, ontleding, werkbord (v1.174)
-- =============================================================================
--   v_d1_forecast_per_maand  bodem/plafond per maand op beslisdatum, met de
--                            kolommen "later" en "geen datum" als échte rijen.
--   v_d1_win_rate            vier hoeken van één bandbreedte, met n per hoek en
--                            het aantal deals dat het datumfilter laat vallen.
--   v_d1_ontleding           fase en eigenaar als twee snedes door dezelfde set.
--   v_d1_werkbord            vier werklijsten met reden, eigenaar en deeplink.
--
-- Bron: dashboarding-onderzoek 2026-09-12 §4.2–§4.5, CD-lock 2026-09-13.
-- =============================================================================

-- ── 1. v_d1_forecast_per_maand ───────────────────────────────────────────────
-- Op beslisdatum (`verwachte_start_pilot`), nooit op closedate. Twee regels die
-- het ontwerp dragen:
--
--  • **"Geen datum" en "later" zijn rijen, geen weglatingen.** Een deal zonder
--    beslisdatum verdwijnt in een gewone group-by uit beeld en maakt de
--    forecast stilletjes optimistischer. Hier staat hij als eigen staaf.
--  • **Fase 1–2 apart van fase 3.** Ze mogen op één as staan, maar nooit in één
--    getal: fase 1 is een verwachting over een gesprek, fase 3 over een
--    handtekening. De UI tekent f12 in een lichte kleur met het label
--    "indicatief" (onderzoek §4.6). Geen gewogen forecast, geen verborgen
--    kanspercentage.
create or replace view public.v_d1_forecast_per_maand
with (security_invoker = on) as
with grens as (
  select
    date_trunc('month', current_date)::date                                      as maand_0,
    (date_trunc('month', current_date) + interval '4 months')::date              as later_vanaf,
    (date_trunc('quarter', current_date) + interval '3 months')::date            as na_kwartaal
),
buckets as (
  select
    to_char((g.maand_0 + (i || ' months')::interval), 'YYYY-MM')                 as bucket,
    'maand'::text                                                               as soort,
    (g.maand_0 + (i || ' months')::interval)::date                              as maand_start,
    i                                                                           as volgnummer,
    ((g.maand_0 + (i || ' months')::interval)::date < g.na_kwartaal)             as binnen_kwartaal
  from grens g, generate_series(0, 3) as s(i)
  union all
  select 'later', 'later', null, 4, false from grens
  union all
  select 'geen',  'geen',  null, 5, false from grens
),
fasegroepen(fasegroep, fasegroep_label, fase_volgnummer) as (
  values ('f3',  'Fase 3 · offerte t/m overeenkomst', 1),
         ('f12', 'Fase 1–2 · indicatief',             2)
),
w as (
  select d.*,
         case when d.fase = '3' then 'f3' else 'f12' end as fasegroep
  from public.v_d1_waarde d
  where d.is_open
)
select
  b.bucket,
  b.soort,
  b.maand_start,
  b.volgnummer,
  b.binnen_kwartaal,
  f.fasegroep,
  f.fasegroep_label,
  f.fase_volgnummer,
  count(w.deal_id)::int                                   as aantal,
  count(w.deal_id) filter (where w.waardeerbaar)::int     as aantal_gewaardeerd,
  sum(w.bodem_lic)   filter (where w.waardeerbaar)        as bodem_licenties,
  sum(w.plafond_lic) filter (where w.waardeerbaar)        as plafond_licenties,
  sum(w.mrr_bodem)                                        as mrr_bodem,
  sum(w.mrr_plafond)                                      as mrr_plafond
from buckets b
cross join fasegroepen f
cross join grens g
left join w
  on w.fasegroep = f.fasegroep
 and (
   (b.soort = 'geen'  and w.beslisdatum is null)
   or (b.soort = 'later' and w.beslisdatum >= g.later_vanaf)
   or (b.soort = 'maand' and w.beslisdatum >= b.maand_start
                         and w.beslisdatum <  (b.maand_start + interval '1 month')::date)
 )
group by b.bucket, b.soort, b.maand_start, b.volgnummer, b.binnen_kwartaal,
         f.fasegroep, f.fasegroep_label, f.fase_volgnummer;

comment on view public.v_d1_forecast_per_maand is
  'Forecast van de open Sales Pipeline per maand op beslisdatum (verwachte_start_pilot), gesplitst in fase 3 en fase 1–2. soort: maand | later (na de vier getoonde maanden) | geen (geen beslisdatum) — die laatste twee zijn expliciete rijen, want een deal die uit de telling valt maakt de forecast stil optimistischer. Ongewogen: bodem en plafond, nooit één verwachtingswaarde.';

grant select on public.v_d1_forecast_per_maand to authenticated;

-- ── 2. v_d1_win_rate — vier hoeken van één bandbreedte ───────────────────────
-- Methodiek 2 filtert op het closedate-jaar. Gemeten op 13-09-2026 heeft 26 van
-- de 57 verloren deals géén closedate, en ze vallen vooral aan de verloren kant
-- weg (21 van de 36 backburner-deals). Een jaarfilter laat die stilzwijgend
-- vallen en tilt de win rate dus structureel op. Daarom nooit één percentage,
-- maar vier hoeken met de basis erbij — en `zonder_closedate` per hoek, zodat
-- zichtbaar is hoeveel het datumfilter wegneemt.
create or replace view public.v_d1_win_rate
with (security_invoker = on) as
with b as (
  select fase, (dealstage = '3206387898') as is_backburner, closedate
  from public.v_d1_deals
  where fase in ('gewonnen', 'verloren')
),
hoeken(basis, backburner, volgnummer, hoofdhoek) as (
  values ('closedate_jaar', 'verloren', 1, true),
         ('closedate_jaar', 'buiten',   2, false),
         ('alles',          'verloren', 3, false),
         ('alles',          'buiten',   4, false)
)
select
  h.basis,
  h.backburner,
  h.volgnummer,
  h.hoofdhoek,
  extract(year from current_date)::int                     as jaar,
  t.gewonnen,
  t.verloren,
  t.basis_n,
  t.win_rate,
  z.zonder_closedate,
  z.populatie
from hoeken h
cross join lateral (
  select
    count(*) filter (where b.fase = 'gewonnen')::int       as gewonnen,
    count(*) filter (where b.fase = 'verloren')::int       as verloren,
    count(*)::int                                          as basis_n,
    case when count(*) > 0
         then round(100.0 * count(*) filter (where b.fase = 'gewonnen') / count(*), 1)
    end                                                    as win_rate
  from b
  where (h.backburner = 'verloren' or not b.is_backburner)
    and (h.basis = 'alles' or extract(year from b.closedate) = extract(year from current_date))
) t
cross join lateral (
  select
    count(*) filter (where b.closedate is null)::int       as zonder_closedate,
    count(*)::int                                          as populatie
  from b
  where (h.backburner = 'verloren' or not b.is_backburner)
) z;

comment on view public.v_d1_win_rate is
  'Win rate van afgesloten sales-trajecten als vier hoeken van één bandbreedte: basis (closedate-jaar | alles) × backburner (verloren | buiten). Hoofdhoek = closedate-jaar × backburner verloren, de conservatieve Methodiek-2-conforme hoek (CD-lock 2026-09-13). zonder_closedate = hoeveel deals van die populatie geen afsluitdatum dragen en dus door het jaarfilter wegvallen — het getal dat de bandbreedte verklaart. Open deals zitten er nooit in.';

grant select on public.v_d1_win_rate to authenticated;

-- ── 3. v_d1_ontleding — twee snedes door dezelfde set ────────────────────────
-- Segment (kantoorgrootte) staat er bewust níét bij: `totale_omvang` is op
-- 13-09-2026 op 244 van 5.872 companies gevuld, en de ETL synchroniseert
-- maximaal 2.000 companies per ronde. Een ontleding op 4 % van de basis is geen
-- ontleding. De knop blijft op het bord staan met die reden erbij — de lege plek
-- is het argument voor het veld (bouwproces.md, Rolverdeling).
create or replace view public.v_d1_ontleding
with (security_invoker = on) as
with w as (select * from public.v_d1_waarde where is_open),
-- Fase-labels komen uit deze lijst en niet uit dim_stage_fase.fase_label: dat
-- veld beschrijft de stage ("Fase 3 · In afwachting / onderhandeling"), en een
-- aggregaat eroverheen zou één willekeurige stage-naam als fase-naam tonen.
-- Dezelfde drie regels als v_d1_pipeline_per_fase, zodat fase 2 ook hier als
-- lege rij terugkomt in plaats van te verdwijnen.
fases(fase, fase_kort, volgnummer) as (
  values ('1', 'Fase 1 · Kennismaking', 1),
         ('2', 'Fase 2 · Offerte sturen', 2),
         ('3', 'Fase 3 · Offerte t/m overeenkomst', 3)
)
select
  'fase'::text                                          as snede,
  f.fase                                                as sleutel,
  f.fase_kort                                           as label,
  f.volgnummer                                          as volgnummer,
  count(w.deal_id)::int                                 as aantal,
  count(w.deal_id) filter (where w.waardeerbaar)::int   as aantal_gewaardeerd,
  sum(w.mrr_bodem)                                      as mrr_bodem,
  sum(w.mrr_plafond)                                    as mrr_plafond,
  min(w.dagen_open)::int                                as jongste_dagen,
  max(w.dagen_open)::int                                as oudste_dagen
from fases f
left join w on w.fase = f.fase
group by f.fase, f.fase_kort, f.volgnummer
union all
select
  'stage',
  w.dealstage,
  min(w.stage_label),
  min(w.stage_sort)::int,
  count(*)::int,
  count(*) filter (where w.waardeerbaar)::int,
  sum(w.mrr_bodem),
  sum(w.mrr_plafond),
  min(w.dagen_open)::int,
  max(w.dagen_open)::int
from w group by w.dealstage
union all
select
  'eigenaar',
  coalesce(w.hubspot_owner_id, 'geen'),
  coalesce(min(w.eigenaar), 'Zonder eigenaar'),
  0,
  count(*)::int,
  count(*) filter (where w.waardeerbaar)::int,
  sum(w.mrr_bodem),
  sum(w.mrr_plafond),
  min(w.dagen_open)::int,
  max(w.dagen_open)::int
from w group by coalesce(w.hubspot_owner_id, 'geen');

comment on view public.v_d1_ontleding is
  'Open Sales Pipeline ontleed langs drie snedes: fase, stage (de vier stages binnen fase 3 apart) en eigenaar. Geen segment-snede: kantoorgrootte staat op 244 van 5.872 companies en de company-sync dekt 2.000 per ronde — die knop staat op het bord met de reden, niet met een cijfer.';

grant select on public.v_d1_ontleding to authenticated;

-- ── 4. v_d1_werkbord — vier lijsten, één vorm ────────────────────────────────
-- Elke regel draagt een eigenaar en een deeplink, en elke lijst mag leeg raken:
-- een werklijst zonder rijen is een geslaagde week, geen kapotte view.
-- De drempel van lijst 1 komt uit dash_parameters (h4_geen_next_step_dagen),
-- dezelfde parameter die D9's H4 voedt — één definitie, twee borden.
create or replace view public.v_d1_werkbord
with (security_invoker = on) as
with w as (select * from public.v_d1_waarde where is_open)
select
  'geen_next_step'::text                                as lijst,
  'Geen volgende stap'::text                            as lijst_label,
  1                                                     as lijst_volgnummer,
  w.deal_id, w.dealname, w.fase, w.fase_label, w.stage_label,
  w.eigenaar, w.beslisdatum, w.next_step, w.dagen_open,
  w.bodem_lic, w.plafond_lic, w.mrr_bodem, w.mrr_plafond, w.hubspot_url,
  case when w.next_step is null
       then 'geen volgende activiteit gepland'
       else 'volgende activiteit stond op ' || to_char(w.next_step, 'DD-MM-YYYY') end as reden
from w
where (w.next_step is null or w.next_step < current_date)
  and w.dagen_open > w.h4_dagen
union all
select
  'verlopen_beslisdatum', 'Verlopen beslisdatum', 2,
  w.deal_id, w.dealname, w.fase, w.fase_label, w.stage_label,
  w.eigenaar, w.beslisdatum, w.next_step, w.dagen_open,
  w.bodem_lic, w.plafond_lic, w.mrr_bodem, w.mrr_plafond, w.hubspot_url,
  'beslisdatum was ' || to_char(w.beslisdatum, 'DD-MM-YYYY')
from w
where w.beslisdatum is not null and w.beslisdatum < current_date
union all
select
  'fase3_zonder_velden', 'Fase 3 zonder velden', 3,
  w.deal_id, w.dealname, w.fase, w.fase_label, w.stage_label,
  w.eigenaar, w.beslisdatum, w.next_step, w.dagen_open,
  w.bodem_lic, w.plafond_lic, w.mrr_bodem, w.mrr_plafond, w.hubspot_url,
  -- Dezelfde drie velden als D9-check H2, met opzet: twee borden die "fase 3
  -- zonder velden" anders definiëren, leveren twee getallen en een discussie.
  array_to_string(array_remove(array[
    case when w.beslisdatum is null then 'beslisdatum' end,
    case when w.bodem_lic   is null then 'minimumafname' end,
    case when w.plafond_lic is null then 'contractomvang' end
  ], null), ' · ') || ' ontbreekt'
from w
where w.fase = '3'
  and (w.beslisdatum is null or w.bodem_lic is null or w.plafond_lic is null)
union all
select
  'zonder_eigenaar', 'Zonder eigenaar', 4,
  w.deal_id, w.dealname, w.fase, w.fase_label, w.stage_label,
  w.eigenaar, w.beslisdatum, w.next_step, w.dagen_open,
  w.bodem_lic, w.plafond_lic, w.mrr_bodem, w.mrr_plafond, w.hubspot_url,
  case when w.hubspot_owner_id is null
       then 'geen eigenaar toegewezen'
       else 'eigenaar-id is niet (meer) actief in HubSpot' end
from w
where w.owner_onbekend;

comment on view public.v_d1_werkbord is
  'De vier werklijsten van D1 in één vorm: geen volgende stap · verlopen beslisdatum · fase 3 zonder velden · zonder eigenaar. Eén deal kan op meerdere lijsten staan; dat is de bedoeling, want het zijn vier acties. Voor een telling per deal (het critical number van D9) is v_d9_forecast_blokkers de bron — die telt deals, niet regels.';

grant select on public.v_d1_werkbord to authenticated;

-- ── 5. v_d1_werkbord_tellers — de tabs, inclusief de lege ────────────────────
-- Een lege lijst levert nul rijen in v_d1_werkbord, en dan zou de UI de tab
-- moeten verzinnen — inclusief zijn naam. Deze view geeft alle vier de lijsten
-- terug met hun telling, ook als die nul is. Zo blijft "Verlopen beslisdatum: 0"
-- een gemeten uitspraak in plaats van een ontbrekende tab.
create or replace view public.v_d1_werkbord_tellers
with (security_invoker = on) as
with lijsten(lijst, lijst_label, lijst_volgnummer, toelichting) as (
  values
    ('geen_next_step',      'Geen volgende stap',   1,
     'Open deal zonder geplande volgende activiteit (of met een activiteit in het verleden) die langer open staat dan de drempel uit dash_parameters. Een deal zonder volgende stap beweegt niet.'),
    ('verlopen_beslisdatum','Verlopen beslisdatum', 2,
     'Open deal met een beslisdatum die al voorbij is. De datum is dan geen verwachting meer maar een herinnering.'),
    ('fase3_zonder_velden', 'Fase 3 zonder velden', 3,
     'Deal in fase 3 zonder beslisdatum, minimumafname of contractomvang — dezelfde definitie als hygiënecheck H2. Zonder die drie telt de deal niet mee in bodem en plafond.'),
    ('zonder_eigenaar',     'Zonder eigenaar',      4,
     'Open deal zonder eigenaar, of met een eigenaar die niet (meer) actief in HubSpot staat.')
)
select
  l.lijst,
  l.lijst_label,
  l.lijst_volgnummer,
  l.toelichting,
  count(w.deal_id)::int as aantal
from lijsten l
left join public.v_d1_werkbord w on w.lijst = l.lijst
group by l.lijst, l.lijst_label, l.lijst_volgnummer, l.toelichting;

comment on view public.v_d1_werkbord_tellers is
  'De vier werklijsten van D1 met hun telling, óók als die nul is. Voedt de tabs van het werkbord zodat een lege lijst een zichtbare, gemeten nul is en geen verdwenen tab.';

grant select on public.v_d1_werkbord_tellers to authenticated;
