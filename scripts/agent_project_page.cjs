#!/usr/bin/env node
// =============================================================================
// agent_project_page.cjs — de projectpagina in Confluence  (spoor 07, item 6)
// =============================================================================
//   node scripts/agent_project_page.cjs              # schrijft / overschrijft
//   node scripts/agent_project_page.cjs --dry-run    # bouwt, raakt Confluence niet
//   node scripts/agent_project_page.cjs --dry-run --out /tmp/project.xhtml
//   node scripts/agent_project_page.cjs --parent 414777345   # andere ouder (test)
//
// `Projecten / Lopende projecten / Project — Maestro Agent Architecture`, parent
// 414777345 — de ouder waar alle twaalf bestaande `Project — …`-pagina's onder
// staan (gemeten, niet aangenomen: CQL `title~"Project"` in space LM). NIET
// onder `Backlog` (420184065, houdt alleen *Project — Security Operations*) en
// niet onder *Documentation audits* — dat is de plek van de trendreeks.
//
// ── Deze pagina houdt geen feiten bij ────────────────────────────────────────
// LIVING-PROCESS §1: één feit, één eigenaar. De status leeft in `_index.md`, het
// gedrag van de code in `docs/agent/` in git, de weekcijfers op de trendpagina.
// Hier staan uitsluitend een TL;DR van vijf regels en links. Wie hier een tabel
// met spoorstatussen bij zet, heeft vanaf dat moment twee statusborden die uit
// elkaar lopen — precies wat RESEARCH §4.5 verbiedt.
//
// ── Eén dynamische regel ─────────────────────────────────────────────────────
// De link naar de nieuwste `Trend — evalweek …` wordt bij elke run uit Confluence
// zelf gelezen. Dat is de enige link die per week verloopt; een hard-gecodeerde
// id zou binnen zeven dagen naar vorige week wijzen.
// =============================================================================
const fs = require('fs');
const C = require('./lib/confluence.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const PARENT = arg('parent', process.env.PROJECT_PARENT_ID || '414777345');
const DRY = flag('dry-run');
const OUT = arg('out', null);
const TITLE = 'Project — Maestro Agent Architecture';

// Vaste plekken. Gemeten op 2026-09-13; alle vier bestaan.
const AUDITS_PARENT = '445841410';   // Operations / Documentation audits
const AFGEROND = '414711809';        // Projecten / Afgerond
const GH = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal';
const BLOB = `${GH}/blob/main`;
const WIKI = 'https://bg-intelligence.atlassian.net/wiki';
const DRIVE_MAP = 'https://drive.google.com/drive/folders/1kbXf7plZUwE-X5jx9JUVEdibm-Ts0Yaf';
const DRIVE_INDEX = 'https://docs.google.com/document/d/1VwfVGmJ39uspGHTWdUhEdqXe3zYQibGEb0gtkPnLd-o/edit';
const DRIVE_PAPER = 'https://docs.google.com/document/d/1Kizas_M8HMpopz8iwt1BC5EBFDWrCnUHISyHo2y6vh4/edit';
const DRIVE_PROCESS = 'https://docs.google.com/document/d/1cUs5PdAdSApvubGC3Ub6zXD24QaQS0W_1kGh5nanG1A/edit';
const WERKMAP = '/workspace/security/maestro-agent-architecture/';

const { esc, p, code, h, table } = C;
const a = (href, text) => `<a href="${esc(href)}">${text}</a>`;
const doc = (name) => a(`${BLOB}/docs/agent/${name}`, code(`docs/agent/${name}`));
const script = (name) => a(`${BLOB}/scripts/${name}`, code(`scripts/${name}`));

// ── De nieuwste trendpagina ──────────────────────────────────────────────────
// Titels zijn `Trend — evalweek YYYY-Www`; lexicografisch sorteren is hier ook
// chronologisch sorteren, zolang het weeknummer twee cijfers houdt.
async function laatsteTrend(parentId) {
  try {
    const r = await C.api(`/content/${parentId}/child/page?limit=100&expand=version`);
    const trend = (r.results || [])
      .filter((x) => /^Trend — evalweek \d{4}-W\d{2}$/.test(x.title))
      .sort((x, y) => (x.title < y.title ? 1 : -1));
    return trend[0] || null;
  } catch (e) {
    console.error(`waarschuwing: nieuwste trendpagina niet gelezen (${e.message}) — alleen de ouder wordt gelinkt`);
    return null;
  }
}

// ── De body ──────────────────────────────────────────────────────────────────
function bouw(trend) {
  const trendLink = trend
    ? `${a(`${WIKI}/spaces/LM/pages/${trend.id}`, esc(trend.title))} (nieuwste)`
    : 'nog geen trendpagina onder deze ouder';

  return ''
    + `<blockquote>
      <p><strong>Status:</strong> 🔵 In progress</p>
      <p><strong>Doel:</strong> de Maestro-chatagent na v1.146 herbouwen en meetbaar houden &mdash; per spoor onderzoek → implementatie → PR, met een poort voor elke stap.</p>
      <p><strong>Bron van waarheid:</strong> het statusbord ${code('_index.md')} in de werkmap; deze pagina dupliceert dat bewust niet.</p>
      <p><strong>Parent:</strong> ${a(`${WIKI}/spaces/LM/pages/414777345`, 'Lopende projecten')}</p>
    </blockquote>`.replace(/\n\s+/g, '')

    + h(2, 'TL;DR')
    + `<ul>
      <li><p><strong>Wat</strong> &mdash; programma dat de Maestro-chatagent na v1.146 herbouwt: Grok orkestreert, elke sessie doet één spoor van onderzoek tot gemerkte PR.</p></li>
      <li><p><strong>Waar de status leeft</strong> &mdash; ${code('_index.md')} in de werkmap (bron), met een leesbare kopie op Drive. Niet op deze pagina.</p></li>
      <li><p><strong>Waar het gedrag leeft</strong> &mdash; ${code('docs/agent/')} in git, bijgewerkt in dezelfde PR als de code.</p></li>
      <li><p><strong>Waar de cijfers leven</strong> &mdash; de wekelijkse ${code('Trend — evalweek …')} onder <em>Documentation audits</em>.</p></li>
      <li><p><strong>Wat deze pagina is</strong> &mdash; een wegwijzer. Eén feit heeft één eigenaar (LIVING-PROCESS §1): citeren mag, dupliceren niet.</p></li>
    </ul>`.replace(/\n\s+/g, '')

    + h(2, 'Statusbord en programmadocumenten')
    + table(['Wat', 'Waar'], [
      ['Statusbord per spoor <em>(bron)</em>', `${code(`${WERKMAP}_index.md`)} &mdash; alleen op de werkmachine`],
      ['Statusbord <em>(leesbare kopie)</em>', `${a(DRIVE_INDEX, '_index — statusbord sporen')} · ${a(DRIVE_MAP, 'Drive-map Maestro Agent Architecture')}`],
      ['Proces en doctrine', a(DRIVE_PAPER, 'Orchestration Paper')],
      ['Onderhoud van de documentatie', a(DRIVE_PROCESS, 'Living Process')],
      ['Onderzoek en implementatienotities per spoor', `${code(`${WERKMAP}<spoor>/`)} &mdash; ${code('RESEARCH.md')}, ${code('EVAL-GATES.md')}, ${code('IMPLEMENT-NOTES.md')}; mensdocumenten staan ook op Drive`],
    ])

    + h(2, 'Levende documentatie in git')
    + table(['Bestand', 'Wat het is'], [
      [doc('ARCHITECTURE.md'), 'hoe de chat werkt &mdash; routes, budgetten, dekkingsredenen'],
      [doc('DECISIONS.md'), 'waarom, chronologisch; een werkpakket is niet af tot hier een regel bij staat'],
      [doc('CHANGELOG-AGENT.md'), 'alleen gedragswijzigingen van de chat'],
      [doc('TOOLS.md'), `<strong>gegenereerd</strong> uit de code door ${script('agent_docs_generate.cjs')}`],
      [doc('SKILLS.md'), 'skills in de chat'],
    ])
    + p(`Dit is de bron voor code en gedrag (LIVING-PROCESS §1) &mdash; niet Confluence en niet Drive. `
      + `De repo is publiek: klantnamen, bedragen en mailinhoud horen niet in een commit, PR-body of issue.`)

    + h(2, 'Weekcijfers, audits en poorten')
    + table(['Wat', 'Waar'], [
      ['Trendreeks en auditreeks', `Operations → ${a(`${WIKI}/spaces/LM/pages/${AUDITS_PARENT}`, 'Documentation audits')}`],
      ['Trendpagina van deze week', trendLink],
      ['Generator van de trendpagina', `${script('agent_trend_page.cjs')} &mdash; één pagina per ISO-week, overschrijft op titel`],
      ['Documentatiepoort', `${script('agent_docs_audit.cjs')} &mdash; DOC-1 t/m DOC-12; ${a(`${BLOB}/CLAUDE.md`, 'pre-flight punt 9')}`],
      ['Evalbank', `${a(`${GH}/tree/main/docs/agent/vragenbank`, code('docs/agent/vragenbank/'))} · poort ${script('agent_eval_load.cjs')} ${code('--check')}`],
    ])

    + h(2, 'Open blokkades')
    + `<ul>
      <li><p><strong>Spoor 03a</strong> &mdash; wacht op de Anthropic ${code('api_key')} in de Vault; zonder die sleutel kan de centrale wrapper niet worden gemeten.</p></li>
      <li><p><strong>Spoor 06f-β</strong> &mdash; wacht op een Cohere-sleutel voor de herrangschikking.</p></li>
      <li><p><strong>Spoor 07 &mdash; ${code('.github/workflows/docs-gate.yml')}</strong> staat nog niet op ${code('main')}: de PAT mag geen workflows pushen. Tot dan is ${a(`${BLOB}/CLAUDE.md`, 'pre-flight punt 9')} handwerk in plaats van een blokkerende CI-stap.</p></li>
    </ul>`.replace(/\n\s+/g, '')

    + h(2, 'Onderhoud van deze pagina')
    + `<ul>
      <li><p>Bijwerken met ${script('agent_project_page.cjs')}: overschrijft op titel, maakt nooit een tweede pagina.</p></li>
      <li><p>Bij afronding: ${code('— afgerond')} achter de titel en verplaatsen naar Projecten → ${a(`${WIKI}/spaces/LM/pages/${AFGEROND}`, 'Afgerond')}, zoals de bestaande reeks.</p></li>
      <li><p>Nieuwe links horen hier; nieuwe <em>inhoud</em> hoort in de werkmap of in ${code('docs/agent/')}.</p></li>
    </ul>`.replace(/\n\s+/g, '')

    // Bewust géén "gegenereerd op <tijdstip>" in de body. Confluence toont zelf
    // wanneer de pagina voor het laatst is bijgewerkt; die regel hier herhalen
    // maakt de body per run anders, en dan bumpt elke run de versie. Zonder die
    // regel is de body stabiel en is elke versie in de historie een echte
    // wijziging — gemeten: een tweede run op identieke inhoud geeft hetzelfde
    // versienummer terug.
    + p(`<em>Gegenereerd door ${code('scripts/agent_project_page.cjs')} (spoor 07, item 6). `
      + `De body is stabiel: elke versie in de historie is een echte wijziging.</em>`);
}

// ── Hoofd ────────────────────────────────────────────────────────────────────
(async () => {
  const trend = DRY && flag('no-lookup') ? null : await laatsteTrend(AUDITS_PARENT);
  const body = bouw(trend);

  console.log(`== projectpagina "${TITLE}" · ouder ${PARENT} · ${body.length} tekens ==`);
  if (OUT) { fs.writeFileSync(OUT, body); console.log(`body → ${OUT}`); }
  if (DRY) {
    console.log(`-- dry-run: Confluence niet aangeraakt.`);
    if (!OUT) console.log(body);
    process.exit(0);
  }

  const res = await C.upsertPage({ parentId: PARENT, title: TITLE, body });
  console.log(`${res.created ? 'aangemaakt' : 'overschreven'}: ${res.id} v${res.version} · ${res.url}`);

  // Verifiëren, niet aannemen: `body.view` is wat de lezer ziet. Een dubbel
  // ontsnapte entity of een achtergebleven `${` valt daar op en in storage niet.
  const v = await C.renderedBody(res.id);
  const leaks = [];
  if (v.view.includes('${')) leaks.push('JS-rest ${');
  for (const e of ['&amp;mdash;', '&amp;rarr;', '&amp;middot;', '&amp;nbsp;', '&amp;ndash;']) if (v.view.includes(e)) leaks.push(e);
  if (!v.view.length) leaks.push('lege render');
  if (v.title !== TITLE) leaks.push(`titel is "${v.title}"`);
  console.log(`verify: v${v.version} · ${v.view.length} tekens gerenderd · ${leaks.length ? `LEK: ${leaks.join(', ')}` : 'geen lekken'}`);
  process.exit(leaks.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
