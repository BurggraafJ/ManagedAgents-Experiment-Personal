-- =============================================================================
-- D9 · Datakwaliteit & hygiëne — A: basis, meta en de checktabel    (v1.173)
-- =============================================================================
-- Het bord beantwoordt één vraag: mag je de andere cijfers geloven, en wie
-- ruimt wat op? Deze migratie levert de laag eronder. Drie objecten:
--
--   v_d9_deals    één rij per niet-gearchiveerde deal met de afgeleide velden
--                 die de checks nodig hebben (fase, eigenaar bekend ja/nee,
--                 beslisdatum, next step …). Alle recordlijsten en de
--                 checktabel lezen hiervan, zodat een definitie op één plek
--                 staat.
--
--   v_d9_meta     één rij met de peildatum van de mirror, hoeveel rijen de
--                 kijker überhaupt ziet, en welke properties er al in de
--                 mirror zitten.
--
--   v_d9_checks   één rij per check (H1–H19) met titel, definitie, eigenaar,
--                 de borden die de fout raakt, het aantal en de basis.
--                 **Het bord rekent niet** — het toont deze rijen.
--
-- Drie ontwerpregels die je terugziet in de kolommen:
--
--  1. **Bron-status en mirror-status zijn niet hetzelfde.** De D9-pagina zet
--     H1–H4 op groen omdat de velden in HubSpot bestaan. In de app bestaan ze
--     pas als ze in de propertylijst van hubspot-sync-etl staan én er één keer
--     gesynct is. Daarom detecteert v_d9_meta per property of er ergens in de
--     mirror een deal is die hem draagt: is dat niet zo, dan krijgt de check
--     status `wacht_op_mirror` met aantal NULL. Zodra de sync de velden
--     meeneemt, springt dezelfde view vanzelf om naar `meetbaar` — zonder
--     deploy. NULL is hier dus geen nul, en het bord moet dat verschil tonen.
--
--  2. **Leeg is niet hetzelfde als nul.** hubspot_deals staat achter
--     is_admin_or_higher(), en die functie eist sinds 02-09-2026 ook
--     session_mfa_ok(). Een kijker zonder rol of zonder tweede factor ziet nul
--     rijen en géén fout. Daarom telt v_d9_meta `deals_zichtbaar` mee: is dat
--     nul, dan zegt het bord "geen records — of geen rechten (MFA vereist)".
--
--  3. **Geen hygiëne-score.** Geen samengesteld cijfer op honderd: dat
--     verbergt welke fout ertoe doet. Wel een `blokkerend`-vlag op de vier
--     checks die de forecast vertekenen (H2–H5); die voeden het critical
--     number in v_d9_forecast_blokkers.
--
-- Bron: dashboarding-onderzoek 2026-09-12 §3, Confluence D9 642285572,
-- skill `dashboarding` (per-dashboard.md, datakwaliteit.md).
--
-- Alle views `security_invoker = on`: de RLS van hubspot_deals blijft gelden en
-- er ontstaat geen tweede leespad naar de CRM-mirror.
-- =============================================================================

-- ── 1. v_d9_deals — de basis onder elke check ────────────────────────────────
create or replace view public.v_d9_deals
with (security_invoker = on) as
select
  d.deal_id,
  d.dealname,
  d.pipeline_id,
  d.dealstage,
  d.hubspot_owner_id,
  d.associated_company_ids,
  d.closedate,
  d.hs_created_at,
  d.synced_at,
  d.properties,
  f.fase,
  f.fase_label,
  f.stage_label,
  coalesce(f.is_open, false)                                   as is_open,
  coalesce(f.is_kern, false)                                   as is_kern,
  (d.pipeline_id = '2299277539')                               as is_klantdeal,
  (d.pipeline_id = 'default')                                  as is_salesdeal,
  case d.pipeline_id
    when '2299277539' then 'Customer Base'
    when 'default'    then 'Sales Pipeline'
    else 'Overige pipeline'
  end                                                          as pipeline_label,
  coalesce(u.full_name, u.email)                               as eigenaar,
  -- Onbekende eigenaar = geen owner-id, óf een owner-id dat niet (meer) actief
  -- in hubspot_users staat. De owners-tabel kan voor deze kijker onzichtbaar
  -- zijn; dan zou de tweede helft élke deal foutmelden. Vandaar de guard: is
  -- er geen enkele owner zichtbaar, dan telt alleen "geen owner-id".
  (d.hubspot_owner_id is null or (g.owners_zichtbaar and u.hubspot_owner_id is null)) as owner_onbekend,
  (coalesce(array_length(d.associated_company_ids, 1), 0) = 0) as zonder_company,
  public.dash_prop_date(d.properties, 'verwachte_start_pilot')    as beslisdatum,
  public.dash_prop_date(d.properties, 'notes_next_activity_date') as next_step,
  public.dash_prop_date(d.properties, 'startdatum')               as startdatum,
  public.dash_prop_date(d.properties, 'einddatum')                as einddatum,
  public.dash_prop_num(d.properties, 'verwachte_minimumafname_licentieperiode') as verwachte_bodem,
  public.dash_prop_num(d.properties, 'verwachte_omvang_licentieperiode')        as verwachte_plafond,
  public.dash_prop_num(d.properties, 'minimale_licenties_licentieperiode')      as bodem,
  public.dash_prop_num(d.properties, 'omvang_licentieperiode')                  as plafond,
  nullif(btrim(coalesce(d.properties->>'closed_lost_reason', '')), '')          as verliesreden,
  greatest((current_date - d.hs_created_at::date), 0)          as dagen_open,
  'https://app.hubspot.com/contacts/0/deal/' || d.deal_id      as hubspot_url
from public.hubspot_deals d
cross join (select ((select count(*) from public.hubspot_users) > 0) as owners_zichtbaar) g
left join public.dim_stage_fase f on f.stage_id = d.dealstage
left join public.hubspot_users  u on u.hubspot_owner_id = d.hubspot_owner_id and u.active is not false
where d.is_archived is not true;

comment on view public.v_d9_deals is
  'Basis onder alle D9-checks: één rij per niet-gearchiveerde deal met de afgeleide velden (fase uit dim_stage_fase, eigenaar bekend ja/nee, beslisdatum, volgende stap, bodem/plafond). Definities staan hier één keer, niet in elke recordlijst.';

grant select on public.v_d9_deals to authenticated;

-- ── 2. v_d9_meta — peildatum, zichtbaarheid en mirror-dekking ────────────────
create or replace view public.v_d9_meta
with (security_invoker = on) as
with d as (
  select
    count(*)                                                              as n,
    max(synced_at)                                                        as peil,
    count(*) filter (where jsonb_exists(properties, 'verwachte_start_pilot'))                   as n_beslisdatum,
    count(*) filter (where jsonb_exists(properties, 'verwachte_omvang_licentieperiode')
                        or jsonb_exists(properties, 'verwachte_minimumafname_licentieperiode')) as n_verwachting,
    count(*) filter (where jsonb_exists(properties, 'notes_next_activity_date'))                 as n_next_step,
    count(*) filter (where jsonb_exists(properties, 'closed_lost_reason'))                       as n_verliesreden,
    count(*) filter (where jsonb_exists(properties, 'kennismaking_datum'))                       as n_kennismaking,
    count(*) filter (where jsonb_exists(properties, 'hs_v2_date_entered_3206386937')
                        or jsonb_exists(properties, 'hs_v2_date_entered_3206387898')
                        or jsonb_exists(properties, 'hs_v2_date_entered_3504650455'))            as n_stage_entry
  from public.hubspot_deals
  where is_archived is not true
),
c as (
  select
    count(*)       as n,
    max(synced_at) as peil,
    count(*) filter (where jsonb_exists(properties, 'totale_omvang')) as n_omvang
  from public.hubspot_companies
  where is_archived is not true
),
s as (
  select min(datum) as vanaf, count(distinct datum) as dagen
  from public.snap_hygiene_dag
)
select
  d.peil                                                     as peildatum,
  c.peil                                                     as peildatum_companies,
  case when d.peil is null then null
       else floor(extract(epoch from (now() - d.peil)) / 60)::int end as minuten_oud,
  -- 60 minuten: de delta-sync draait elke 30 minuten. Ouder dan een uur
  -- betekent dat er een sync is overgeslagen — dan krijgen de tellers een
  -- gele rand en is het bord een stand van gisteren.
  (d.peil is null or d.peil < now() - interval '60 minutes')  as mirror_verouderd,
  d.n                                                        as deals_zichtbaar,
  c.n                                                        as companies_zichtbaar,
  (d.n_beslisdatum  > 0)                                     as prop_beslisdatum,
  (d.n_verwachting  > 0)                                     as prop_verwachtingsvelden,
  (d.n_next_step    > 0)                                     as prop_next_step,
  (d.n_verliesreden > 0)                                     as prop_verliesreden,
  (d.n_kennismaking > 0)                                     as prop_kennismaking,
  (d.n_stage_entry  > 0)                                     as prop_stage_entry,
  (c.n_omvang       > 0)                                     as prop_company_omvang,
  s.vanaf                                                    as trend_vanaf,
  coalesce(s.dagen, 0)                                       as trend_dagen
from d, c, s;

comment on view public.v_d9_meta is
  'Eén rij met de peildatum van de mirror, hoeveel rijen deze kijker ziet (0 = geen records óf geen rechten/MFA) en welke stuurinformatie-properties al in de mirror zitten. De prop_*-vlaggen zijn de schakelaar tussen "wacht op mirror" en "meetbaar" in v_d9_checks.';

grant select on public.v_d9_meta to authenticated;

-- ── 3. v_d9_checks — de checktabel ───────────────────────────────────────────
create or replace view public.v_d9_checks
with (security_invoker = on) as
with m as (select * from public.v_d9_meta),
p as (
  select coalesce((select waarde from public.dash_parameters where sleutel = 'h4_geen_next_step_dagen'), 14) as h4_dagen
),
-- De drempel meeliften als kolom i.p.v. als sub-select in een FILTER-clausule:
-- dat leest beter en houdt de aggregaten simpel.
b as (select d.*, p.h4_dagen from public.v_d9_deals d cross join p),
cb_companies as (
  select distinct cid
  from b, lateral unnest(b.associated_company_ids) as u(cid)
  where b.is_klantdeal
),
gewonnen_open as (
  select count(*) as n
  from b
  where b.fase = 'gewonnen'
    and not exists (select 1 from cb_companies cc where cc.cid = any (b.associated_company_ids))
),
dubbel as (
  select
    count(*) filter (where x.n > 1) as n_dubbel,
    count(*)                        as n_companies
  from (
    select u.cid, b.pipeline_id, count(*) as n
    from b, lateral unnest(b.associated_company_ids) as u(cid)
    where b.is_open
    group by u.cid, b.pipeline_id
  ) x
),
comp as (
  select
    count(*)                                                                       as n,
    count(*) filter (
      where nullif(btrim(coalesce(properties->>'totale_omvang', '')), '') is null
    )                                                                              as zonder_omvang
  from public.hubspot_companies
  where is_archived is not true
),
t as (
  select
    count(*) filter (where b.fase = 'verloren' and b.verliesreden is null)                     as h1,
    count(*) filter (where b.fase = 'verloren')                                                as h1_noemer,
    count(*) filter (where b.fase = '3'
                       and (b.beslisdatum is null or b.verwachte_bodem is null
                            or b.verwachte_plafond is null))                                   as h2,
    count(*) filter (where b.fase = '3')                                                       as h2_noemer,
    count(*) filter (where b.is_open and b.beslisdatum is not null
                       and b.beslisdatum < current_date)                                       as h3,
    count(*) filter (where b.is_open)                                                          as h3_noemer,
    count(*) filter (where b.is_open and b.is_salesdeal
                       and (b.next_step is null or b.next_step < current_date)
                       and b.dagen_open > b.h4_dagen)                                          as h4,
    count(*) filter (where b.is_open and b.is_salesdeal)                                       as h4_noemer,
    count(*) filter (where (b.is_open or b.is_klantdeal) and b.owner_onbekend)                 as h5,
    count(*) filter (where (b.is_open or b.is_klantdeal))                                      as h5_noemer,
    count(*) filter (where b.fase = 'gewonnen')                                                as h6_noemer,
    count(*) filter (where b.is_kern
                       and (b.startdatum is null or b.plafond is null or b.bodem is null))     as h8,
    count(*) filter (where b.is_kern)                                                          as h8_noemer,
    count(*) filter (where b.fase = 'proef'
                       and (b.einddatum is null or b.einddatum < current_date))                as h9,
    count(*) filter (where b.fase = 'proef')                                                   as h9_noemer,
    count(*) filter (where b.is_klantdeal and b.fase in ('actief', 'proef', 'niet_gestart', 'onboarding')
                       and b.closedate is not null)                                            as h10,
    count(*) filter (where b.is_klantdeal and b.fase in ('actief', 'proef', 'niet_gestart', 'onboarding'))    as h10_noemer,
    count(*) filter (where nullif(btrim(coalesce(b.properties->>'contract_start_date', '')), '') is not null
                        or nullif(btrim(coalesce(b.properties->>'contract_einddatum', '')), '') is not null) as h11,
    count(*)                                                                                   as h11_noemer,
    count(*) filter (where (b.is_open or b.is_klantdeal) and b.zonder_company)                 as h13,
    count(*) filter (where (b.is_open or b.is_klantdeal))                                      as h13_noemer,
    count(*) filter (where b.fase = 'beeindigd')                                               as h19_noemer
  from b
),
def(check_id, volgnummer, titel, definitie, eigenaar, scope, scope_label, raakt, records_view, blokkerend, beschikbaar, reden_niet_meetbaar) as (
  values
  ('H1', 1, 'Verliesreden ontbreekt',
   'Deal in Afgevallen na demo of Backburner zonder ingevulde verliesreden. Zonder reden is verliesanalyse op D10 onmogelijk en is elke conclusie over "waarom" een gesprek in plaats van een meting.',
   'Jay', 'sales', 'Sales Pipeline', (array['D1','D10'])::text[], 'v_d9_h1_verliesreden_leeg', false, 'mirror', null::text),

  ('H2', 2, 'Fase 3 zonder beslisdatum of verwachting',
   'Deal in fase 3 (offerte gestuurd t/m licentieovereenkomst) zonder beslisdatum, minimumafname of contractomvang. Deze drie velden dragen de forecast: ontbreekt er één, dan telt de deal niet mee in bodem en plafond.',
   'Jay', 'sales', 'Sales Pipeline', (array['D1'])::text[], 'v_d9_h2_fase3_zonder_velden', true, 'mirror', null),

  ('H3', 3, 'Beslisdatum is verlopen',
   'Open deal met een beslisdatum die in het verleden ligt. De datum is dan geen verwachting meer maar een herinnering; de forecast van deze maand staat op een besluit dat al genomen had moeten zijn.',
   'Jay', 'sales', 'Sales Pipeline', (array['D1'])::text[], 'v_d9_h3_verlopen_beslisdatum', true, 'mirror', null),

  ('H4', 4, 'Geen volgende stap gepland',
   'Open deal in de Sales Pipeline zonder geplande volgende activiteit (of met een activiteit die in het verleden ligt), die ouder is dan de drempel uit dash_parameters. Een deal zonder volgende stap beweegt niet.',
   'Jay', 'sales', 'Sales Pipeline', (array['D1'])::text[], 'v_d9_h4_geen_next_step', true, 'mirror', null),

  ('H5', 5, 'Zonder of met onbekende eigenaar',
   'Open deal of klantdeal zonder eigenaar, of met een eigenaar die niet (meer) actief in HubSpot staat. Elke ontleding per eigenaar is dan onvolledig, en niemand voelt zich verantwoordelijk.',
   'CS', 'beide', 'Sales Pipeline + Customer Base', (array['D1','D4','D7'])::text[], 'v_d9_h5_zonder_owner', true, 'nu', null),

  ('H6', 6, 'Gewonnen deal staat nog in de Sales Pipeline',
   'Deal in Gesloten & Gescoord waarvan de company geen enkele klantdeal in de Customer Base heeft. De overdracht van sales naar CS is dan niet afgerond en de klant bestaat administratief nog niet.',
   'Jay', 'sales', 'Sales Pipeline', (array['D1','D4'])::text[], 'v_d9_h6_gewonnen_in_sales', false, 'nu', null),

  ('H7', 7, 'Meer dan één open deal op dezelfde klant',
   'Company met twee of meer lopende deals in dezelfde pipeline. De klant wordt dan dubbel geteld in aantallen en dubbel gewaardeerd in de forecast.',
   'Jay', 'beide', 'Sales Pipeline + Customer Base', (array['D1','D4','D10'])::text[], 'v_d9_h7_dubbele_open_deals', false, 'nu', null),

  ('H8', 8, 'Klantdeal zonder kernvelden',
   'Lopende klantdeal (proef, actief of vernieuwd) zonder startdatum, contractomvang of minimumafname. Zonder deze drie is er geen cohort, geen verlengingsmoment en geen contractwaarde.',
   'CS', 'klant', 'Customer Base', (array['D3','D4','D10'])::text[], 'v_d9_h8_klantdeal_zonder_kernvelden', false, 'nu', null),

  ('H9', 9, 'Proef zonder of met verlopen einddatum',
   'Deal in Proeftijd zonder einddatum, of met een einddatum die al voorbij is terwijl de deal nog in Proeftijd staat. Beide maken de proefkalender onbetrouwbaar — en het veld betekent in het ene geval "proef loopt af" en in het andere "contract geëindigd".',
   'CS', 'klant', 'Customer Base', (array['D3','D4','D10'])::text[], 'v_d9_h9_proef_einddatum', false, 'nu', null),

  ('H10', 10, 'Afsluitdatum op een lopende klantdeal',
   'Klantdeal in Proeftijd, Actieve deals of Niet gestart met een ingevulde afsluitdatum. Een lopende klant heeft geen einde; de datum is administratief en mag nooit als verliesdatum gelezen worden.',
   'CS', 'klant', 'Customer Base', (array['D4','D10'])::text[], 'v_d9_h10_administratieve_closedate', false, 'nu', null),

  ('H11', 11, 'Doublure-velden contractstart en contracteinde',
   'Eenmalige constatering, geen doorlopende opruimregel: op 12-09-2026 waren contract_start_date en contract_einddatum 0 van 1.139 gevuld. Het zijn dode velden; startdatum en einddatum zijn leidend. Loopt dit getal ooit op, dan is er een tweede waarheid ontstaan.',
   'Jelle', 'beide', 'Alle deals', (array['D4','D10'])::text[], 'v_d9_h11_doublure_velden', false, 'constatering', null),

  ('H12', 12, 'Kantoorgrootte ontbreekt op de company',
   'Company zonder totale omvang (aantal advocaten). Dit veld draagt de segment-ontleding op élk bord; zolang het ontbreekt, bestaat er geen enkele uitsplitsing naar kantoorgrootte.',
   'Jelle', 'company', 'Companies', (array['D1','D4','D10'])::text[], 'v_d9_h12_company_zonder_omvang', false, 'mirror_company', null),

  ('H13', 13, 'Deal zonder company',
   'Open deal of klantdeal zonder gekoppelde company. Zo''n deal valt buiten elke telling per klant, per segment en per domein.',
   'Jay', 'beide', 'Sales Pipeline + Customer Base', (array['D1','D4','D10'])::text[], 'v_d9_h13_zonder_company', false, 'nu', null),

  ('H14', 14, 'Leadbron of kanaal ontbreekt',
   'Uit welk kanaal een deal komt, is nergens vastgelegd: er bestaat geen veld voor. Daarmee is de bijdrage per motor (sales-led, product-led, klantbasis) niet te meten.',
   'Jelle', 'sales', 'Sales Pipeline', (array['D1','D2'])::text[], null, false, 'nooit', 'Veld bestaat niet in HubSpot — aanmaken is een besluit van Jelle en Jay.'),

  ('H15', 15, 'Verlengde proef niet herkenbaar',
   'Een verlengde proef wordt administratief nergens vastgelegd. Daardoor is de grens tussen "proef niet omgezet" en "opzegging" op D10 een duurregel en geen feit.',
   'Jelle', 'klant', 'Customer Base', (array['D10','D4'])::text[], null, false, 'nooit', 'Veld bestaat niet in HubSpot — raakt direct de B/C-grens (dash_parameters.bc_duurgrens_dagen).'),

  ('H16', 16, 'Concurrent in de proef',
   'Of er tijdens de proef een concurrent meedeed, wordt niet vastgelegd. Verlies aan een concurrent is daarmee niet te tellen.',
   'Jelle', 'klant', 'Customer Base', (array['D10'])::text[], null, false, 'nooit', 'Veld bestaat niet in HubSpot.'),

  ('H17', 17, 'Naammatching Genie ↔ HubSpot',
   'Kantoornamen uit de gebruiksdata zijn niet aan HubSpot-companies gekoppeld. Zonder alias-tabel is er geen brug tussen gedrag en CRM.',
   'Jelle', 'extern', 'Genie ↔ HubSpot', (array['D3','D4'])::text[], null, false, 'extern', 'Genie/Databricks is niet ontsloten; er is nog geen dim_klant_alias.'),

  ('H18', 18, 'Klantaantal wijkt af tussen bronnen',
   'Het aantal betalende klanten (AFAS) is niet naast het aantal actieve klanten (HubSpot) te leggen. Verschillen blijven daardoor onverklaard.',
   'Jelle', 'extern', 'AFAS ↔ HubSpot', (array['D4','D5','D10'])::text[], null, false, 'extern', 'AFAS is niet gekoppeld; er is geen factuur-export in de database.'),

  ('H19', 19, 'Uitvalreden ontbreekt op klantdeals',
   'Waarom een klantdeal is beëindigd, wordt niet vastgelegd: er bestaat geen uitvalreden-veld op de Customer Base. Op D10 blijft "niet geregistreerd" daardoor de grootste categorie.',
   'CS', 'klant', 'Customer Base', (array['D10'])::text[], null, false, 'nooit', 'Veld bestaat niet in HubSpot — de basis staat in de noemer: zoveel beëindigde klantdeals hebben geen reden.')
)
select
  def.check_id,
  def.volgnummer,
  def.titel,
  def.definitie,
  def.eigenaar,
  def.scope,
  def.scope_label,
  def.raakt,
  def.records_view,
  def.blokkerend,
  st.status,
  case when st.status in ('meetbaar', 'constatering') then
    case def.check_id
      when 'H1'  then t.h1  when 'H2'  then t.h2  when 'H3' then t.h3
      when 'H4'  then t.h4  when 'H5'  then t.h5
      when 'H6'  then (select n from gewonnen_open)
      when 'H7'  then (select n_dubbel from dubbel)
      when 'H8'  then t.h8  when 'H9'  then t.h9  when 'H10' then t.h10
      when 'H11' then t.h11
      when 'H12' then (select zonder_omvang from comp)
      when 'H13' then t.h13
    end
  end::int as aantal,
  case def.check_id
    when 'H1'  then t.h1_noemer  when 'H2'  then t.h2_noemer  when 'H3'  then t.h3_noemer
    when 'H4'  then t.h4_noemer  when 'H5'  then t.h5_noemer  when 'H6'  then t.h6_noemer
    when 'H7'  then (select n_companies from dubbel)
    when 'H8'  then t.h8_noemer  when 'H9'  then t.h9_noemer
    when 'H10' then t.h10_noemer when 'H11' then t.h11_noemer
    when 'H12' then (select n from comp)
    when 'H13' then t.h13_noemer when 'H19' then t.h19_noemer
  end::int as noemer,
  case def.check_id
    when 'H1'  then 'verloren deals'          when 'H2'  then 'deals in fase 3'
    when 'H3'  then 'open deals'              when 'H4'  then 'open sales-deals'
    when 'H5'  then 'open deals + klantdeals' when 'H6'  then 'gewonnen deals'
    when 'H7'  then 'klanten met een open deal' when 'H8' then 'lopende klantdeals'
    when 'H9'  then 'proeven'                 when 'H10' then 'lopende klantdeals'
    when 'H11' then 'deals in de mirror'      when 'H12' then 'companies'
    when 'H13' then 'open deals + klantdeals' when 'H19' then 'beëindigde klantdeals'
  end as noemer_label,
  coalesce(
    def.reden_niet_meetbaar,
    case when st.status = 'wacht_op_mirror'
      then 'Het veld bestaat in HubSpot maar staat nog niet in de mirror: de propertylijst van hubspot-sync-etl moet uitgebreid en één keer volledig gesynct worden.'
    end
  ) as reden,
  m.peildatum,
  m.mirror_verouderd,
  m.deals_zichtbaar
from def
cross join t
cross join m
cross join lateral (
  select case
    when def.beschikbaar = 'nooit'        then 'niet_meetbaar'
    when def.beschikbaar = 'extern'       then 'niet_gekoppeld'
    when def.beschikbaar = 'constatering' then 'constatering'
    when def.beschikbaar = 'mirror' and not (
      case def.check_id
        when 'H1' then m.prop_verliesreden
        when 'H2' then (m.prop_beslisdatum and m.prop_verwachtingsvelden)
        when 'H3' then m.prop_beslisdatum
        when 'H4' then m.prop_next_step
        else true
      end
    ) then 'wacht_op_mirror'
    when def.beschikbaar = 'mirror_company' and not m.prop_company_omvang then 'wacht_op_mirror'
    else 'meetbaar'
  end as status
) st;

comment on view public.v_d9_checks is
  'Eén rij per hygiënecheck van D9. status: meetbaar | wacht_op_mirror (veld bestaat in HubSpot, nog niet in de mirror) | niet_meetbaar (veld bestaat niet) | niet_gekoppeld (externe bron) | constatering (eenmalig, geen opruimregel). aantal is NULL waar de check niet meetbaar is — NULL is geen nul en mag niet als nul getoond worden.';

grant select on public.v_d9_checks to authenticated;

-- ── 4. v_d9_forecast_blokkers — het critical number ──────────────────────────
-- "7 van de 32 open deals heeft minstens één blokkerende fout." Bewust een
-- deal-telling en geen som van de checks: één deal kan op drie lijsten staan
-- en zou dan drie keer meetellen. Richting omlaag is het doel, niet nul.
create or replace view public.v_d9_forecast_blokkers
with (security_invoker = on) as
with m as (select * from public.v_d9_meta),
p as (
  select coalesce((select waarde from public.dash_parameters where sleutel = 'h4_geen_next_step_dagen'), 14) as h4_dagen
),
b as (select d.*, p.h4_dagen from public.v_d9_deals d cross join p where d.is_open and d.is_salesdeal)
select
  count(*) filter (
    where (b.fase = '3' and (b.beslisdatum is null or b.verwachte_bodem is null or b.verwachte_plafond is null))
       or (b.beslisdatum is not null and b.beslisdatum < current_date)
       or ((b.next_step is null or b.next_step < current_date) and b.dagen_open > b.h4_dagen)
       or b.owner_onbekend
  )::int                                        as aantal,
  count(*)::int                                 as noemer,
  (select array_remove(array[
     case when not m.prop_verwachtingsvelden or not m.prop_beslisdatum then 'H2'::text end,
     case when not m.prop_beslisdatum then 'H3'::text end,
     case when not m.prop_next_step   then 'H4'::text end
   ], null) from m)                             as blind_voor,
  (select peildatum from m)                     as peildatum
from b;

comment on view public.v_d9_forecast_blokkers is
  'Critical number van D9: het aantal open Sales-Pipeline-deals met minstens één blokkerende hygiënefout (H2, H3, H4 of H5), naast het totaal aantal open sales-deals. blind_voor noemt de checks die nu niet meetellen omdat hun veld nog niet in de mirror zit — zonder die kolom zou het getal te gunstig lijken.';

grant select on public.v_d9_forecast_blokkers to authenticated;
