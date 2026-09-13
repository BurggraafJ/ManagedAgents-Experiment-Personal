-- =============================================================================
-- D10 · Klantverlies — A: basis, soorten, maandreeks, records          (v1.175)
-- =============================================================================
-- Het bord beantwoordt één vraag: hoeveel klanten en prospects verliezen we, in
-- welke fase, waarom — en wie staat op het punt te vertrekken?
--
-- De hele laag draait om één regel die het bestaande /klantverlies vandaag
-- overtreedt: **A, B en C worden nooit opgeteld.** Alleen C is churn in de
-- SaaS-betekenis (Methodiek 3, 623017987: "alleen opzegging in de
-- licentieperiode is churn"). De app toont nu "Totaal verloren 18" — B en C op
-- één hoop, bijna twintig keer de werkelijke churn, en precies het getal dat
-- volgens de D10-pagina het vaakst aan MT en investeerders wordt verteld.
--
--   v_d10_verlies                de basis: één rij per verliesgebeurtenis, met
--                                zijn soort, zijn datum, de herkomst van die
--                                datum en zijn contractwaarde.
--   v_d10_kop                    de drie kaarten in drie rijen — deze maand,
--                                vorige maand, dertien maanden, cumulatief.
--   v_d10_meta                   peildatum, zichtbaarheid, de noemer in twee
--                                tellingen, en de constateringen eronder.
--   v_d10_verlies_per_soort_maand dertien maanden × drie soorten, altijd alle
--                                39 rijen — een lege maand is een gemeten nul.
--
-- De recordlijst achter elk soort (`v_d10_verlies_records`) staat in migratie B,
-- bij de andere lijstviews.
--
-- Vier ontwerpregels die je terugziet in de kolommen:
--
--  1. **Soort is een kolom, geen filter.** Elke rij draagt `soort`, `is_churn`
--     en een `soort_label` in mensentaal. Een view die A/B/C als één getal kan
--     leveren, wordt vroeg of laat opgeteld.
--
--  2. **Elke datum draagt zijn herkomst.** `datum_bron` zegt of de verliesmaand
--     uit de stage-entry komt, uit de einddatum of (als laatste redmiddel) uit
--     closedate. Het bestaande bord doet `churned_at ?? closedate` zonder label;
--     dat is precies hoe een administratieve datum stilletjes een
--     bedrijfsgebeurtenis gaat voorstellen.
--
--  3. **De B/C-grens is een parameter, geen waarheid.** `bc_duurgrens_dagen`
--     (365) staat in dash_parameters en `grensgeval` markeert elk verlies binnen
--     `bc_grensmarge_dagen` (35) van die grens. Gemeten 13-09-2026: B loopt tot
--     364 dagen, C begint op 380 — zestien dagen ertussen, en twee van de twintig
--     records zitten in de marge. Eén administratieve slordigheid verplaatst een
--     klant van "proef niet omgezet" naar "churn".
--
--  4. **A draagt geen geld.** Een verloren prospect heeft een verwachte waarde,
--     geen contractwaarde; die twee naast elkaar zetten nodigt uit tot de
--     optelling die dit bord verbiedt. A telt records, B en C tellen euro's —
--     en die euro's heten contractwaarde, nooit MRR (AFAS is niet gekoppeld).
--
-- Alle views `security_invoker = on`: de RLS van hubspot_deals blijft gelden en
-- er ontstaat geen tweede leespad naar de CRM-mirror.
--
-- Bron: dashboarding-onderzoek 2026-09-12 §5, CD-lock 2026-09-13 (OB-8),
-- Confluence D10 642318365. Terugdraaien: `drop view` in omgekeerde volgorde.
-- =============================================================================

-- ── 0. De gebeurtenis die de A-reeks verklaart ───────────────────────────────
-- Zonder deze markering leest oktober 2025 als de slechtste maand van het jaar.
-- Gemeten 13-09-2026: 27 van de 57 verloren sales-deals gingen in die ene maand
-- naar een verliesstage, verspreid over zes dagen, en ze waren gemiddeld al 223
-- dagen oud (andere maanden: 35 tot 80). Dat is een opruimronde, geen maand
-- waarin 27 kansen verdwenen.
insert into public.events_annotaties (datum, gebeurtenis, borden, bron, toelichting) values
  ('2025-10-03',
   'Opruimronde verliesstages Sales Pipeline (oktober 2025)',
   array['D1','D10']::text[],
   'Gemeten op de mirror 13-09-2026 00:30 UTC',
   'In oktober 2025 zijn 27 deals uit januari–april 2025 naar Afgevallen na demo of Backburner verplaatst, verspreid over zes dagen (3, 10, 17, 21, 24 en 29 oktober). Mediane leeftijd bij verlies: 223 dagen, tegen 35–80 dagen in de maanden erna. De verliesdatum van die records is dus de administratieve datum, niet het moment waarop de kans verdween.')
on conflict (datum, gebeurtenis) do nothing;

-- ── 1. v_d10_verlies — de basis onder elk D10-getal ──────────────────────────
create or replace view public.v_d10_verlies
with (security_invoker = on) as
with p as (
  select
    coalesce((select waarde from public.dash_parameters where sleutel = 'bc_duurgrens_dagen'), 365)  as duurgrens,
    coalesce((select waarde from public.dash_parameters where sleutel = 'bc_grensmarge_dagen'), 35)  as grensmarge
),
-- A · Prospectverlies: sales-deals die nu in een verliesstage staan. De
-- verliesdatum komt uit hs_v2_date_entered_<huidige stage> — sinds de full sync
-- van 13-09-2026 gevuld op 57 van 57, waarmee de A-maandreeks voor het eerst
-- bestaat (onderzoek §5.5-4 hield hem tegen zolang het veld ontbrak).
-- 1-pitters (fase `buiten`) tellen niet mee: buiten scope is geen verlies.
a as (
  select
    'A'::text                                                               as soort,
    d.deal_id, d.dealname, d.pipeline_id, d.dealstage,
    f.stage_label,
    (d.associated_company_ids)[1]                                           as company_id,
    d.hubspot_owner_id,
    coalesce(
      public.dash_prop_date(d.properties, 'hs_v2_date_entered_' || d.dealstage),
      d.closedate::date
    )                                                                       as verliesdatum,
    case
      when public.dash_prop_date(d.properties, 'hs_v2_date_entered_' || d.dealstage) is not null then 'stage_entry'
      when d.closedate is not null then 'closedate'
      else 'geen'
    end                                                                     as datum_bron,
    null::date                                                              as startdatum,
    null::date                                                              as einddatum,
    null::timestamptz                                                       as churned_at,
    (coalesce(
       public.dash_prop_date(d.properties, 'hs_v2_date_entered_' || d.dealstage),
       d.closedate::date) - d.hs_created_at::date)                          as dagen_tot_verlies,
    'deal aangemaakt → verliesstage'::text                                  as duur_grondslag,
    null::numeric as bodem_lic, null::numeric as plafond_lic,
    null::numeric as prijs,     null::numeric as vaste_prijs,
    'geen_contract'::text                                                   as prijsmodel,
    nullif(btrim(coalesce(d.properties->>'closed_lost_reason', '')), '')    as verliesreden
  from public.hubspot_deals d
  join public.dim_stage_fase f
    on f.stage_id = d.dealstage and f.pipeline_id = d.pipeline_id
  where d.is_archived is not true
    and d.pipeline_id = 'default'
    and f.fase = 'verloren'
),
-- B en C · klantdeals die zijn beëindigd. De splitsing is een duurregel, geen
-- statusveld: HubSpot legt een verlengde proef nergens vast.
bc as (
  select
    case when (public.dash_prop_date(d.properties, 'einddatum')
             - public.dash_prop_date(d.properties, 'startdatum')) < p.duurgrens
         then 'B' else 'C' end                                              as soort,
    d.deal_id, d.dealname, d.pipeline_id, d.dealstage,
    f.stage_label,
    (d.associated_company_ids)[1]                                           as company_id,
    d.hubspot_owner_id,
    public.dash_prop_date(d.properties, 'einddatum')                        as verliesdatum,
    case when public.dash_prop_date(d.properties, 'einddatum') is not null then 'einddatum'
         when d.closedate is not null then 'closedate'
         else 'geen' end                                                    as datum_bron,
    public.dash_prop_date(d.properties, 'startdatum')                       as startdatum,
    public.dash_prop_date(d.properties, 'einddatum')                        as einddatum,
    c.churned_at,
    (public.dash_prop_date(d.properties, 'einddatum')
   - public.dash_prop_date(d.properties, 'startdatum'))                     as dagen_tot_verlies,
    'startdatum → einddatum'::text                                          as duur_grondslag,
    public.dash_prop_num(d.properties, 'minimale_licenties_licentieperiode') as bodem_lic,
    public.dash_prop_num(d.properties, 'omvang_licentieperiode')             as plafond_lic,
    public.dash_prop_num(d.properties, 'licentieprijs_per_gebruiker')        as prijs,
    public.dash_prop_num(d.properties, 'vaste_licentieprijs_maand')          as vaste_prijs,
    -- Twee van de twintig beëindigde contracten dragen een vaste maandprijs en
    -- géén prijs per gebruiker; voor die twee is licenties × prijs nul, wat de
    -- verloren contractwaarde met duizenden euro's zou onderschatten.
    case when coalesce(public.dash_prop_num(d.properties, 'vaste_licentieprijs_maand'), 0) > 0
         then 'vast' else 'per_gebruiker' end                               as prijsmodel,
    null::text                                                              as verliesreden
  from public.hubspot_deals d
  cross join p
  join public.dim_stage_fase f
    on f.stage_id = d.dealstage and f.pipeline_id = d.pipeline_id
  left join public.churn_customers c
    on c.deal_id = d.deal_id and c.superseded = false
  where d.is_archived is not true
    and d.pipeline_id = '2299277539'
    and f.fase = 'beeindigd'
),
alles as (select * from a union all select * from bc)
select
  x.soort,
  case x.soort
    when 'A' then 'Prospectverlies'
    when 'B' then 'Proef niet omgezet'
    else          'Opzegging'
  end                                                                       as soort_label,
  (x.soort = 'C')                                                           as is_churn,
  case x.soort
    when 'A' then 'telt niet als churn — deal verloren vóór de proef'
    when 'B' then 'telt niet als churn — proef eindigde zonder klant te worden'
    else          'dit is churn — opzegging in de licentieperiode'
  end                                                                       as churn_label,
  x.deal_id, x.dealname, x.pipeline_id, x.dealstage, x.stage_label,
  x.company_id,
  co.name                                                                   as bedrijfsnaam,
  x.hubspot_owner_id,
  coalesce(u.full_name, u.email)                                            as eigenaar,
  x.verliesdatum,
  date_trunc('month', x.verliesdatum)::date                                 as verliesmaand,
  x.datum_bron,
  x.startdatum, x.einddatum, x.churned_at,
  x.dagen_tot_verlies, x.duur_grondslag,
  -- Grensgeval: alleen zinvol waar de duurregel de soort bepaalt (B/C).
  coalesce(x.soort <> 'A' and abs(x.dagen_tot_verlies - p.duurgrens) <= p.grensmarge, false) as grensgeval,
  p.duurgrens                                                               as duurgrens_dagen,
  p.grensmarge                                                              as grensmarge_dagen,
  x.bodem_lic, x.plafond_lic, x.prijs, x.vaste_prijs, x.prijsmodel,
  case x.prijsmodel
    when 'geen_contract' then null
    when 'vast'          then x.vaste_prijs
    else                      x.bodem_lic * x.prijs
  end                                                                       as waarde_bodem,
  case x.prijsmodel
    when 'geen_contract' then null
    when 'vast'          then x.vaste_prijs
    else                      x.plafond_lic * x.prijs
  end                                                                       as waarde_plafond,
  (x.prijsmodel = 'vast'
   or (x.prijsmodel = 'per_gebruiker' and x.prijs > 0 and x.bodem_lic is not null))   as waardeerbaar,
  (x.prijsmodel = 'vast'
   or (x.prijsmodel = 'per_gebruiker' and x.prijs > 0 and x.plafond_lic is not null)) as plafond_bekend,
  x.verliesreden,
  'https://app.hubspot.com/contacts/0/deal/' || x.deal_id                   as hubspot_url
from alles x
cross join p
left join public.hubspot_companies co on co.company_id = x.company_id
left join public.hubspot_users      u  on u.hubspot_owner_id = x.hubspot_owner_id and u.active is not false;

comment on view public.v_d10_verlies is
  'Basis onder alle D10-getallen: één rij per verliesgebeurtenis met zijn soort (A prospectverlies · B proef niet omgezet · C opzegging = de enige churn), de verliesdatum mét herkomst (datum_bron), de duur mét zijn grondslag en de contractwaarde als bodem–plafond. A draagt bewust geen geld: een verloren prospect heeft een verwachte waarde, geen contract. A, B en C worden nooit opgeteld.';

grant select on public.v_d10_verlies to authenticated;

-- ── 2. v_d10_kop — de drie kaarten, drie rijen ───────────────────────────────
-- Altijd drie rijen, ook als een soort deze maand nul is. De UI leest de rij,
-- telt niet zelf een array op (les uit KpiStrip.jsx, dat jarenlang client-side
-- optelde en daardoor een fout getal kon tonen zonder dat iemand het zag).
create or replace view public.v_d10_kop
with (security_invoker = on) as
-- Labels staan in de VALUES-lijst en niet in een max() over de join: een soort
-- zonder records moet nog steeds zijn naam en zijn churn-label dragen. Zou C ooit
-- op nul staan, dan is "Opzegging · 0 deze maand · dit is churn" het antwoord —
-- niet een naamloze kaart.
with soorten(soort, volgnummer, soort_label, churn_label, duur_grondslag) as (values
  ('A', 1, 'Prospectverlies',    'telt niet als churn — deal verloren vóór de proef',            'deal aangemaakt → verliesstage'),
  ('B', 2, 'Proef niet omgezet', 'telt niet als churn — proef eindigde zonder klant te worden',  'startdatum → einddatum'),
  ('C', 3, 'Opzegging',          'dit is churn — opzegging in de licentieperiode',               'startdatum → einddatum')
),
v as (select * from public.v_d10_verlies)
select
  s.soort,
  s.volgnummer,
  s.soort_label,
  (s.soort = 'C')                                                           as is_churn,
  s.churn_label,
  count(v.deal_id)::int                                                     as totaal,
  count(v.deal_id) filter (
    where v.verliesmaand = date_trunc('month', current_date)::date)::int    as deze_maand,
  count(v.deal_id) filter (
    where v.verliesmaand = (date_trunc('month', current_date) - interval '1 month')::date)::int as vorige_maand,
  count(v.deal_id) filter (
    where v.verliesdatum >= (date_trunc('month', current_date) - interval '12 months')::date)::int as laatste_13_maanden,
  count(v.deal_id) filter (where v.datum_bron = 'geen')::int                as zonder_datum,
  count(v.deal_id) filter (where v.grensgeval)::int                         as grensgevallen,
  count(v.deal_id) filter (where v.waardeerbaar)::int                       as waardeerbaar,
  count(v.deal_id) filter (where v.plafond_bekend)::int                     as plafond_bekend,
  sum(v.waarde_bodem)   filter (where v.waardeerbaar)                       as waarde_bodem,
  sum(v.waarde_plafond) filter (where v.plafond_bekend)                     as waarde_plafond,
  sum(v.bodem_lic)      filter (where v.waardeerbaar)                       as licenties_bodem,
  sum(v.plafond_lic)    filter (where v.plafond_bekend)                     as licenties_plafond,
  min(v.dagen_tot_verlies)                                                  as duur_min,
  max(v.dagen_tot_verlies)                                                  as duur_max,
  percentile_cont(0.5) within group (order by v.dagen_tot_verlies)          as duur_mediaan,
  round(avg(v.dagen_tot_verlies))                                           as duur_gemiddeld,
  s.duur_grondslag,
  min(v.verliesdatum)                                                       as vroegste,
  max(v.verliesdatum)                                                       as laatste
from soorten s
left join v on v.soort = s.soort
group by s.soort, s.volgnummer, s.soort_label, s.churn_label, s.duur_grondslag;

comment on view public.v_d10_kop is
  'De drie kaarten van de eerste blik, één rij per soort, áltijd alle drie — ook bij nul. deze_maand naast totaal en laatste_13_maanden, met de duur (mediaan én gemiddelde, want één uitschieter vervormt een gemiddelde over twintig records) en de contractwaarde als bodem–plafond. Nooit een som over de drie rijen: A is pipeline, B is proef, C is churn.';

grant select on public.v_d10_kop to authenticated;

-- ── 3. v_d10_meta — peildatum, noemer en de constateringen eronder ───────────
create or replace view public.v_d10_meta
with (security_invoker = on) as
with d as (
  select count(*) as n, max(synced_at) as peil
  from public.hubspot_deals where is_archived is not true
),
-- De noemer in twee tellingen. 66 klantdeals zijn 46 kantoren: wie het
-- churnpercentage op de dealtelling baseert, deelt door een te grote noemer.
-- Beide staan op het bord, nooit één (onderzoek §5.2, principes.md regel 8).
n as (
  select
    count(*) filter (where f.fase in ('actief','vernieuwd'))                        as klantdeals,
    count(distinct (x.associated_company_ids)[1]) filter (where f.fase in ('actief','vernieuwd')) as kantoren,
    count(*) filter (where f.fase in ('actief','vernieuwd','proef'))                as klantdeals_incl_proef,
    count(distinct (x.associated_company_ids)[1]) filter (where f.fase in ('actief','vernieuwd','proef')) as kantoren_incl_proef,
    count(*) filter (where f.fase = 'proef')                                        as proeven,
    count(*) filter (where f.fase = 'beeindigd')                                    as beeindigd
  from public.hubspot_deals x
  join public.dim_stage_fase f on f.stage_id = x.dealstage and f.pipeline_id = x.pipeline_id
  where x.is_archived is not true and x.pipeline_id = '2299277539'
),
v as (
  select
    count(*) filter (where soort = 'A')                                             as a_totaal,
    count(*) filter (where soort = 'A' and datum_bron = 'stage_entry')              as a_stage_entry,
    count(*) filter (where soort = 'A' and datum_bron = 'closedate')                as a_closedate,
    count(*) filter (where soort = 'A' and datum_bron = 'geen')                     as a_zonder_datum,
    count(*) filter (where soort = 'A' and verliesreden is not null)                as a_met_reden,
    count(*) filter (where soort <> 'A')                                            as bc_totaal,
    count(*) filter (where grensgeval)                                              as grensgevallen,
    count(*) filter (where soort <> 'A' and not plafond_bekend)                     as bc_zonder_plafond
  from public.v_d10_verlies
),
ds as (
  select
    count(*) filter (where superseded = false)                                      as dossiers,
    count(*) filter (where superseded = false and churn_summary is not null)        as met_samenvatting,
    count(*) filter (where superseded = false and churned_at is not null)           as met_churned_at,
    max(last_summarized_at)                                                         as laatste_run
  from public.churn_customers
),
zd as (
  select count(*) as n
  from public.hubspot_deals x
  join public.dim_stage_fase f on f.stage_id = x.dealstage and f.pipeline_id = x.pipeline_id
  where x.is_archived is not true and x.pipeline_id = '2299277539' and f.fase = 'beeindigd'
    and not exists (select 1 from public.churn_customers c
                     where c.deal_id = x.deal_id and c.superseded = false)
)
select
  d.peil                                                                            as peildatum,
  case when d.peil is null then null
       else floor(extract(epoch from (now() - d.peil)) / 60)::int end                as minuten_oud,
  (d.peil is null or d.peil < now() - interval '60 minutes')                         as mirror_verouderd,
  d.n                                                                               as deals_zichtbaar,
  n.klantdeals                                                                      as noemer_klantdeals,
  n.kantoren                                                                        as noemer_kantoren,
  n.klantdeals_incl_proef, n.kantoren_incl_proef,
  n.proeven, n.beeindigd,
  v.a_totaal, v.a_stage_entry, v.a_closedate, v.a_zonder_datum, v.a_met_reden,
  v.bc_totaal, v.grensgevallen, v.bc_zonder_plafond,
  ds.dossiers, ds.met_samenvatting, ds.met_churned_at, ds.laatste_run,
  zd.n                                                                              as dossiers_ontbrekend,
  (select waarde from public.dash_parameters where sleutel = 'bc_duurgrens_dagen')   as duurgrens_dagen,
  (select waarde from public.dash_parameters where sleutel = 'bc_grensmarge_dagen')  as grensmarge_dagen,
  -- AFAS is de bron van "betalend"; zolang die niet gekoppeld is, bestaat er geen
  -- noemer van betalende klanten en dus geen churnpercentage dat finance herkent.
  false                                                                             as afas_gekoppeld,
  -- Onder tien waarnemingen geen percentage als hoofdgetal (principes.md regel 4).
  -- Met één opzegging in dertien maanden is elk churnpercentage ruis.
  ((select count(*) from public.v_d10_verlies where soort = 'C') >= 10)              as churn_pct_toonbaar,
  (select count(*) from public.hubspot_companies
    where is_archived is not true
      and nullif(btrim(coalesce(properties->>'totale_omvang', '')), '') is not null) as companies_met_omvang,
  (select count(*) from public.hubspot_companies where is_archived is not true)      as companies_zichtbaar
from d, n, v, ds, zd;

comment on view public.v_d10_meta is
  'Eén rij met de peildatum, hoeveel mirror-rijen deze kijker ziet (0 = geen records óf geen rechten: hubspot_deals eist is_admin_or_higher() + session_mfa_ok()) en de constateringen die onder de D10-cijfers horen: de noemer in twee tellingen (klantdeals én kantoren), de dekking van de A-datering, de dossier-achterstand van de churn-agent en of AFAS gekoppeld is.';

grant select on public.v_d10_meta to authenticated;

-- ── 4. v_d10_verlies_per_soort_maand — dertien maanden × drie soorten ────────
-- Volledige kruistabel: dertien maanden maal drie soorten is negenendertig
-- rijen, ook waar niets gebeurde. Een maand die uit een group-by wegvalt omdat
-- ze leeg is, leest als een gat in de meting in plaats van als een goede maand.
create or replace view public.v_d10_verlies_per_soort_maand
with (security_invoker = on) as
with maanden as (
  select (date_trunc('month', current_date) - (i || ' months')::interval)::date as maand
  from generate_series(0, 12) as g(i)
),
soorten(soort, volgnummer) as (values ('A', 1), ('B', 2), ('C', 3)),
v as (select * from public.v_d10_verlies)
select
  m.maand,
  to_char(m.maand, 'YYYY-MM')                                               as maand_key,
  (m.maand = date_trunc('month', current_date)::date)                       as is_huidige_maand,
  s.soort,
  s.volgnummer,
  count(v.deal_id)::int                                                     as aantal,
  count(v.deal_id) filter (where v.grensgeval)::int                         as grensgevallen,
  sum(v.bodem_lic)      filter (where v.waardeerbaar)                       as licenties_bodem,
  sum(v.plafond_lic)    filter (where v.plafond_bekend)                     as licenties_plafond,
  sum(v.waarde_bodem)   filter (where v.waardeerbaar)                       as waarde_bodem,
  sum(v.waarde_plafond) filter (where v.plafond_bekend)                     as waarde_plafond,
  count(v.deal_id) filter (where v.datum_bron in ('stage_entry','einddatum'))::int as op_gebeurtenisdatum,
  percentile_cont(0.5) within group (order by v.dagen_tot_verlies)          as duur_mediaan
from maanden m
cross join soorten s
left join v on v.soort = s.soort and v.verliesmaand = m.maand
group by m.maand, s.soort, s.volgnummer;

comment on view public.v_d10_verlies_per_soort_maand is
  'Dertien maanden × drie soorten, altijd alle 39 rijen — nul is een meting, geen gat. De drie reeksen horen náást elkaar getekend te worden, nooit gestapeld: stapelen nodigt visueel uit tot precies de optelling die dit bord verbiedt (visualisatie.md, gestapelde vlakken bij kleine n). duur_mediaan per maand maakt een administratieve opruimronde zichtbaar — die maand heeft een veel hogere mediane leeftijd dan de rest.';

grant select on public.v_d10_verlies_per_soort_maand to authenticated;
