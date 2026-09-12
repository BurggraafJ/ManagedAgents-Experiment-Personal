-- =============================================================================
-- Stuurinformatie-fundament C — dagelijkse snapshots                (v1.173)
-- =============================================================================
-- HubSpot bewaart geen historie van tellingen en `hubspot_deals` is een stand,
-- geen reeks. Zonder snapshot bestaat er dus geen pipeline-trend, geen
-- tijd-in-fase, geen slippage en geen hygiënetrend — en elke dag zonder
-- snapshot is trend die je nooit meer terugkrijgt. Daarom staat deze migratie
-- bewust vóór het eerste bord (skill `dashboarding`, principes.md regel 10 en
-- bouwproces.md "Snapshots"; onderzoek 2026-09-12 §8 stap 0b).
--
--   snap_deal_dag      één rij per deal per dag met de velden waar de borden op
--                      rekenen. Voedt later: trend per fase, tijd-in-fase,
--                      slippage, forecast-nauwkeurigheid.
--   snap_hygiene_dag   één rij per hygiënecheck per dag. Voedt de trendkolom
--                      van D9. De vulfunctie staat in migratie D, want die
--                      leest v_d9_checks.
--
-- Twee ontwerpkeuzes die ertoe doen:
--
--   • De vulfunctie is `security definer`: pg_cron draait zonder auth.uid() en
--     `hubspot_deals` staat achter is_admin_or_higher() + session_mfa_ok().
--     Daarom expliciet `revoke execute from public` — een kale CREATE FUNCTION
--     geeft PUBLIC anders execute, en dan leest anon de mirror langs de RLS om.
--   • Een lege bron schrijft géén snapshot. Zou de mirror even leeg of
--     onbereikbaar zijn, dan is een rij met nul deals geen meting maar een gat
--     dat er als een daling uitziet. Liever een ontbrekende dag dan een leugen.
--
-- Terugdraaien: cron-jobs unschedulen, functies droppen, tabellen droppen.
-- =============================================================================

-- ── 1. Parse-helpers ─────────────────────────────────────────────────────────
-- hubspot_deals.properties is jsonb met alles als tekst: datums soms als
-- 'YYYY-MM-DD', soms als epoch-milliseconden. De bestaande analytics_prop_*-
-- functies dekken dit af maar zijn `security definer` en niet uitvoerbaar voor
-- de read-only rol — in views die ook via de read-only weg gemeten worden, is
-- dat een blokkade. Deze twee zijn invoker, totaal (werpen nooit) en zichtbaar
-- voor iedereen die de rijen toch al mag zien.
create or replace function public.dash_prop_date(p_props jsonb, p_key text)
returns date
language sql
stable
parallel safe
set search_path to 'public', 'pg_catalog'
as $dash_prop_date$
  select case
    when nullif(btrim(coalesce(p_props->>p_key, '')), '') is null then null
    when btrim(p_props->>p_key) ~ '^\d{10,16}$'
      then ((to_timestamp((btrim(p_props->>p_key))::numeric / 1000) at time zone 'UTC'))::date
    when btrim(p_props->>p_key) ~ '^\d{4}-\d{2}-\d{2}'
      then (substring(btrim(p_props->>p_key) from 1 for 10))::date
    else null
  end
$dash_prop_date$;

comment on function public.dash_prop_date(jsonb, text) is
  'Leest een HubSpot-datumproperty uit een properties-jsonb. Verdraagt ISO-datums én epoch-milliseconden en geeft NULL bij alles wat geen van beide is — een rommelige waarde mag nooit een hele view laten klappen.';

revoke execute on function public.dash_prop_date(jsonb, text) from public;
grant execute on function public.dash_prop_date(jsonb, text) to authenticated, service_role;

create or replace function public.dash_prop_num(p_props jsonb, p_key text)
returns numeric
language sql
stable
parallel safe
set search_path to 'public', 'pg_catalog'
as $dash_prop_num$
  select case
    when btrim(coalesce(p_props->>p_key, '')) ~ '^-?\d+(\.\d+)?$'
      then (btrim(p_props->>p_key))::numeric
    else null
  end
$dash_prop_num$;

comment on function public.dash_prop_num(jsonb, text) is
  'Leest een numerieke HubSpot-property uit een properties-jsonb; NULL bij leeg of niet-numeriek.';

revoke execute on function public.dash_prop_num(jsonb, text) from public;
grant execute on function public.dash_prop_num(jsonb, text) to authenticated, service_role;

-- ── 2. snap_deal_dag ─────────────────────────────────────────────────────────
create table if not exists public.snap_deal_dag (
  datum             date not null,
  deal_id           text not null,
  pipeline_id       text,
  dealstage         text,
  fase              text,
  hubspot_owner_id  text,
  company_id        text,
  beslisdatum       date,
  bodem             numeric,
  plafond           numeric,
  startdatum        date,
  einddatum         date,
  closedate         timestamptz,
  mirror_peildatum  timestamptz,
  primary key (datum, deal_id)
);

comment on table public.snap_deal_dag is
  'Dagelijkse stand per niet-gearchiveerde deal. Bron van elke trendlijn op D1/D9/D10. mirror_peildatum = max(hubspot_deals.synced_at) op het moment van schrijven: zo is achteraf te zien of een dag op verse of oude mirror-data rust.';
comment on column public.snap_deal_dag.beslisdatum is
  'verwachte_start_pilot — de beslisdatum (besluit Jelle 01-09-2026), NIET closedate. Leeg tot de property in de mirror landt (zie hubspot-sync-etl DEAL_PROPERTIES).';
comment on column public.snap_deal_dag.bodem is
  'Minimumafname: verwachte_minimumafname_licentieperiode, terugvallend op minimale_licenties_licentieperiode voor klantdeals.';
comment on column public.snap_deal_dag.plafond is
  'Contractomvang: verwachte_omvang_licentieperiode, terugvallend op omvang_licentieperiode voor klantdeals.';

create index if not exists snap_deal_dag_deal_idx on public.snap_deal_dag (deal_id, datum);

alter table public.snap_deal_dag enable row level security;

drop policy if exists snap_deal_dag_read on public.snap_deal_dag;
create policy snap_deal_dag_read on public.snap_deal_dag
  for select to authenticated using ((select public.is_admin_or_higher()));

drop policy if exists snap_deal_dag_service on public.snap_deal_dag;
create policy snap_deal_dag_service on public.snap_deal_dag
  for all to service_role using (true) with check (true);

grant select on public.snap_deal_dag to authenticated;

-- ── 3. snap_hygiene_dag ──────────────────────────────────────────────────────
create table if not exists public.snap_hygiene_dag (
  datum             date not null,
  check_id          text not null,
  aantal            integer,
  mirror_peildatum  timestamptz,
  primary key (datum, check_id)
);

comment on table public.snap_hygiene_dag is
  'Dagelijks aantal open records per hygiënecheck (D9). Voedt de trendkolom. aantal NULL = de check was die dag niet meetbaar (bron ontbrak) — dat is iets anders dan nul fouten en mag nooit als nul getekend worden.';

alter table public.snap_hygiene_dag enable row level security;

drop policy if exists snap_hygiene_dag_read on public.snap_hygiene_dag;
create policy snap_hygiene_dag_read on public.snap_hygiene_dag
  for select to authenticated using ((select public.is_admin_or_higher()));

drop policy if exists snap_hygiene_dag_service on public.snap_hygiene_dag;
create policy snap_hygiene_dag_service on public.snap_hygiene_dag
  for all to service_role using (true) with check (true);

grant select on public.snap_hygiene_dag to authenticated;

-- ── 4. Vulfunctie voor snap_deal_dag ─────────────────────────────────────────
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

  -- Lege bron = geen meting. Een nulrij zou als daling in de trend verschijnen.
  if coalesce(v_bron, 0) = 0 then
    raise notice 'snap_deal_dag_run: mirror leeg, geen snapshot voor %', p_datum;
    return 0;
  end if;

  delete from public.snap_deal_dag where datum = p_datum;

  insert into public.snap_deal_dag (
    datum, deal_id, pipeline_id, dealstage, fase, hubspot_owner_id, company_id,
    beslisdatum, bodem, plafond, startdatum, einddatum, closedate, mirror_peildatum
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
    v_peil
  from public.hubspot_deals d
  left join public.dim_stage_fase f on f.stage_id = d.dealstage
  where d.is_archived is not true;

  get diagnostics v_geschreven = row_count;
  return v_geschreven;
end;
$snap_deal_dag_run$;

comment on function public.snap_deal_dag_run(date) is
  'Schrijft de dagstand van alle niet-gearchiveerde deals naar snap_deal_dag. Idempotent per datum (verwijdert eerst die dag). Security definer omdat pg_cron geen auth.uid() heeft en hubspot_deals achter is_admin_or_higher() + session_mfa_ok() staat — daarom execute alleen voor service_role.';

revoke execute on function public.snap_deal_dag_run(date) from public;
grant execute on function public.snap_deal_dag_run(date) to service_role;

-- ── 5. Cron — dagelijks, ná het nachtelijke sync-venster ─────────────────────
-- 05:40 UTC = 07:40 NL. De full sync draait elke 24 uur binnen de `*/30`-delta
-- van hubspot-sync-etl; het exacte uur schuift dus mee. mirror_peildatum in de
-- snapshot maakt achteraf zichtbaar hoe vers de bron op dat moment was.
select cron.unschedule('dash-snap-deal-dag')
 where exists (select 1 from cron.job where jobname = 'dash-snap-deal-dag');

select cron.schedule('dash-snap-deal-dag', '40 5 * * *', $cron$
  select public.snap_deal_dag_run();
$cron$);
