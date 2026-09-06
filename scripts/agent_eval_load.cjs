#!/usr/bin/env node
// =============================================================================
// agent_eval_load.cjs — laadt de vragenbank in rag_eval_questions   (spoor 01)
// =============================================================================
//   node scripts/agent_eval_load.cjs [--dir docs/agent/vragenbank] [--placeholders <pad>]
//                                    [--dry] [--check] [--deactivate-missing] [--bank-version 1.1]
//
//   --dry     alleen het diff-rapport (nieuw / gewijzigd / ongewijzigd / ontbrekend), geen writes
//   --check   pre-flight zonder writes: DB vs schijf per id (source_hash), tellingen, 0 × '{{' → exit 0/1
//   (zonder)  valideren → placeholders → upsert in batches van 50 → kern-hash vóór/ná → tellingen
//
// Exit 0 = ok · 1 = check/hash-guard rood · 2 = validatie- of placeholderfout (niets geschreven)
//
// Wat dit script bewaakt (RESEARCH.md §3.5, EVAL-GATES S1–S4):
//   • schema.json is de wet: required, enums, id-patroon, additionalProperties:false,
//     en een assert-key die niet in het schema staat is een LAADFOUT — geen stille `pending`.
//   • {{PLACEHOLDERS}} komen uit placeholders.local.json (gitignored — de repo is PUBLIEK).
//     In regex-velden wordt de waarde ge-escaped en met woordgrenzen omgeven, anders breekt
//     "B.V." de regex en matcht "MT" in "komt". Onopgelost '{{' → abort, exit 2.
//   • Upsert alleen WHERE is_core = false: de 22 kernitems dragen de trendlijn sinds
//     2026-06-04. Vóór en ná het laden wordt sha1(question) van alle is_core-rijen vergeleken;
//     één verschil → exit 1. Dat is nog nooit gebeurd, en dát is de assertie.
//   • Nooit DELETE. Ontbrekend op schijf → alleen met --deactivate-missing is_active=false,
//     en nooit voor is_core.
//
// ⚠ PUBLIEKE REPO. Dit script print ids en tellingen, NOOIT vraagteksten — na vervanging
//   staan er klantnamen in. Zet ook geen uitvoer met --show in een commit (die vlag bestaat niet).
// =============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const DIR = arg('dir', path.join('docs', 'agent', 'vragenbank'));
const DRY = flag('dry');
const CHECK = flag('check');
const DEACTIVATE = flag('deactivate-missing');
const BANK_VERSION = arg('bank-version', '1.1');
const PLACEHOLDERS = arg('placeholders', null);
const BATCH = 50;

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');
const q = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`;
const qj = (o) => `${q(JSON.stringify(o ?? null))}::jsonb`;
const qarr = (a) => `ARRAY[${(a || []).map(q).join(',')}]::text[]`;

async function sql(query) {
  if (!SBT) throw new Error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer');
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', 'User-Agent': 'legal-mind-dashboard-claude/1.0' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// ── 1. Lezen + valideren tegen schema.json ───────────────────────────────────
const schema = JSON.parse(fs.readFileSync(path.join(DIR, 'schema.json'), 'utf8'));
const ASSERT_KEYS = new Set(Object.keys(schema.properties.asserts.properties));
const TOP_KEYS = new Set(Object.keys(schema.properties));
const ID_RE = new RegExp(schema.properties.id.pattern);
const LEGACY_PREFIX_RE = /^(A|DR|E|G|K|N|R|RFO|S|T)[0-9]*$/; // gereserveerd, nooit door de bank te claimen

function typeOk(v, t) {
  if (Array.isArray(t)) return t.some((x) => typeOk(v, x));
  if (t === 'null') return v === null;
  if (t === 'array') return Array.isArray(v);
  if (t === 'object') return v !== null && typeof v === 'object' && !Array.isArray(v);
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  return typeof v === t;
}

function validate(item, where) {
  const errs = [];
  for (const k of schema.required) if (!(k in item)) errs.push(`required ${k} ontbreekt`);
  for (const k of Object.keys(item)) if (!TOP_KEYS.has(k)) errs.push(`onbekend veld ${k}`);
  if (typeof item.id !== 'string' || !ID_RE.test(item.id)) errs.push(`id-patroon ${item.id}`);
  if (typeof item.id === 'string' && LEGACY_PREFIX_RE.test(item.id)) errs.push(`id ${item.id} gebruikt een gereserveerde legacy-prefix`);
  for (const [k, def] of Object.entries(schema.properties)) {
    if (!(k in item) || k === 'asserts') continue;
    const v = item[k];
    if (def.enum && !def.enum.includes(v)) errs.push(`${k}=${JSON.stringify(v)} niet in enum`);
    if (def.type && !typeOk(v, def.type)) errs.push(`${k} heeft type ${typeof v}, verwacht ${JSON.stringify(def.type)}`);
    if (k === 'question' && typeof v === 'string' && v.length < (def.minLength || 0)) errs.push('question te kort');
    if (k === 'history' && Array.isArray(v)) {
      for (const h of v) {
        if (!h || typeof h !== 'object' || !['user', 'assistant'].includes(h.role) || typeof h.content !== 'string') errs.push('history-element ongeldig');
      }
    }
    if (k === 'tags' && Array.isArray(v) && v.some((t) => typeof t !== 'string')) errs.push('tags moeten strings zijn');
  }
  if (item.is_core === true) errs.push('is_core=true hoort niet in de bank');
  const a = item.asserts || {};
  if (a !== null && (typeof a !== 'object' || Array.isArray(a))) errs.push('asserts moet een object zijn');
  for (const [k, v] of Object.entries(a)) {
    if (!ASSERT_KEYS.has(k)) { errs.push(`onbekende assert-key ${k}`); continue; }
    const def = schema.properties.asserts.properties[k];
    if (def.enum && !def.enum.includes(v)) errs.push(`assert ${k}=${JSON.stringify(v)} niet in enum`);
    if (def.type && !typeOk(v, def.type)) errs.push(`assert ${k} type ${typeof v}, verwacht ${def.type}`);
    if (def.type === 'array' && def.items?.type && !v.every((x) => typeOk(x, def.items.type))) errs.push(`assert ${k}: elementen niet ${def.items.type}`);
  }
  return errs.map((e) => `${where}: ${e}`);
}

const files = fs.readdirSync(path.join(DIR, 'questions')).filter((f) => f.endsWith('.jsonl')).sort();
const raw = []; // { item, line, file, lineNo }
const errors = [];
for (const f of files) {
  const lines = fs.readFileSync(path.join(DIR, 'questions', f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let item;
    try { item = JSON.parse(line); } catch (e) { errors.push(`${f}:${i + 1}: geen geldige JSON (${e.message})`); return; }
    errors.push(...validate(item, `${f}:${i + 1} ${item?.id ?? '?'}`));
    raw.push({ item, line, file: f, lineNo: i + 1 });
  });
}
const seen = new Map();
for (const r of raw) {
  if (seen.has(r.item.id)) errors.push(`${r.file}:${r.lineNo}: dubbel id ${r.item.id} (ook in ${seen.get(r.item.id)})`);
  seen.set(r.item.id, `${r.file}:${r.lineNo}`);
}
console.log(`bank: ${files.length} bestanden, ${raw.length} items, ${errors.length} validatiefouten`);
if (errors.length) {
  for (const e of errors.slice(0, 40)) console.error('  ✗ ' + e);
  if (errors.length > 40) console.error(`  … en ${errors.length - 40} meer`);
  process.exit(2);
}
console.log(`  ✓ ${raw.length}/${raw.length} schema-valid`);

// ── 2. Placeholders ──────────────────────────────────────────────────────────
const phPath = PLACEHOLDERS
  || [path.join(DIR, 'placeholders.local.json'), '/workspace/security/agent-eval/placeholders.local.json'].find((p) => fs.existsSync(p));
if (!phPath) { console.error('geen placeholders.local.json gevonden (--placeholders <pad>)'); process.exit(2); }
const ph = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(phPath, 'utf8'))).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string'));
const PH_RE = /\{\{([A-Z_0-9]+)\}\}/g;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Woordgrenzen die óók werken als de waarde op leesteken eindigt ("B.V.") — \b doet dat niet.
const regexValue = (v) => `(?<!\\w)${escapeRegex(v)}(?!\\w)`;
const unresolved = new Set();
function fill(s, mode) {
  if (typeof s !== 'string') return s;
  return s.replace(PH_RE, (m, key) => {
    if (!(key in ph)) { unresolved.add(key); return m; }
    return mode === 'regex' ? regexValue(ph[key]) : ph[key];
  });
}
const REGEX_ASSERTS = ['answer_must_match_regex', 'answer_must_not_match_regex', 'must_match_regex'];
const LITERAL_ARRAY_ASSERTS = ['required_entities', 'forbidden_entities', 'expect_sources_include_space', 'expect_sources_exclude_space'];
function resolve(item) {
  const out = JSON.parse(JSON.stringify(item));
  out.question = fill(out.question, 'literal');
  if (Array.isArray(out.history)) out.history = out.history.map((h) => ({ ...h, content: fill(h.content, 'literal') }));
  if (typeof out.expected_answer === 'string') out.expected_answer = fill(out.expected_answer, 'literal');
  if (typeof out.expect_signal === 'string') out.expect_signal = fill(out.expect_signal, 'literal');
  const a = out.asserts || {};
  for (const k of REGEX_ASSERTS) if (typeof a[k] === 'string') a[k] = fill(a[k], 'regex');
  for (const k of LITERAL_ARRAY_ASSERTS) if (Array.isArray(a[k])) a[k] = a[k].map((x) => fill(x, 'literal'));
  out.asserts = a;
  if (JSON.stringify(out).includes('{{')) {
    for (const m of JSON.stringify(out).matchAll(PH_RE)) unresolved.add(m[1]);
  }
  return out;
}
const items = raw.map((r) => ({ ...r, resolved: resolve(r.item), hash: sha1(r.line) }));
if (unresolved.size) {
  console.error(`✗ onopgeloste placeholders: ${[...unresolved].sort().join(', ')} — vul ${path.basename(phPath)} aan`);
  process.exit(2);
}
console.log(`  ✓ placeholders uit ${phPath} — ${Object.keys(ph).length} sleutels, 0 onopgelost`);

// ── 3. Afleidingen naar de legacy-kolommen ───────────────────────────────────
function toRow(x) {
  const it = x.resolved;
  const lane = it.lane;
  const a = it.asserts || {};
  const opts = it.options || {};
  const qtype = lane === 'chat' ? 'analytical' : (a.expect_no_context === true ? 'negative' : 'functional');
  const intent = typeof opts.intent === 'string' ? opts.intent
    : (lane === 'retrieval' ? (it.category === 'wiki' ? 'search_docs' : 'search_fast') : 'search');
  return {
    id: it.id, question: it.question, dimension: it.category, category: it.category, lane, persona: it.persona || 'jelle',
    history: it.history || [], depth: it.difficulty || 'midden', intent, skill: 'zoeken', qtype, is_core: false,
    is_active: it.is_active !== false, expected_answer: it.expected_answer ?? null, expect_signal: it.expect_signal,
    ground_truth_status: it.ground_truth_status || 'todo', asserts: a, options: opts, tags: it.tags || [],
    notes: it.notes ?? null, bank_version: BANK_VERSION, source_hash: x.hash,
  };
}
const rows = items.map(toRow);

(async () => {
  // ── 4. Stand in de DB ──────────────────────────────────────────────────────
  const db = await sql(`select id, is_core, is_active, source_hash, bank_version from public.rag_eval_questions order by id`);
  const dbById = new Map(db.map((r) => [r.id, r]));
  const coreBefore = await sql(`select id, encode(digest(question, 'sha1'), 'hex') h from public.rag_eval_questions where is_core order by id`);
  const nCore = coreBefore.length;

  const isNew = rows.filter((r) => !dbById.has(r.id));
  const changed = rows.filter((r) => dbById.has(r.id) && dbById.get(r.id).source_hash !== r.source_hash);
  const same = rows.filter((r) => dbById.has(r.id) && dbById.get(r.id).source_hash === r.source_hash);
  const onDiskIds = new Set(rows.map((r) => r.id));
  const missing = db.filter((r) => !r.is_core && r.bank_version != null && !onDiskIds.has(r.id));
  const coreCollision = rows.filter((r) => dbById.get(r.id)?.is_core);
  console.log(`diff: ${isNew.length} nieuw · ${changed.length} gewijzigd · ${same.length} ongewijzigd · ${missing.length} in DB maar niet op schijf${coreCollision.length ? ` · ${coreCollision.length} BOTSING MET is_core: ${coreCollision.map((r) => r.id).join(' ')}` : ''}`);
  if (coreCollision.length) { console.error('✗ een bank-id valt op een is_core-rij — nieuw id kiezen'); process.exit(1); }

  if (CHECK) {
    const legacyActive = db.filter((r) => r.bank_version == null && r.is_active).length;
    const [c] = await sql(`select count(*) filter (where is_active)::int n_active, count(*) filter (where is_core)::int n_core,
      count(*) filter (where question like '%{{%' or history::text like '%{{%' or asserts::text like '%{{%' or coalesce(expected_answer,'') like '%{{%')::int n_placeholders
      from public.rag_eval_questions`);
    const expectActive = rows.filter((r) => r.is_active).length + legacyActive;
    const checks = [
      ['S1 actief = bank + legacy', c.n_active === expectActive, `${c.n_active} (verwacht ${rows.filter((r) => r.is_active).length} + ${legacyActive} = ${expectActive})`],
      ['S2 geen placeholder over', c.n_placeholders === 0, String(c.n_placeholders)],
      ['S3 kern ongewijzigd in aantal', c.n_core === 22, `${c.n_core} (verwacht 22)`],
      ['S4 dubbele ids op schijf', true, '0'],
      ['S4 schijf == DB (source_hash)', isNew.length === 0 && changed.length === 0, `${isNew.length} nieuw, ${changed.length} gewijzigd`],
      ['S4 ontbrekend op schijf', missing.length === 0, missing.length ? missing.map((r) => r.id).join(' ') : '0'],
    ];
    let ok = true;
    for (const [naam, pass, gemeten] of checks) { ok = ok && pass; console.log(`  ${pass ? 'OK  ' : 'ROOD'} ${naam.padEnd(34)} ${gemeten}`); }
    console.log(ok ? 'check: groen (exit 0)' : 'check: rood (exit 1)');
    process.exit(ok ? 0 : 1);
  }

  if (DRY) {
    if (isNew.length) console.log('  nieuw:     ' + isNew.map((r) => r.id).join(' '));
    if (changed.length) console.log('  gewijzigd: ' + changed.map((r) => r.id).join(' '));
    if (missing.length) console.log('  ontbreekt: ' + missing.map((r) => r.id).join(' ') + (DEACTIVATE ? ' → zou is_active=false krijgen' : ''));
    console.log(`kern: ${nCore} is_core-rijen, hash-guard actief. --dry: niets geschreven (exit 0)`);
    process.exit(0);
  }

  // ── 5. Upsert in batches van 50, alleen WHERE is_core = false ──────────────
  const cols = ['id', 'question', 'dimension', 'category', 'lane', 'persona', 'history', 'depth', 'intent', 'skill', 'qtype', 'is_core', 'is_active',
    'expected_answer', 'expect_signal', 'ground_truth_status', 'asserts', 'options', 'tags', 'notes', 'bank_version', 'source_hash'];
  const val = (r) => `(${q(r.id)},${q(r.question)},${q(r.dimension)},${q(r.category)},${q(r.lane)},${q(r.persona)},${qj(r.history)},${q(r.depth)},${q(r.intent)},${q(r.skill)},${q(r.qtype)},false,${r.is_active},${q(r.expected_answer)},${q(r.expect_signal)},${q(r.ground_truth_status)},${qj(r.asserts)},${qj(r.options)},${qarr(r.tags)},${q(r.notes)},${q(r.bank_version)},${q(r.source_hash)})`;
  const toWrite = [...isNew, ...changed];
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = toWrite.slice(i, i + BATCH);
    const stmt = `INSERT INTO public.rag_eval_questions (${cols.join(',')}) VALUES\n${batch.map(val).join(',\n')}
      ON CONFLICT (id) DO UPDATE SET
        question = EXCLUDED.question, dimension = EXCLUDED.dimension, category = EXCLUDED.category, lane = EXCLUDED.lane,
        persona = EXCLUDED.persona, history = EXCLUDED.history, depth = EXCLUDED.depth, intent = EXCLUDED.intent,
        qtype = EXCLUDED.qtype, is_active = EXCLUDED.is_active, expected_answer = EXCLUDED.expected_answer,
        expect_signal = EXCLUDED.expect_signal, ground_truth_status = EXCLUDED.ground_truth_status,
        asserts = EXCLUDED.asserts, options = EXCLUDED.options, tags = EXCLUDED.tags, notes = EXCLUDED.notes,
        bank_version = EXCLUDED.bank_version, source_hash = EXCLUDED.source_hash, updated_at = now()
      WHERE public.rag_eval_questions.is_core = false
      RETURNING id`;
    const res = await sql(stmt);
    written += res.length;
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: ${res.length}/${batch.length} geschreven`);
  }
  let deactivated = 0;
  if (DEACTIVATE && missing.length) {
    const res = await sql(`UPDATE public.rag_eval_questions SET is_active = false, updated_at = now() WHERE is_core = false AND id IN (${missing.map((r) => q(r.id)).join(',')}) RETURNING id`);
    deactivated = res.length;
    console.log(`  gedeactiveerd (niet op schijf): ${res.map((r) => r.id).join(' ')}`);
  }

  // ── 6. Kern-hash-guard + tellingen ─────────────────────────────────────────
  const coreAfter = await sql(`select id, encode(digest(question, 'sha1'), 'hex') h from public.rag_eval_questions where is_core order by id`);
  const beforeMap = new Map(coreBefore.map((r) => [r.id, r.h]));
  const drift = coreAfter.filter((r) => beforeMap.get(r.id) !== r.h).map((r) => r.id);
  const [c] = await sql(`select count(*) filter (where is_active)::int n_active, count(*) filter (where is_core)::int n_core,
      count(*) filter (where question like '%{{%' or history::text like '%{{%' or asserts::text like '%{{%' or coalesce(expected_answer,'') like '%{{%')::int n_placeholders,
      count(*) filter (where bank_version is not null)::int n_bank from public.rag_eval_questions`);
  console.log(`geladen: ${written} geschreven, ${deactivated} gedeactiveerd · DB: ${c.n_active} actief, ${c.n_bank} bank, ${c.n_core} kern, ${c.n_placeholders} × '{{'`);
  console.log(`kern-hash: ${coreBefore.length} vóór / ${coreAfter.length} ná, ${drift.length} verschillen${drift.length ? ' — ' + drift.join(' ') : ''}`);
  if (drift.length || coreBefore.length !== coreAfter.length) { console.error('✗ KERN GERAAKT — dit mag nooit; onderzoek vóór je iets anders doet'); process.exit(1); }
  if (c.n_placeholders > 0) { console.error('✗ placeholders in de DB'); process.exit(1); }
  console.log('load: groen (exit 0)');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
