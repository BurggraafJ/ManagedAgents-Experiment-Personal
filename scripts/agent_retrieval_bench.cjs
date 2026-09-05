#!/usr/bin/env node
// =============================================================================
// agent_retrieval_bench.cjs — meet het retrieval-budget van de chat   (WP0/WP1)
// =============================================================================
// Roept `context-build` aan met EXACT de parameters die `rag-chat` stuurt en
// rapporteert p50/p95, het aantal lege bundels en de vector-fouten. Draai hem
// één keer vóór en één keer ná een wijziging aan het recept.
//
//   node scripts/agent_retrieval_bench.cjs                      # intent=search (baseline)
//   node scripts/agent_retrieval_bench.cjs --intent search_fast # het lichte recept
//   node scripts/agent_retrieval_bench.cjs --n 20 --json out.json
//   node scripts/agent_retrieval_bench.cjs --gate 3000          # exit 1 als p95 > 3000 ms
//
// Auth: SBT=<management_token>, of ~/.claude/supabase-mcp.json, of
// $SUPABASE_ACCESS_TOKEN. Het cron_secret komt uit Vault via de RPC — het
// wordt nooit geprint.
//
// ⚠ PUBLIEKE REPO. De vragen staan NIET in dit bestand: ze worden op runtime uit
// `rag_chat_query_log` gehaald (echte vragen bevatten klantnamen). De uitvoer
// toont per vraag alleen een korte hash + lengte; `--show` zet de volledige
// tekst aan voor lokaal debuggen. Plak `--show`-uitvoer nooit in een commit.
//
// ⚠ Meet retrieval NOOIT met een chunk-embedding uit bron A terwijl je op bron
// B filtert — een gefilterde HNSW-zoekactie geeft dan nul, en dat is geen bug.
// Dit script embed altijd de vraagtekst zelf (via context-build) en laat het
// bronfilter aan het recept over.
// =============================================================================
const fs = require('fs');
const crypto = require('crypto');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;
if (!SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }

const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const FN = `https://${REF}.supabase.co/functions/v1`;
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const INTENT = arg('intent', 'search');
const N = Number(arg('n', 20));
const GATE_MS = arg('gate', null) ? Number(arg('gate')) : null;
const JSON_OUT = arg('json', null);
const SHOW = flag('show');
const LABEL = arg('label', `bench-${INTENT}`);
// rag-chat's eigen grens: alles daarboven komt bij de gebruiker aan als 0 fragmenten.
const CHAT_TIMEOUT_MS = Number(arg('chat-timeout', 6000));

async function sql(query) {
  const r = await fetch(`${MGMT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const qid = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

(async () => {
  const [{ secret }] = await sql(`select get_skill_secret_service('global','cron_secret') as secret`);
  if (!secret) { console.error('cron_secret niet in Vault'); process.exit(2); }

  // Echte vragen, niet bedachte. Alleen vragen die het semantische pad raken of
  // zouden raken (structured/sweep slaan context-build over), gededupliceerd.
  const rows = await sql(`
    select distinct on (lower(question)) question
    from rag_chat_query_log
    where asked_at > now() - interval '120 days'
      and length(question) between 12 and 220
      and route in ('semantic','agentic')
    order by lower(question), asked_at desc
    limit ${Math.max(1, Math.min(60, N))}`);
  const questions = rows.map((r) => r.question);
  if (!questions.length) { console.error('geen vragen in rag_chat_query_log'); process.exit(2); }

  console.log(`\n=== retrieval-bench · intent=${INTENT} · n=${questions.length} · ${new Date().toISOString()} ===\n`);

  const results = [];
  for (const q of questions) {
    // Exact de aanroep uit rag-chat/index.ts (cbOptions).
    const body = {
      intent: INTENT, audience: 'rag-chat-bench', trigger_type: 'eval', trigger_id: null,
      query_text: q, caller_user_id: null,
      options: {
        top_k: Number(arg('top-k', 60)), filter_sources: null, min_similarity: Number(arg('min-sim', 0.30)),
        ...(flag('no-rerank') ? { enable_rerank: false } : {}),
        ...(flag('no-rewrite') ? { rewrite: false } : {}),
        ...(flag('no-entity') ? { resolve_entity: false } : {}),
        ...(flag('async-bundle') ? { async_bundle: true } : {}),
      },
    };
    const t0 = Date.now();
    let out = { n: 0, err: null, meta: null };
    try {
      const r = await fetch(`${FN}/context-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, ...UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) out.err = `http_${r.status}: ${String(j.error || '').slice(0, 120)}`;
      else { out.n = j.match_count ?? (j.matches || []).length; out.meta = j.retrieval_meta || null; }
    } catch (e) { out.err = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
    const ms = Date.now() - t0;
    const rec = {
      id: qid(q), len: q.length, ms, n: out.n,
      build_ms: out.meta?.timing_ms?.total ?? null,
      search_ms: out.meta?.timing_ms?.search ?? null,
      rerank_ms: out.meta?.timing_ms?.rerank ?? null,
      embed_ms: out.meta?.timing_ms?.embed ?? null,
      strategy: out.meta?.strategy ?? null,
      hyde: out.meta?.hyde?.n_queries ?? null,
      rerank_applied: out.meta?.rerank_applied ?? null,
      filter_sources: out.meta?.filter_sources ?? null,
      vector_errors: out.meta?.vector_errors ?? [],
      over_chat_budget: ms > CHAT_TIMEOUT_MS,
      error: out.err,
      ...(SHOW ? { question: q } : {}),
    };
    results.push(rec);
    const badge = rec.error ? '✗' : rec.n === 0 ? '∅' : rec.over_chat_budget ? '⏱' : '✓';
    console.log(
      `${badge} ${rec.id} ${String(ms).padStart(6)}ms  n=${String(rec.n).padStart(2)}  ` +
      `${(rec.strategy || '-').padEnd(30)} ${rec.vector_errors.length ? `vec_err=${rec.vector_errors.length}` : ''}` +
      `${rec.error ? ` ${rec.error}` : ''}${SHOW ? `  « ${q.slice(0, 70)}` : ''}`,
    );
  }

  const lat = results.map((r) => r.ms);
  const empties = results.filter((r) => !r.error && r.n === 0);
  const overs = results.filter((r) => r.over_chat_budget);
  const vecErrs = results.filter((r) => r.vector_errors.length > 0);
  const summary = {
    label: LABEL, intent: INTENT, n: results.length, at: new Date().toISOString(),
    p50_ms: pct(lat, 0.5), p95_ms: pct(lat, 0.95), max_ms: Math.max(...lat),
    avg_ms: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length),
    empty_bundles: empties.length, empty_pct: Math.round((empties.length / results.length) * 100),
    over_chat_budget: overs.length, over_pct: Math.round((overs.length / results.length) * 100),
    vector_error_runs: vecErrs.length,
    errors: results.filter((r) => r.error).length,
    chat_timeout_ms: CHAT_TIMEOUT_MS,
  };

  console.log(`\n--- samenvatting (${LABEL}) ---`);
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(20)} ${v}`);
  if (vecErrs.length) {
    console.log('\n  vector_errors:');
    for (const r of vecErrs) for (const e of r.vector_errors) console.log(`    ${r.id}  ${String(e).slice(0, 140)}`);
  }

  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, results }, null, 2)); console.log(`\n  → ${JSON_OUT}`); }

  if (GATE_MS != null) {
    const ok = summary.p95_ms <= GATE_MS;
    console.log(`\n  poort p95 ≤ ${GATE_MS} ms: ${ok ? 'GROEN' : 'ROOD'} (p95 = ${summary.p95_ms} ms)`);
    process.exit(ok ? 0 : 1);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
