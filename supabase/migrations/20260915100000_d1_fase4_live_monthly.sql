-- =============================================================================
-- D1 · Fase 4 — Live + Monthly: kanaal, beweging, ICP-chip (v1.207)
-- =============================================================================
-- Drie nieuwe views voor de vijf klantvragen die het bord nu beantwoordt:
--
--   v_d1_kanaal           open deals per acquisitiekanaal (hs_analytics_source)
--   v_d1_beweging_week    pipeline-beweging per week: nieuw, gewonnen, verloren
--   v_d1_icp              open deals per ICP-segment
--
-- Plus: hs_analytics_source (kanaal) toegevoegd aan v_d1_deals en v_d1_waarde.
--
-- Licenties stonden al in v_d1_pipeline_per_fase (bodem_licenties,
-- plafond_licenties) — de UI toont ze voortaan naast de euro's.
--
-- Bron: D1-CHARTS-V2, klantvraag-reset 2026-09-15, CD-lock.
-- =============================================================================

-- ── 1. v_d1_deals — kanaal toevoegen ─────────────────────────────────────────
-- hs_analytics_source is de HubSpot-standaard leadbron. ~94 % gevuld op de
-- open Sales Pipeline (Jelle, 2026-09-15). Lege waarden → 'onbekend'; de chip
-- toont ze als hygiëne-indicator.
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
  -- Company join (v1.191)
  comp.company_naam,
  comp.totale_omvang,
  case
    when comp.totale_omvang is null then null
    when comp.totale_omvang >= 17   then 'ICP1'
    when comp.totale_omvang >= 5    then 'ICP1'
    when comp.totale_omvang >= 2    then 'ICP2'
    else                                 'ICP3'
  end                                                             as segment_bucket,
  -- Kanaal (v1.207): hs_analytics_source is de HubSpot-standaard leadbron.
  coalesce(
    nullif(btrim(coalesce(d.properties->>'hs_analytics_source', '')), ''),
    'UNKNOWN'
  )                                                               as kanaal
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
where d.is_archived is not true
  and d.pipeline_id = 'default';

comment on view public.v_d1_deals is
  'Basis onder alle D1-getallen. v1.207 voegt kanaal (hs_analytics_source) toe naast company_naam, totale_omvang en segment_bucket.';

grant select on public.v_d1_deals to authenticated;

-- ── 2. v_d1_waarde — heraanmaken zodat d.* de nieuwe kolom oppikt ────────────
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
  'v_d1_deals plus de maandwaarde: licenties × prijs, in euro per maand. v1.207 erft kanaal uit v_d1_deals.';

grant select on public.v_d1_waarde to authenticated;

-- ── 3. v_d1_kanaal — open deals per acquisitiekanaal ─────────────────────────
-- Voedt de kanaal-chip op het Live-bord. Elke rij is een kanaal met het aantal
-- open deals. De enum-labels (OFFLINE → Offline / outbound) staan in de frontend
-- en niet hier: de view levert het HubSpot-enum, de UI vertaalt.
create or replace view public.v_d1_kanaal
with (security_invoker = on) as
select
  w.kanaal,
  count(*)::int                                   as aantal,
  count(*) filter (where w.waardeerbaar)::int     as aantal_gewaardeerd,
  sum(w.mrr_plafond)                              as mrr_plafond
from public.v_d1_waarde w
where w.is_open
group by w.kanaal
order by count(*) desc;

comment on view public.v_d1_kanaal is
  'Open Sales-Pipeline-deals per acquisitiekanaal (hs_analytics_source). Voedt de kanaal-chip op D1 Live. UNKNOWN = geen bron vastgelegd; de chip toont die als hygiëne-indicator.';

grant select on public.v_d1_kanaal to authenticated;

-- ── 4. v_d1_icp — open deals per ICP-segment ────────────────────────────────
-- Voedt de ICP-chip op het Live-bord. Segment hangt af van kantoorgrootte op de
-- company; NULL = geen company-associatie of geen omvang.
create or replace view public.v_d1_icp
with (security_invoker = on) as
select
  coalesce(w.segment_bucket, 'onbekend') as segment,
  count(*)::int                           as aantal
from public.v_d1_waarde w
where w.is_open
group by 1
order by
  case coalesce(w.segment_bucket, 'onbekend')
    when 'ICP1' then 1
    when 'ICP2' then 2
    when 'ICP3' then 3
    else 4
  end;

comment on view public.v_d1_icp is
  'Open Sales-Pipeline-deals per ICP-segment (kantoorgrootte). Voedt de ICP-chip op D1 Live. onbekend = geen company-associatie of geen totale_omvang op de company.';

grant select on public.v_d1_icp to authenticated;

-- ── 5. v_d1_beweging_week — pipeline-beweging per week ───────────────────────
-- Drie reeksen: deals die de pipeline inkwamen (hs_created_at), deals gewonnen
-- (closedate bij fase gewonnen) en deals verloren (closedate bij fase verloren).
-- Twaalf weken, zelfde venster als v_d1_aanvoer.
--
-- Geen snap_deal_dag-afhankelijkheid: die tabel kan leeg zijn (v_d1_meta meldt
-- dat), en de drie basisreeksen bestaan onafhankelijk van dagelijks snapshotwerk.
create or replace view public.v_d1_beweging_week
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
  count(d.deal_id) filter (
    where d.hs_created_at >= w.week_start::timestamptz
      and d.hs_created_at <  (w.week_start + 7)::timestamptz
  )::int                                                               as nieuw,
  count(d.deal_id) filter (
    where d.fase = 'gewonnen'
      and d.closedate >= w.week_start::timestamptz
      and d.closedate <  (w.week_start + 7)::timestamptz
  )::int                                                               as gewonnen,
  count(d.deal_id) filter (
    where d.fase = 'verloren'
      and d.closedate >= w.week_start::timestamptz
      and d.closedate <  (w.week_start + 7)::timestamptz
  )::int                                                               as verloren
from weken w
left join d on true
group by w.week_start
order by w.week_start;

comment on view public.v_d1_beweging_week is
  'Pipeline-beweging per week: deals die de Sales Pipeline inkwamen (hs_created_at), gewonnen en verloren deals (closedate). Twaalf weken, zelfde venster als v_d1_aanvoer. Voedt de bewegingsstrip op D1 Live.';

grant select on public.v_d1_beweging_week to authenticated;
