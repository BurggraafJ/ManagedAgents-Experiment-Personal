-- =============================================================================
-- D9 · Datakwaliteit & hygiëne — B: recordlijsten en trend        (v1.173)
-- =============================================================================
-- Niveau drie van het drill-pad: teller → check → lijst met records. Niet
-- dieper. Elke lijst heeft dezelfde kolommen, zodat de UI één renderer heeft en
-- v_d9_checks.records_view kan zeggen welke lijst bij welke check hoort — de
-- koppeling staat dus in de data, niet in JSX.
--
--   check_id · record_id · record_type · naam · pipeline_label · fase_label
--   eigenaar · dagen_open · detail · hubspot_url
--
-- `detail` is de reden in mensentaal: waaróm staat dit record op de lijst. Geen
-- systeemtaal — `dealstage` en `closedate` horen in de definitiekaart, niet in
-- een kolom op het scherm.
--
-- De lijsten van H1–H4 en H12 dragen dezelfde mirror-guard als de checktabel:
-- zit de property nog niet in de mirror, dan geven ze nul rijen in plaats van
-- een lijst met valse beschuldigingen. "Alle 25 fase-3-deals missen een
-- beslisdatum" is namelijk niet waar — de app kan het veld alleen niet zien.
--
-- Verder in deze migratie: v_d9_trend (8 weken per check, uit snap_hygiene_dag)
-- en de dagelijkse vulfunctie daarvoor.
-- =============================================================================

-- ── H1 · Verliesreden ontbreekt ──────────────────────────────────────────────
create or replace view public.v_d9_h1_verliesreden_leeg
with (security_invoker = on) as
select
  'H1'::text                                   as check_id,
  b.deal_id                                    as record_id,
  'deal'::text                                 as record_type,
  b.dealname                                   as naam,
  b.pipeline_label,
  b.fase_label,
  b.eigenaar,
  b.dagen_open,
  'verloren op ' || coalesce(to_char(b.closedate, 'DD-MM-YYYY'), 'onbekende datum')
    || ' · geen reden ingevuld'                as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.fase = 'verloren'
  and b.verliesreden is null
  and (select prop_verliesreden from public.v_d9_meta);

-- ── H2 · Fase 3 zonder beslisdatum of verwachting ────────────────────────────
create or replace view public.v_d9_h2_fase3_zonder_velden
with (security_invoker = on) as
select
  'H2'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  array_to_string(array_remove(array[
    case when b.beslisdatum is null       then 'beslisdatum'::text end,
    case when b.verwachte_bodem is null   then 'minimumafname'::text end,
    case when b.verwachte_plafond is null then 'contractomvang'::text end
  ], null), ' · ') || ' ontbreekt' as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.fase = '3'
  and (b.beslisdatum is null or b.verwachte_bodem is null or b.verwachte_plafond is null)
  and (select prop_beslisdatum and prop_verwachtingsvelden from public.v_d9_meta);

-- ── H3 · Beslisdatum is verlopen ─────────────────────────────────────────────
create or replace view public.v_d9_h3_verlopen_beslisdatum
with (security_invoker = on) as
select
  'H3'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  'beslisdatum ' || to_char(b.beslisdatum, 'DD-MM-YYYY')
    || ' · ' || (current_date - b.beslisdatum) || ' dagen verlopen' as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.is_open
  and b.beslisdatum is not null
  and b.beslisdatum < current_date
  and (select prop_beslisdatum from public.v_d9_meta);

-- ── H4 · Geen volgende stap gepland ──────────────────────────────────────────
create or replace view public.v_d9_h4_geen_next_step
with (security_invoker = on) as
select
  'H4'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  case
    when b.next_step is null then 'geen volgende stap gepland · ' || b.dagen_open || ' dagen open'
    else 'laatste geplande stap ' || to_char(b.next_step, 'DD-MM-YYYY')
         || ' · ' || (current_date - b.next_step) || ' dagen geleden'
  end as detail,
  b.hubspot_url
from (select d.*, coalesce((select waarde from public.dash_parameters where sleutel = 'h4_geen_next_step_dagen'), 14) as drempel
      from public.v_d9_deals d) b
where b.is_open and b.is_salesdeal
  and (b.next_step is null or b.next_step < current_date)
  and b.dagen_open > b.drempel
  and (select prop_next_step from public.v_d9_meta);

-- ── H5 · Zonder of met onbekende eigenaar ────────────────────────────────────
create or replace view public.v_d9_h5_zonder_owner
with (security_invoker = on) as
select
  'H5'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  case
    when b.hubspot_owner_id is null then 'geen eigenaar toegewezen'
    else 'eigenaar-id ' || b.hubspot_owner_id || ' is niet (meer) actief in HubSpot'
  end as detail,
  b.hubspot_url
from public.v_d9_deals b
where (b.is_open or b.is_klantdeal) and b.owner_onbekend;

-- ── H6 · Gewonnen deal staat nog in de Sales Pipeline ────────────────────────
create or replace view public.v_d9_h6_gewonnen_in_sales
with (security_invoker = on) as
with cb_companies as (
  select distinct cid
  from public.v_d9_deals d, lateral unnest(d.associated_company_ids) as u(cid)
  where d.is_klantdeal
)
select
  'H6'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  'gewonnen op ' || coalesce(to_char(b.closedate, 'DD-MM-YYYY'), 'onbekende datum')
    || ' · deze klant heeft nog geen klantdeal' as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.fase = 'gewonnen'
  and not exists (select 1 from cb_companies cc where cc.cid = any (b.associated_company_ids));

-- ── H7 · Meer dan één open deal op dezelfde klant ────────────────────────────
create or replace view public.v_d9_h7_dubbele_open_deals
with (security_invoker = on) as
with per_company as (
  select u.cid, d.pipeline_label, count(*) as n, string_agg(d.dealname, ' · ' order by d.dealname) as namen
  from public.v_d9_deals d, lateral unnest(d.associated_company_ids) as u(cid)
  where d.is_open
  group by u.cid, d.pipeline_label
  having count(*) > 1
)
select
  'H7'::text                                   as check_id,
  pc.cid                                       as record_id,
  'company'::text                              as record_type,
  coalesce(c.name, 'Onbekende klant (' || pc.cid || ')') as naam,
  pc.pipeline_label,
  null::text                                   as fase_label,
  null::text                                   as eigenaar,
  null::int                                    as dagen_open,
  pc.n || ' open deals: ' || pc.namen          as detail,
  'https://app.hubspot.com/contacts/0/company/' || pc.cid as hubspot_url
from per_company pc
left join public.hubspot_companies c on c.company_id = pc.cid;

-- ── H8 · Klantdeal zonder kernvelden ─────────────────────────────────────────
create or replace view public.v_d9_h8_klantdeal_zonder_kernvelden
with (security_invoker = on) as
select
  'H8'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  array_to_string(array_remove(array[
    case when b.startdatum is null then 'startdatum'::text end,
    case when b.plafond is null    then 'contractomvang'::text end,
    case when b.bodem is null      then 'minimumafname'::text end
  ], null), ' · ') || ' ontbreekt' as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.is_kern
  and (b.startdatum is null or b.plafond is null or b.bodem is null);

-- ── H9 · Proef zonder of met verlopen einddatum ──────────────────────────────
create or replace view public.v_d9_h9_proef_einddatum
with (security_invoker = on) as
select
  'H9'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  case
    when b.einddatum is null then 'proef zonder einddatum'
    else 'einddatum ' || to_char(b.einddatum, 'DD-MM-YYYY') || ' is voorbij, deal staat nog in Proeftijd'
  end as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.fase = 'proef'
  and (b.einddatum is null or b.einddatum < current_date);

-- ── H10 · Afsluitdatum op een lopende klantdeal ──────────────────────────────
create or replace view public.v_d9_h10_administratieve_closedate
with (security_invoker = on) as
select
  'H10'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  'afsluitdatum ' || to_char(b.closedate, 'DD-MM-YYYY') || ' op een lopende klant' as detail,
  b.hubspot_url
from public.v_d9_deals b
where b.is_klantdeal
  and b.fase in ('actief', 'proef', 'niet_gestart', 'onboarding')
  and b.closedate is not null;

-- ── H11 · Doublure-velden (eenmalige constatering) ───────────────────────────
create or replace view public.v_d9_h11_doublure_velden
with (security_invoker = on) as
select
  'H11'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  'draagt ' || array_to_string(array_remove(array[
    case when nullif(btrim(coalesce(b.properties->>'contract_start_date', '')), '') is not null
         then 'een tweede contractstart'::text end,
    case when nullif(btrim(coalesce(b.properties->>'contract_einddatum', '')), '') is not null
         then 'een tweede contracteinde'::text end
  ], null), ' en ') || ' naast startdatum/einddatum' as detail,
  b.hubspot_url
from public.v_d9_deals b
where nullif(btrim(coalesce(b.properties->>'contract_start_date', '')), '') is not null
   or nullif(btrim(coalesce(b.properties->>'contract_einddatum', '')), '') is not null;

-- ── H12 · Kantoorgrootte ontbreekt op de company ─────────────────────────────
create or replace view public.v_d9_h12_company_zonder_omvang
with (security_invoker = on) as
select
  'H12'::text                                  as check_id,
  c.company_id                                 as record_id,
  'company'::text                              as record_type,
  coalesce(c.name, 'Naamloze company (' || c.company_id || ')') as naam,
  'Companies'::text                            as pipeline_label,
  null::text                                   as fase_label,
  coalesce(u.full_name, u.email)               as eigenaar,
  greatest((current_date - c.hs_created_at::date), 0) as dagen_open,
  'geen totale omvang ingevuld'                as detail,
  'https://app.hubspot.com/contacts/0/company/' || c.company_id as hubspot_url
from public.hubspot_companies c
left join public.hubspot_users u on u.hubspot_owner_id = c.hubspot_owner_id
where c.is_archived is not true
  and nullif(btrim(coalesce(c.properties->>'totale_omvang', '')), '') is null
  and (select prop_company_omvang from public.v_d9_meta);

-- ── H13 · Deal zonder company ────────────────────────────────────────────────
create or replace view public.v_d9_h13_zonder_company
with (security_invoker = on) as
select
  'H13'::text as check_id, b.deal_id as record_id, 'deal'::text as record_type,
  b.dealname as naam, b.pipeline_label, b.fase_label, b.eigenaar, b.dagen_open,
  'geen klant gekoppeld aan deze deal'         as detail,
  b.hubspot_url
from public.v_d9_deals b
where (b.is_open or b.is_klantdeal) and b.zonder_company;

grant select on
  public.v_d9_h1_verliesreden_leeg,
  public.v_d9_h2_fase3_zonder_velden,
  public.v_d9_h3_verlopen_beslisdatum,
  public.v_d9_h4_geen_next_step,
  public.v_d9_h5_zonder_owner,
  public.v_d9_h6_gewonnen_in_sales,
  public.v_d9_h7_dubbele_open_deals,
  public.v_d9_h8_klantdeal_zonder_kernvelden,
  public.v_d9_h9_proef_einddatum,
  public.v_d9_h10_administratieve_closedate,
  public.v_d9_h11_doublure_velden,
  public.v_d9_h12_company_zonder_omvang,
  public.v_d9_h13_zonder_company
to authenticated;

-- ── Tellers — de eerste blik, per datagebied ─────────────────────────────────
-- De D9-pagina schetst drie tellers (Sales Pipeline · Customer Base ·
-- Company). Er zijn er hier vier, want vier checks (H5, H7, H11, H13) gelden
-- voor béíde pipelines en laten zich niet zonder recordtelling over twee
-- tellers verdelen. Ze onder één van beide hangen zou het ene bord te schoon en
-- het andere te vies maken; een eigen teller "Beide pipelines" telt niemand
-- dubbel. De UI telt hier niets bij op — dat gebeurt hier, één keer.
create or replace view public.v_d9_tellers
with (security_invoker = on) as
select
  c.scope,
  max(c.scope_label)                                            as scope_label,
  sum(c.aantal) filter (where c.status = 'meetbaar')::int       as open_fouten,
  count(*) filter (where c.status = 'meetbaar')::int            as checks_meetbaar,
  count(*) filter (where c.status = 'wacht_op_mirror')::int     as checks_wacht,
  count(*) filter (where c.status in ('niet_meetbaar', 'niet_gekoppeld'))::int as checks_blind,
  min(c.volgnummer)                                             as sort_order
from public.v_d9_checks c
where c.scope <> 'extern'
group by c.scope;

comment on view public.v_d9_tellers is
  'Openstaande hygiënefouten per datagebied (sales · klant · company · beide). open_fouten telt alleen meetbare checks; checks_wacht en checks_blind zeggen hoeveel checks er níét in dat getal zitten, zodat een lage teller niet als "schoon" gelezen wordt.';

grant select on public.v_d9_tellers to authenticated;

-- ── Trend — acht weken per check, uit de snapshots ───────────────────────────
-- Zolang snap_hygiene_dag leeg is, geeft deze view nul rijen en toont het bord
-- "—" met "trend beschikbaar vanaf <datum>". Een vlakke nep-lijn tekenen zou
-- suggereren dat er niets beweegt, en dat is precies het verkeerde signaal.
create or replace view public.v_d9_trend
with (security_invoker = on) as
select
  s.check_id,
  array_agg(s.aantal order by s.datum)               as reeks,
  min(s.datum)                                       as vanaf,
  max(s.datum)                                       as tot,
  count(*)::int                                      as punten,
  (array_agg(s.aantal order by s.datum desc))[1]     as laatste,
  max(s.aantal) filter (
    where s.datum = (select max(datum) - 7 from public.snap_hygiene_dag)
  )                                                  as week_terug
from public.snap_hygiene_dag s
where s.datum >= current_date - 56
group by s.check_id;

comment on view public.v_d9_trend is
  'Acht weken hygiënetrend per check uit snap_hygiene_dag. Nul rijen = er zijn nog geen snapshots; het bord toont dan "trend beschikbaar vanaf …" en geen lijn.';

grant select on public.v_d9_trend to authenticated;

-- ── Dagelijkse vulling van snap_hygiene_dag ──────────────────────────────────
create or replace function public.snap_hygiene_dag_run(p_datum date default current_date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $snap_hygiene_dag_run$
declare
  v_zichtbaar  integer;
  v_peil       timestamptz;
  v_geschreven integer;
begin
  select deals_zichtbaar, peildatum into v_zichtbaar, v_peil from public.v_d9_meta;

  -- Geen zichtbare deals = geen meting. Zou de functie hier doorlopen, dan
  -- schreef ze voor elke check een nul en zag de trend er morgen uit alsof
  -- alles is opgeruimd.
  if coalesce(v_zichtbaar, 0) = 0 then
    raise notice 'snap_hygiene_dag_run: geen zichtbare deals, geen snapshot voor %', p_datum;
    return 0;
  end if;

  delete from public.snap_hygiene_dag where datum = p_datum;

  insert into public.snap_hygiene_dag (datum, check_id, aantal, mirror_peildatum)
  select p_datum, c.check_id, c.aantal, v_peil
  from public.v_d9_checks c;

  get diagnostics v_geschreven = row_count;
  return v_geschreven;
end;
$snap_hygiene_dag_run$;

comment on function public.snap_hygiene_dag_run(date) is
  'Schrijft het aantal open records per hygiënecheck weg voor één dag. aantal blijft NULL waar de check niet meetbaar was — dat is iets anders dan nul en moet zo de trend in. Idempotent per datum.';

revoke execute on function public.snap_hygiene_dag_run(date) from public;
grant execute on function public.snap_hygiene_dag_run(date) to service_role;

-- 05:45 UTC = 07:45 NL, vijf minuten na de deal-snapshot.
select cron.unschedule('dash-snap-hygiene-dag')
 where exists (select 1 from cron.job where jobname = 'dash-snap-hygiene-dag');

select cron.schedule('dash-snap-hygiene-dag', '45 5 * * *', $cron$
  select public.snap_hygiene_dag_run();
$cron$);
