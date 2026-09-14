-- =============================================================================
-- D1 · Fase 2: vier P1 views + prijs in snap_deal_dag                (v1.195)
-- =============================================================================
-- Vier views op bestaande data (geen snapshots nodig):
--   v_d1_beweging_week    — instroom/uitstroom per week (de minimale "film")
--   v_d1_win_rate_trend   — win rate per kwartaal (closedate, historisch)
--   v_d1_salescyclus      — mediaan doorlooptijd gesloten deals
--   v_d1_cohort_basis     — instroomkwartaal × uitkomst
--
-- Plus: snap_deal_dag krijgt een `prijs` kolom zodat historische waarde-trends
-- niet breken bij een prijswijziging. Bestaande rijen krijgen NULL.
--
-- Bron: D1-DATA-RESEARCH.md §10, bijlagen A–D, Jelle-lock 2026-09-15.
-- Terugdraaien: drop views in omgekeerde volgorde, alter table drop column.
-- =============================================================================

-- ── 1. v_d1_beweging_week ───────────────────────────────────────────────────
-- Instroom (hs_created_at deze week), uitstroom gewonnen/verloren (closedate
-- deze week). Geen snapshots nodig — leest de live mirror.
create or replace view public.v_d1_beweging_week
with (security_invoker = on) as
with weken as (
  select (date_trunc('week', current_date) - (i || ' weeks')::interval)::date as week_start
  from generate_series(0, 11) as g(i)
),
d as (select * from public.v_d1_deals)
select
  w.week_start,
  (w.week_start + 6)::date                                           as week_eind,
  to_char(w.week_start, 'IYYY-"W"IW')                                as week_label,
  (w.week_start = date_trunc('week', current_date)::date)            as is_huidige_week,
  count(d.deal_id) filter (
    where d.hs_created_at >= w.week_start
      and d.hs_created_at < (w.week_start + 7)::timestamptz
  )::int                                                              as instroom,
  count(d.deal_id) filter (
    where d.fase = 'verloren'
      and d.closedate >= w.week_start
      and d.closedate < (w.week_start + 7)::timestamptz
  )::int                                                              as verloren,
  count(d.deal_id) filter (
    where d.fase = 'gewonnen'
      and d.closedate >= w.week_start
      and d.closedate < (w.week_start + 7)::timestamptz
  )::int                                                              as gewonnen,
  -- netto = instroom - verloren - gewonnen (gewonnen verlaat de pipeline)
  (count(d.deal_id) filter (
    where d.hs_created_at >= w.week_start
      and d.hs_created_at < (w.week_start + 7)::timestamptz
  ) - count(d.deal_id) filter (
    where d.fase in ('verloren', 'gewonnen')
      and d.closedate >= w.week_start
      and d.closedate < (w.week_start + 7)::timestamptz
  ))::int                                                             as netto
from weken w
left join d on true
group by 1, 2, 3, 4
order by 1;

comment on view public.v_d1_beweging_week is
  'Instroom/uitstroom/netto per week, 12 weken. instroom = nieuwe deals (hs_created_at), verloren/gewonnen = gesloten (closedate). netto = instroom − verloren − gewonnen. Geen snapshots nodig.';

grant select on public.v_d1_beweging_week to authenticated;

-- ── 2. v_d1_win_rate_trend ──────────────────────────────────────────────────
-- Win rate per kwartaal op basis van closedate. Historisch beschikbaar.
create or replace view public.v_d1_win_rate_trend
with (security_invoker = on) as
select
  date_trunc('quarter', d.closedate)::date                            as kwartaal,
  to_char(date_trunc('quarter', d.closedate), '"Q"Q YYYY')           as kwartaal_label,
  count(*) filter (where d.fase = 'gewonnen')::int                   as gewonnen,
  count(*) filter (where d.fase = 'verloren')::int                   as verloren,
  count(*)::int                                                       as basis_n,
  case when count(*) > 0
    then round(100.0 * count(*) filter (where d.fase = 'gewonnen') / count(*), 1)
  end                                                                 as win_rate
from public.v_d1_deals d
where d.fase in ('gewonnen', 'verloren')
  and d.closedate is not null
group by 1, 2
order by 1;

comment on view public.v_d1_win_rate_trend is
  'Win rate per kwartaal op basis van closedate. Telt alleen gesloten deals (gewonnen + verloren). basis_n is de noemer; kwartalen met <5 deals zijn statistisch onbetrouwbaar.';

grant select on public.v_d1_win_rate_trend to authenticated;

-- ── 3. v_d1_salescyclus ─────────────────────────────────────────────────────
-- Mediaan + kwartielen van de totale doorlooptijd (closedate − hs_created_at).
-- Niet dagen_open (dat gebruikt current_date en is voor open deals).
create or replace view public.v_d1_salescyclus
with (security_invoker = on) as
select
  date_trunc('quarter', d.closedate)::date                            as kwartaal,
  to_char(date_trunc('quarter', d.closedate), '"Q"Q YYYY')           as kwartaal_label,
  d.fase,
  count(*)::int                                                       as n,
  min(d.closedate::date - d.hs_created_at::date)::int                as minimum,
  (percentile_cont(0.25) within group (order by d.closedate::date - d.hs_created_at::date))::int as p25,
  (percentile_cont(0.5)  within group (order by d.closedate::date - d.hs_created_at::date))::int as mediaan,
  (percentile_cont(0.75) within group (order by d.closedate::date - d.hs_created_at::date))::int as p75,
  max(d.closedate::date - d.hs_created_at::date)::int                as maximum
from public.v_d1_deals d
where d.fase in ('gewonnen', 'verloren')
  and d.closedate is not null
  and d.hs_created_at is not null
group by 1, 2, 3
order by 1, 2;

comment on view public.v_d1_salescyclus is
  'Doorlooptijd gesloten deals per kwartaal en fase (gewonnen/verloren), in dagen. Berekening: closedate::date − hs_created_at::date (niet dagen_open, dat is voor open deals). Kwartielen helpen uitschieters herkennen.';

grant select on public.v_d1_salescyclus to authenticated;

-- ── 4. v_d1_cohort_basis ────────────────────────────────────────────────────
-- Instroomkwartaal × uitkomst: hoeveel deals per instroomkwartaal, hoeveel
-- gewonnen/verloren/open/buiten scope.
create or replace view public.v_d1_cohort_basis
with (security_invoker = on) as
select
  date_trunc('quarter', d.hs_created_at)::date                       as instroomkwartaal,
  to_char(date_trunc('quarter', d.hs_created_at), '"Q"Q YYYY')      as kwartaal_label,
  count(*)::int                                                       as totaal,
  count(*) filter (where d.is_open)::int                             as open,
  count(*) filter (where d.fase = 'gewonnen')::int                   as gewonnen,
  count(*) filter (where d.fase = 'verloren')::int                   as verloren,
  count(*) filter (where d.fase = 'buiten')::int                     as buiten_scope,
  sum(d.mrr_plafond) filter (where d.fase = 'gewonnen')              as waarde_gewonnen,
  (percentile_cont(0.5) within group (
    order by case when d.fase = 'gewonnen' then d.closedate::date - d.hs_created_at::date end
  ))::int                                                             as mediaan_cyclus_gewonnen
from public.v_d1_waarde d
where d.hs_created_at is not null
group by 1, 2
order by 1;

comment on view public.v_d1_cohort_basis is
  'Instroomcohort: deals gegroepeerd op het kwartaal van hs_created_at, met de uitkomst (open/gewonnen/verloren/buiten) en de mediaan cyclustijd van gewonnen deals. Basis voor cohort-analyse: verandert de kwaliteit van de instroom over de tijd?';

grant select on public.v_d1_cohort_basis to authenticated;

-- ── 5. snap_deal_dag: prijs-kolom toevoegen ─────────────────────────────────
-- Historische rijen (vóór deze migratie) krijgen NULL — dat is eerlijk:
-- de prijs op dat moment was niet opgeslagen.
alter table public.snap_deal_dag
  add column if not exists prijs numeric;

comment on column public.snap_deal_dag.prijs is
  'De prijs die v_d1_waarde op het snapmoment zou gebruiken. NULL vóór deze migratie of als de deal onwaardeerbaar is. Voorkomt dat een prijswijziging historische waardeberekeningen breekt.';

-- ── 6. snap_deal_dag_run: prijs meeschrijven ────────────────────────────────
-- Herdefinieer de vulfunctie met het extra veld. Zelfde security-model.
create or replace function public.snap_deal_dag_run(p_datum date default current_date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $snap_deal_dag_run$
declare
  v_bron    integer;
  v_peil    timestamptz;
  v_geschreven integer;
begin
  select count(*), max(synced_at) into v_bron, v_peil
  from public.hubspot_deals
  where is_archived is not true;

  if coalesce(v_bron, 0) = 0 then
    raise notice 'snap_deal_dag_run: mirror leeg, geen snapshot voor %', p_datum;
    return 0;
  end if;

  delete from public.snap_deal_dag where datum = p_datum;

  insert into public.snap_deal_dag (
    datum, deal_id, pipeline_id, dealstage, fase, hubspot_owner_id, company_id,
    beslisdatum, bodem, plafond, startdatum, einddatum, closedate, mirror_peildatum,
    prijs
  )
  select
    p_datum,
    d.deal_id,
    d.pipeline_id,
    d.dealstage,
    f.fase,
    d.hubspot_owner_id,
    (d.associated_company_ids)[1],
    public.dash_prop_date(d.properties, 'verwachte_start_pilot'),
    coalesce(
      public.dash_prop_num(d.properties, 'verwachte_minimumafname_licentieperiode'),
      public.dash_prop_num(d.properties, 'minimale_licenties_licentieperiode')
    ),
    coalesce(
      public.dash_prop_num(d.properties, 'verwachte_omvang_licentieperiode'),
      public.dash_prop_num(d.properties, 'omvang_licentieperiode')
    ),
    public.dash_prop_date(d.properties, 'startdatum'),
    public.dash_prop_date(d.properties, 'einddatum'),
    d.closedate,
    v_peil,
    -- prijs: zelfde logica als v_d1_deals.prijs
    coalesce(
      public.dash_prop_num(d.properties, 'verwachte_prijs'),
      case when public.dash_prop_date(d.properties, 'verwachte_start_pilot')
                >= (select geldig_vanaf from public.dash_parameters where sleutel = 'prijs_kantoorbreed')
           then (select waarde from public.dash_parameters where sleutel = 'prijs_kantoorbreed')
      end
    )
  from public.hubspot_deals d
  left join public.dim_stage_fase f on f.stage_id = d.dealstage
  where d.is_archived is not true;

  get diagnostics v_geschreven = row_count;
  return v_geschreven;
end;
$snap_deal_dag_run$;

comment on function public.snap_deal_dag_run(date) is
  'Schrijft de dagstand van alle niet-gearchiveerde deals naar snap_deal_dag, inclusief de prijs op dat moment. Idempotent per datum. Security definer — execute alleen service_role.';

revoke execute on function public.snap_deal_dag_run(date) from public;
grant execute on function public.snap_deal_dag_run(date) to service_role;

-- ── 7. PostgREST schema reload ──────────────────────────────────────────────
notify pgrst, 'reload schema';
