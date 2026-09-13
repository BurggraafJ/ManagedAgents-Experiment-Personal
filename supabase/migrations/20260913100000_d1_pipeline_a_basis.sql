-- =============================================================================
-- D1 · Pipeline & forecast — A: basis, aanvoer, fase-verdeling, dekking (v1.174)
-- =============================================================================
-- Het bord beantwoordt één vraag: halen we het kwartaal, en waar zit het lek?
-- Deze migratie levert de laag eronder. Net als bij D9 geldt: **het bord rekent
-- niet**. Elke waarde komt uit een view; de component kiest alleen hoe ze
-- getoond wordt (skill `dashboarding`, bouwproces.md "de UI rekent niet").
--
--   v_d1_deals             één rij per niet-gearchiveerde Sales-Pipeline-deal met
--                          de afgeleide velden waar D1 op rekent: fase,
--                          beslisdatum, kennismaking, bodem/plafond in licenties
--                          én in euro per maand, en waar de prijs vandaan komt.
--   v_d1_meta              peildatum, zichtbaarheid en de constateringen die
--                          onder de cijfers horen (closedate, verliesreden,
--                          kantoorgrootte).
--   v_d1_pipeline_per_fase de trechter — fase 1, 2 en 3 áltijd als rij, ook bij
--                          nul deals.
--   v_d1_aanvoer           twaalf weken kennismakingen (het critical number) en
--                          nieuwe deals (de proxy) naast elkaar.
--   v_d1_aanvoer_kop       de kaartwaarde van het critical number in één rij.
--   v_d1_dekking           plafond fase 3 tegen het kwartaaldoel.
--
-- Drie ontwerpregels die je terugziet in de kolommen:
--
--  1. **Beslisdatum, nooit closedate.** `verwachte_start_pilot` draagt de
--     forecast (besluit Jelle 01-09-2026). Op 13-09-2026 heeft 31 van de 32 open
--     deals géén bruikbare closedate (14 leeg, 17 verlopen) — wie daarop
--     forecast, forecast op ruis. v_d1_meta telt dat expliciet zodat het bord de
--     constatering kan tónen in plaats van hem elk kwartaal opnieuw uit te leggen.
--
--  2. **Nooit één pipeline-waarde.** Altijd bodem én plafond, uit
--     `verwachte_minimumafname_licentieperiode` en
--     `verwachte_omvang_licentieperiode` × prijs. `amount` blijft ongebruikt: dat
--     veld is dood (35 van 1.139 gevuld, 0 op de klantkant).
--
--  3. **Waardeerbaar is een eigen telling.** Een deal zonder prijs of zonder
--     omvang telt wél mee in het aantal en níét in de euro's. Het bord toont
--     beide noemers ("22 van 25 gewaardeerd"), want anders leest een lage
--     pipelinewaarde als een slechte maand in plaats van als een leeg veld.
--
-- Alle views `security_invoker = on`: de RLS van hubspot_deals blijft gelden en
-- er ontstaat geen tweede leespad naar de CRM-mirror.
--
-- Bron: dashboarding-onderzoek 2026-09-12 §4, CD-lock 2026-09-13, Confluence
-- D1 642613249. Terugdraaien: `drop view` in omgekeerde volgorde.
-- =============================================================================

-- ── 0. Parameters die D1 toevoegt ────────────────────────────────────────────
-- Het doel van zes kennismakingen per week is een keuze met een bron en een
-- datum, geen constante in JSX. Zo kan Jay hem verzetten zonder deploy.
insert into public.dash_parameters
  (sleutel, waarde, eenheid, geldig_vanaf, bron, peildatum, toelichting) values
  ('doel_kennismakingen_week', 6, 'kennismakingen_per_week', '2026-09-11',
   'Dashboarding 642449420 §3, SDR-map 635633696', '2026-09-12',
   'Critical number van D1: gehouden kennismakingen per week. Sinds 11-09-2026 het critical number van de SDR. Telt op kennismaking_datum uit HubSpot — dat veld telt ruimer dan de geschoonde demo-lijst (Demo specs.xlsx), vandaar het label "ruw (HubSpot)" op het bord.')
on conflict (sleutel) do nothing;

-- De omslag van proxy naar echte kennismakingen is zelf een gebeurtenis: twee
-- reeksen die elkaar opvolgen mogen nooit stil in elkaar overlopen
-- (datakwaliteit.md: "definitie-drift is erger dan vuile data").
insert into public.events_annotaties (datum, gebeurtenis, borden, bron, toelichting) values
  ('2026-09-13',
   'Herdefinitie critical number D1: van proxy (nieuwe pipeline/week) naar gehouden kennismakingen/week',
   array['D1']::text[],
   'Dashboarding-onderzoek 2026-09-12 §4.1, CD-lock 2026-09-13',
   'kennismaking_datum staat sinds de full sync van 13-09-2026 00:04 UTC in de mirror (88 van 108 sales-deals gevuld). Vanaf deze datum is het critical number de echte kennismakingen; de proxy blijft als tweede regel op de kaart staan tot de reeksen op elkaar aansluiten.')
on conflict (datum, gebeurtenis) do nothing;

-- ── 1. v_d1_deals — de basis onder elk D1-getal ──────────────────────────────
-- Bewust alleen de Sales Pipeline: D1 gaat over nieuwe omzet. Klantdeals
-- (Customer Base) horen op D4/D10 en zouden hier elke telling vertekenen.
create or replace view public.v_d1_deals
with (security_invoker = on) as
with p as (
  select
    (select waarde       from public.dash_parameters where sleutel = 'prijs_kantoorbreed')      as prijs_lijst,
    (select geldig_vanaf from public.dash_parameters where sleutel = 'prijs_kantoorbreed')      as prijs_vanaf,
    coalesce((select waarde from public.dash_parameters where sleutel = 'h4_geen_next_step_dagen'), 14) as h4_dagen
),
g as (select ((select count(*) from public.hubspot_users) > 0) as owners_zichtbaar)
select
  d.deal_id,
  d.dealname,
  d.dealstage,
  f.stage_label,
  f.fase,
  f.fase_label,
  coalesce(f.is_open, false)                                      as is_open,
  coalesce(f.sort_order, 0)                                       as stage_sort,
  d.hubspot_owner_id,
  coalesce(u.full_name, u.email)                                  as eigenaar,
  (d.hubspot_owner_id is null or (g.owners_zichtbaar and u.hubspot_owner_id is null)) as owner_onbekend,
  d.closedate,
  d.hs_created_at,
  greatest((current_date - d.hs_created_at::date), 0)             as dagen_open,
  p.h4_dagen,
  public.dash_prop_date(d.properties, 'verwachte_start_pilot')    as beslisdatum,
  public.dash_prop_date(d.properties, 'kennismaking_datum')       as kennismaking,
  public.dash_prop_date(d.properties, 'notes_next_activity_date') as next_step,
  nullif(btrim(coalesce(d.properties->>'closed_lost_reason', '')), '') as verliesreden,
  public.dash_prop_num(d.properties, 'verwachte_minimumafname_licentieperiode') as bodem_lic,
  public.dash_prop_num(d.properties, 'verwachte_omvang_licentieperiode')        as plafond_lic,
  public.dash_prop_num(d.properties, 'verwachte_prijs')                         as prijs_deal,
  -- Prijsdrager (onderzoek §4.6, TODO 1): de prijs op de deal is leidend.
  -- Staat die leeg, dan pas de lijstprijs — en alléén voor deals die ná de
  -- prijswijziging beslissen. Een oudere deal zonder prijs blijft bewust
  -- onwaardeerbaar: de oude lijstprijs staat niet in dash_parameters en wordt
  -- hier niet verzonnen.
  case
    when public.dash_prop_num(d.properties, 'verwachte_prijs') is not null then 'deal'
    when p.prijs_lijst is not null
     and public.dash_prop_date(d.properties, 'verwachte_start_pilot') >= p.prijs_vanaf then 'lijstprijs'
  end                                                             as prijs_bron,
  coalesce(
    public.dash_prop_num(d.properties, 'verwachte_prijs'),
    case when public.dash_prop_date(d.properties, 'verwachte_start_pilot') >= p.prijs_vanaf
         then p.prijs_lijst end
  )                                                               as prijs,
  'https://app.hubspot.com/contacts/0/deal/' || d.deal_id         as hubspot_url
from public.hubspot_deals d
cross join p
cross join g
left join public.dim_stage_fase f on f.stage_id = d.dealstage
left join public.hubspot_users  u on u.hubspot_owner_id = d.hubspot_owner_id and u.active is not false
where d.is_archived is not true
  and d.pipeline_id = 'default';

comment on view public.v_d1_deals is
  'Basis onder alle D1-getallen: één rij per niet-gearchiveerde Sales-Pipeline-deal. Bevat de beslisdatum (verwachte_start_pilot — nooit closedate), de kennismakingsdatum, bodem en plafond in licenties en de prijsdrager met zijn herkomst (prijs_bron: deal | lijstprijs | NULL = niet waardeerbaar).';

grant select on public.v_d1_deals to authenticated;

-- ── 2. v_d1_waarde — licenties × prijs, één keer gedefinieerd ────────────────
-- Aparte laag zodat de vermenigvuldiging exact één plek heeft. Elke view die
-- euro's toont, leest hiervan.
create or replace view public.v_d1_waarde
with (security_invoker = on) as
select
  d.*,
  (d.bodem_lic   * d.prijs)                                        as mrr_bodem,
  (d.plafond_lic * d.prijs)                                        as mrr_plafond,
  (d.bodem_lic is not null and d.plafond_lic is not null and d.prijs is not null) as waardeerbaar,
  (d.beslisdatum is not null and d.bodem_lic is not null and d.plafond_lic is not null) as forecast_volledig
from public.v_d1_deals d;

comment on view public.v_d1_waarde is
  'v_d1_deals plus de maandwaarde: licenties × prijs, in euro per maand. waardeerbaar = alle drie de dragers aanwezig; een onwaardeerbare deal telt wél in het aantal en níét in de euro''s, en het bord toont beide noemers.';

grant select on public.v_d1_waarde to authenticated;

-- ── 3. v_d1_meta — peildatum en de constateringen eronder ────────────────────
create or replace view public.v_d1_meta
with (security_invoker = on) as
with d as (
  select
    count(*)                                                             as n,
    max(synced_at)                                                       as peil,
    count(*) filter (where jsonb_exists(properties, 'verwachte_start_pilot'))            as n_beslisdatum,
    count(*) filter (where jsonb_exists(properties, 'kennismaking_datum'))               as n_kennismaking_prop,
    count(*) filter (where jsonb_exists(properties, 'verwachte_prijs'))                  as n_prijs_prop
  from public.hubspot_deals
  where is_archived is not true and pipeline_id = 'default'
),
w as (
  select
    count(*) filter (where is_open)                                                      as open_deals,
    count(*) filter (where is_open and closedate is null)                                as cd_leeg,
    count(*) filter (where is_open and closedate is not null and closedate::date < current_date) as cd_verlopen,
    count(*) filter (where fase = 'verloren')                                            as verloren,
    count(*) filter (where fase = 'verloren' and verliesreden is null)                   as verloren_zonder_reden,
    count(*) filter (where kennismaking is not null)                                     as km_gevuld,
    count(*) filter (where kennismaking is not null and kennismaking > current_date)     as km_gepland,
    count(*)                                                                             as n_sales,
    count(*) filter (where is_open and prijs_bron = 'lijstprijs')                        as op_lijstprijs
  from public.v_d1_waarde
),
c as (
  select
    count(*)                                                                             as n,
    count(*) filter (where jsonb_exists(properties, 'totale_omvang'))                     as key_aanwezig,
    count(*) filter (where nullif(btrim(coalesce(properties->>'totale_omvang', '')), '') is not null) as gevuld
  from public.hubspot_companies
  where is_archived is not true
),
s as (
  select min(datum) as vanaf, count(distinct datum) as dagen
  from public.snap_deal_dag
)
select
  d.peil                                                     as peildatum,
  case when d.peil is null then null
       else floor(extract(epoch from (now() - d.peil)) / 60)::int end as minuten_oud,
  -- 60 minuten: de delta-sync draait elke 30 minuten. Ouder dan een uur betekent
  -- dat er een ronde is overgeslagen — dan is dit bord een stand van gisteren.
  (d.peil is null or d.peil < now() - interval '60 minutes') as mirror_verouderd,
  d.n                                                        as deals_zichtbaar,
  w.open_deals,
  w.cd_leeg                                                  as closedate_leeg,
  w.cd_verlopen                                              as closedate_verlopen,
  (w.cd_leeg + w.cd_verlopen)                                as closedate_onbruikbaar,
  w.verloren,
  w.verloren_zonder_reden,
  w.km_gevuld                                                as kennismaking_gevuld,
  w.km_gepland                                               as kennismaking_gepland,
  w.n_sales                                                  as sales_deals,
  w.op_lijstprijs,
  (d.n_beslisdatum       > 0)                                as prop_beslisdatum,
  (d.n_kennismaking_prop > 0)                                as prop_kennismaking,
  (d.n_prijs_prop        > 0)                                as prop_prijs,
  c.n                                                        as companies_zichtbaar,
  c.key_aanwezig                                             as companies_met_veld,
  c.gevuld                                                   as companies_met_omvang,
  -- Segment-ontleding (kantoorgrootte) is pas eerlijk als het veld er op
  -- vrijwel elke company staat. Twee dingen staan dat in de weg: het veld is
  -- grotendeels leeg, én de ETL synchroniseert maximaal 2.000 companies per
  -- ronde (MAX_PAGES_PER_OBJECT), dus een deel van de mirror draagt de property
  -- niet eens. Beide getallen staan hierboven zodat het bord de échte reden kan
  -- noemen in plaats van "geen data".
  (c.gevuld > 0 and c.gevuld >= (c.n * 0.8))                 as segment_bruikbaar,
  s.vanaf                                                    as trend_vanaf,
  coalesce(s.dagen, 0)                                       as trend_dagen
from d, w, c, s;

comment on view public.v_d1_meta is
  'Eén rij met de peildatum van de mirror, hoeveel Sales-Pipeline-rijen deze kijker ziet (0 = geen records óf geen rechten: hubspot_deals eist is_admin_or_higher() + session_mfa_ok()) en de constateringen die onder de D1-cijfers horen — onbruikbare closedates, ontbrekende verliesredenen, dekking van kantoorgrootte.';

grant select on public.v_d1_meta to authenticated;

-- ── 4. v_d1_pipeline_per_fase — de trechter ──────────────────────────────────
-- Fase 1, 2 en 3 staan áltijd als rij in de uitkomst, ook met nul deals. Dat is
-- geen cosmetica: de gemeten vorm (7 · 0 · 25) ís het verhaal van dit bord, en
-- een fase die uit een group-by wegvalt omdat ze leeg is, verbergt precies dat.
create or replace view public.v_d1_pipeline_per_fase
with (security_invoker = on) as
with fases(fase, fase_kort, volgnummer) as (
  values ('1', 'Fase 1 · Kennismaking', 1),
         ('2', 'Fase 2 · Offerte sturen', 2),
         ('3', 'Fase 3 · Offerte t/m overeenkomst', 3)
),
w as (select * from public.v_d1_waarde where is_open)
select
  f.fase,
  f.fase_kort                                                          as fase_label,
  f.volgnummer,
  count(w.deal_id)::int                                                as aantal,
  count(w.deal_id) filter (where w.waardeerbaar)::int                  as aantal_gewaardeerd,
  count(w.deal_id) filter (where w.forecast_volledig)::int             as aantal_volledig,
  sum(w.bodem_lic)   filter (where w.waardeerbaar)                     as bodem_licenties,
  sum(w.plafond_lic) filter (where w.waardeerbaar)                     as plafond_licenties,
  sum(w.mrr_bodem)                                                     as mrr_bodem,
  sum(w.mrr_plafond)                                                   as mrr_plafond,
  (select max(peildatum) from public.v_d1_meta)                        as peildatum
from fases f
left join w on w.fase = f.fase
group by f.fase, f.fase_kort, f.volgnummer;

comment on view public.v_d1_pipeline_per_fase is
  'Actieve Sales-Pipeline per fase, met bodem en plafond in licenties én in euro per maand. Fase 1, 2 en 3 komen altijd terug, ook leeg. aantal_gewaardeerd < aantal betekent dat een deel van de deals geen prijs of geen omvang draagt: de euro''s dekken dan minder deals dan het aantal suggereert.';

grant select on public.v_d1_pipeline_per_fase to authenticated;

-- ── 5. v_d1_aanvoer — twaalf weken aanvoer ───────────────────────────────────
-- Twee reeksen naast elkaar: het echte critical number (gehouden kennismakingen)
-- en de proxy die er tot 13-09-2026 voor stond (nieuwe deals). Ze blijven
-- gescheiden kolommen — een proxy en zijn opvolger mogen nooit één lijn worden.
create or replace view public.v_d1_aanvoer
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) - (i || ' weeks')::interval)::date as week_start
  from generate_series(0, 11) as g(i)
),
d as (select * from public.v_d1_deals)
select
  w.week_start,
  (w.week_start + 6)                                                   as week_eind,
  to_char(w.week_start, 'IYYY-"W"IW')                                  as week_label,
  (w.week_start = date_trunc('week', current_date)::date)              as is_huidige_week,
  -- "Gehouden": een kennismaking in de toekomst is een afspraak, geen prestatie.
  count(d.deal_id) filter (
    where d.kennismaking >= w.week_start
      and d.kennismaking <  w.week_start + 7
      and d.kennismaking <= current_date
  )::int                                                               as kennismakingen,
  count(d.deal_id) filter (
    where d.kennismaking >= w.week_start
      and d.kennismaking <  w.week_start + 7
      and d.kennismaking >  current_date
  )::int                                                               as kennismakingen_gepland,
  count(d.deal_id) filter (
    where d.hs_created_at >= w.week_start
      and d.hs_created_at <  (w.week_start + 7)::timestamptz
  )::int                                                               as nieuwe_deals
from weken w
left join d on true
group by w.week_start;

comment on view public.v_d1_aanvoer is
  'Twaalf weken aanvoer van de Sales Pipeline. kennismakingen = gehouden (kennismaking_datum tot en met vandaag) — het critical number, doel uit dash_parameters.doel_kennismakingen_week. nieuwe_deals = de interim-proxy die tot 13-09-2026 als critical number stond; die blijft als aparte reeks staan tot beide elkaar bevestigen.';

grant select on public.v_d1_aanvoer to authenticated;

-- ── 6. v_d1_aanvoer_kop — de kaartwaarde van het critical number ─────────────
-- De laatste volledige week is de kopwaarde, niet de lopende: een week die nog
-- niet om is, leest altijd als een terugval (principes.md, kleine aantallen).
create or replace view public.v_d1_aanvoer_kop
with (security_invoker = on) as
with a as (select * from public.v_d1_aanvoer),
laatste_volledig as (select * from a where not is_huidige_week order by week_start desc limit 1),
huidig as (select * from a where is_huidige_week),
vier as (
  select
    sum(kennismakingen)::int as km_4wk,
    sum(nieuwe_deals)::int   as nieuw_4wk
  from (select * from a where not is_huidige_week order by week_start desc limit 4) x
)
select
  (select waarde    from public.dash_parameters where sleutel = 'doel_kennismakingen_week') as doel,
  (select peildatum from public.dash_parameters where sleutel = 'doel_kennismakingen_week') as doel_peildatum,
  (select bron      from public.dash_parameters where sleutel = 'doel_kennismakingen_week') as doel_bron,
  lv.week_label                                as week_label,
  lv.week_start                                as week_start,
  lv.week_eind                                 as week_eind,
  lv.kennismakingen                            as kennismakingen,
  lv.nieuwe_deals                              as nieuwe_deals,
  h.kennismakingen                             as kennismakingen_lopend,
  h.kennismakingen_gepland                     as kennismakingen_gepland,
  h.nieuwe_deals                               as nieuwe_deals_lopend,
  v.km_4wk,
  v.nieuw_4wk,
  round(v.km_4wk / 4.0, 1)                     as km_gemiddeld_4wk,
  (select kennismaking_gevuld from public.v_d1_meta) as km_gevuld,
  (select sales_deals         from public.v_d1_meta) as km_noemer,
  (select peildatum           from public.v_d1_meta) as peildatum
from laatste_volledig lv
cross join vier v
left join huidig h on true;

comment on view public.v_d1_aanvoer_kop is
  'Kaartwaarde van het D1-critical-number in één rij: gehouden kennismakingen in de laatste vólledige week tegen het doel, met het viervoudige weekgemiddelde en de lopende week apart. De proxy (nieuwe_deals) staat in dezelfde rij maar in een eigen kolom en hoort op het bord als tweede regel, altijd gelabeld.';

grant select on public.v_d1_aanvoer_kop to authenticated;

-- ── 7. v_d1_dekking — plafond fase 3 tegen het kwartaaldoel ──────────────────
-- Geen dekkingsnorm uit een enterprise-benchmark (het klassieke "3×"): deze
-- cyclus en dit proefmodel zijn anders, en een geleende norm kleurt het bord
-- rood of groen zonder dat iemand die keuze heeft gemaakt (onderzoek §4.8).
-- Staat er geen norm in dash_parameters, dan toont het bord dat als lege plek.
create or replace view public.v_d1_dekking
with (security_invoker = on) as
with f3 as (
  select
    sum(mrr_bodem)                                   as mrr_bodem,
    sum(mrr_plafond)                                 as mrr_plafond,
    count(*) filter (where waardeerbaar)::int        as aantal_gewaardeerd,
    count(*)::int                                    as aantal
  from public.v_d1_waarde where is_open and fase = '3'
),
doel as (
  select waarde, peildatum, bron, geldig_vanaf, toelichting
  from public.dash_parameters where sleutel = 'kwartaaldoel_mrr'
),
norm as (
  select waarde from public.dash_parameters where sleutel = 'dekkingsnorm'
)
select
  f3.mrr_bodem,
  f3.mrr_plafond,
  f3.aantal,
  f3.aantal_gewaardeerd,
  doel.waarde                                        as kwartaaldoel_mrr,
  doel.peildatum                                     as doel_peildatum,
  doel.bron                                          as doel_bron,
  norm.waarde                                        as dekkingsnorm,
  case when doel.waarde > 0 then round(f3.mrr_plafond / doel.waarde, 2) end as dekking_plafond,
  case when doel.waarde > 0 then round(f3.mrr_bodem   / doel.waarde, 2) end as dekking_bodem,
  to_char(date_trunc('quarter', current_date), '"Q"Q YYYY')               as kwartaal_label,
  (date_trunc('quarter', current_date) + interval '3 months' - interval '1 day')::date as kwartaal_eind,
  greatest(((date_trunc('quarter', current_date) + interval '3 months' - interval '1 day')::date - current_date), 0) as dagen_resterend,
  case when doel.waarde is null then doel.toelichting end                 as reden
from f3
left join doel on true
left join norm on true;

comment on view public.v_d1_dekking is
  'Dekking van het kwartaal: plafond (en bodem) van fase 3 in euro per maand tegen dash_parameters.kwartaaldoel_mrr. Doel NULL = nog niet vastgelegd; dan is dekking NULL en toont het bord de reden, nooit een 0. De peildatum van het doel staat naast de peildatum van de data — die twee worden nooit stil gemengd (Methodiek 8).';

grant select on public.v_d1_dekking to authenticated;
