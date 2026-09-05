#!/usr/bin/env node
// =============================================================================
// agent_chat_smoke.cjs — gedragstest op rag-chat na een deploy      (WP1/2/3/4)
// =============================================================================
// Geen 200-check maar een GEDRAGS-check: raakt de wijziging wat hij moet raken?
// Per vraag wordt geasserteerd, niet alleen geprint.
//
//   SBT=<management_token> node scripts/agent_chat_smoke.cjs
//   node scripts/agent_chat_smoke.cjs --only empty     # alleen de leegte-cases
//   node scripts/agent_chat_smoke.cjs --show           # toon het antwoord
//
// Exit 0 = alle asserties groen. Exit 1 = minstens één rood.
//
// Wat hier bewaakt wordt:
//   S1  het snelle recept wordt gekozen (context_build_intent = search_fast)
//   S2  een gewone vraag krijgt fragmenten binnen het budget
//   S3  een onbeantwoordbare vraag krijgt een coverage.reason uit de vaste set
//       — G1 uit rubrics.md: geen stille leegte
//   S4  de envelop staat in het antwoord (WP4-contract)
//   S5  elke run heeft een kostenregel, ook het semantische pad (WP3)
//   S6  rag-chat blijft verify_jwt:true
//
// ⚠ PUBLIEKE REPO. De vragen hieronder zijn met opzet generiek en bevatten geen
// klantnamen. Voor een test met échte vragen: scripts/agent_retrieval_bench.cjs,
// die haalt ze op runtime uit de database.
// =============================================================================
const fs = require('fs');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;
if (!SBT) { console.error('geen management-token: zet SBT='); process.exit(2); }

const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const FN = `https://${REF}.supabase.co/functions/v1`;
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };

const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();
const SHOW = argv.includes('--show');

// Vier vragen, vier vormen. De laatste is met opzet onbeantwoordbaar: hij toetst
// of de leegte een reden krijgt in plaats van een beleefde alinea.
const CASES = [
  { id: 'semantic', tag: 'normal', q: 'Wat zijn de belangrijkste zorgen die klanten noemen over betrouwbaarheid van AI?' },
  { id: 'docs', tag: 'docs', q: 'Wat staat er in de documentatie over de architectuur van de RAG-pijplijn?' },
  { id: 'structured', tag: 'rows', q: 'Hoeveel deals staan er per fase in de Sales Pipeline?' },
  { id: 'empty', tag: 'empty', q: 'Wat is er besproken over de kwartaalcijfers van Groenlandse zeewierkwekerijen?' },
];

const results = [];
function assert(id, wat, ok, gemeten) {
  results.push({ id, wat, ok: !!ok, gemeten });
  console.log(`  ${ok ? '✅' : '❌'} ${id.padEnd(5)} ${wat}${ok ? '' : `  → gemeten: ${JSON.stringify(gemeten)}`}`);
}

async function mgmt(path, init) {
  const r = await fetch(`${MGMT}${path}`, { ...init, headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init?.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${path} ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

(async () => {
  // S6 — de vlag. Een RAG-cron-functie hoort op false, deze op true: rag-chat
  // wordt door de browser aangeroepen en callerSub() leest de `sub` uit de JWT.
  // Staat hij op false, dan valt iedereen terug op de org-baseline en ziet
  // niemand meer zijn eigen Confluence-spaces — zonder één foutmelding.
  const fns = await mgmt('/functions');
  const ragChat = fns.find((f) => f.slug === 'rag-chat');
  const ctxBuild = fns.find((f) => f.slug === 'context-build');
  assert('S6', 'rag-chat verify_jwt = true', ragChat?.verify_jwt === true, ragChat?.verify_jwt);
  assert('S6', 'context-build verify_jwt = false', ctxBuild?.verify_jwt === false, ctxBuild?.verify_jwt);

  // De legacy service_role-JWT passeert verify_jwt:true maar draagt geen `sub`
  // (role = 'service_role'), dus caller_user_id blijft null = org-baseline.
  // Precies goed voor een rookronde; voor de ACL is een échte user-JWT nodig
  // (zie scripts/confluence_acl_eval.cjs).
  const keys = await mgmt('/api-keys?reveal=true');
  const svc = keys.find((k) => k.name === 'service_role' || k.type === 'legacy' && k.name === 'service_role');
  const jwt = svc?.api_key;
  if (!jwt) { console.error('geen service_role-sleutel via /api-keys'); process.exit(2); }

  for (const c of CASES) {
    if (only && only !== c.tag) continue;
    const t0 = Date.now();
    let j = null, err = null;
    try {
      const r = await fetch(`${FN}/rag-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: jwt, ...UA },
        body: JSON.stringify({ message: c.q, stream: false }),
        signal: AbortSignal.timeout(300_000),
      });
      const txt = await r.text();
      j = JSON.parse(txt);
      if (!r.ok || !j.ok) err = `http_${r.status}: ${String(j.error || '').slice(0, 200)}`;
    } catch (e) { err = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
    const ms = Date.now() - t0;

    const env = j?.envelope || null;
    const cov = env?.coverage || j?.coverage || null;
    const dbgm = j?.debug_pipeline || {};
    console.log(`\n[${c.id}] ${ms} ms  route=${j?.analytics?.route || 'semantic'}  chunks=${j?.chunk_count ?? '?'}  recept=${dbgm.context_build_intent ?? '-'}  reden=${cov?.reason ?? '-'}${err ? `  FOUT ${err}` : ''}`);
    if (SHOW && j?.answer) console.log('  ' + String(j.answer).replace(/\n/g, '\n  ').slice(0, 900));

    assert('S0', `${c.id}: geen fout`, !err, err);
    if (err) continue;

    // S4 — het contract. Zonder envelop kan de UI geen tabel tonen en moet de
    // evalharnas weer reguliere expressies over proza leggen.
    assert('S4', `${c.id}: envelop aanwezig (v1)`, env?.version === 1, env?.version);
    assert('S4', `${c.id}: envelop draagt coverage`, !!cov && Array.isArray(cov.searched), cov);

    // S5 — kosten. Ook het semantische pad, dat vóór v5.6 nooit een bedrag kreeg.
    assert('S5', `${c.id}: kostenregel gevuld`, typeof env?.cost?.usd === 'number', env?.cost);

    if (c.tag === 'normal') {
      assert('S1', `${c.id}: recept = search_fast`, dbgm.context_build_intent === 'search_fast', dbgm.context_build_intent);
      // S2 mag NIET "er zijn fragmenten" eisen. De router kiest zelf, en een
      // trage of koude context-build hoort te escaleren naar de agent in plaats
      // van leeg terug te komen. Wat wél moet gelden: er is óf context, óf een
      // route die het overneemt, óf een reden. Nooit alle drie niet.
      const gotContext = (j.chunk_count ?? 0) > 0;
      const escalated = !!j.analytics && (j.analytics.rows || []).length >= 0 && j.analytics.route === 'agentic';
      const hasReason = !!cov?.reason;
      assert('S2', `${c.id}: context, escalatie of reden`, gotContext || escalated || hasReason,
        { chunks: j.chunk_count, route: j.analytics?.route, reason: cov?.reason });
      // Alleen als context-build daadwerkelijk antwoordde, is de klok relevant.
      if (dbgm.vector_fetch_ms != null) {
        assert('S2', `${c.id}: retrieval binnen 6 s`, dbgm.vector_fetch_ms < 6000, dbgm.vector_fetch_ms);
      } else {
        assert('S2', `${c.id}: geen stille retrieval-fout`, hasReason || gotContext || escalated,
          { vector_error: dbgm.vector_error, reason: cov?.reason });
      }
    }
    if (c.tag === 'docs') {
      assert('S1', `${c.id}: recept = search_docs`, dbgm.context_build_intent === 'search_docs', dbgm.context_build_intent);
    }
    if (c.tag === 'rows') {
      assert('S4', `${c.id}: rijen + kolommen in de envelop`, Array.isArray(env?.rows) && env.rows.length > 0 && (env.columns || []).length > 0, { rows: env?.rows?.length, cols: env?.columns?.length });
      assert('S4', `${c.id}: xlsx/csv aangeboden`, (env?.artifacts_available || []).includes('xlsx'), env?.artifacts_available);
    }
    if (c.tag === 'empty') {
      // G1 uit rubrics.md — de blokkerende poort. Een leeg antwoord ZONDER
      // reden is erger dan een fout antwoord: het ziet eruit als een feit.
      const legal = ['timeout', 'acl_filtered', 'below_threshold', 'truly_empty', 'not_tracked'];
      const empty = (j.chunk_count ?? 0) === 0 && !(j.analytics?.rows || []).length;
      if (empty) {
        assert('S3', `${c.id}: leeg antwoord draagt een reden`, legal.includes(cov?.reason), cov?.reason);
        assert('S3', `${c.id}: reden is niet 'not_tracked'`, cov?.reason && cov.reason !== 'not_tracked', cov?.reason);
      } else {
        console.log(`  ℹ️  ${c.id}: niet leeg (chunks=${j.chunk_count}) — de leegte-assertie is hier niet van toepassing`);
      }
    }
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${bad.length === 0 ? '✅ ALLES GROEN' : `❌ ${bad.length} ROOD`}  (${results.length} asserties)`);
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
