-- D1 deals: extend with company join for kantoorgrootte and ICP-segment.
-- Pass B (v1.191): adds totale_omvang, company_naam and segment_bucket to
-- v_d1_deals so the detail panel can show kantoorgrootte, ICP and sorting.
--
-- The join is on the first element of associated_company_ids (the primary
-- company association in HubSpot). A deal without a company association gets
-- NULL for all three fields — that is "onbekend", not zero.
--
-- The segment_bucket uses the Methodiek 1 buckets (kantoorgrootte-based):
--   1 advocaat (solo), 2–4, 5–16, 17+ which map to ICP3, ICP2, ICP1, ICP1.

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
  end                                                             as segment_bucket
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
  'Basis onder alle D1-getallen: één rij per niet-gearchiveerde Sales-Pipeline-deal. v1.191 voegt company_naam, totale_omvang en segment_bucket toe via de eerste company-associatie.';

grant select on public.v_d1_deals to authenticated;
