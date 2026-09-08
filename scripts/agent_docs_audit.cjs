#!/usr/bin/env node
// =============================================================================
// agent_docs_audit.cjs — is `docs/agent/` nog waar?                  (spoor 07)
// =============================================================================
//   node scripts/agent_docs_audit.cjs
//   node scripts/agent_docs_audit.cjs --range origin/main...HEAD
//
// Twaalf controles onder de codes DOC-1 … DOC-12. Eén tabel, één exit-code.
// DOC-1 t/m DOC-7 hebben alleen een checkout nodig; DOC-8 t/m DOC-12 hebben de
// database nodig en worden zonder management-token **zichtbaar overgeslagen**
// (`SKIP`), nooit stil groen. De DB-kant is los daarvan geborgd door
// `agent_docs_staleness_check()` op cron (spoor 07 item 4), want CI heeft geen
// token en een sessie draait niet elke dag.
//
// ── De exit-code ─────────────────────────────────────────────────────────────
// Alleen de BLOKKERENDE codes bepalen hem (EVAL-GATES §1, kolom "blokkerend"):
//   blokkerend      DOC-1, DOC-1b, DOC-2 … DOC-9   → `ROOD`, exit 1
//   niet-blokkerend DOC-10, DOC-11, DOC-12         → `WAARSCH`, exit blijft 0
// Die drie meten cadans en schuld (weekronde, stille cronvuring, blijvend rood
// zonder datum). Ze horen in het rapport, maar een PR van iemand anders mag er
// niet op stranden — dat is precies hoe een poort weer uitgaat (D07-7).
//
// ── Waarom de VERWACHTING uit het document komt ──────────────────────────────
// De onderzoeksprobe had de doc-waarden in zijn eigen bron staan (`low 2 30000
// 0.05 2`). Dan is het script een derde kopie die net zo goed veroudert, en
// bewijst een groene poort alleen dat script en code het eens zijn. Hier wordt
// elke verwachting uit `docs/agent/ARCHITECTURE.md` geparseerd en tegen de code
// gelegd. Kan de doc-kant niet gelezen worden, dan is dat **rood** — een
// document dat zijn eigen bewering kwijt is, is óók drift.
//
// ⚠ PUBLIEKE REPO. Deze uitvoer print id's, tellingen en bestandsnamen. Nooit
//   vraag- of antwoordtekst uit de evalbank: na placeholder-vervanging staan
//   daar klantnamen in.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const RANGE = argOf('range', process.env.DOCS_AUDIT_RANGE || 'origin/main...HEAD');
const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN || null;

const ARCH = path.join('docs', 'agent', 'ARCHITECTURE.md');
const SKILLS = path.join('docs', 'agent', 'SKILLS.md');
const TOOLS = path.join('docs', 'agent', 'TOOLS.md');
const CHANGELOG = path.join('docs', 'agent', 'CHANGELOG-AGENT.md');
const RUN_TS = path.join('supabase', 'functions', 'rag-chat', 'run.ts');
const AGENTIC_TS = path.join('supabase', 'functions', 'rag-chat', 'agentic.ts');
const COMPOSE_TS = path.join('supabase', 'functions', 'rag-chat', 'compose.ts');
const COVERAGE_JSX = path.join('src', 'components', 'views', 'zoeken', 'CoverageNote.jsx');
const EVAL_CRON = path.join('supabase', 'functions', 'rag-eval-cron', 'index.ts');

// ── Tabel ────────────────────────────────────────────────────────────────────
const BLOCKING = new Set(['DOC-1', 'DOC-1b', 'DOC-2', 'DOC-3', 'DOC-4', 'DOC-5', 'DOC-6', 'DOC-7', 'DOC-8', 'DOC-9']);
let red = 0, warn = 0, skip = 0;
const pad = (s, n) => String(s).padEnd(n);
function row(code, ok, verwacht, gemeten) {
  // ok: true | false | 'skip'
  let st;
  if (ok === 'skip') { st = 'SKIP'; skip += 1; }
  else if (ok) st = 'OK';
  else if (BLOCKING.has(code)) { st = 'ROOD'; red += 1; }
  else { st = 'WAARSCH'; warn += 1; }
  console.log(`${pad(code, 8)}${pad(st, 8)}${pad(verwacht, 36)}${gemeten}`);
}
const slurp = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// Nederlandse getalnotatie uit proza → getal. `30.000` = dertigduizend,
// `0,05` = vijf cent. Beide staan zo in ARCHITECTURE.md.
function nlNum(s) {
  const t = String(s).trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t.replace(/\./g, '').replace(',', '.'));
}
const codeNum = (s) => Number(String(s).replace(/_/g, ''));
const us = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '_'); // 30000 → 30_000

// ── Database (alleen DOC-8 … DOC-12) ─────────────────────────────────────────
async function dbq(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', 'User-Agent': 'legal-mind-dashboard-claude/1.0' },
    body: JSON.stringify({ query, read_only: true }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = JSON.parse(await r.text());
  return rows[0] ? Object.values(rows[0])[0] : null;
}

(async () => {
  console.log(`== docs/agent driftaudit · ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC · range=${RANGE} ==`);
  console.log();
  console.log(`${pad('CODE', 8)}${pad('STATUS', 8)}${pad('VERWACHT', 36)}GEMETEN`);
  console.log(`${pad('-'.repeat(7), 8)}${pad('-'.repeat(7), 8)}${pad('-'.repeat(34), 36)}${'-'.repeat(6)}`);

  const arch = slurp(ARCH);

  // ── DOC-1 · het gegenereerde bestand loopt niet achter ─────────────────────
  // Niet nagebouwd: dit is letterlijk de generator met --check (D07-10).
  const gen = spawnSync('node', [path.join('scripts', 'agent_docs_generate.cjs'), '--check'], { encoding: 'utf8' });
  const genOut = `${gen.stdout || ''}${gen.stderr || ''}`.split('\n').filter((l) => l.trim() && !/Warning|trace-warnings/.test(l))[0] || '';
  row('DOC-1', gen.status === 0, 'generate --check exit 0', `exit ${gen.status} · ${genOut.slice(0, 120)}`);

  // ── DOC-1b · …en hij is niet alleen vers, maar ook geldig ───────────────────
  // `--check` vergelijkt de generator met zichzelf en is dus blind voor een
  // generator die stil JavaScript in de tabel schrijft. Alleen `${` telt:
  // backticks zijn in markdown legitiem (43 valse positieven).
  const tools = slurp(TOOLS);
  if (tools === null) row('DOC-1b', false, '0 JS-resten in TOOLS.md', `${TOOLS} ontbreekt`);
  else {
    const leaks = tools.split('\n').filter((l) => l.includes('${'));
    row('DOC-1b', leaks.length === 0, '0 JS-resten in TOOLS.md',
      leaks.length ? `${leaks.length} regel(s): ${(leaks[0].match(/\$\{[^\s|]*/) || [''])[0]}` : '0 regels');
  }

  // ── DOC-2 · Stand-kop >= hoogste versie in het bestand zelf ────────────────
  // Vangt de helft van het bijwerken: kop met de hand mee, tekst niet — of
  // andersom. Geen oordeel nodig, alleen twee getallen uit één bestand.
  for (const f of [ARCH, SKILLS]) {
    const src = slurp(f);
    if (src === null) { row('DOC-2', false, `kop >= hoogste v in ${path.basename(f)}`, 'bestand ontbreekt'); continue; }
    const hdr = (src.match(/Stand:\s*\*{0,2}v?(1\.\d+)/) || [])[1];
    const all = [...src.matchAll(/v(1\.\d+)/g)].map((m) => Number(m[1].split('.')[1]));
    const mx = all.length ? Math.max(...all) : null;
    if (!hdr) row('DOC-2', 'skip', `kop >= hoogste v in ${path.basename(f)}`, 'geen Stand-kop');
    else row('DOC-2', mx === null || Number(hdr.split('.')[1]) >= mx, `kop >= hoogste v in ${path.basename(f)}`,
      `kop ${hdr} · in tekst 1.${mx}`);
  }

  // ── DOC-3 · coverage.reason is één gesloten verzameling op drie plekken ─────
  const setOf = (src, from, to, re) => {
    if (!src) return null;
    const a = src.indexOf(from);
    if (a < 0) return null;
    const b = src.indexOf(to, a + from.length);
    return [...src.slice(a, b < 0 ? undefined : b).matchAll(re)].map((m) => m[1]).sort().join(',');
  };
  const cA = setOf(slurp(COMPOSE_TS), 'export const COVERAGE_SENTENCE', '\n};', /^ {2}([a-z_]+):/gm);
  const cB = setOf(slurp(COVERAGE_JSX), 'const REASONS', '\n}', /^ {2}([a-z_]+):/gm);
  const cC = (() => {
    const m = arch && arch.match(/"reason":.*\/\/ of:\s*([a-z_ |]+)/);
    return m ? m[1].split('|').map((s) => s.trim()).filter(Boolean).sort().join(',') : null;
  })();
  row('DOC-3', Boolean(cA) && cA === cB && cA === cC, 'compose == CoverageNote == ARCH',
    cA && cA === cB && cA === cC ? `3 × dezelfde ${cA.split(',').length}` : `compose[${cA}] ui[${cB}] arch[${cC}]`);

  // ── DOC-4 · budgettabel §2 == DEFAULT_BUDGETS in run.ts ────────────────────
  const runTs = slurp(RUN_TS);
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const budBad = [];
  let budRead = 0;
  for (const eff of EFFORTS) {
    const d = arch && arch.match(new RegExp(`^\\|\\s*\`${eff}\`\\s*\\|\\s*([\\d.,]+)\\s*\\|\\s*([\\d.,]+)\\s*\\|\\s*([\\d.,]+)\\s*\\|\\s*([\\d.,]+)\\s*\\|`, 'm'));
    const c = runTs && runTs.match(new RegExp(`^\\s*${eff}:\\s*\\{[^}]*tool_calls:\\s*([\\d_]+)[^}]*wall_ms:\\s*([\\d_]+)[^}]*usd:\\s*([\\d._]+)[^}]*hops_max:\\s*([\\d_]+)`, 'm'));
    if (!d || !c) { budBad.push(`${eff}(${!d ? 'niet in doc' : 'niet in run.ts'})`); continue; }
    budRead += 1;
    const doc = [1, 2, 3, 4].map((i) => nlNum(d[i]));
    const code = [1, 2, 3, 4].map((i) => codeNum(c[i]));
    for (let i = 0; i < 4; i += 1) {
      if (doc[i] !== code[i]) budBad.push(`${eff}.${['tool_calls', 'wall_ms', 'usd', 'hops_max'][i]}(doc:${doc[i]}|code:${code[i]})`);
    }
  }
  row('DOC-4', budBad.length === 0 && budRead === EFFORTS.length, '5 effort-rijen × 4 waarden',
    budBad.length ? budBad.join(' ') : `${budRead * 4}/20 gelijk`);

  // ── DOC-5 · de genoemde grenzen == de code ─────────────────────────────────
  // Doc-kant: `NAAM` gevolgd door een getal met eenheid, binnen dezelfde regel.
  const docMs = (label) => {
    const m = arch && arch.match(new RegExp(`\`${label}\`[^\\n]{0,40}?([\\d.,]+)\\s*(ms|s)\\b`));
    return m ? nlNum(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
  };
  for (const name of ['CONTEXT_BUILD_TIMEOUT_MS', 'HOP_SOFT_MS', 'HOP_HARD_MS', 'COMPAT_WALL_MS']) {
    const want = docMs(name);
    const got = runTs && (runTs.match(new RegExp(`${name} = ([\\d_]+)`)) || [])[1];
    row('DOC-5', want !== null && got !== undefined && codeNum(got) === want, `${name} == doc`,
      want === null ? 'niet in ARCHITECTURE.md' : `doc ${want} · code ${got ? codeNum(got) : 'afwezig'}`);
  }
  for (const [label, re, file] of [
    ['semantic_search', /\|\s*`semantic_search` als agent-tool\s*\|\s*≤?\s*([\d.,]+)\s*(ms|s)/, AGENTIC_TS],
    ['Grok-stream per hop', /\|\s*Grok-stream per hop\s*\|\s*≤?\s*([\d.,]+)\s*(ms|s)/, COMPOSE_TS],
  ]) {
    const m = arch && arch.match(re);
    const want = m ? nlNum(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
    const src = slurp(file);
    const hit = want !== null && src ? src.includes(`${us(want)}`) : false;
    row('DOC-5', hit, `${label} == doc`,
      want === null ? 'niet in ARCHITECTURE.md' : `doc ${want} · ${us(want)} ${hit ? 'aanwezig' : 'AFWEZIG'}`);
  }

  // ── DOC-6 · één runnerversie, en die van de code ───────────────────────────
  const cronSrc = slurp(EVAL_CRON);
  const code6 = cronSrc && (cronSrc.match(/RUNNER_VERSION = "(v[\d.]+)"/) || [])[1];
  const doc6 = [...new Set([...(arch || '').matchAll(/`rag-eval-cron`\s*(v[\d.]+)/g)].map((m) => m[1]))];
  row('DOC-6', Boolean(code6) && doc6.length === 1 && doc6[0] === code6, `ARCHITECTURE noemt ${code6 || '?'}`,
    `ARCH: ${doc6.join(',') || '—'} · code: ${code6 || '—'}`);

  // ── DOC-7 · keten geraakt ⇒ regel in CHANGELOG-AGENT.md ────────────────────
  // Per PR (`origin/main...HEAD`), niet per commit: WP-commits doen code en een
  // latere commit in dezelfde PR doet de docs. Per commit gemeten is de score
  // 4 rood op 6 en 0 daarvan is echt (D07-6, M10).
  const git = spawnSync('git', ['diff', '--name-only', RANGE], { encoding: 'utf8' });
  if (git.status !== 0) {
    row('DOC-7', 'skip', 'keten ⇒ CHANGELOG-regel', `range ${RANGE} niet op te lossen`);
  } else {
    const files = git.stdout.split('\n').filter(Boolean);
    const chain = files.filter((f) => /^supabase\/functions\/(rag-chat|context-build|rag-eval-cron)\//.test(f)
      || /^supabase\/migrations\/.*(match_chunks|context_intents|agent_chat)/.test(f));
    const logged = files.includes(CHANGELOG.split(path.sep).join('/'));
    row('DOC-7', chain.length === 0 || logged, 'keten ⇒ CHANGELOG-regel',
      `${chain.length} ketenbestand(en), changelog ${logged ? 'gewijzigd' : 'NIET gewijzigd'}`);
  }

  // ── DOC-8 · geen handgeschreven banktelling (en als er één staat: kloppend) ─
  // D07-9: een getal uit een `count(*)` hoort niet in proza. Staat er geen
  // telling, dan is er niets te verouderen en is dit groen zonder database.
  const bankCount = arch && arch.match(/evalbank\*\*\s*\((\d+) items:\s*(\d+) bank \+ (\d+) legacy,\s*(\d+) `is_core`/);
  if (!bankCount) {
    row('DOC-8', true, 'geen handgeschreven telling', 'geen telling in ARCHITECTURE.md (D07-9)');
  } else if (!SBT) {
    row('DOC-8', 'skip', 'telling == live', 'telling aanwezig, geen management-token');
  } else {
    try {
      const live = await dbq("select count(*) filter (where is_active)::text || '/' || count(*) filter (where is_core)::text from public.rag_eval_questions");
      const doc = `${bankCount[1]}/${bankCount[4]}`;
      row('DOC-8', doc === live, 'telling == live', `ARCH ${doc} · live ${live}`);
    } catch (e) { row('DOC-8', 'skip', 'telling == live', `db onbereikbaar (${e.message})`); }
  }

  // ── DOC-9 … DOC-12 · de databasekant ───────────────────────────────────────
  const dbChecks = [
    ['DOC-9', '0 bankitems zonder source_hash',
      "select count(*)::text from public.rag_eval_questions where bank_version is not null and source_hash is null",
      "select coalesce(string_agg(id,' ' order by id),'-') from public.rag_eval_questions where bank_version is not null and source_hash is null",
      (n, ids) => [n === '0', `${n}${n === '0' ? '' : ` (${ids})`}`]],
    ['DOC-10', 'weekronde <= 8 dagen oud',
      "select coalesce(extract(day from now()-max(created_at))::int,999)::text from public.rag_eval_runs where status='done' and (label like 'weekly%' or label='cron-weekly')",
      "select coalesce(max(created_at)::date::text,'nooit') from public.rag_eval_runs where status='done' and (label like 'weekly%' or label='cron-weekly')",
      (age, d) => [Number(age) <= 8, `laatste ${d} (${age} d)`]],
    // pg_cron meldt alleen dat de SQL lukte. Of de edge er een run van maakte
    // staat nergens — dit is de enige controle die de stille mislukking van
    // 2026-09-06 02:30Z vindt. De runrij moet HET LABEL VAN DEZE CRON dragen,
    // anders is de check stil groen zodra een sessie in hetzelfde venster iets
    // anders draaide (exact wat er die nacht gebeurde).
    ['DOC-11', '0 vuringen zonder runrij (30 d)',
      `select count(*)::text from cron.job_run_details d join cron.job j on j.jobid=d.jobid
        where j.jobname='rag-eval-weekly' and d.start_time > now() - interval '30 days'
          and not exists (select 1 from public.rag_eval_runs r where r.label like 'weekly%'
                            and r.created_at between d.start_time and d.start_time + interval '6 hours')`,
      null, (n) => [n === '0', `${n} vuring(en) zonder runrij`]],
    // Drempel 3 runs: run-op-run-ruis is ±2 items (geheugen
    // eval-bank-route-noise), dus één rode run zegt niets over "blijvend".
    ['DOC-12', "0 blijvend rood zonder 'rood sinds'",
      `with r as (select id from public.rag_eval_runs where suite='rook-p0' and status='done' order by created_at desc limit 3),
            f as (select res.question_id, count(*) n_runs, count(*) filter (where res.signal_hit is false) n_fail
                    from public.rag_eval_results res where res.run_id in (select id from r) group by 1)
       select count(*) filter (where q.notes !~ '^rood sinds [0-9]{4}-[0-9]{2}-[0-9]{2}' or q.notes is null)::text
              || '/' || count(*)::text
         from f join public.rag_eval_questions q on q.id=f.question_id
        where f.n_fail = f.n_runs and f.n_runs = 3`,
      null, (v) => [String(v).split('/')[0] === '0', `${v} zonder datum`]],
  ];
  for (const [code, verwacht, q1, q2, judge] of dbChecks) {
    if (!SBT) { row(code, 'skip', verwacht, 'geen management-token'); continue; }
    try {
      const a = await dbq(q1);
      const b = q2 ? await dbq(q2) : null;
      const [ok, gemeten] = judge(a, b);
      row(code, ok, verwacht, gemeten);
    } catch (e) { row(code, 'skip', verwacht, `db onbereikbaar (${e.message})`); }
  }

  console.log();
  console.log(`== ${red} rood (blokkerend) · ${warn} waarschuwing · ${skip} overgeslagen ==`);
  if (warn) console.log('   WAARSCH = cadans/schuld, niet-blokkerend (EVAL-GATES P5/P6/P8) — hoort in de trendpagina, niet in een rode PR.');
  if (skip) console.log('   SKIP = geen management-token; de DB-kant is geborgd door de cron-guard (spoor 07 item 4).');
  process.exit(red === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(2); });
