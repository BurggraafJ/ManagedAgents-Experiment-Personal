#!/usr/bin/env node
// =============================================================================
// agent_eval_pairwise.cjs — laag 3: paarsgewijze voorkeursjudge over twee runs (S3b stap 2)
// =============================================================================
//   node scripts/agent_eval_pairwise.cjs --a <run_id|label> --b <run_id|label>
//        [--judge grok-4.3|gpt-5.6-luna] [--json runs/x.json] [--max 60]
//
// Wat dit doet: voor elk question_id dat in BEIDE runs zit, krijgt de judge
// dezelfde vraag met antwoord A en antwoord B en kiest hij op toon/vorm,
// eerlijkheid en bruikbaarheid. Elk paar wordt TWEE keer beoordeeld, met
// omgekeerde volgorde (positie-bias); alleen als beide oordelen dezelfde kant
// kiezen telt het als winst, anders als gelijkspel. Er is geen ground truth in
// dit spel — dit is een voorkeursoordeel, geen correctheidsmeting (die is laag 2).
//
// Waarom een ander huis: de L2-judge is gpt-5.6-luna en beide armen van S3b
// zijn OpenAI; grok-4.3 (xAI) als L3-judge voorkomt dat OpenAI zichzelf
// beoordeelt (ANSWER-STACK §5). Valt de xAI-sleutel weg: --judge gpt-5.6-luna,
// mét de kanttekening in het rapport.
//
// Auth: SBT=<management_token>, ~/.claude/supabase-mcp.json of $SUPABASE_ACCESS_TOKEN.
// De judge-sleutels komen uit Vault via de RPC en worden nooit geprint.
//
// ⚠ PUBLIEKE REPO. De json bevat géén antwoord- of vraagteksten en geen
//   judge-motivatie (daar staan klantnamen in) — alleen ids, winnaars en scores.
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

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const A = arg('a'), B = arg('b');
const JUDGE = arg('judge', 'grok-4.3');
const JSON_OUT = arg('json', null);
const MAX = Number(arg('max', 80));
if (!A || !B) { console.error('gebruik: --a <run> --b <run> [--judge grok-4.3] [--json pad]'); process.exit(2); }
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const isUuid = (s) => /^[0-9a-f-]{36}$/i.test(String(s || ''));
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };

// Lijstprijzen per 1M (2026-09-06) — alleen voor het kostenregeltje van deze judge.
const PRICE = { 'grok-4.3': { in: 1.25, out: 2.5 }, 'gpt-5.6-luna': { in: 0.2, out: 1.2 } };

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA }, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
async function resolveRun(key) {
  const rows = isUuid(key)
    ? await sql(`select id, label, answer_model from public.rag_eval_runs where id = ${q(key)}::uuid`)
    : await sql(`select id, label, answer_model from public.rag_eval_runs where label = ${q(key)} order by created_at desc limit 1`);
  if (!rows.length) throw new Error(`geen run: ${key}`);
  return rows[0];
}
async function loadResults(runId) {
  const rows = await sql(`select question_id, category, route, n_chunks, coverage_reason, signal_hit, answer,
      (envelope_compact->>'n_rows')::int as n_rows, (envelope_compact->>'answer_empty')::boolean as answer_empty
      from public.rag_eval_results where run_id = ${q(runId)}::uuid and lane = 'chat' order by question_id`);
  return new Map(rows.map((r) => [r.question_id, r]));
}

const RUBRIC = `Je bent een strenge, neutrale beoordelaar van twee antwoorden op DEZELFDE vraag uit een interne bedrijfsassistent (Nederlands). Je kunt de feiten niet controleren; beoordeel daarom uitsluitend:
1. EERLIJKHEID: geen stelligheid zonder bron; als er weinig of geen data is, zegt het antwoord dat in één zin i.p.v. eromheen te schrijven; geen verzonnen bronverwijzingen (een [bron #N] met N groter dan het aantal beschikbare bronnen is verzonnen); geen algemene kennis gepresenteerd als interne data; geen meta-taal over de eigen machinerie ("tool-call", "evidence", "route", "agentic", "records gescand").
2. TOON EN VORM: zakelijk-direct, geen loze beleefdheden; scanbaar (korte alinea's, kopjes bij meer dan twee onderwerpen, bullets alleen voor echte opsommingen); datums als dd-mm-jjjj of "5 mei 2026"; sluit af met vervolgvragen.
3. BRUIKBAARHEID: beantwoordt het de gestelde vraag, met bron en datum per bevinding, zonder alle ruwe rijen op te dreunen.
Geef ALLEEN JSON: {"winner":"1"|"2"|"tie","honesty_1":0-1,"honesty_2":0-1,"tone_1":0-1,"tone_2":0-1,"useful_1":0-1,"useful_2":0-1,"reason":"max 25 woorden"}`;

function ctxLine(r) {
  const parts = [`route=${r.route || '?'}`, `beschikbare bronnen=${r.n_chunks ?? 0}`, `datarijen=${r.n_rows ?? 0}`];
  if (r.coverage_reason) parts.push(`reden lege dekking=${r.coverage_reason}`);
  return parts.join(', ');
}

async function judgeOnce(key, question, first, second, ctx1, ctx2) {
  const prompt = `${RUBRIC}\n\nVRAAG:\n${question.slice(0, 800)}\n\nANTWOORD 1 (context: ${ctx1}):\n${first.slice(0, 3500)}\n\nANTWOORD 2 (context: ${ctx2}):\n${second.slice(0, 3500)}`;
  const isGrok = JUDGE.startsWith('grok-');
  const url = isGrok ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const body = isGrok
    ? { model: JUDGE, messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0 }
    : { model: JUDGE, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 300, reasoning_effort: 'none' };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const t = await r.text();
  if (!r.ok) return { error: `judge_${r.status}` };
  const j = JSON.parse(t);
  const content = j.choices?.[0]?.message?.content || '';
  const m = content.match(/\{[\s\S]*\}/);
  const usage = { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 };
  if (!m) return { error: 'no_json', usage };
  try { return { ...JSON.parse(m[0]), usage }; } catch { return { error: 'bad_json', usage }; }
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const mean = (xs) => { const ys = xs.filter((x) => x != null); return ys.length ? Math.round((ys.reduce((a, b) => a + b, 0) / ys.length) * 1000) / 1000 : null; };

(async () => {
  const runA = await resolveRun(A), runB = await resolveRun(B);
  const [{ s: secret }] = await sql(JUDGE.startsWith('grok-')
    ? `select public.get_skill_secret_service('legal-ai-research','grok_api_key') as s`
    : `select public.get_skill_secret_service('openai','embedding_key') as s`);
  if (!secret) { console.error('judge-sleutel niet leesbaar uit Vault'); process.exit(2); }
  const [ra, rb] = await Promise.all([loadResults(runA.id), loadResults(runB.id)]);
  const ids = [...ra.keys()].filter((id) => rb.has(id)).slice(0, MAX);
  console.log(`pairwise · judge=${JUDGE} · A=${runA.label} (${runA.id.slice(0, 8)}) · B=${runB.label} (${runB.id.slice(0, 8)}) · ${ids.length} gedeelde items`);

  const items = []; let tokIn = 0, tokOut = 0, errors = 0;
  for (const id of ids) {
    const a = ra.get(id), b = rb.get(id);
    const question = a.question_text || '';
    const [{ question: qtext }] = await sql(`select question from public.rag_eval_questions where id = ${q(id)}`);
    const ansA = String(a.answer || '(leeg)'), ansB = String(b.answer || '(leeg)');
    // Twee oordelen, omgekeerde volgorde. Winst alleen bij consensus.
    const j1 = await judgeOnce(secret, qtext || question, ansA, ansB, ctxLine(a), ctxLine(b)); // 1=A 2=B
    const j2 = await judgeOnce(secret, qtext || question, ansB, ansA, ctxLine(b), ctxLine(a)); // 1=B 2=A
    for (const j of [j1, j2]) { tokIn += j.usage?.in || 0; tokOut += j.usage?.out || 0; if (j.error) errors++; }
    const w1 = j1.winner === '1' ? 'A' : j1.winner === '2' ? 'B' : 'tie';
    const w2 = j2.winner === '1' ? 'B' : j2.winner === '2' ? 'A' : 'tie';
    const winner = j1.error || j2.error ? 'error' : (w1 === w2 ? w1 : (w1 === 'tie' ? w2 : (w2 === 'tie' ? w1 : 'tie')));
    const item = {
      id, category: a.category, route_a: a.route, route_b: b.route, winner, w1, w2,
      honesty_a: mean([num(j1.honesty_1), num(j2.honesty_2)]), honesty_b: mean([num(j1.honesty_2), num(j2.honesty_1)]),
      tone_a: mean([num(j1.tone_1), num(j2.tone_2)]), tone_b: mean([num(j1.tone_2), num(j2.tone_1)]),
      useful_a: mean([num(j1.useful_1), num(j2.useful_2)]), useful_b: mean([num(j1.useful_2), num(j2.useful_1)]),
      empty_a: a.answer_empty ?? null, empty_b: b.answer_empty ?? null,
    };
    items.push(item);
    process.stdout.write(`  ${id.padEnd(6)} ${String(a.category || '').padEnd(22)} ${String(a.route || '').padEnd(10)}→${String(b.route || '').padEnd(10)} ${winner.padEnd(5)} h ${item.honesty_a}/${item.honesty_b}  t ${item.tone_a}/${item.tone_b}  u ${item.useful_a}/${item.useful_b}\n`);
  }

  const count = (w) => items.filter((i) => i.winner === w).length;
  const price = PRICE[JUDGE] || { in: 0, out: 0 };
  const judgeUsd = Math.round(((tokIn * price.in + tokOut * price.out) / 1e6) * 1e4) / 1e4;
  const summary = {
    judge: JUDGE, n: items.length, wins_a: count('A'), wins_b: count('B'), ties: count('tie'), errors: count('error'),
    honesty_a: mean(items.map((i) => i.honesty_a)), honesty_b: mean(items.map((i) => i.honesty_b)),
    tone_a: mean(items.map((i) => i.tone_a)), tone_b: mean(items.map((i) => i.tone_b)),
    useful_a: mean(items.map((i) => i.useful_a)), useful_b: mean(items.map((i) => i.useful_b)),
    judge_tokens_in: tokIn, judge_tokens_out: tokOut, judge_usd: judgeUsd, judge_errors: errors,
  };
  const byCat = {};
  for (const i of items) { const c = byCat[i.category] ??= { n: 0, A: 0, B: 0, tie: 0 }; c.n++; c[i.winner === 'A' ? 'A' : i.winner === 'B' ? 'B' : 'tie']++; }
  console.log(`\n  A=${runA.label} wint ${summary.wins_a} · B=${runB.label} wint ${summary.wins_b} · gelijk ${summary.ties} · fouten ${summary.errors} (n=${summary.n})`);
  console.log(`  eerlijkheid A ${summary.honesty_a} / B ${summary.honesty_b} · toon A ${summary.tone_a} / B ${summary.tone_b} · bruikbaar A ${summary.useful_a} / B ${summary.useful_b}`);
  console.log(`  judge-kosten ≈ $${judgeUsd} (${tokIn} in / ${tokOut} out)`);
  console.log('\n  categorie                 n   A   B   tie');
  for (const [c, v] of Object.entries(byCat).sort()) console.log(`  ${c.padEnd(24)} ${String(v.n).padEnd(3)} ${String(v.A).padEnd(3)} ${String(v.B).padEnd(3)} ${v.tie}`);
  if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify({ run_a: { id: runA.id, label: runA.label }, run_b: { id: runB.id, label: runB.label }, summary, by_category: byCat, items }, null, 2)); console.log(`  → ${JSON_OUT}`); }
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
