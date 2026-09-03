-- 2026-09-03 — Health-pagina eerlijk maken: health_pct naast success_pct.
--
-- Probleem dat dit oplost
-- -----------------------
-- `agent_runs_health_7d.success_pct` = success / totaal. Een run met
-- `status='warning'` telde dus als mislukking, terwijl
-- `agent-handbook/references/logging.md` warning definieert als
-- "run completeert, attention gewenst" — een geslaagde run met een aantekening.
-- Gevolg op 2026-09-03: orchestrator 43 runs / 0 errors / 40 warnings -> 7%
-- (rood), klantbase 4 runs / 0 errors / 4 warnings -> 0% (rood). De pagina
-- meldde daarmee "niet aan het draaien" voor agents die elk uur netjes liepen.
--
-- Keuze: `success_pct` blijft ongewijzigd (strikte success-ratio, andere
-- consumers mogen erop blijven leunen); we voegen `health_pct` toe =
-- (success + warning) / totaal. De UI kleurt op health_pct en houdt de
-- losse ✓ / ⚠ / ✗ kolommen, zodat de nuance zichtbaar blijft.
--
-- `running` telt in geen van beide percentages mee als geslaagd, maar wel in
-- runs_total — een hangende run mag niet als gezond gelden.

create or replace view public.agent_runs_health_7d as
select
  s.agent_name,
  s.display_name,
  s.tier,
  s.enabled,
  coalesce(r.runs_total, 0::bigint)  as runs_total,
  coalesce(r.ok_count, 0::bigint)    as ok_count,
  coalesce(r.warn_count, 0::bigint)  as warn_count,
  coalesce(r.err_count, 0::bigint)   as err_count,
  case
    when coalesce(r.runs_total, 0::bigint) = 0 then null::numeric
    else round(100.0 * r.ok_count::numeric / r.runs_total::numeric, 1)
  end as success_pct,
  coalesce(r.avg_dur_s, 0::numeric) as avg_dur_s,
  r.last_failure_at,
  s.last_run_at,
  -- health_pct staat achteraan omdat `create or replace view` geen kolom
  -- midden in de lijst mag invoegen (42P16). Positie is irrelevant: de app
  -- selecteert op naam.
  case
    when coalesce(r.runs_total, 0::bigint) = 0 then null::numeric
    else round(100.0 * (r.ok_count + r.warn_count)::numeric / r.runs_total::numeric, 1)
  end as health_pct
from agent_schedules s
left join (
  select
    agent_runs.agent_name,
    count(*)                                                   as runs_total,
    sum((agent_runs.status = 'success'::text)::integer)         as ok_count,
    sum((agent_runs.status = 'warning'::text)::integer)         as warn_count,
    sum((agent_runs.status = 'error'::text)::integer)           as err_count,
    round(avg(extract(epoch from agent_runs.completed_at - agent_runs.started_at)), 1) as avg_dur_s,
    max(case when agent_runs.status = 'error'::text then agent_runs.started_at end)    as last_failure_at
  from agent_runs
  where agent_runs.started_at > (now() - '7 days'::interval)
  group by agent_runs.agent_name
) r on r.agent_name = s.agent_name;

comment on view public.agent_runs_health_7d is
  'Agent-health over 7 dagen. success_pct = strikt status=success; health_pct = '
  '(success+warning)/totaal — de kolom waar de Health-pagina op kleurt, omdat '
  'warning per logging.md-contract een voltooide run is. Zie migration '
  '20260903_agent_health_pct.sql.';
