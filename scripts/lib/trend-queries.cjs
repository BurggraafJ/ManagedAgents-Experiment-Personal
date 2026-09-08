// =============================================================================
// lib/trend-queries.cjs — de SQL achter de trendpagina             (spoor 07)
// =============================================================================
// Alle cijfers op de trendpagina komen hier vandaan en nergens anders: geen
// nieuwe evaltabel, geen tweede telling in skill-tekst (D07-4). Elke functie
// geeft ruwe rijen terug; het opmaken zit in `agent_trend_page.cjs`.
//
// ── Het filter is de hele truc ──────────────────────────────────────────────
// `rag_eval_runs` staat vol implementatieprobes met eigen labels (W36: 95 runs,
// W37 tot nu 62). Een trendlijn daaruit is ruis. Alleen `label like 'weekly%'`
// (nieuw) en `label = 'cron-weekly'` (historisch) tellen — RESEARCH §4.3.
//
// ── Weekgrenzen ─────────────────────────────────────────────────────────────
// ISO-week, in UTC, in SQL uitgerekend zodat er één definitie is. ISO-week 1 is
// per definitie de week die 4 januari bevat, en `date_trunc('week', …)` is in
// Postgres maandag-start; samen geeft dat de grens exact. Gecontroleerd tegen
// `date_trunc('week', now())` → 2026-09-07 voor 2026-W37.
// =============================================================================
const WEEKLY = "(r.label like 'weekly%' or r.label = 'cron-weekly')";
const RUN_COLS = `id, label, suite, status, runner_version, created_at, duration_s,
  n_questions, n_results, pass, fail, pending, signal_pass_rate, avg_answer_correctness,
  cost_usd_total, p50_latency_ms, p95_latency_ms, persona_ok, g1, g4, n_identity_unreliable`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const one = (rows) => (rows && rows[0] ? Object.values(rows[0])[0] : null);

// ── 0 · welke week, en waar begint hij ──────────────────────────────────────
async function resolveWeek(sql, wk) {
  const rows = await sql(`
    with t as (select ${wk ? q(wk) : `to_char(now() at time zone 'UTC','IYYY-"W"IW')`} as wk),
         b as (select wk,
                 ((date_trunc('week', to_date(split_part(wk,'-W',1)||'-01-04','YYYY-MM-DD'))
                   + (split_part(wk,'-W',2)::int - 1) * interval '7 days')::timestamp
                   at time zone 'UTC') as ws
                 from t)
    select json_build_object(
      'week', wk,
      'ws', ws, 'we', ws + interval '7 days',
      'ws_date', (ws at time zone 'UTC')::date, 'we_date', ((ws + interval '6 days') at time zone 'UTC')::date,
      'nu', now(), 'week_voorbij', (ws + interval '7 days') <= now()
    ) as j from b`);
  const w = one(rows);
  if (!w || !/^\d{4}-W\d{2}$/.test(w.week)) throw new Error(`onbruikbare week: ${wk} (verwacht YYYY-Www)`);
  return w;
}

// ── 1 · de weekronde zelf, en de vorige ─────────────────────────────────────
async function runs(sql, { ws, we }) {
  return one(await sql(`
    select json_build_object(
      'target', (select row_to_json(t) from (select ${RUN_COLS} from public.v_agent_eval_runs r
                   where ${WEEKLY} and r.status='done'
                     and r.created_at >= ${q(ws)}::timestamptz and r.created_at < ${q(we)}::timestamptz
                   order by r.created_at desc limit 1) t),
      'prior',  (select row_to_json(t) from (select ${RUN_COLS} from public.v_agent_eval_runs r
                   where ${WEEKLY} and r.status='done' and r.created_at < ${q(ws)}::timestamptz
                   order by r.created_at desc limit 1) t),
      'in_week_any', (select json_agg(row_to_json(t)) from (select r.label, r.status, r.created_at, r.n_results
                        from public.v_agent_eval_runs r
                        where ${WEEKLY} and r.created_at >= ${q(ws)}::timestamptz and r.created_at < ${q(we)}::timestamptz
                        order by r.created_at) t)
    ) as j`));
}

// ── 2 · per categorie, met Δ pp t.o.v. de vorige weekronde ──────────────────
// `full join`: een categorie die deze week nieuw is (of verdwenen) mag niet
// stil wegvallen — dat is precies het soort verschuiving dat een trend verbergt.
async function byCategory(sql, targetId, priorId) {
  return one(await sql(`
    select coalesce(json_agg(row_to_json(t) order by t.category), '[]'::json) as j from (
      select category, a.n, a.pass, a.fail, a.pending, a.pass_pct, a.cost_usd,
             b.pass_pct as prior_pct, b.n as prior_n,
             case when a.pass_pct is not null and b.pass_pct is not null
                  then round(a.pass_pct - b.pass_pct, 1) end as delta_pp
        from (select category, n, pass, fail, pending, pass_pct, cost_usd
                from public.v_agent_eval_by_category where run_id = ${q(targetId)}) a
        full join (select category, pass_pct, n
                     from public.v_agent_eval_by_category where run_id = ${priorId ? q(priorId) : `'00000000-0000-0000-0000-000000000000'`}) b
          using (category)
    ) t`));
}

// ── 3 · kern-22: wie wisselde van kleur ─────────────────────────────────────
async function coreTrend(sql, targetId, priorId) {
  return one(await sql(`
    select json_build_object(
      'kern_totaal', (select count(*) from public.rag_eval_questions where is_core),
      'items', (select coalesce(json_agg(row_to_json(t) order by t.question_id), '[]'::json) from (
         select question_id, a.lane, a.signal_hit as nu, b.signal_hit as toen,
                a.answer_correctness as corr
           from (select question_id, lane, signal_hit, answer_correctness
                   from public.v_agent_eval_core_trend where run_id = ${q(targetId)}) a
           full join (select question_id, signal_hit
                        from public.v_agent_eval_core_trend
                       where run_id = ${priorId ? q(priorId) : `'00000000-0000-0000-0000-000000000000'`}) b
             using (question_id)) t)
    ) as j`));
}

// ── 4 · blijvend rood zonder datum in `notes` ───────────────────────────────
// Zelfde definitie als DOC-12 in `agent_docs_audit.cjs` en in
// `agent_docs_staleness_check()`: drie opeenvolgende `rook-p0`-rondes volledig
// rood. Bewust dezelfde drempel — anders alarmeert de guard op zes items en
// toont de pagina er vier, en dan is geen van de twee meer te vertrouwen.
// Drempel 3: run-op-run-ruis is ±2 items (geheugen eval-bank-route-noise).
//
// ⚠ PUBLIEKE REPO. `notes` bevat klantnamen. Deze uitvoer gaat naar Confluence
//   (intern, onder de space-ACL) — nooit naar een commit, PR-body of issue.
async function blijvendRood(sql) {
  return one(await sql(`
    with r as (select id from public.rag_eval_runs where suite='rook-p0' and status='done'
                order by created_at desc limit 3),
         f as (select res.question_id, count(*) n_runs, count(*) filter (where res.signal_hit is false) n_fail
                 from public.rag_eval_results res where res.run_id in (select id from r) group by 1)
    select coalesce(json_agg(row_to_json(t) order by t.id), '[]'::json) as j from (
      select q.id, q.category, q.is_core,
             (q.notes ~ '^rood sinds [0-9]{4}-[0-9]{2}-[0-9]{2}') as heeft_datum,
             left(coalesce(q.notes,''), 120) as notes
        from f join public.rag_eval_questions q on q.id = f.question_id
       where f.n_fail = f.n_runs and f.n_runs = 3) t`));
}

// ── 5 · kosten: de weekronde zelf en het evalverkeer van diezelfde week ─────
// De weekronde kost een paar dollar; het evalverkeer eromheen tientallen
// (2026-09-07 alleen al $30). Zonder die tweede regel meet de pagina de
// verkeerde kant van de rekening.
async function kosten(sql, { ws_date, we_date }) {
  return one(await sql(`
    select json_build_object(
      'per_verkeer', (select coalesce(json_agg(row_to_json(t) order by t.usd desc), '[]'::json) from (
         select verkeer, sum(runs)::int as runs, sum(failed)::int as failed,
                round(sum(kosten_usd), 2) as usd, max(p95_wall_ms) as p95_ms
           from public.v_agent_chat_runs_health
          where dag >= ${q(ws_date)}::date and dag <= ${q(we_date)}::date
          group by 1) t),
      'dagen_gemeten', (select count(distinct dag) from public.v_agent_chat_runs_health
                          where dag >= ${q(ws_date)}::date and dag <= ${q(we_date)}::date)
    ) as j`));
}

// ── 6 · de driftregel: de guard van dit spoor op zijn eigen pagina ──────────
async function drift(sql, { ws, we }) {
  return one(await sql(`
    select json_build_object(
      'findings', (select coalesce(json_agg(row_to_json(t) order by t.found desc), '[]'::json) from (
         select to_char(found_at at time zone 'UTC','YYYY-MM-DD HH24:MI') as found,
                severity, category, title, affected_object, status
           from public.security_findings
          where scan_type in ('docs_guard','rag_pipeline_guard') and status = 'open'
          order by found_at desc limit 12) t),
      'guard_cron',  (select row_to_json(t) from (select schedule, active from cron.job where jobname='agent-docs-guard') t),
      'weekly_cron', (select row_to_json(t) from (select schedule, active from cron.job where jobname='rag-eval-weekly') t),
      'vuringen', (select coalesce(json_agg(row_to_json(t) order by t.start_utc), '[]'::json) from (
         select to_char(d.start_time at time zone 'UTC','YYYY-MM-DD HH24:MI') as start_utc, d.status,
                exists (select 1 from public.rag_eval_runs r
                         where (r.label like 'weekly%' or r.label='cron-weekly')
                           and r.created_at between d.start_time and d.start_time + interval '6 hours') as heeft_run
           from cron.job_run_details d join cron.job j on j.jobid = d.jobid
          where j.jobname = 'rag-eval-weekly'
            and d.start_time >= ${q(ws)}::timestamptz and d.start_time < ${q(we)}::timestamptz) t),
      'laatste_weekronde', (select json_build_object(
            'datum', to_char(max(r.created_at) at time zone 'UTC','YYYY-MM-DD'),
            'dagen', extract(day from now() - max(r.created_at))::int)
          from public.rag_eval_runs r where r.status='done' and ${WEEKLY})
    ) as j`));
}

module.exports = { resolveWeek, runs, byCategory, coreTrend, blijvendRood, kosten, drift };
