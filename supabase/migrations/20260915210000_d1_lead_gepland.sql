-- =============================================================================
-- D1 Live · geplande kennismakingen tellen óók in de Lead-pipelines (v1.215)
-- =============================================================================
-- Klacht Jelle (15-09-2026): "er staan kennismakingen in de agenda, het bord
-- zegt nul." De backfill-audit van diezelfde dag wees uit dat dat geen sync-gat
-- is — de mirror heeft alle veertien toekomstige `kennismaking_datum`-deals,
-- exact zoals HubSpot ze kent. Het gat zit in de vraag die het bord stelt:
-- `v_d1_deals` filtert op `pipeline_id = 'default'` (Sales Pipeline), en van de
-- veertien geplande kennismakingen staat er precies één in Sales. De andere
-- dertien staan in de Lead-pipelines, waar de SDR ze plant vóórdat de deal naar
-- Sales verhuist. Het bord toonde dus 1 waar 14 hoort.
--
--   Sales (default)             1
--   Leads (Paddls)              9
--   Leads (non-campaign)        2
--   Leads (Sell Me This Pen)    2
--
-- **Wat hier verandert, en vooral: wat niet.** Alleen het *geplande* deel van
-- de aanvoer wordt verbreed. De trechter (`v_d1_pipeline_per_fase`), de
-- forecast (`v_d1_forecast_per_maand`), het kanaal, de kantoorgrootte, de
-- waarde en het critical number `kennismakingen` (gehouden, `v_d1_aanvoer`)
-- blijven onaangeroerd Sales-only. Die getallen dragen fase, beslisdatum en
-- prijs, en die begrippen bestaan in een Lead-pipeline niet: er is geen
-- `dim_stage_fase`-rij voor één Lead-stage (gemeten: 0 van 167 Lead-deals).
-- Een Lead-deal in de trechter zou een fase-loze rij zijn die de noemer van
-- élke fase-verhouding stilletjes verschuift.
--
-- Vier objecten:
--
--   v_d1_km_pipelines      de allowlist zelf, als view. Eén plek waar staat
--                          welke pipelines geplande kennismakingen leveren —
--                          `v_d1_aanvoer_gepland`, `v_d1_meta` en
--                          `v_d1_aanvoer_deals` lezen hem alle drie.
--   v_d1_aanvoer_gepland   telt nu uit `hubspot_deals` over de allowlist in
--                          plaats van uit `v_d1_waarde` (Sales-only).
--                          Kolommen ongewijzigd.
--   v_d1_meta              `kennismaking_gepland` telt over dezelfde allowlist.
--                          Verder letterlijk de bestaande definitie; alleen die
--                          ene teller komt uit een nieuwe CTE.
--   v_d1_aanvoer_deals     NIEUW — de rijen achter een weekstaaf, met de
--                          Sales-deals in de vorm die het bord al kent plus de
--                          Lead-deals van de allowlist, elk met hun eigen
--                          `pipeline_label`.
--
-- ── De allowlist, en waarom deze vijf ───────────────────────────────────────
-- Een kennismaking telt mee als ze op weg is naar Sales. Dat sluit drie soorten
-- pipelines uit, elk om een eigen reden:
--
--   Leadinfo (2971054291)       606 deals, 2 met een kennismakingsdatum ooit.
--                               Een websitebezoekersfeed, geen agenda.
--   Customer Base (2299277539)  108 historische kennismakingen van klanten die
--                               we al hebben. Aanvoer telt nieuwe kantoren.
--   self-serve / DEV / Alt      geen kennismakingen, of geen echte pipeline.
--
-- `Leads (Website)` (3534570692) heeft er vandaag nul, maar staat er wél in:
-- het is dezelfde soort pipeline als de andere drie en een lege allowlist-regel
-- is goedkoper dan een regel die je over een maand mist. De uitsluitingen staan
-- hierboven mét reden — een allowlist zonder reden per regel is een lijst die
-- niemand later durft te wijzigen.
--
-- ── Licenties blijven Sales ─────────────────────────────────────────────────
-- `mid_licenties` in `v_d1_aanvoer_gepland` en `mid_lic` in `v_d1_aanvoer_deals`
-- komen alleen uit `v_d1_waarde`, dus alleen van Sales-deals die `waardeerbaar`
-- zijn (bodem én plafond én prijs). Een Lead-deal draagt die velden zelden en
-- nooit met een prijs; een geraden mid zou de stand Licenties laten stijgen
-- zonder dat er één licentie bij komt. Een Lead-rij telt dus in het aantal en
-- niet in de licenties — dezelfde asymmetrie die het bord al kent tussen
-- `aantal` en `aantal_gewaardeerd`.
--
-- Alle views `security_invoker = on`: de RLS van `hubspot_deals` (admin + MFA)
-- blijft gelden, ook op de nieuwe. Terugdraaien = de twee gewijzigde views
-- terugzetten uit 20260913100000 / 20260915130000 en de twee nieuwe droppen.
-- =============================================================================

-- ── 1. v_d1_km_pipelines — de allowlist, één plek ────────────────────────────
-- Het label komt uit de mirror (HubSpot's eigen naam, met de spatie eraf die in
-- 'Leads (Paddls) ' staat); de naam in de VALUES is de terugval als
-- `hubspot_pipelines` leeg is of de rij nog niet gesynct. De lijst met id's
-- hangt dus nooit aan een read die kan mislukken.
create or replace view public.v_d1_km_pipelines
with (security_invoker = on) as
select
  a.pipeline_id,
  coalesce(nullif(btrim(p.label), ''), a.naam)                    as label,
  a.volgnummer,
  a.is_sales
from (values
        ('default',    1, true,  'Sales Pipeline'),
        ('2557844668', 2, false, 'Leads (Paddls)'),
        ('4057054447', 3, false, 'Leads (Sell Me This Pen)'),
        ('2562718926', 4, false, 'Leads (non-campaign)'),
        ('3534570692', 5, false, 'Leads (Website)')
     ) as a(pipeline_id, volgnummer, is_sales, naam)
left join public.hubspot_pipelines p on p.pipeline_id = a.pipeline_id;

comment on view public.v_d1_km_pipelines is
  'Allowlist: de pipelines waarin een geplande kennismaking meetelt voor de aanvoer van D1. Sales (default) plus de vier Lead-pipelines waar de SDR plant. Bewust NIET: Leadinfo (bezoekersfeed), Customer Base (bestaande klanten), self-serve/DEV. Alleen het geplande deel leest deze lijst — fase, forecast, kanaal en het critical number blijven Sales-only.';

grant select on public.v_d1_km_pipelines to authenticated;

-- ── 2. v_d1_aanvoer_gepland — vier weken vooruit, over de allowlist ──────────
-- Was: `from public.v_d1_waarde` (Sales-only). Nu: uit `hubspot_deals` met de
-- allowlist, en de licenties er links bij gejoind uit `v_d1_waarde` — die join
-- vindt per definitie alleen Sales-deals, want daar bestaat die view uit.
-- Kolommen, types en volgorde ongewijzigd (week_start · week_eind · week_label
-- · kennismakingen_gepland · mid_licenties), zodat `create or replace` en de
-- hook allebei blijven werken.
create or replace view public.v_d1_aanvoer_gepland
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) + (i || ' weeks')::interval)::date as week_start
  from generate_series(1, 4) as g(i)
),
km as (
  select
    d.deal_id,
    public.dash_prop_date(d.properties, 'kennismaking_datum') as kennismaking
  from public.hubspot_deals d
  join public.v_d1_km_pipelines a on a.pipeline_id = d.pipeline_id
  where d.is_archived is not true
    and public.dash_prop_date(d.properties, 'kennismaking_datum') is not null
),
d as (
  select k.deal_id, k.kennismaking, w.mid_lic
  from km k
  left join public.v_d1_waarde w on w.deal_id = k.deal_id
)
select
  w.week_start,
  (w.week_start + 6)                                                   as week_eind,
  to_char(w.week_start, 'IYYY-"W"IW')                                  as week_label,
  count(d.deal_id) filter (
    where d.kennismaking >= w.week_start
      and d.kennismaking <  w.week_start + 7
  )::int                                                               as kennismakingen_gepland,
  sum(d.mid_lic) filter (
    where d.kennismaking >= w.week_start
      and d.kennismaking <  w.week_start + 7
  )                                                                    as mid_licenties
from weken w
left join d on true
group by w.week_start;

comment on view public.v_d1_aanvoer_gepland is
  'De vier weken ná de lopende week: kennismakingen met een kennismaking_datum in die week (gepland), over de allowlist v_d1_km_pipelines — Sales én de Lead-pipelines waar de SDR plant (v1.215). Vult het gearceerde rechterdeel van de kaart Kennismakingen; nul is een gemeten nul. mid_licenties telt alleen Sales-deals: een Lead-deal draagt geen prijs.';

grant select on public.v_d1_aanvoer_gepland to authenticated;

-- ── 3. v_d1_meta — kennismaking_gepland over dezelfde allowlist ──────────────
-- Letterlijk de definitie uit 20260913100000, met één wijziging: de teller
-- `kennismaking_gepland` komt niet meer uit `w` (v_d1_waarde, Sales-only) maar
-- uit de nieuwe CTE `kmp`. Alle andere kolommen, hun volgorde en hun types
-- blijven exact zoals ze zijn — `create or replace view` weigert anders, en de
-- 23 kolommen hangen aan het hele bord.
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
    count(*)                                                                             as n_sales,
    count(*) filter (where is_open and prijs_bron = 'lijstprijs')                        as op_lijstprijs
  from public.v_d1_waarde
),
-- v1.215: geplande kennismakingen tellen over de allowlist, niet over Sales
-- alleen. Dit is de enige teller in deze view die buiten de Sales Pipeline
-- kijkt — `deals_zichtbaar`, `sales_deals` en de hygiënetellers hierboven
-- blijven met opzet Sales, want die dragen de constateringen van de trechter.
kmp as (
  select count(*) as km_gepland
  from public.hubspot_deals d
  join public.v_d1_km_pipelines a on a.pipeline_id = d.pipeline_id
  where d.is_archived is not true
    and public.dash_prop_date(d.properties, 'kennismaking_datum') > current_date
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
  (d.peil is null or d.peil < now() - interval '60 minutes') as mirror_verouderd,
  d.n                                                        as deals_zichtbaar,
  w.open_deals,
  w.cd_leeg                                                  as closedate_leeg,
  w.cd_verlopen                                              as closedate_verlopen,
  (w.cd_leeg + w.cd_verlopen)                                as closedate_onbruikbaar,
  w.verloren,
  w.verloren_zonder_reden,
  w.km_gevuld                                                as kennismaking_gevuld,
  kmp.km_gepland                                             as kennismaking_gepland,
  w.n_sales                                                  as sales_deals,
  w.op_lijstprijs,
  (d.n_beslisdatum       > 0)                                as prop_beslisdatum,
  (d.n_kennismaking_prop > 0)                                as prop_kennismaking,
  (d.n_prijs_prop        > 0)                                as prop_prijs,
  c.n                                                        as companies_zichtbaar,
  c.key_aanwezig                                             as companies_met_veld,
  c.gevuld                                                   as companies_met_omvang,
  (c.gevuld > 0 and c.gevuld >= (c.n * 0.8))                 as segment_bruikbaar,
  s.vanaf                                                    as trend_vanaf,
  coalesce(s.dagen, 0)                                       as trend_dagen
from d, w, kmp, c, s;

comment on view public.v_d1_meta is
  'Eén rij met de peildatum van de mirror, hoeveel Sales-Pipeline-rijen deze kijker ziet (0 = geen records óf geen rechten: hubspot_deals eist is_admin_or_higher() + session_mfa_ok()) en de constateringen die onder de D1-cijfers horen — onbruikbare closedates, ontbrekende verliesredenen, dekking van kantoorgrootte. v1.215: kennismaking_gepland telt over v_d1_km_pipelines (Sales + Lead), alle andere tellers blijven Sales-only.';

grant select on public.v_d1_meta to authenticated;

-- ── 4. v_d1_aanvoer_deals — de rijen achter een weekstaaf ────────────────────
-- Twee takken, bewust ongelijk:
--
--   Sales   komt uit `v_d1_waarde` en is daarmee per definitie dezelfde rij als
--           overal elders op het bord. Geen tweede rekenpad, geen drift.
--   Lead    komt uit `hubspot_deals`, met alleen de velden die in een
--           Lead-pipeline bestaan. `fase` en `fase_label` zijn null (er is geen
--           dim_stage_fase-rij), `mid_lic` / `mrr_*` zijn null (geen prijs),
--           `waardeerbaar` is false. `stage_label` en `is_open` komen uit de
--           `stages`-jsonb van de pipeline zelf — HubSpot's eigen woorden
--           ("Kennismaking gepland") en zijn eigen `isClosed`.
--
-- `is_sales` is de discriminator waarop de UI kiest: een gemeten week toont de
-- Sales-rijen (want de staaf telt Sales), een geplande week toont alles. Zonder
-- die vlag zou de voet "11 van 5" zeggen op een week die er 5 telt, en dat leest
-- als een bug in plaats van als twee verschillende vragen.
create or replace view public.v_d1_aanvoer_deals
with (security_invoker = on) as
select
  w.deal_id,
  w.dealname,
  w.company_naam,
  w.fase,
  w.fase_label,
  w.stage_label,
  w.is_open,
  w.hubspot_owner_id,
  w.eigenaar,
  w.hs_created_at,
  w.closedate,
  w.beslisdatum,
  w.kennismaking,
  w.bodem_lic,
  w.plafond_lic,
  w.mid_lic,
  w.mrr_bodem,
  w.mrr_plafond,
  w.waardeerbaar,
  w.dagen_open,
  w.dagen_in_fase,
  w.totale_omvang,
  w.segment_bucket,
  w.kantoorband,
  w.kanaal,
  w.hubspot_url,
  'default'::text                                                 as pipeline_id,
  (select a.label from public.v_d1_km_pipelines a where a.pipeline_id = 'default') as pipeline_label,
  true                                                            as is_sales
from public.v_d1_waarde w
where w.kennismaking is not null

union all

select
  d.deal_id,
  d.dealname,
  comp.company_naam,
  null::text                                                      as fase,
  null::text                                                      as fase_label,
  st.stage_label,
  st.is_open,
  d.hubspot_owner_id,
  coalesce(u.full_name, u.email)                                  as eigenaar,
  d.hs_created_at,
  d.closedate,
  public.dash_prop_date(d.properties, 'verwachte_start_pilot')    as beslisdatum,
  public.dash_prop_date(d.properties, 'kennismaking_datum')       as kennismaking,
  public.dash_prop_num(d.properties, 'verwachte_minimumafname_licentieperiode') as bodem_lic,
  public.dash_prop_num(d.properties, 'verwachte_omvang_licentieperiode')        as plafond_lic,
  null::numeric                                                   as mid_lic,
  null::numeric                                                   as mrr_bodem,
  null::numeric                                                   as mrr_plafond,
  false                                                           as waardeerbaar,
  greatest((current_date - d.hs_created_at::date), 0)             as dagen_open,
  null::int                                                       as dagen_in_fase,
  comp.totale_omvang,
  case
    when comp.totale_omvang is null then null
    when comp.totale_omvang >= 17   then 'ICP3'
    when comp.totale_omvang >= 5    then 'ICP2'
    else                                 'ICP1'
  end                                                             as segment_bucket,
  case
    when comp.totale_omvang is null then 'onbekend'
    when comp.totale_omvang >= 17   then '17+'
    when comp.totale_omvang >= 5    then '5-16'
    else                                 '1-4'
  end                                                             as kantoorband,
  coalesce(nullif(btrim(coalesce(d.properties->>'hs_analytics_source', '')), ''), 'UNKNOWN') as kanaal,
  'https://app.hubspot.com/contacts/0/deal/' || d.deal_id         as hubspot_url,
  d.pipeline_id,
  a.label                                                         as pipeline_label,
  false                                                           as is_sales
from public.hubspot_deals d
join public.v_d1_km_pipelines a on a.pipeline_id = d.pipeline_id and not a.is_sales
left join public.hubspot_users u on u.hubspot_owner_id = d.hubspot_owner_id and u.active is not false
left join lateral (
  select
    coalesce(c.properties->>'name', '') as company_naam,
    public.dash_prop_num(c.properties, 'totale_omvang') as totale_omvang
  from public.hubspot_companies c
  where c.company_id = d.associated_company_ids[1]
) comp on true
left join lateral (
  select
    s.value->>'label'                                as stage_label,
    ((s.value->>'isClosed')::boolean is not true)    as is_open
  from public.hubspot_pipelines pp
  cross join lateral jsonb_array_elements(pp.stages) s
  where pp.pipeline_id = d.pipeline_id
    and s.value->>'id' = d.dealstage
  limit 1
) st on true
where d.is_archived is not true
  and public.dash_prop_date(d.properties, 'kennismaking_datum') is not null;

comment on view public.v_d1_aanvoer_deals is
  'De deals achter een weekstaaf van de kaart Kennismakingen: de Sales-deals in de vorm die de rest van het bord gebruikt (uit v_d1_waarde) plus de Lead-deals uit de allowlist v_d1_km_pipelines. is_sales scheidt de twee — een gemeten week toont Sales (want de staaf telt Sales), een geplande week toont alles. Lead-rijen dragen geen fase, geen licenties en geen prijs; stage_label en is_open komen uit hubspot_pipelines.stages.';

grant select on public.v_d1_aanvoer_deals to authenticated;
