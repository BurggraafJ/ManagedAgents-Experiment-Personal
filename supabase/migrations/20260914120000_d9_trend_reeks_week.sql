-- =============================================================================
-- D9 · v_d9_trend krijgt `reeks_week`: acht weekstanden voor de C3 Trendcel
-- (skill dashboarding v0.9.1, chart-catalogus §C3, locked 2026-09-14).
--
-- Waarom: de cel in de meesterlijst is 84 px breed en toont acht vaste slots,
-- niet 24 dagstaven. Slot 8 is de laatste snapshotdag, slot k de stand op
-- dezelfde weekdag (8 − k) weken eerder. NULL waar die dag geen snapshot was
-- of de check niet meetbaar was — dat is iets anders dan nul en moet zo de
-- trend in. De UI rekent niets anders dan `laatste − vorige` over deze acht
-- posities (G5).
--
-- Additief: alle bestaande kolommen (reeks, vanaf, tot, punten, laatste,
-- week_terug) blijven in dezelfde volgorde staan; `reeks_week` komt erachter.
-- `week_terug` blijft de stand van zeven dagen vóór de laatste snapshot en is
-- dus per definitie gelijk aan reeks_week[7].
-- =============================================================================
create or replace view public.v_d9_trend
with (security_invoker = on) as
with laatste as (
  select max(datum) as datum from public.snap_hygiene_dag
),
weken as (
  -- k = 1 … 8; datum_k = laatste snapshotdag − 7 · (8 − k)
  select g.k, (l.datum - 7 * (8 - g.k))::date as datum
  from laatste l, generate_series(1, 8) as g(k)
),
per_check as (
  select s.check_id
  from public.snap_hygiene_dag s
  where s.datum >= current_date - 56
  group by s.check_id
),
week_reeks as (
  select
    c.check_id,
    array_agg(s.aantal order by w.k) as reeks_week
  from per_check c
  cross join weken w
  left join public.snap_hygiene_dag s on s.check_id = c.check_id and s.datum = w.datum
  group by c.check_id
)
select
  s.check_id,
  array_agg(s.aantal order by s.datum)               as reeks,
  min(s.datum)                                       as vanaf,
  max(s.datum)                                       as tot,
  count(*)::int                                      as punten,
  (array_agg(s.aantal order by s.datum desc))[1]     as laatste,
  max(s.aantal) filter (
    where s.datum = (select datum - 7 from laatste)
  )                                                  as week_terug,
  (select wr.reeks_week from week_reeks wr where wr.check_id = s.check_id) as reeks_week
from public.snap_hygiene_dag s
where s.datum >= current_date - 56
group by s.check_id;

comment on view public.v_d9_trend is
  'Acht weken hygiënetrend per check uit snap_hygiene_dag. reeks = alle dagsnapshots (oud → nieuw); reeks_week = exact acht weekstanden op dezelfde weekdag als de laatste snapshot, NULL = geen meting die dag (C3 Trendcel, v0.9.1). Nul rijen = er zijn nog geen snapshots; het bord toont dan "reeks start" en geen lijn.';

grant select on public.v_d9_trend to authenticated;
