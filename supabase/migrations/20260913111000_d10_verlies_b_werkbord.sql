-- =============================================================================
-- D10 · Klantverlies — B: recordlijst, CS-werkbord en redenen          (v1.175)
-- =============================================================================
-- De stuurbordzone (migratie A) geeft de tellingen. Hier staan de lijsten
-- eronder: de records achter een soort, en de twee vooruitkijkende werklijsten.
-- Dat de proeven vóór de verlengingen komen volgt uit de meting en niet uit
-- gewoonte — negentien van de twintig verliezen zitten in de proef en één in de
-- licentieperiode, dus de vraag "wie staat op het punt te vertrekken" gaat in de
-- eerste plaats over lópende proeven.
--
--   v_d10_verlies_records       niveau drie van het drill-pad: de records achter
--                               één soort en één maand.
--   v_d10_verlengingskalender   klantdeals met hun eerstvolgende contractjaar.
--   v_d10_proeven_lopend        proeven met hun einddatum — uit het veld waar
--                               het gevuld is, anders afgeleid uit de looptijd
--                               en dan als zodanig gelabeld.
--   v_d10_redenen               de redenen achter het verlies, met een
--                               bron-kolom. AI-categorisering en HubSpot-veld
--                               worden nooit stil gemengd.
--
-- De early-warning-lijst (dalend gebruik) staat bewust níét in deze migratie:
-- daarvoor is gebruiksdata nodig die nergens in dit project ontsloten is. Het
-- bord toont die lijst als rode lege plek met de reden erbij — de lege plek is
-- het argument voor de koppeling (per-dashboard.md, D10).
--
-- Bron: dashboarding-onderzoek 2026-09-12 §5.4 en §5.8, per-dashboard.md D10.
-- Terugdraaien: `drop view` in omgekeerde volgorde.
-- =============================================================================

-- ── 1. v_d10_verlies_records — de lijst achter elk soort ─────────────────────
create or replace view public.v_d10_verlies_records
with (security_invoker = on) as
select
  soort, soort_label, is_churn, churn_label,
  deal_id,
  coalesce(bedrijfsnaam, dealname)                                          as klant,
  dealname, stage_label, eigenaar,
  verliesdatum, verliesmaand, datum_bron,
  startdatum, einddatum, churned_at,
  dagen_tot_verlies, duur_grondslag, grensgeval,
  bodem_lic, plafond_lic, prijsmodel,
  waarde_bodem, waarde_plafond, waardeerbaar, plafond_bekend,
  verliesreden, hubspot_url
from public.v_d10_verlies;

comment on view public.v_d10_verlies_records is
  'Niveau drie van het drill-pad: de records achter een soort en een maand. grensgeval markeert de verliezen die binnen de marge van de duurgrens vallen — die kunnen door één administratieve slordigheid van soort wisselen, en dat hoort de lezer te zien vóór hij op het getal stuurt.';

grant select on public.v_d10_verlies_records to authenticated;

-- ── 2. v_d10_verlengingskalender ─────────────────────────────────────────────
-- Verlengingsmoment = startdatum + 12 maanden. Dat is een berekening op één
-- veld, geen vastgelegde datum: HubSpot kent geen verlengingsdatum, en een
-- verlengde proef of een verlengd contract wordt administratief nergens apart
-- opgeslagen. Vandaar `moment_grondslag` in elke rij en `status = 'verstreken'`
-- voor de contracten waar dat eerste jaar al voorbij is — daar is de échte
-- eerstvolgende datum onbekend, en dat is iets anders dan "geen verlenging".
create or replace view public.v_d10_verlengingskalender
with (security_invoker = on) as
with k as (
  select
    d.deal_id, d.dealname, f.fase, f.fase_label, f.stage_label,
    (d.associated_company_ids)[1]                                             as company_id,
    d.hubspot_owner_id,
    public.dash_prop_date(d.properties, 'startdatum')                         as startdatum,
    public.dash_prop_num(d.properties, 'minimale_licenties_licentieperiode')  as bodem_lic,
    public.dash_prop_num(d.properties, 'omvang_licentieperiode')              as plafond_lic,
    public.dash_prop_num(d.properties, 'licentieprijs_per_gebruiker')         as prijs,
    public.dash_prop_num(d.properties, 'vaste_licentieprijs_maand')           as vaste_prijs
  from public.hubspot_deals d
  join public.dim_stage_fase f
    on f.stage_id = d.dealstage and f.pipeline_id = d.pipeline_id
  where d.is_archived is not true
    and d.pipeline_id = '2299277539'
    and f.fase in ('actief', 'vernieuwd')
)
select
  k.deal_id,
  coalesce(co.name, k.dealname)                                               as klant,
  k.dealname, k.fase, k.fase_label, k.stage_label,
  coalesce(u.full_name, u.email)                                              as eigenaar,
  k.startdatum,
  (k.startdatum + interval '12 months')::date                                 as verlengingsmoment,
  ((k.startdatum + interval '12 months')::date - current_date)                as dagen_te_gaan,
  case
    when k.startdatum is null                                                      then 'onbekend'
    when (k.startdatum + interval '12 months')::date < current_date                then 'verstreken'
    when (k.startdatum + interval '12 months')::date <= current_date + 90          then 'binnen_90'
    else                                                                                'later'
  end                                                                         as status,
  'startdatum + 12 maanden'::text                                             as moment_grondslag,
  k.bodem_lic, k.plafond_lic,
  case when coalesce(k.vaste_prijs, 0) > 0 then k.vaste_prijs else k.bodem_lic   * k.prijs end as waarde_bodem,
  case when coalesce(k.vaste_prijs, 0) > 0 then k.vaste_prijs else k.plafond_lic * k.prijs end as waarde_plafond,
  'https://app.hubspot.com/contacts/0/deal/' || k.deal_id                     as hubspot_url
from k
left join public.hubspot_companies co on co.company_id = k.company_id
left join public.hubspot_users     u  on u.hubspot_owner_id = k.hubspot_owner_id and u.active is not false;

comment on view public.v_d10_verlengingskalender is
  'De enige vooruitkijkende lijst die vandaag zonder nieuwe bron te maken is: actieve en vernieuwde klantdeals met hun eerste contractjaar (startdatum + 12 maanden). status = verstreken betekent dat dat eerste jaar voorbij is en de échte eerstvolgende datum niet in HubSpot staat — dat is een datavraag aan CS, geen klant zonder verlenging.';

grant select on public.v_d10_verlengingskalender to authenticated;

-- ── 3. v_d10_proeven_lopend ──────────────────────────────────────────────────
-- De tegenhanger van de verlengingskalender, en met de gemeten verhouding
-- (19 van de 20 verliezen in de proef) de belangrijkste van de twee.
-- `einddatum` is gevuld op 7 van de 17 proeven; voor de rest is het einde af te
-- leiden uit `looptijd_proefperiode_maanden`. Die afleiding staat op het bord
-- met een eigen label en nooit in dezelfde kolom als het echte veld — een
-- afgeleide datum die als ingevulde datum leest, is precies hoe een bord
-- betrouwbaarder lijkt dan het is. Bij looptijd 0 wordt niets afgeleid: dat zou
-- een proef opleveren die eindigt op de dag dat hij begint.
create or replace view public.v_d10_proeven_lopend
with (security_invoker = on) as
with p as (
  select
    d.deal_id, d.dealname, f.stage_label,
    (d.associated_company_ids)[1]                                             as company_id,
    d.hubspot_owner_id,
    public.dash_prop_date(d.properties, 'startdatum')                         as startdatum,
    public.dash_prop_date(d.properties, 'einddatum')                          as einddatum_veld,
    public.dash_prop_num(d.properties, 'looptijd_proefperiode_maanden')       as looptijd_maanden,
    public.dash_prop_num(d.properties, 'minimale_licenties_licentieperiode')  as bodem_lic,
    public.dash_prop_num(d.properties, 'omvang_licentieperiode')              as plafond_lic,
    public.dash_prop_num(d.properties, 'licentieprijs_per_gebruiker')         as prijs,
    public.dash_prop_num(d.properties, 'vaste_licentieprijs_maand')           as vaste_prijs
  from public.hubspot_deals d
  join public.dim_stage_fase f
    on f.stage_id = d.dealstage and f.pipeline_id = d.pipeline_id
  where d.is_archived is not true
    and d.pipeline_id = '2299277539'
    and f.fase = 'proef'
),
b as (
  select p.*,
    case
      when p.einddatum_veld is not null then p.einddatum_veld
      when p.startdatum is not null and p.looptijd_maanden > 0
        then (p.startdatum + (p.looptijd_maanden || ' months')::interval)::date
    end                                                                       as einddatum,
    case
      when p.einddatum_veld is not null                                       then 'veld'
      when p.startdatum is not null and p.looptijd_maanden > 0                then 'afgeleid'
      else                                                                         'geen'
    end                                                                       as einddatum_bron
  from p
)
select
  b.deal_id,
  coalesce(co.name, b.dealname)                                               as klant,
  b.dealname, b.stage_label,
  coalesce(u.full_name, u.email)                                              as eigenaar,
  b.startdatum, b.einddatum, b.einddatum_bron, b.einddatum_veld,
  b.looptijd_maanden,
  (current_date - b.startdatum)                                               as dagen_lopend,
  (b.einddatum - current_date)                                                as dagen_te_gaan,
  case
    when b.einddatum is null                       then 'onbekend'
    when b.einddatum <  current_date               then 'verlopen'
    when b.einddatum <= current_date + 30          then 'binnen_30'
    else                                                'later'
  end                                                                         as status,
  b.bodem_lic, b.plafond_lic,
  case when coalesce(b.vaste_prijs, 0) > 0 then b.vaste_prijs else b.bodem_lic   * b.prijs end as waarde_bodem,
  case when coalesce(b.vaste_prijs, 0) > 0 then b.vaste_prijs else b.plafond_lic * b.prijs end as waarde_plafond,
  'https://app.hubspot.com/contacts/0/deal/' || b.deal_id                     as hubspot_url
from b
left join public.hubspot_companies co on co.company_id = b.company_id
left join public.hubspot_users     u  on u.hubspot_owner_id = b.hubspot_owner_id and u.active is not false;

comment on view public.v_d10_proeven_lopend is
  'Lopende proeven met hun einde. einddatum_bron = veld | afgeleid | geen; afgeleid betekent startdatum + looptijd_proefperiode_maanden en hoort op het bord als zodanig gelabeld te staan. status = verlopen op een deal die nog in Proeftijd staat is de scherpste CS-signaallijst die dit project vandaag kan maken: daar is de proef voorbij en is er nog geen besluit genomen.';

grant select on public.v_d10_proeven_lopend to authenticated;

-- ── 4. v_d10_redenen ─────────────────────────────────────────────────────────
-- Twee bronnen, twee blokken, nooit één staafdiagram.
--
--   `ai`       de categorisering van de churn-analytics-agent op basis van
--              notities en mails. Dit is de enige redenenbron die vandaag
--              bestaat, en hij dekt alleen B en C (de klantkant).
--   `hubspot`  `closed_lost_reason` op de verloren sales-deals (A). Gemeten
--              13-09-2026: nul van de zevenenvijftig. Die nul staat groot en
--              rood op het bord — het bord dwingt het gedrag af dat de data
--              ontbeert (per-dashboard.md, D10).
--
-- De derde bron uit het onderzoek — een handmatige opgave van sales/CS — bestaat
-- nog niet en wordt hier níét verzonnen. Zodra die tabel er is, komt hij als
-- derde blok met bron = 'opgave' binnen, zonder de andere twee aan te raken.
create or replace view public.v_d10_redenen
with (security_invoker = on) as
with ai as (
  select
    c.category_id,
    cat.category_key,
    cat.label,
    cat.color,
    coalesce(cat.sort_order, 950)                                             as sort_order,
    count(*)::int                                                             as aantal,
    -- Het venster van dertig dagen uit de oude KPI-strip blijft bestaan, maar
    -- als tweede kolom naast het volledige venster en nooit als ranglijst op
    -- zichzelf: met achttien dossiers in dertien maanden vallen er in dertig
    -- dagen een of twee, en een "top-reden" over n=2 is ruis (principes.md
    -- regel 4). Het bord toont beide getallen en laat de lezer kiezen.
    count(*) filter (where v.verliesdatum >= current_date - 30)::int          as aantal_30d
  from public.churn_customers c
  left join public.churn_categories cat on cat.id = c.category_id
  left join public.v_d10_verlies    v   on v.deal_id = c.deal_id
  where c.superseded = false
  group by c.category_id, cat.category_key, cat.label, cat.color, cat.sort_order
),
-- Beëindigde klantdeals waar de agent nog geen dossier voor heeft. Zonder deze
-- regel lijkt de redenenverdeling volledig terwijl er records buiten vallen.
geen_dossier as (
  select count(*)::int as n
  from public.hubspot_deals d
  join public.dim_stage_fase f on f.stage_id = d.dealstage and f.pipeline_id = d.pipeline_id
  where d.is_archived is not true and d.pipeline_id = '2299277539' and f.fase = 'beeindigd'
    and not exists (select 1 from public.churn_customers c
                     where c.deal_id = d.deal_id and c.superseded = false)
),
-- Eén noemer voor het hele AI-blok: álle beëindigde klantdeals, niet alleen de
-- dossiers. Anders telt een staaf tegen 18 en de regel eronder tegen 20, en dan
-- tellen de percentages niet op naar honderd zonder dat iemand ziet waarom.
ai_noemer as (
  select (((select coalesce(sum(aantal), 0) from ai) + (select n from geen_dossier)))::int as n
),
hs as (
  select
    coalesce(v.verliesreden, '—')                                             as reden,
    (v.verliesreden is null)                                                  as leeg,
    count(*)::int                                                             as aantal,
    count(*) filter (where v.verliesdatum >= current_date - 30)::int          as aantal_30d
  from public.v_d10_verlies v
  where v.soort = 'A'
  group by 1, 2
),
hs_noemer as (select sum(aantal)::int as n from hs)
select
  'ai'::text                                                                  as bron,
  'AI-categorisering uit notities en mails'::text                             as bron_label,
  'B · C — klantkant'::text                                                   as bron_bereik,
  coalesce(ai.label, 'Nog niet gecategoriseerd')                              as reden,
  ai.color                                                                    as kleur,
  ai.aantal,
  (select n from ai_noemer)                                                   as noemer,
  (ai.category_id is null or ai.category_key = 'reden_onbekend')              as is_niet_geregistreerd,
  1                                                                           as blok,
  ai.sort_order,
  ai.aantal_30d
from ai
union all
select
  'ai', 'AI-categorisering uit notities en mails', 'B · C — klantkant',
  'Nog geen dossier (agent loopt achter)', null,
  (select n from geen_dossier), (select n from ai_noemer),
  true, 1, 960, null
where (select n from geen_dossier) > 0
union all
select
  'hubspot'::text,
  'Veld closed_lost_reason in HubSpot'::text,
  'A — prospectkant'::text,
  case when hs.leeg then 'Niet geregistreerd' else hs.reden end,
  null,
  hs.aantal,
  (select n from hs_noemer),
  hs.leeg,
  2,
  case when hs.leeg then 900 else 100 end,
  hs.aantal_30d
from hs;

comment on view public.v_d10_redenen is
  'Redenen achter het verlies, met een bron-kolom die nooit gemengd wordt: `ai` is de churn-analytics-categorisering over de klantkant (B en C), `hubspot` is closed_lost_reason over de prospectkant (A). is_niet_geregistreerd markeert de regels die eigenlijk een gat zijn — die horen op het bord groot en rood, niet weggelaten of samengevoegd met een restcategorie.';

grant select on public.v_d10_redenen to authenticated;
