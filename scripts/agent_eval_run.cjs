#!/usr/bin/env node
// =============================================================================
// agent_eval_run.cjs — kick, poll en vergelijk een evalronde        (spoor 01)
// =============================================================================
//   node scripts/agent_eval_run.cjs --suite rook-p0 --label rook-<branch> --gate [strict]
//        [--compare-to <label|uuid>] [--json runs/x.json] [--build-artifacts] [--no-build-artifacts]
//        [--ids A01,B02] [--only-tag p0] [--lane chat] [--category wiki-acl] [--persona jelle]
//        [--force] [--max-minutes 180]
//   node scripts/agent_eval_run.cjs --status <run_id|label> [--json …] [--gate]
//   node scripts/agent_eval_run.cjs --compare <after: run_id|label> <before: run_id|label> [--gate]
//
// Wat dit script NIET doet: scoren. Alle asserts leven in de edge function
// rag-eval-cron (één scorer, RESEARCH §3.1); G1–G7 rekent de RPC
// rag_eval_compare uit. Dit script kickt, pollt, print en sluit af met een exitcode.
//
// Exit: 0 = klaar (en poorten groen als --gate) · 1 = --gate rood · 2 = gebruik/auth
//       3 = een andere run draait (zonder --force) · 4 = run failed / invalid_persona
//
// --gate        exit 1 als G1 of G4 rood, de run invalid_persona is, of n_identity_unreliable > 0
// --gate strict ook exit 1 als G2, G3, G5, G6 of G7 rood ('n/a' is niet rood)
//
// Auth: SBT=<management_token>, ~/.claude/supabase-mcp.json of $SUPABASE_ACCESS_TOKEN.
// Het cron_secret komt uit Vault via de RPC en wordt nooit geprint.
//
// ⚠ PUBLIEKE REPO. De json bevat géén antwoordtekst en geen vraagteksten; in
//   assert_detail wordt alles tussen haakjes vervangen door (…) — daar staan bij
//   required_entities/must_match_regex klantnamen in. De ruwe detail staat in de DB.
// =============================================================================
const fs = require('fs');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;
if (!SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }

const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const FN = `https://${REF}.supabase.co/functions/v1/rag-eval-cron`;
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);
const GATE = flag('gate') ? (arg('gate', null) === 'strict' ? 'strict' : 'basic') : null;
const JSON_OUT = arg('json', null);
const MAX_MIN = Number(arg('max-minutes', 180));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));

async function sql(query) {
  const r = await fetch(`${MGMT}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA }, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
async function resolveRunId(key) {
  if (isUuid(key)) return key;
  const rows = await sql(`select id from public.rag_eval_runs where label = ${q(key)} order by created_at desc limit 1`);
  if (!rows.length) throw new Error(`geen run met label ${key}`);
  return rows[0].id;
}
async function loadRun(runId) {
  const rows = await sql(`select r.*, (select count(*) from public.rag_eval_results x where x.run_id = r.id)::int as n_results,
      (select count(*) from public.rag_eval_run_items i where i.run_id = r.id and i.state <> 'done')::int as n_open
      from public.rag_eval_runs r where r.id = ${q(runId)}::uuid`);
  return rows[0] || null;
}
const scrub = (d) => String(d || '').replace(/\(([^)]*)\)/g, '(…)').slice(0, 300);
const pad = (s, n) => String(s ?? '').padEnd(n);
const fmt = (v) => v == null ? '-' : (typeof v === 'object' ? JSON.stringify(v) : String(v));

function printGates(g) {
  console.log('\n  poort  status  waarde                                                             drempel');
  console.log('  ' + '-'.repeat(110));
  for (const k of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) {
    const x = g?.[k] || {};
    const val = x.value != null ? fmt(x.value) : `before=${fmt(x.before)} after=${fmt(x.after)}`;
    console.log(`  ${pad(k, 6)} ${pad(x.status, 7)} ${pad(val.slice(0, 66), 66)} ${x.threshold || ''}${x.reason ? `  · ${x.reason}` : ''}`);
  }
  console.log(`  n_pending=${fmt(g?.n_pending)} · n_identity_unreliable=${fmt(g?.n_identity_unreliable)} · cost_usd_total=${fmt(g?.cost_usd_total)} · duration_s=${fmt(g?.duration_s)} · assumption_honesty_rate=${fmt(g?.assumption_honesty_rate)}`);
  if (Array.isArray(g?.green_to_red) && g.green_to_red.length) console.log('  groen→rood: ' + g.green_to_red.map((x) => `${x.id}${x.caller_identified_before !== x.caller_identified_after ? '*' : ''}`).join(' ') + '   (* = caller_identified verschilt)');
  if (Array.isArray(g?.red_to_green) && g.red_to_green.length) console.log('  rood→groen: ' + g.red_to_green.map((x) => x.id).join(' '));
  if (Array.isArray(g?.by_category) && g.by_category.length) {
    console.log('\n  categorie                 n   pass  fail  pend  pass%   p50ms   p95ms   $      unrel');
    for (const c of g.by_category) console.log(`  ${pad(c.category, 24)} ${pad(c.n, 4)} ${pad(c.pass, 5)} ${pad(c.fail, 5)} ${pad(c.pending, 5)} ${pad(c.pass_pct ?? '-', 7)} ${pad(c.p50_latency_ms ?? '-', 7)} ${pad(c.p95_latency_ms ?? '-', 7)} ${pad(c.cost_usd ?? '-', 6)} ${c.n_identity_unreliable}`);
  }
}

function gateExit(g, run) {
  if (!GATE) return 0;
  const red = (k) => g?.[k]?.status === 'red';
  const reasons = [];
  if (run && run.status === 'invalid_persona') reasons.push('invalid_persona');
  if (run && run.status === 'failed') reasons.push('run failed');
  if (red('G1')) reasons.push('G1 rood');
  if (red('G4')) reasons.push('G4 rood');
  if ((g?.n_identity_unreliable ?? 0) > 0) reasons.push(`n_identity_unreliable=${g.n_identity_unreliable}`);
  if (GATE === 'strict') for (const k of ['G2', 'G3', 'G5', 'G6', 'G7']) if (red(k)) reasons.push(`${k} rood`);
  if (reasons.length) { console.log(`\n--gate${GATE === 'strict' ? ' strict' : ''}: ROOD (${reasons.join(', ')}) → exit 1`); return 1; }
  console.log(`\n--gate${GATE === 'strict' ? ' strict' : ''}: groen → exit 0`);
  return 0;
}

async function writeJson(run, gates) {
  const items = await sql(`select question_id as id, signal_hit, assert_detail, pending_asserts, answer_correctness, lane, category, persona, route,
      caller_identified, latency_ms, cost_usd, coverage_reason, hop, attempt, (envelope_compact->>'answer_empty')::boolean answer_empty
      from public.rag_eval_results where run_id = ${q(run.id)}::uuid order by question_id`);
  const out = {
    run_id: run.id, label: run.label, suite: run.suite, status: run.status, runner_version: run.runner_version,
    created_at: run.created_at, started_at: run.started_at, finished_at: run.finished_at,
    duration_s: run.finished_at && run.started_at ? Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000) : null,
    summary: { n_questions: run.n_questions, n_results: run.n_results, pass: items.filter((i) => i.signal_hit === true).length, fail: items.filter((i) => i.signal_hit === false).length,
      na: items.filter((i) => i.signal_hit === null).length, n_pending: run.n_pending, signal_pass_rate: run.signal_pass_rate, avg_answer_correctness: run.avg_answer_correctness,
      cost_usd_total: run.cost_usd_total, p50_latency_ms: run.p50_latency_ms, p95_latency_ms: run.p95_latency_ms, persona_check_ok: run.persona_check?.ok ?? null, compare_to: run.compare_to },
    gates: gates ? Object.fromEntries(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map((k) => [k, gates[k]])) : null,
    before_run: gates?.before_run ?? null, green_to_red: gates?.green_to_red ?? null, red_to_green: gates?.red_to_green ?? null,
    n_identity_unreliable: gates?.n_identity_unreliable ?? null, assumption_honesty_rate: gates?.assumption_honesty_rate ?? null,
    by_category: gates?.by_category ?? null,
    items: items.map((i) => ({ id: i.id, hit: i.signal_hit, detail: scrub(i.assert_detail), pending: i.pending_asserts, correctness: i.answer_correctness, lane: i.lane, category: i.category,
      persona: i.persona, route: i.route, caller_identified: i.caller_identified, latency_ms: i.latency_ms, cost_usd: i.cost_usd, coverage_reason: i.coverage_reason, answer_empty: i.answer_empty, hop: i.hop, attempt: i.attempt })),
  };
  fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  console.log(`  → ${JSON_OUT}`);
}

function printRun(run) {
  const dur = run.finished_at && run.started_at ? Math.round((new Date(run.finished_at) - new Date(run.started_at)) / 1000) : null;
  console.log(`\nrun ${run.id} · ${run.label} · suite=${run.suite} · status=${run.status} · runner=${run.runner_version || '-'}`);
  console.log(`  items ${run.n_results}/${run.n_questions} · pass_rate=${fmt(run.signal_pass_rate)} · pending=${fmt(run.n_pending)} · cost=$${fmt(run.cost_usd_total)} · p50=${fmt(run.p50_latency_ms)}ms p95=${fmt(run.p95_latency_ms)}ms · duur=${dur ?? '-'}s · persona_ok=${fmt(run.persona_check?.ok)}`);
  if (run.notes) console.log(`  notes: ${String(run.notes).slice(0, 160)}`);
}

async function pollUntilDone(runId) {
  const deadline = Date.now() + MAX_MIN * 60000;
  let run = null;
  while (Date.now() < deadline) {
    run = await loadRun(runId);
    if (!run) throw new Error('run verdwenen');
    process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} status=${run.status} results=${run.n_results}/${run.n_questions} open=${run.n_open}\n`);
    if (!['queued', 'running'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 20000));
  }
  console.error(`✗ time-out na ${MAX_MIN} min; run staat nog op ${run?.status}`);
  return run;
}

(async () => {
  // ── --compare <after> <before> ────────────────────────────────────────────
  if (flag('compare')) {
    const i = argv.indexOf('--compare');
    const after = await resolveRunId(argv[i + 1]); const before = argv[i + 2] && !argv[i + 2].startsWith('--') ? await resolveRunId(argv[i + 2]) : null;
    const [{ g }] = await sql(`select public.rag_eval_compare(${q(after)}::uuid, ${before ? q(before) + '::uuid' : 'null'}) as g`);
    const run = await loadRun(after);
    printRun(run);
    console.log(`  vergeleken met ${g.before_run || '(geen vorige run)'}`);
    printGates(g);
    if (JSON_OUT) await writeJson(run, g);
    process.exit(gateExit(g, run));
  }

  // ── --status <run> ────────────────────────────────────────────────────────
  if (flag('status')) {
    const run = await loadRun(await resolveRunId(arg('status')));
    if (!run) { console.error('run niet gevonden'); process.exit(2); }
    printRun(run);
    if (run.gates) printGates(run.gates);
    if (JSON_OUT) await writeJson(run, run.gates);
    process.exit(gateExit(run.gates, run));
  }

  // ── kick ──────────────────────────────────────────────────────────────────
  const suite = arg('suite', null); const label = arg('label', null);
  if (!suite || !label) { console.error('gebruik: --suite <legacy71|rook-p0|chat-lane|full|acl|custom> --label <label> [--gate] [--json pad]'); process.exit(2); }

  // Eén run tegelijk (paper §3.5-3). De RPC weigert ook, maar hier is de melding leesbaar.
  const busy = await sql(`select id, label, started_at from public.rag_eval_runs where status = 'running' and coalesce(last_activity_at, started_at, created_at) > now() - interval '10 minutes' order by created_at desc limit 1`);
  if (busy.length && !flag('force')) { console.error(`✗ er draait al een run: ${busy[0].id} (${busy[0].label}, sinds ${busy[0].started_at}). Wacht, of --force.`); process.exit(3); }

  const body = { label, suite };
  if (arg('ids')) body.ids = arg('ids').split(',').map((s) => s.trim()).filter(Boolean);
  for (const k of ['only-tag', 'lane', 'category', 'persona', 'compare-to']) if (arg(k)) body[k.replace('-', '_')] = arg(k);
  if (flag('build-artifacts')) body.build_artifacts = true;
  if (flag('no-build-artifacts')) body.build_artifacts = false;
  if (flag('force')) body.force = true;

  const [{ s: secret }] = await sql(`select public.get_skill_secret_service('global','cron_secret') as s`);
  if (!secret) { console.error('cron_secret niet leesbaar'); process.exit(2); }
  console.log(`kick rag-eval-cron · suite=${suite} · label=${label}${body.ids ? ` · ids=${body.ids.length}` : ''}${body.compare_to ? ` · compare_to=${body.compare_to}` : ''}`);
  const r = await fetch(FN, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(400_000) });
  const txt = await r.text();
  let j = {}; try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 300) }; }
  if (r.status === 409) { console.error(`✗ run_already_running`); process.exit(3); }
  if (!r.ok || !j.run_id) { console.error(`✗ kick mislukt: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`); process.exit(4); }
  console.log(`  run_id=${j.run_id} · hop 1: ${j.n ?? 0} items (${j.lane || '-'}/${j.persona || '-'}) · persona_check_ok=${j.persona_check_ok ?? j.status}`);
  if (j.status === 'invalid_persona') {
    console.error('✗ invalid_persona: ' + JSON.stringify(j.persona_check?.personas || {}).slice(0, 600));
    const run = await loadRun(j.run_id); if (JSON_OUT) await writeJson(run, null);
    process.exit(4);
  }

  const run = await pollUntilDone(j.run_id);
  printRun(run);
  let gates = run.gates;
  if (!gates && run.status === 'done') { const [{ g }] = await sql(`select public.rag_eval_compare(${q(run.id)}::uuid, null) as g`); gates = g; }
  if (gates) printGates(gates);
  if (JSON_OUT) await writeJson(run, gates);
  if (run.status === 'failed' || run.status === 'invalid_persona') process.exit(4);
  if (run.status !== 'done') process.exit(4);
  process.exit(gateExit(gates, run));
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
