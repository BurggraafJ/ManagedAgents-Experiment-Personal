-- =============================================================================
-- D1 Live · Design ronde 5 — de views achter de zeven kaarten (v1.209)
-- =============================================================================
-- Het Live-bord is herbouwd naar Design ronde 5 (Jelle-lock 2026-09-15): zeven
-- kaarten met Visx-charts en één detail-sink. Vier kaarten hadden nog geen laag
-- in de database; die komt hier. Het bord rekent nog steeds niet — elk getal
-- op een kaart is een kolom in een view (skill `dashboarding`, bouwproces.md).
--
--   v_d1_deals             + kanaal (hs_analytics_source), kantoorband,
--                            fase_sinds, dagen_in_fase — alleen kolommen
--                            achteraan toegevoegd, bestaande kolommen ongewijzigd
--   v_d1_waarde            zelfde kolommen als voorheen, met de nieuwe erachter
--                            (expliciete lijst: `d.*` zou de bestaande kolommen
--                            verschuiven en `create or replace` laten weigeren)
--   v_d1_kanaal            open deals per eerste bron (kaart Kanaal, donut)
--   v_d1_fase_aging        mediaan · P90 · te lang per fase (kaart Tijd in fase)
--   v_d1_kantoorgrootte    open deals per advocaten-band × fase (kaart Kantoorgrootte)
--   v_d1_aanvoer           + mid_licenties per week (toggle Licenties)
--   v_d1_aanvoer_gepland   vier weken vooruit: geplande kennismakingen
--   v_d1_beweging_week     + licenties (mid) per beweging (toggle Licenties)
--
-- Drie keuzes die je in de kolommen terugziet:
--
--  1. **Kanaal = hs_analytics_source** (Jelle, 2026-09-15). Geen eigen deal_bron
--     verzinnen. Leeg → 'UNKNOWN' als eigen categorie, want een ontbrekende bron
--     is een hygiënerij en geen weglating (chart-catalogus, gatregel).
--  2. **Tijd in fase = dagen sinds het binnenkomen in de huidige fase**, uit
--     HubSpot's `hs_v2_date_entered_<stage>`. Fase 3 telt vanaf de eerste
--     fase-3-stage die de deal bereikte (least van vier). Deals zonder zo'n datum
--     (geïmporteerd vóór HubSpot dit bijhield) staan apart als
--     `zonder_fasedatum` en tellen niet in mediaan of P90 — een verzonnen dag
--     nul zou de mediaan omlaag trekken. "Te lang" = langer dan 1,5 × mediaan,
--     dezelfde definitie als de chip op de kaart.
--  3. **Licenties = mid**, (bodem + plafond) / 2 per deal, alleen over deals die
--     `waardeerbaar` zijn — dezelfde filter als v_d1_pipeline_per_fase, zodat de
--     kaarten Kanaal, Kantoorgrootte en Waarde één en hetzelfde totaal delen.
--
-- Alle views `security_invoker = on`: de RLS van hubspot_deals blijft gelden
-- (multi-user-poort M1). Terugdraaien: `drop view` van de vier nieuwe views;
-- de vier gewijzigde views hebben alleen kolommen achteraan gekregen.
-- =============================================================================

-- ── 1. v_d1_deals — vier kolommen achteraan ──────────────────────────────────
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
  'https://app.hubspot.com/contacts/0/deal/' || d.deal_id         as hubspot_url,
  comp.company_naam,
  comp.totale_omvang,
  -- Methodiek 1 (fix 2026-09-15): ICP1 = 1–4, ICP2 = 5–16 (kernklant), ICP3 = 17+.
  case
    when comp.totale_omvang is null then null
    when comp.totale_omvang >= 17   then 'ICP3'
    when comp.totale_omvang >= 5    then 'ICP2'
    else                                 'ICP1'
  end                                                             as segment_bucket,
  -- ── nieuw in v1.209 ──
  coalesce(nullif(btrim(coalesce(d.properties->>'hs_analytics_source', '')), ''), 'UNKNOWN') as kanaal,
  case
    when comp.totale_omvang is null then 'onbekend'
    when comp.totale_omvang >= 17   then '17+'
    when comp.totale_omvang >= 5    then '5-16'
    else                                 '1-4'
  end                                                             as kantoorband,
  fs.fase_sinds,
  case when fs.fase_sinds is null then null
       else greatest(current_date - fs.fase_sinds::date, 0) end   as dagen_in_fase
from public.hubspot_deals d
cross join p
cross join g
left join public.dim_stage_fase f on f.stage_id = d.dealstage
left join public.hubspot_users  u on u.hubspot_owner_id = d.hubspot_owner_id and u.active is not false
left join lateral (
  select
    coalesce(c.properties->>'name', '') as company_naam,
    public.dash_prop_num(c.properties, 'totale_omvang') as totale_omvang
  from public.hubspot_companies c
  where c.company_id = d.associated_company_ids[1]
) comp on true
left join lateral (
  select case f.fase
    when '1' then public.dash_prop_date(d.properties, 'hs_v2_date_entered_appointmentscheduled')
    when '2' then public.dash_prop_date(d.properties, 'hs_v2_date_entered_4077073627')
    when '3' then least(
      public.dash_prop_date(d.properties, 'hs_v2_date_entered_3206386936'),
      public.dash_prop_date(d.properties, 'hs_v2_date_entered_5732535537'),
      public.dash_prop_date(d.properties, 'hs_v2_date_entered_contractsent'),
      public.dash_prop_date(d.properties, 'hs_v2_date_entered_4075158742'))
  end as fase_sinds
) fs on true
where d.is_archived is not true
  and d.pipeline_id = 'default';

comment on view public.v_d1_deals is
  'Basis onder alle D1-getallen: één rij per niet-gearchiveerde Sales-Pipeline-deal. v1.209 voegt achteraan toe: kanaal (hs_analytics_source, leeg = UNKNOWN), kantoorband (1-4 · 5-16 · 17+ · onbekend), fase_sinds en dagen_in_fase (uit hs_v2_date_entered_<stage>; fase 3 = eerste fase-3-stage).';

grant select on public.v_d1_deals to authenticated;

-- ── 2. v_d1_waarde — expliciete kolomlijst, nieuwe kolommen achteraan ────────
create or replace view public.v_d1_waarde
with (security_invoker = on) as
select
  d.deal_id, d.dealname, d.dealstage, d.stage_label, d.fase, d.fase_label, d.is_open,
  d.stage_sort, d.hubspot_owner_id, d.eigenaar, d.owner_onbekend, d.closedate,
  d.hs_created_at, d.dagen_open, d.h4_dagen, d.beslisdatum, d.kennismaking, d.next_step,
  d.verliesreden, d.bodem_lic, d.plafond_lic, d.prijs_deal, d.prijs_bron, d.prijs,
  d.hubspot_url,
  (d.bodem_lic   * d.prijs)                                        as mrr_bodem,
  (d.plafond_lic * d.prijs)                                        as mrr_plafond,
  (d.bodem_lic is not null and d.plafond_lic is not null and d.prijs is not null) as waardeerbaar,
  (d.beslisdatum is not null and d.bodem_lic is not null and d.plafond_lic is not null) as forecast_volledig,
  -- De company-kolommen staan op prod ná de waardekolommen (de view is in
  -- v1.191 herbouwd terwijl de basis al de company-join droeg); die volgorde
  -- moet hier exact zo blijven, anders weigert `create or replace`.
  d.company_naam, d.totale_omvang, d.segment_bucket,
  -- ── nieuw in v1.209 ──
  d.kanaal,
  d.kantoorband,
  d.fase_sinds,
  d.dagen_in_fase,
  case when d.bodem_lic is not null and d.plafond_lic is not null and d.prijs is not null
       then (d.bodem_lic + d.plafond_lic) / 2 end                  as mid_lic
from public.v_d1_deals d;

comment on view public.v_d1_waarde is
  'v_d1_deals plus de maandwaarde: licenties × prijs, in euro per maand. v1.209 voegt achteraan kanaal, kantoorband, fase_sinds, dagen_in_fase en mid_lic ((bodem + plafond) / 2, alleen waardeerbaar) toe.';

grant select on public.v_d1_waarde to authenticated;

-- ── 3. v_d1_kanaal — open deals per eerste bron ──────────────────────────────
create or replace view public.v_d1_kanaal
with (security_invoker = on) as
select
  w.kanaal,
  (w.kanaal = 'UNKNOWN')                                   as onbekend,
  count(*)::int                                            as aantal,
  count(*) filter (where w.waardeerbaar)::int              as aantal_gewaardeerd,
  sum(w.bodem_lic)   filter (where w.waardeerbaar)         as bodem_licenties,
  sum(w.plafond_lic) filter (where w.waardeerbaar)         as plafond_licenties,
  sum(w.mid_lic)                                           as mid_licenties,
  sum(w.mrr_bodem)                                         as mrr_bodem,
  sum(w.mrr_plafond)                                       as mrr_plafond,
  (select peildatum from public.v_d1_meta)                 as peildatum
from public.v_d1_waarde w
where w.is_open
group by w.kanaal;

comment on view public.v_d1_kanaal is
  'Open Sales-Pipeline-deals per eerste bron (hs_analytics_source). UNKNOWN = geen bron vastgelegd — de hygiënerij van de kaart Kanaal, nooit weggelaten. Licenties als mid ((bodem + plafond) / 2) over waardeerbare deals.';

grant select on public.v_d1_kanaal to authenticated;

-- ── 4. v_d1_fase_aging — hoe lang zitten deals nu in hun fase ────────────────
create or replace view public.v_d1_fase_aging
with (security_invoker = on) as
with fases(fase, fase_label, volgnummer) as (
  values ('1', 'Fase 1 · Kennismaking',              1),
         ('2', 'Fase 2 · Offerte sturen',            2),
         ('3', 'Fase 3 · Offerte t/m overeenkomst',  3)
),
w as (select * from public.v_d1_waarde where is_open and fase in ('1', '2', '3')),
m as (
  select fase, percentile_cont(0.5) within group (order by dagen_in_fase) as mediaan
  from w where dagen_in_fase is not null group by fase
)
select
  f.fase,
  f.fase_label,
  f.volgnummer,
  count(w.deal_id)::int                                                     as aantal,
  count(w.deal_id) filter (where w.dagen_in_fase is not null)::int          as aantal_met_datum,
  count(w.deal_id) filter (where w.dagen_in_fase is null)::int              as zonder_fasedatum,
  round(m.mediaan)::int                                                     as mediaan_dagen,
  round(percentile_cont(0.9) within group (order by w.dagen_in_fase)
        filter (where w.dagen_in_fase is not null))::int                    as p90_dagen,
  min(w.dagen_in_fase)                                                      as min_dagen,
  max(w.dagen_in_fase)                                                      as max_dagen,
  round(m.mediaan * 1.5)::int                                               as te_lang_drempel,
  count(w.deal_id) filter (where w.dagen_in_fase > m.mediaan * 1.5)::int    as te_lang,
  count(w.deal_id) filter (where w.waardeerbaar)::int                       as aantal_gewaardeerd,
  sum(w.bodem_lic)   filter (where w.waardeerbaar)                          as bodem_licenties,
  sum(w.plafond_lic) filter (where w.waardeerbaar)                          as plafond_licenties,
  sum(w.mid_lic)                                                            as mid_licenties,
  sum(w.mrr_bodem)                                                          as mrr_bodem,
  sum(w.mrr_plafond)                                                        as mrr_plafond,
  (select peildatum from public.v_d1_meta)                                  as peildatum
from fases f
left join w on w.fase = f.fase
left join m on m.fase = f.fase
group by f.fase, f.fase_label, f.volgnummer, m.mediaan;

comment on view public.v_d1_fase_aging is
  'Tijd in fase per open fase 1 · 2 · 3 (altijd drie rijen): mediaan en P90 van dagen_in_fase, te_lang = langer dan 1,5 × mediaan (te_lang_drempel). zonder_fasedatum = deals zonder hs_v2_date_entered voor hun fase; die tellen in aantal maar niet in de dagen.';

grant select on public.v_d1_fase_aging to authenticated;

-- ── 5. v_d1_kantoorgrootte — open deals per advocaten-band × fase ────────────
create or replace view public.v_d1_kantoorgrootte
with (security_invoker = on) as
with banden(kantoorband, band_label, volgnummer, kern, onbekend) as (
  values ('17+',      '17+',      1, false, false),
         ('5-16',     '5–16',     2, true,  false),
         ('1-4',      '1–4',      3, false, false),
         ('onbekend', 'onbekend', 4, false, true)
),
w as (select * from public.v_d1_waarde where is_open)
select
  b.kantoorband,
  b.band_label,
  b.volgnummer,
  b.kern,
  b.onbekend,
  count(w.deal_id)::int                                                  as aantal,
  count(w.deal_id) filter (where w.fase = '1')::int                      as f1,
  count(w.deal_id) filter (where w.fase = '2')::int                      as f2,
  count(w.deal_id) filter (where w.fase = '3')::int                      as f3,
  sum(w.mid_lic)                                                         as mid_licenties,
  sum(w.mid_lic) filter (where w.fase = '1')                             as f1_licenties,
  sum(w.mid_lic) filter (where w.fase = '2')                             as f2_licenties,
  sum(w.mid_lic) filter (where w.fase = '3')                             as f3_licenties,
  count(w.deal_id) filter (where w.beslisdatum is not null
                             and w.beslisdatum <= current_date + 30)::int as close_30d,
  sum(w.mid_lic)   filter (where w.beslisdatum is not null
                             and w.beslisdatum <= current_date + 30)      as close_30d_licenties,
  (select peildatum from public.v_d1_meta)                               as peildatum
from banden b
left join w on w.kantoorband = b.kantoorband
group by b.kantoorband, b.band_label, b.volgnummer, b.kern, b.onbekend;

comment on view public.v_d1_kantoorgrootte is
  'Open Sales-Pipeline-deals per advocaten-band van het kantoor (totale_omvang op de eerste company): 17+ · 5–16 (kern = ICP2) · 1–4 · onbekend, met de fase-mix en het aantal met beslisdatum binnen 30 dagen. Altijd vier rijen.';

grant select on public.v_d1_kantoorgrootte to authenticated;

-- ── 6. v_d1_aanvoer — mid_licenties achteraan ────────────────────────────────
create or replace view public.v_d1_aanvoer
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) - (i || ' weeks')::interval)::date as week_start
  from generate_series(0, 11) as g(i)
),
d as (select * from public.v_d1_waarde)
select
  w.week_start,
  (w.week_start + 6)                                                   as week_eind,
  to_char(w.week_start, 'IYYY-"W"IW')                                  as week_label,
  (w.week_start = date_trunc('week', current_date)::date)              as is_huidige_week,
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
  )::int                                                               as nieuwe_deals,
  -- nieuw in v1.209: licenties (mid) van de gehouden kennismakingen die week
  sum(d.mid_lic) filter (
    where d.kennismaking >= w.week_start
      and d.kennismaking <  w.week_start + 7
      and d.kennismaking <= current_date
  )                                                                    as mid_licenties
from weken w
left join d on true
group by w.week_start;

comment on view public.v_d1_aanvoer is
  'Twaalf weken aanvoer van de Sales Pipeline. kennismakingen = gehouden (kennismaking_datum tot en met vandaag) — het critical number, doel uit dash_parameters.doel_kennismakingen_week. v1.209: mid_licenties van die kennismakingen erbij (toggle Licenties, indicatief).';

grant select on public.v_d1_aanvoer to authenticated;

-- ── 7. v_d1_aanvoer_gepland — vier weken vooruit ─────────────────────────────
create or replace view public.v_d1_aanvoer_gepland
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) + (i || ' weeks')::interval)::date as week_start
  from generate_series(1, 4) as g(i)
),
d as (select * from public.v_d1_waarde)
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
  'De vier weken ná de lopende week: kennismakingen met een kennismaking_datum in die week (gepland). Vult het gearceerde rechterdeel van de kaart Kennismakingen; nul is een gemeten nul.';

grant select on public.v_d1_aanvoer_gepland to authenticated;

-- ── 7b. v_d1_forecast_per_maand — mid_licenties achteraan ───────────────────
-- Zelfde definitie als 20260913101000; alleen de som van mid_lic erbij zodat de
-- kaart Landt het? in de stand Licenties uit de view leest en niet zelf middelt.
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
  sum(w.mrr_plafond)                                      as mrr_plafond,
  sum(w.mid_lic)                                          as mid_licenties
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

grant select on public.v_d1_forecast_per_maand to authenticated;

-- ── 8. v_d1_beweging_week — licenties (mid) achteraan ────────────────────────
create or replace view public.v_d1_beweging_week
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) - (i || ' weeks')::interval)::date as week_start
  from generate_series(0, 11) as g(i)
),
d as (select * from public.v_d1_waarde)
select
  w.week_start,
  (w.week_start + 6)                                                   as week_eind,
  to_char(w.week_start, 'IYYY-"W"IW')                                  as week_label,
  (w.week_start = date_trunc('week', current_date)::date)              as is_huidige_week,
  count(d.deal_id) filter (
    where d.hs_created_at >= w.week_start
      and d.hs_created_at <  (w.week_start + 7)::timestamptz)::int     as instroom,
  count(d.deal_id) filter (
    where d.fase = 'verloren'
      and d.closedate >= w.week_start
      and d.closedate <  (w.week_start + 7)::timestamptz)::int         as verloren,
  count(d.deal_id) filter (
    where d.fase = 'gewonnen'
      and d.closedate >= w.week_start
      and d.closedate <  (w.week_start + 7)::timestamptz)::int         as gewonnen,
  (count(d.deal_id) filter (
     where d.hs_created_at >= w.week_start
       and d.hs_created_at <  (w.week_start + 7)::timestamptz)
   - count(d.deal_id) filter (
     where d.fase in ('verloren', 'gewonnen')
       and d.closedate >= w.week_start
       and d.closedate <  (w.week_start + 7)::timestamptz))::int       as netto,
  -- nieuw in v1.209
  sum(d.mid_lic) filter (
    where d.hs_created_at >= w.week_start
      and d.hs_created_at <  (w.week_start + 7)::timestamptz)          as instroom_licenties,
  sum(d.mid_lic) filter (
    where d.fase = 'verloren'
      and d.closedate >= w.week_start
      and d.closedate <  (w.week_start + 7)::timestamptz)              as verloren_licenties,
  sum(d.mid_lic) filter (
    where d.fase = 'gewonnen'
      and d.closedate >= w.week_start
      and d.closedate <  (w.week_start + 7)::timestamptz)              as gewonnen_licenties
from weken w
left join d on true
group by w.week_start
order by w.week_start;

comment on view public.v_d1_beweging_week is
  'Pipeline-beweging per week: instroom (hs_created_at), gewonnen en verloren (closedate), netto. Twaalf weken, zelfde venster als v_d1_aanvoer. v1.209: licenties (mid) per beweging erbij voor de toggle Licenties.';

grant select on public.v_d1_beweging_week to authenticated;
