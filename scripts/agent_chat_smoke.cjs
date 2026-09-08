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
//   S7  de run-modus levert een rij die op `done` eindigt (spoor 02 I2)
//   S8  een verbroken verbinding verliest geen antwoord — poort T2, blokkerend
//   S9  owner-only op tabel én publicatie, met positieve controle — poort T3
//   S10 elke vraag heeft een run-rij — poort T1
//   S11 de waakhond leeft en er hangt niets vast
//   S29 organisatiekennis komt aan: het blok heeft omvang, er is niets stil
//       afgekapt, en op de structured route noemt de naad de gebonden tool
//       — spoor 04 PR-A, poort K6
//   S30 de werkwijzen-ACL is fail-closed op het pad dat de chat loopt:
//       app_skills_visible(null) levert 0 rijen buiten scope=org — spoor 04
//       PR-B, poort K2. Pure SQL, dus onafhankelijk van een deploy
//   S31 elke run-rij draagt de set-etag van de werkwijzen, en twee runs zonder
//       bewerking dragen dezelfde — spoor 04 PR-B. Vraagt een gedeployde PR-B;
//       zolang die er niet is meldt de rookronde dat met zoveel woorden in
//       plaats van groen te doen
//
// v1.151 (spoor 02 I2): S1–S5 meten niet langer het compat-pad. Sinds rag-chat
// v6.0 is een vraag een rij in `agent_chat_runs`; `askRun()` uit
// `lib/chat-run.cjs` start de run, volgt de rij tot hij terminaal is, en levert
// hem in de vorm van het oude antwoord op — de asserties eronder zijn dus
// woordelijk hetzelfde gebleven en meten nu het pad dat de browser gebruikt.
// Zonder die overstap zou de rookronde na het verwijderen van de compat-modes
// (vork V7) een pad meten dat niet meer bestaat.
//
// ⚠ PUBLIEKE REPO. De vragen hieronder zijn met opzet generiek en bevatten geen
// klantnamen. Voor een test met échte vragen: scripts/agent_retrieval_bench.cjs,
// die haalt ze op runtime uit de database.
// =============================================================================
const fs = require('fs');
const { askRun } = require('./lib/chat-run.cjs');
const { s7RunMode, s8Disconnect, s9Rls, s10EveryQuestionHasRun, s11Watchdog } = require('./lib/smoke-runs.cjs');

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

// Read-only SQL via de Management API — `read_only:true` draait als
// supabase_read_only_user, dus een tikfout in een query kan niets muteren.
async function sql(query) {
  return mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query, read_only: true }) });
}
// Zelfde kanaal zónder read_only. Alleen nodig voor de RLS-positieve controle
// van S9: `set local role authenticated` mag supabase_read_only_user niet.
// Elke query die hierlangs gaat staat in een `begin; … rollback;` — er wordt
// niets geschreven, en dat is de enige reden dat dit kanaal er is.
async function sqlRw(query) {
  return mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) });
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

  // S29 (spoor 04 PR-A) — welke tools vandaag een actieve org-regel dragen. De
  // verwachting wordt hier uit de database gehaald en niet hard ingetypt: staat
  // er geen regel op de gekozen tool, dan hoort de naad `null` te zijn en niet
  // te ontbreken. Zo blijft de assertie kloppen als Jelle een binding weghaalt.
  const boundTools = new Set(
    (await sql(`select distinct tool_binding from public.org_skills
                where active and coalesce(trim(tool_binding), '') <> ''`))
      .map((r) => String(r.tool_binding).trim()),
  );
  const nActiveSkills = Number((await sql(`select count(*)::int n from public.org_skills
                where active and coalesce(trim(body), '') <> ''`))[0]?.n ?? 0);
  console.log(`\n[S29] org_skills: ${nActiveSkills} actieve regels, gebonden tools: ${[...boundTools].join(', ') || '(geen)'}`);

  // ── S30 (spoor 04 PR-B, poort K2) — de werkwijzen-ACL, fail-closed ────────
  // De chat leest `app_skills` met de service-role-key: op dat pad vuurt RLS
  // nooit, dus de enige bescherming is de RPC. `app_skills_visible(null)` is
  // precies wat een cron-agent of een evalrunner zonder persona ziet, en dat
  // hoort ALLEEN scope=org te zijn. Deze assertie is pure SQL en hangt dus niet
  // aan een deploy — hij bewaakt de laag ook op een dag dat de edge-code
  // teruggedraaid is.
  const s30 = (await sql(`
    select count(*) filter (where scope <> 'org')::int as niet_org,
           count(*)::int as totaal
      from public.app_skills_visible(null)`))[0] ?? { niet_org: 0, totaal: 0 };
  const s30b = (await sql(`
    select count(*) filter (where scope <> 'org')::int as niet_org
      from public.app_skills_visible('00000000-0000-0000-0000-0000000000ff'::uuid)`))[0] ?? { niet_org: 0 };
  const nAppSkills = Number((await sql(`select count(*)::int n from public.app_skills where active`))[0]?.n ?? 0);
  console.log(`\n[S30] app_skills: ${nAppSkills} actief; zonder identiteit zichtbaar: ${s30.totaal} (waarvan ${s30.niet_org} buiten scope=org)`);
  assert('S30', 'service-aanroeper zonder uid ziet geen persoonlijke werkwijze', Number(s30.niet_org) === 0, s30);
  assert('S30', 'onbekende uuid ziet geen persoonlijke werkwijze', Number(s30b.niet_org) === 0, s30b);

  // S31 verzamelt de etags van de runs hieronder; de vergelijking gebeurt ná de lus.
  const etags = [];
  let s31Deployed = null;

  for (const c of CASES) {
    if (only && only !== c.tag) continue;
    let j = null, err = null;
    try {
      // v1.151: run-modus. `askRun` start de run en leest de rij — dus exact het
      // pad dat de browser sinds v6.0 loopt, en niet meer het compat-pad dat na
      // vork V7 verdwijnt.
      j = await askRun({ fnBase: FN, jwt, body: { message: c.q, origin: 'smoke' }, ua: UA, sql });
      if (!j.ok) err = `${j.error?.code || j.state}: ${String(j.error?.message || '').slice(0, 200)}`;
    } catch (e) { err = e instanceof Error ? `${e.name}: ${e.message}` : String(e); }
    const ms = j?.latency_ms ?? 0;

    const env = j?.envelope || null;
    const cov = env?.coverage || j?.coverage || null;
    const dbgm = j?.debug_pipeline || {};
    console.log(`\n[${c.id}] ${ms} ms  route=${j?.route || j?.analytics?.route || 'semantic'}  chunks=${j?.chunk_count ?? '?'}  recept=${dbgm.context_build_intent ?? '-'}  reden=${cov?.reason ?? '-'}  effort=${j?.effort ?? '-'}${err ? `  FOUT ${err}` : ''}`);
    if (SHOW && j?.answer) console.log('  ' + String(j.answer).replace(/\n/g, '\n  ').slice(0, 900));

    assert('S0', `${c.id}: geen fout`, !err, err);
    if (err) continue;

    // S4 — het contract. Zonder envelop kan de UI geen tabel tonen en moet de
    // evalharnas weer reguliere expressies over proza leggen.
    assert('S4', `${c.id}: envelop aanwezig (v1)`, env?.version === 1, env?.version);
    assert('S4', `${c.id}: envelop draagt coverage`, !!cov && Array.isArray(cov.searched), cov);

    // S5 — kosten. Ook het semantische pad, dat vóór v5.6 nooit een bedrag kreeg.
    assert('S5', `${c.id}: kostenregel gevuld`, typeof env?.cost?.usd === 'number', env?.cost);

    // ── S29 (spoor 04 PR-A) — de naad, niet het gedrag ───────────────────────
    // Poort K6 asserteert dat de organisatieregel in de prompt terechtkwam, niet
    // dat het model hem opvolgde: gemeten volgt het model een gebonden regel in
    // 2 van 51 agentische antwoorden, dus een gedragsassertie zou een werkende
    // fix rood kunnen maken (DECISIONS D04-6). `org_skills_chars` is het
    // modelvrije bewijs dat het blok bestond; `org_skills_truncated_n` dat er
    // niets stil wegviel; `org_skills_bound_tool` dat de afspraak van de
    // gekozen tool erachteraan ging — de route waar dat vóór 04 nooit gebeurde.
    if (nActiveSkills > 0) {
      assert('S29', `${c.id}: org-kennisblok heeft omvang`, typeof dbgm.org_skills_chars === 'number' && dbgm.org_skills_chars > 0, dbgm.org_skills_chars);
    }
    assert('S29', `${c.id}: afkapping is geteld, niet stil`, dbgm.org_skills_truncated_n === 0, dbgm.org_skills_truncated_n);
    assert('S29', `${c.id}: naad aanwezig (ook als null)`, 'org_skills_bound_tool' in dbgm, Object.keys(dbgm).filter((k) => k.startsWith('org_skills')));

    // ── S31 (spoor 04 PR-B) — de set-etag op de run-rij ─────────────────────
    // De etag maakt een cache-miss uitlegbaar: verschilt hij tussen twee runs,
    // dan is er een werkwijze bewerkt, toegevoegd, uitgezet of verschoven. Dat
    // is de enige manier om "de prompt veranderde" van "de cache deed iets
    // geks" te onderscheiden.
    //
    // De helft "na één bewerking verschilt hij" staat NIET hier: die zou de
    // rookronde productie-inhoud laten muteren. Hij is deterministisch bewezen
    // in scripts/agent_skills_acl.cjs (E1b/E1c) en scripts/
    // agent_skills_prompt_probe.ts (P10/P10b), met eigen fixtures.
    if (s31Deployed === null) {
      s31Deployed = Object.keys(dbgm).some((k) => k.startsWith('app_skills'));
      if (!s31Deployed) {
        console.log('  ⏭️  S31 overgeslagen: de gedeployde rag-chat kent de app_skills-laag nog niet '
          + '(geen enkele app_skills_*-sleutel in debug_pipeline). Draai deze rookronde opnieuw ná de deploy van 04 PR-B.');
      }
    }
    if (s31Deployed) {
      assert('S31', `${c.id}: run-rij draagt de set-etag`, typeof dbgm.app_skills_etag === 'string' && dbgm.app_skills_etag.length > 0, dbgm.app_skills_etag);
      assert('S31', `${c.id}: afkapping van de titellijst is geteld`, dbgm.app_skills_truncated_n === 0, dbgm.app_skills_truncated_n);
      if (typeof dbgm.app_skills_etag === 'string') etags.push({ id: c.id, etag: dbgm.app_skills_etag });
    }

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
      // S29 op de structured route — de vraag hierboven ("deals per fase") kiest
      // count_by_stage, en dáár hangt de enige binding aan die Jelle heeft
      // gemaakt. Kiest de router een andere route (het mag: hij mag escaleren),
      // dan is er geen gekozen tool en is deze assertie niet van toepassing.
      const chosen = j?.analytics?.tool ? String(j.analytics.tool) : null;
      if (!chosen) {
        console.log(`  ℹ️  ${c.id}: geen structured tool gekozen (route=${j?.analytics?.route || 'semantic'}) — S29-naad niet van toepassing`);
      } else if (boundTools.has(chosen)) {
        assert('S29', `${c.id}: gebonden regel landt op de structured route`, dbgm.org_skills_bound_tool === chosen, { bound_tool: dbgm.org_skills_bound_tool, tool: chosen });
      } else {
        assert('S29', `${c.id}: geen binding op ${chosen} → naad is null`, dbgm.org_skills_bound_tool === null, dbgm.org_skills_bound_tool);
      }
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

  // S31, tweede helft: dezelfde set, dus dezelfde etag. Er is tussen deze runs
  // niets aan de werkwijzen gewijzigd; verschillen ze tóch, dan leest de keten
  // per run een andere lijst en is de cache-observatie waardeloos.
  if (etags.length >= 2) {
    const uniek = new Set(etags.map((e) => e.etag));
    assert('S31', 'alle runs zonder bewerking dragen dezelfde etag', uniek.size === 1, etags);
  } else if (s31Deployed) {
    console.log(`  ℹ️  S31: ${etags.length} run(s) met een etag — te weinig om ze te vergelijken`);
  }

  // ══ S7–S11: de run zelf (spoor 02 I2) ═════════════════════════════════════
  // Overslaan met --only, want dan is de rookronde bewust op één vorm gericht.
  if (!only) {
    const anonKey = keys.find((k) => k.name === 'anon')?.api_key || null;

    await s7RunMode({ fnBase: FN, jwt, ua: UA, sql, assert });

    console.log('\n[S8] disconnect — 3 runs waarvan de client 1 s na het run_id weggaat');
    await s8Disconnect({ fnBase: FN, jwt, ua: UA, sql, assert, times: 3 });

    console.log('\n[S9] owner-only op tabel én publicatie');
    if (!anonKey) assert('S9', 'RLS: anon-sleutel beschikbaar', false, 'geen anon-sleutel via /api-keys');
    else await s9Rls({ ref: REF, fnBase: FN, anonKey, serviceKey: jwt, ua: UA, sql, sqlRw, assert });

    console.log('\n[S10/S11] run-dekking en de waakhond');
    // Sinds de tabel bestaat: de eerste run-rij is het moment waarop I1 live ging.
    const since = (await sql(`select min(created_at) as t from public.agent_chat_runs`))[0]?.t;
    if (since) await s10EveryQuestionHasRun({ sql, assert, sinceIso: new Date(since).toISOString() });
    else assert('S10', 'run-dekking meetbaar', false, 'geen enkele run-rij');
    await s11Watchdog({ sql, assert });
  }

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${bad.length === 0 ? '✅ ALLES GROEN' : `❌ ${bad.length} ROOD`}  (${results.length} asserties`
    + `${s31Deployed === false ? ', S31 overgeslagen — 04 PR-B niet gedeployd' : ''})`);
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
