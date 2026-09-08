#!/usr/bin/env node
// =============================================================================
// agent_docs_generate.cjs — genereert docs/agent/TOOLS.md            (WP10)
// =============================================================================
//   node scripts/agent_docs_generate.cjs           # schrijf docs/agent/TOOLS.md
//   node scripts/agent_docs_generate.cjs --check   # exit 1 als het bestand achterloopt
//
// Handgeschreven documentatie over tools loopt gegarandeerd achter. Deze
// generator leest de waarheid uit de bron:
//   - `TOOL_CATALOG` in supabase/functions/rag-chat/analytics.ts (de metric-tools)
//   - `toolSchemas()` in supabase/functions/rag-chat/agentic.ts   (de agent-tools)
//   - `context_intents` in de database                            (de recepten)
//
// De databasekant is optioneel: zonder management-token wordt het recepten-
// hoofdstuk overgeslagen met een zichtbare regel eronder, en vergelijkt
// `--check` alles BEHALVE §3 (zie `dbFree`), zodat CI niet omvalt op een
// ontbrekende sleutel maar je wél ziet wat er niet gemeten is.
//
// `--check` is de discipline uit het onderzoek (§5.11): een werkpakket is niet
// af tot TOOLS.md schoon hergenereert. Wat `--check` NIET bewijst is dat de
// generator zinnige tekst schrijft — hij vergelijkt de generator met zichzelf.
// Die assertie staat ernaast, in `scripts/agent_docs_audit.cjs` (DOC-1b).
// =============================================================================
const fs = require('fs');
const path = require('path');

const OUT = path.join('docs', 'agent', 'TOOLS.md');
const CHECK = process.argv.includes('--check');
const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;

async function sql(query) {
  if (!SBT) return null;
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', 'User-Agent': 'legal-mind-dashboard-claude/1.0' },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return null;
    return JSON.parse(await r.text());
  } catch { return null; }
}

// Parsen in plaats van importeren: dit zijn Deno/TypeScript-modules met
// https-imports, die draaien niet in Node. Een regex over de bron is lelijk maar
// eerlijk — en als de vorm van de catalogus verandert, valt dat hier meteen op
// omdat de tabel leeg wordt.
function parseToolCatalog() {
  const src = fs.readFileSync(path.join('supabase', 'functions', 'rag-chat', 'analytics.ts'), 'utf8');
  const start = src.indexOf('export const TOOL_CATALOG = [');
  if (start < 0) return [];
  const end = src.indexOf('\n];', start);
  const block = src.slice(start, end);
  const out = [];
  const re = /\{\s*name:\s*"([^"]+)",\s*rpc:\s*(null|"[^"]+"),\s*desc:\s*"((?:[^"\\]|\\.)*)",\s*definition:\s*"((?:[^"\\]|\\.)*)",\s*\}/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    out.push({
      name: m[1],
      rpc: m[2] === 'null' ? null : m[2].slice(1, -1),
      desc: m[3].replace(/\\"/g, '"'),
      definition: m[4].replace(/\\"/g, '"'),
    });
  }
  return out;
}

// Leest de JS-literal die op `src[i]` begint (i wijst naar het openende
// aanhalingsteken of de backtick) en geeft { text, end } terug. Elke
// `${…}`-interpolatie wordt één plaatshouder `…`.
//
// Waarom geen regex (spoor 07, D07-10a): `my_mail_search` heeft een
// template-literal met een ternary erin, en die ternary heeft zelf backticks
// en zelf accolades:
//
//   `… van de vrager${mirror.mailbox ? ` (${mirror.mailbox})` : ""} — …`
//
// Een regex die op de eerste backtick of de eerste `}` stopt, kapt de zin af
// midden in het JavaScript. Dat is precies wat er gebeurde: `TOOLS.md` regel 44
// toonde maandenlang `van de vrager${mirror.mailbox ?` terwijl `--check` groen
// bleef, want die vergelijkt de generator met zichzelf. Vandaar de scanner met
// echte diepte-administratie én de uitkomst-assertie ernaast (geen `${` in de
// gegenereerde tabel — DOC-1b in `agent_docs_audit.cjs`).
function readJsLiteral(src, i) {
  const quote = src[i];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let out = '';
  let p = i + 1;
  while (p < src.length) {
    const c = src[p];
    if (c === '\\') { out += src[p + 1] ?? ''; p += 2; continue; }
    if (c === quote) return { text: out, end: p + 1 };
    if (quote === '`' && c === '$' && src[p + 1] === '{') {
      p = skipInterpolation(src, p + 2);
      out += '…';
      continue;
    }
    out += c;
    p += 1;
  }
  return null; // niet-afgesloten literal: liever niets dan een halve zin
}

// Slaat een `${ … }` over, vanaf de eerste tekst ná `${`. Houdt accolade-diepte
// bij en slaat geneste literals in hun geheel over, want daarbinnen mag een `}`
// of een backtick staan die niets afbakent.
function skipInterpolation(src, p) {
  let depth = 1;
  while (p < src.length) {
    const c = src[p];
    if (c === '\\') { p += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const lit = readJsLiteral(src, p);
      if (!lit) return src.length;
      p = lit.end;
      continue;
    }
    if (c === '{') { depth += 1; p += 1; continue; }
    if (c === '}') { depth -= 1; p += 1; if (depth === 0) return p; continue; }
    p += 1;
  }
  return p;
}

function parseAgentTools() {
  const src = fs.readFileSync(path.join('supabase', 'functions', 'rag-chat', 'agentic.ts'), 'utf8');
  const out = [];
  // De agent-tools staan als OpenAI-function-schema's. Tussen `name` en
  // `description` kan een commentaarregel staan, dus het venster is ruim; de
  // literal zelf wordt daarna gescand, niet gematcht (zie readJsLiteral).
  const NAME_RE = /name:\s*"([a-z_]+)",/g;
  let m;
  while ((m = NAME_RE.exec(src)) !== null) {
    const from = m.index + m[0].length;
    const d = src.slice(from, from + 400).indexOf('description:');
    if (d < 0) continue;
    let p = from + d + 'description:'.length;
    while (p < src.length && /\s/.test(src[p])) p += 1;
    const lit = readJsLiteral(src, p);
    if (!lit) continue;
    out.push({ name: m[1], desc: lit.text });
  }
  // Dedup op naam, eerste wint.
  const seen = new Set();
  return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const trunc = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ⚠ PUBLIEKE REPO. Alleen de EERSTE ZIN van een tool-beschrijving komt in de
// gegenereerde tabel. Niet om het kort te houden, maar omdat de voorbeelden
// dáárna staan — en die voorbeelden bevatten echte klantnamen ("wat speelde er
// bij <klant>"). Een generator die de hele beschrijving overneemt, kopieert die
// namen naar een nieuw bestand dat we committen. De eerste zin zegt wat de tool
// doet; dat is precies wat deze tabel moet zeggen.
const firstSentence = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,300}?[.!?])(\s|$)/);
  return (m ? m[1] : trunc(t, 200)).trim();
};

// De twee koppen die §3 (het enige databasehoofdstuk) afbakenen, plus de
// tabelkop erin. Als constante, want `dbFree()` knipt erop en een los
// gewijzigde kop zou die knip stil laten mislukken.
const H_RECIPES = '## 3. Retrieval-recepten (`context_intents`)';
const H_ROUTING = '## 4. Welk recept krijgt een chatvraag?';
const RECIPE_TABLE_HEAD = '| recept | strategie | top_k | min_sim | rerank | intel | anchors | bm25 | bronfilter |';

// Alles wat uit de database komt eruit: §3 in zijn geheel en de receptenteller
// in de bron-tellerregel. Wat overblijft is wat een checkout alléén kan weten,
// en dus wat CI zonder token eerlijk kan vergelijken.
function dbFree(md) {
  const a = md.indexOf(H_RECIPES);
  const b = md.indexOf(H_ROUTING);
  const cut = a >= 0 && b > a ? md.slice(0, a) + md.slice(b) : md;
  return cut.replace(/^(Bron-teller: .*?) · [0-9?]+ recepten\.$/m, '$1.');
}

(async () => {
  const metrics = parseToolCatalog();
  const agentTools = parseAgentTools();
  const intents = await sql(`
    select intent, default_strategy, default_top_k, default_min_similarity,
           default_rerank, query_intel_level, entity_anchor_top_n, bm25_enabled,
           default_filter_sources::text as filter_sources, description
      from context_intents order by intent`);

  const L = [];
  L.push('# Tools en recepten van de Maestro-chat');
  L.push('');
  L.push('> **GEGENEREERD BESTAND — niet met de hand bewerken.**');
  L.push('> `node scripts/agent_docs_generate.cjs` schrijft het opnieuw uit de bron:');
  L.push('> `TOOL_CATALOG` (analytics.ts), `toolSchemas()` (agentic.ts) en `context_intents`.');
  L.push('> `--check` faalt als dit bestand achterloopt. Een werkpakket is niet af tot het');
  L.push('> schoon hergenereert.');
  L.push('');
  L.push(`Bron-teller: ${metrics.length} metric-tools · ${agentTools.length} agent-tools · ${intents ? intents.length : '?'} recepten.`);
  L.push('');

  L.push('## 1. Metric-tools (structured route)');
  L.push('');
  L.push('Deterministisch: één RPC, één definitie, geen model tussen vraag en getal. De');
  L.push('`definition` hieronder is wat in het antwoord terechtkomt als verantwoording —');
  L.push('en straks als kolomtoelichting in een Excel-export.');
  L.push('');
  L.push('| tool | RPC | definitie |');
  L.push('|---|---|---|');
  for (const t of metrics) L.push(`| \`${t.name}\` | ${t.rpc ? `\`${t.rpc}\`` : '—' } | ${esc(t.definition)} |`);
  L.push('');

  L.push('## 2. Agent-tools (agentic route)');
  L.push('');
  L.push('Wat de onderzoeks-agent zelf mag aanroepen. Het onderzoek telt hier de grens waar');
  L.push('toolselectie meetbaar degradeert (15-20 tools) — zie WP8 voor het groeperen naar');
  L.push('ongeveer acht.');
  L.push('');
  L.push('| tool | wat het doet |');
  L.push('|---|---|');
  for (const t of agentTools) L.push(`| \`${t.name}\` | ${esc(firstSentence(t.desc))} |`);
  L.push('');

  L.push(H_RECIPES);
  L.push('');
  if (!intents) {
    L.push('_Niet opgehaald: geen management-token in deze omgeving (`SBT` of `~/.claude/supabase-mcp.json`)._');
  } else {
    L.push('Elk recept is een rij, dus tunebaar zonder redeploy. `bm25_enabled: false` zet de');
    L.push('lexicale arm van `match_chunks` uit — gemeten 7 ms in plaats van 1-10 s, ten koste');
    L.push('van lexicale recall. Zie migratie `20260905180000_search_fast_intent.sql`.');
    L.push('');
    L.push(RECIPE_TABLE_HEAD);
    L.push('|---|---|---:|---:|---|---|---:|---|---|');
    for (const i of intents) {
      L.push(`| \`${i.intent}\` | ${i.default_strategy} | ${i.default_top_k} | ${i.default_min_similarity} | ${i.default_rerank ? 'ja' : 'nee'} | ${i.query_intel_level} | ${i.entity_anchor_top_n} | ${i.bm25_enabled ? 'aan' : 'UIT'} | ${i.filter_sources ?? '—'} |`);
    }
  }
  L.push('');
  L.push(H_ROUTING);
  L.push('');
  L.push('```');
  L.push('vraag → router (gpt-5.6-luna)');
  L.push('        ├── structured → metric-tool uit §1 (geen retrieval)');
  L.push('        ├── sweep      → mail-voorfilter + batched verdicts');
  L.push('        ├── agentic    → agent-tools uit §2 (semantic_search gebruikt `search`)');
  L.push('        └── semantic   → `search_docs` bij een documentatievraag, anders `search_fast`');
  L.push('```');
  L.push('');
  L.push('Het zware `search`-recept is sinds v1.146 géén chatroute meer: het is alleen nog');
  L.push('bereikbaar als agent-tool, met een eigen budget van 30 s. Gemeten reden staat in');
  L.push('`docs/agent/DECISIONS.md` (2026-09-05).');
  L.push('');

  const body = L.join('\n') + '\n';
  if (CHECK) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    // Zonder recepten vergelijken we alles BEHALVE §3. De kopregel in dit
    // bestand belooft sinds dag één dat `--check` niet omvalt op een ontbrekende
    // sleutel, maar de vergelijking pakte de hele body — dus in CI (geen
    // `~/.claude/`, geen SBT) was hij gegarandeerd rood op §3. Een poort die
    // altijd rood staat gaat uit; daarom is §3 nu zichtbaar uitgesloten in
    // plaats van stil de reden van een rode CI.
    //
    // De voorwaarde is `intents`, niet `SBT`: een token dat de API weigert
    // levert precies dezelfde lege §3 als geen token, en dan hoort de
    // vergelijking hetzelfde te doen.
    const same = intents ? cur === body : dbFree(cur) === dbFree(body);
    if (!same) {
      console.error(`${OUT} loopt achter op de bron — draai: node scripts/agent_docs_generate.cjs`);
      process.exit(1);
    }
    console.log(`${OUT} is actueel (${metrics.length} metric-tools, ${agentTools.length} agent-tools)`
      + (intents ? `, ${intents.length} recepten.` : ' — §3 (recepten) niet vergeleken: geen management-token.'));
    process.exit(0);
  }
  // Zonder token zou de write het bestaande receptenhoofdstuk door één
  // skip-regel vervangen. Dat is stil verlies in een gecommit bestand, dus
  // liever een harde stop dan een gutgeslagen §3 in de volgende PR.
  if (!intents && fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8').includes(RECIPE_TABLE_HEAD)) {
    console.error(`geen management-token: §3 van ${OUT} zou gewist worden — zet SBT= of gebruik --check`);
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body);
  console.log(`${OUT} geschreven — ${metrics.length} metric-tools, ${agentTools.length} agent-tools, ${intents ? intents.length : 0} recepten.`);
})().catch((e) => { console.error(e); process.exit(2); });
