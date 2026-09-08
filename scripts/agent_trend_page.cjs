#!/usr/bin/env node
// =============================================================================
// agent_trend_page.cjs — één trendpagina per evalweek in Confluence  (spoor 07)
// =============================================================================
//   node scripts/agent_trend_page.cjs                    # deze ISO-week, schrijft
//   node scripts/agent_trend_page.cjs --week 2026-W36    # één specifieke week
//   node scripts/agent_trend_page.cjs --dry-run          # bouwt, raakt Confluence niet
//   node scripts/agent_trend_page.cjs --dry-run --out /tmp/w37.xhtml
//   node scripts/agent_trend_page.cjs --parent 445841410 # andere ouder (test)
//   node scripts/agent_trend_page.cjs --no-audit         # sla de repo-audit over
//
// `Operations / Documentation audits / Trend — evalweek YYYY-Www`, parent
// 445841410 — naast de bestaande `Audit — week …`-reeks: zelfde ritme, andere
// inhoud, één plek (D07-1).
//
// ── Exact één pagina per week ────────────────────────────────────────────────
// De titel is de sleutel. Bestaat hij al, dan wordt hij overschreven en gaat de
// nieuwe datum in de body. Géén `(inhaalronde <datum>)` in de titel: dat is
// precies waardoor de auditreeks vandaag twee W22- en twee W36-pagina's heeft
// (D07-2).
//
// ── Een lege week is een geslaagde pagina ────────────────────────────────────
// Geen weekronde? Dan is de pagina één regel — "geen weekronde" — plus de reden
// uit de database: vuurde de cron niet, of vuurde hij wél en leverde niets op?
// Dat tweede geval is 2026-09-06 en bleef toen onzichtbaar (§4.4).
//
// ⚠ PUBLIEKE REPO. Deze uitvoer (ook `--dry-run` op stdout) bevat `notes` uit de
//   evalbank, en daar staan klantnamen in. De pagina staat in Confluence onder
//   de space-ACL; de tekst hoort nooit in een commit, PR-body of issue.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/confluence.cjs');
const Q = require('./lib/trend-queries.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const WEEK = arg('week', null);
const PARENT = arg('parent', process.env.TREND_PARENT_ID || '445841410');
const DRY = flag('dry-run');
const OUT = arg('out', null);
const REPO = path.resolve(__dirname, '..');

// De trendbreuk. Vóór deze datum draaiden de 71 legacy-items op de service-key,
// erna als gebruiker (persona `jelle`, DECISIONS V5 spoor 01). Vergelijkingen
// over de streep heen zijn niet gelijkwaardig; de pagina zegt dat zelf.
const BREUK = '2026-09-06';

// ── Opmaak ───────────────────────────────────────────────────────────────────
const { esc, p, code, h, ul, table } = C;
const nl = (v, d = 1) => (v == null ? null : String(Number(v).toFixed(d)).replace('.', ','));
const pct = (v) => (v == null ? null : `${nl(v, 1)}&nbsp;%`);
const usd = (v) => (v == null ? null : `$${nl(v, 2)}`);
const utc = (ts) => (ts ? String(ts).replace('T', ' ').slice(0, 16) : null);
const bool = (v) => (v == null ? null : v ? 'ja' : 'nee');
const kleur = (d) => (d == null ? '' : d <= -5 ? '🔴 ' : d >= 5 ? '🟢 ' : '');
const delta = (d) => (d == null ? null : `${kleur(d)}${d > 0 ? '+' : ''}${nl(d, 1)}&nbsp;pp`);

// `30 2 * * 0` → het moment in déze week waarop die cron valt (UTC).
function cronSlot(schedule, wsDate) {
  const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\d)$/.exec(String(schedule || '').trim());
  if (!m) return null;
  const [, mi, hh, dow] = m;
  const d = new Date(`${wsDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((Number(dow) + 6) % 7)); // cron 0=zo → ISO-offset 6
  return `${d.toISOString().slice(0, 10)} ${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')} UTC`;
}

// ── De repo-audit ernaast leggen ─────────────────────────────────────────────
// De DB-guard ziet DOC-9…DOC-12; DOC-1…DOC-8 hebben een checkout nodig. Draait
// dit script in de repo, dan is die helft gratis mee te nemen.
function repoAudit() {
  if (flag('no-audit')) return { regel: 'overgeslagen (<code>--no-audit</code>)' };
  const s = path.join(REPO, 'scripts', 'agent_docs_audit.cjs');
  if (!fs.existsSync(s)) return { regel: 'niet uitgevoerd (script niet in deze checkout)' };
  const r = spawnSync('node', [s], { cwd: REPO, encoding: 'utf8', timeout: 180000 });
  const lines = `${r.stdout || ''}`.split('\n');
  const sum = lines.filter((l) => /^== \d+ rood/.test(l)).pop();
  // Alleen tabelregels (`DOC-x  STATUS  …`); de legenda eronder noemt WAARSCH
  // ook en zou anders als een lege code meekomen. Uniek: DOC-5 heeft 6 rijen.
  const codes = (st) => [...new Set(lines.filter((l) => new RegExp(`^DOC-\\S*\\s+${st}\\s`).test(l)).map((l) => l.split(/\s+/)[0]))];
  const rood = codes('ROOD'); const waarsch = codes('WAARSCH');
  if (!sum) return { regel: `niet uitgevoerd (exit ${r.status}${r.error ? `, ${r.error.message}` : ''})` };
  return {
    regel: `exit ${r.status} &middot; ${esc(sum.replace(/^== | ==$/g, ''))}`
      + (rood.length ? ` &middot; rood: ${rood.map(code).join(' ')}` : '')
      + (waarsch.length ? ` &middot; waarschuwing: ${waarsch.map(code).join(' ')}` : ''),
  };
}

// ── Blok: de breukstreep ─────────────────────────────────────────────────────
function breuk(a, b, w) {
  const straddle = a && b && String(b.created_at) < BREUK && String(a.created_at) >= BREUK;
  const inWeek = String(w.ws_date) <= BREUK && BREUK <= String(w.we_date);
  if (!straddle && !inWeek) return '';
  return `<hr />${p(`<strong>⎯ trendbreuk ${BREUK}</strong> &mdash; sinds die datum draaien de 71 legacy-items als `
    + `gebruiker (persona ${code('jelle')}) in plaats van op de service-key (DECISIONS V5, spoor 01). `
    + (straddle ? 'De twee runs hierboven liggen aan weerszijden van deze streep: de Δ is gemengd, geen gelijkwaardige vergelijking.'
      : 'De streep valt in deze week; vergelijkingen over de streep heen zijn niet gelijkwaardig.'))}`;
}

// ── Blok: kop ────────────────────────────────────────────────────────────────
function kop(w, extra) {
  return h(1, `Trend &mdash; evalweek ${w.week}`)
    + p(`<strong>Week:</strong> ${w.ws_date} t/m ${w.we_date} (UTC) &middot; `
      + `<strong>Gegenereerd:</strong> ${utc(w.nu)} UTC door ${code('scripts/agent_trend_page.cjs')} &middot; `
      + `<strong>Bron:</strong> uitsluitend SQL op prod (${code('v_agent_eval_runs')}, ${code('v_agent_eval_by_category')}, `
      + `${code('v_agent_eval_core_trend')}, ${code('v_agent_chat_runs_health')}, ${code('security_findings')}).${extra || ''}`);
}

// ── De lege pagina ───────────────────────────────────────────────────────────
function bodyLeeg(w, r, d, audit) {
  const cron = (d.weekly_cron && d.weekly_cron.schedule) || '?';
  const slot = cronSlot(cron, w.ws_date);
  const v = d.vuringen || [];
  const stil = v.filter((x) => !x.heeft_run);
  const reden = [];
  const buitenHistorie = d.historie_vanaf && String(w.ws_date) < String(d.historie_vanaf);
  if (!v.length) {
    reden.push(!w.week_voorbij
      ? `de vuring van deze week staat nog te gebeuren: <strong>${slot || cron}</strong> (cron ${code('rag-eval-weekly')}, ${code(cron)})`
      : buitenHistorie
        // Geen negatief bewijs claimen dat er niet is: pg_cron ruimt op.
        ? `geen vuringshistorie bewaard voor deze week &mdash; ${code('cron.job_run_details')} gaat terug tot ${d.historie_vanaf}`
        : `cron ${code('rag-eval-weekly')} (${code(cron)}) heeft deze week <strong>niet gevuurd</strong>`);
  } else if (stil.length) {
    reden.push(`cron ${code('rag-eval-weekly')} vuurde op ${stil.map((x) => `<strong>${x.start_utc} UTC</strong> (pg_cron: ${esc(x.status)})`).join(', ')} `
      + `maar er staat <strong>geen runrij</strong> tegenover &mdash; stille mislukking, zie ${code('DOC-11')}`);
  } else {
    reden.push(`cron vuurde ${v.length}&times;, maar geen enkele ronde haalde status ${code('done')}`);
  }
  for (const x of r.in_week_any || []) {
    if (x.status !== 'done') reden.push(`wél een weekrij in deze week: ${code(x.label)} ${utc(x.created_at)} UTC, status ${code(x.status)}, ${x.n_results || 0} resultaten`);
  }
  const lw = d.laatste_weekronde || {};
  reden.push(`laatste geslaagde weekronde ${w.week_voorbij ? 'vóór het einde van deze week' : ''}: <strong>${lw.datum || 'geen'}</strong>`
    + (lw.dagen == null ? '' : ` (${lw.dagen} dagen ${w.week_voorbij ? 'vóór dat moment' : 'geleden'} &mdash; ${code('DOC-10')} slaat om boven 8)`));
  for (const f of d.findings || []) reden.push(`open guard-finding ${code(f.affected_object)}: ${esc(f.title)} (${esc(f.severity)}, ${f.found} UTC)`);
  // De repo-audit kent geen tijdmachine: hij scant de checkout van nu. Op een
  // inhaalpagina hoort dat erbij te staan, want al het andere op de pagina is
  // stand-einde-van-die-week.
  reden.push(`repo-audit${w.week_voorbij ? ' (stand van nu, niet van die week)' : ''}: ${audit.regel}`);

  return kop(w) + h(2, 'geen weekronde')
    + p('<strong>geen weekronde</strong> &mdash; er is deze week geen geslaagde wekelijkse evalronde. '
      + 'Dat is geen ontbrekende pagina maar een gemeten uitkomst; de reden staat hieronder.')
    + ul(reden)
    + breuk(null, null, w);
}

// ── De volle pagina ──────────────────────────────────────────────────────────
function bodyVol(w, r, cats, core, rood, kost, d, audit) {
  const a = r.target; const b = r.prior;
  const geldig = [
    `${code(a.label)} / ${code(a.suite)}`, `status ${code(a.status)}`,
    `${utc(a.created_at)} UTC`, `${a.duration_s == null ? '?' : a.duration_s} s`,
    `${a.n_results || 0} van ${a.n_questions || 0} items`,
    `signaal ${pct(a.signal_pass_rate == null ? null : a.signal_pass_rate * 100) || '&ndash;'}`,
    `kosten ${usd(a.cost_usd_total) || 'niet vastgelegd'}`,
    `persona_ok ${bool(a.persona_ok) || 'niet vastgelegd'}`,
    `G1 ${a.g1 || '&ndash;'} / G4 ${a.g4 || '&ndash;'}`,
    `runner ${a.runner_version ? esc(a.runner_version) : 'niet vastgelegd'}`,
  ].join(' &middot; ');

  // ── categorie ──
  const movers = cats.filter((c) => c.delta_pp != null && Math.abs(Number(c.delta_pp)) >= 5)
    .sort((x, y) => Number(x.delta_pp) - Number(y.delta_pp));
  const catRows = cats.map((c) => [
    code(c.category), c.n, c.pass, c.fail, c.pending || 0, pct(c.pass_pct), delta(c.delta_pp),
    c.n == null ? 'weg deze week' : c.prior_n == null ? 'nieuw' : '',
  ]);

  // ── kern-22 ──
  const items = core.items || [];
  // Zonder voorganger is élk item "gewisseld" (`toen` is overal leeg). Dat is
  // geen trendlijn maar een lijst van 22, dus dan geen tabel.
  const flips = b ? items.filter((i) => i.nu !== i.toen) : [];
  const flipRows = flips.map((i) => [
    code(i.question_id), i.lane || '&ndash;',
    i.toen == null ? 'niet gemeten' : i.toen ? '🟢 groen' : '🔴 rood',
    i.nu == null ? 'niet gemeten' : i.nu ? '🟢 groen' : '🔴 rood',
    i.corr == null ? null : nl(i.corr, 2),
  ]);
  const groen = items.filter((i) => i.nu === true).length;
  const gemeten = items.filter((i) => i.nu != null).length;

  // ── blijvend rood ──
  const zonder = rood.filter((x) => !x.heeft_datum);
  const roodRows = rood.map((x) => [
    code(x.id), code(x.category), x.is_core ? 'kern' : '', x.heeft_datum ? '🟢 heeft datum' : '🔴 geen datum',
    x.notes ? esc(x.notes) + (x.notes.length >= 120 ? '&hellip;' : '') : '&ndash;',
  ]);

  // ── kosten ──
  const kv = kost.per_verkeer || [];
  const evalRij = kv.find((x) => x.verkeer === 'eval');
  const kostRows = kv.map((x) => [code(x.verkeer), x.runs, x.failed, usd(x.usd), x.p95_ms == null ? null : `${x.p95_ms} ms`]);

  return kop(w)
    + h(2, 'De meting')
    + p(geldig)
    + p(`<strong>${a.pass || 0} groen &middot; ${a.fail || 0} rood &middot; ${a.pending || 0} open</strong>`
      + (b ? ` &middot; vorige weekronde: ${code(b.label)} ${utc(b.created_at)} UTC (${b.pass || 0} groen / ${b.fail || 0} rood, signaal ${pct(b.signal_pass_rate == null ? null : b.signal_pass_rate * 100) || '&ndash;'})`
        : ' &middot; geen eerdere weekronde om tegen af te zetten'))
    + (a.n_identity_unreliable ? p(`⚠ ${a.n_identity_unreliable} item(s) met onbetrouwbare identiteit in deze ronde &mdash; die dragen geen conclusie.`) : '')

    + h(2, 'Per categorie')
    + p(!b
      ? `Geen vorige weekronde om tegen af te zetten &mdash; de Δ-kolom blijft leeg. Dit is de eerste ronde in de reeks.`
      : movers.length
        ? `Grootste bewegingen: ${movers.slice(0, 6).map((c) => `${code(c.category)} ${delta(c.delta_pp)}`).join(' &middot; ')}.`
        : 'Geen categorie bewoog 5&nbsp;pp of meer ten opzichte van de vorige weekronde.')
    + table(['Categorie', 'n', 'groen', 'rood', 'open', 'pass', 'Δ pp', ''], catRows)
    + p(`Er staat bewust geen totaal onder deze tabel: de categorieën hebben n=1 tot n=5 en een gemiddelde `
      + `verbergt precies de verschuiving die het stuurgetal is (RESEARCH §4.3).`)
    + breuk(a, b, w)

    + h(2, `Kern-22 &mdash; ${groen} van ${gemeten} gemeten groen`)
    + (flipRows.length
      ? table(['Item', 'lane', 'vorige weekronde', 'deze weekronde', 'correctness'], flipRows)
      : p(b ? 'Geen enkel kernitem wisselde van kleur ten opzichte van de vorige weekronde.'
        : 'Geen vorige weekronde om kleurwissels tegen af te zetten.'))
    + p(`${core.kern_totaal || '?'} items staan als ${code('is_core')} in de bank; ${gemeten} daarvan zaten in deze ronde.`)

    + h(2, 'Blijvend rood')
    + p(rood.length
      ? `${rood.length} item(s) staan drie opeenvolgende ${code('rook-p0')}-rondes volledig rood, waarvan `
        + `<strong>${zonder.length} zonder ${code('rood sinds <datum>')} in ${code('notes')}</strong>. `
        + `Een item dat altijd rood staat is een besluit, geen bug &mdash; zonder datum is het schuld zonder eigenaar (vragenbank README §10).`
      : `Geen item staat drie opeenvolgende ${code('rook-p0')}-rondes volledig rood.`)
    + (roodRows.length ? table(['Item', 'categorie', '', 'datum in notes', 'notes (afgekapt)'], roodRows) : '')

    + h(2, 'Kosten')
    + p(`Weekronde: <strong>${usd(a.cost_usd_total) || 'niet vastgelegd'}</strong>`
      + (a.cost_usd_total == null ? ` &mdash; de ${code('cron-weekly')}-reeks legde geen kosten vast; nieuwe ${code('weekly*')}-rondes doen dat wel.` : '.')
      + (evalRij ? ` Evalverkeer van deze week: <strong>${usd(evalRij.usd)}</strong> over ${evalRij.runs} runs.` : ''))
    + table(['Verkeer', 'runs', 'mislukt', 'kosten', 'p95 wall'], kostRows)
    + p(`Gemeten over ${kost.dagen_gemeten || 0} dag(en) met verkeer in deze week. De weekronde is een fractie van de rekening; `
      + `het verkeer eromheen is het bedrag dat onzichtbaar blijft als niemand het afzet (RESEARCH §4.3).`)

    + h(2, 'Drift')
    + p(`Repo-audit ${code('scripts/agent_docs_audit.cjs')}${w.week_voorbij ? ' (stand van nu, niet van die week)' : ''}: ${audit.regel}.`)
    + p(`DB-guard ${code('agent_docs_staleness_check()')} op cron ${code((d.guard_cron && d.guard_cron.schedule) || '?')}`
      + `${d.guard_cron && d.guard_cron.active === false ? ' (<strong>uit</strong>)' : ''} &mdash; `
      + `${(d.findings || []).length} open finding(s).`)
    + ((d.findings || []).length
      ? table(['Gevonden (UTC)', 'severity', 'categorie', 'object', 'titel'],
        d.findings.map((f) => [f.found, esc(f.severity), code(f.category), code(f.affected_object), esc(f.title)]))
      : p('Geen open findings van de docs-guard of de RAG-pijplijnguard.'))
    + ((d.vuringen || []).some((x) => !x.heeft_run)
      ? p(`⚠ ${d.vuringen.filter((x) => !x.heeft_run).length} cronvuring(en) in deze week zonder runrij: `
        + `${d.vuringen.filter((x) => !x.heeft_run).map((x) => `${x.start_utc} UTC`).join(', ')}.`)
      : '');
}

// ── Hoofd ────────────────────────────────────────────────────────────────────
(async () => {
  if (!C.SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }
  const sql = C.sql;
  const w = await Q.resolveWeek(sql, WEEK);
  const r = await Q.runs(sql, w);
  const d = await Q.drift(sql, w);
  const audit = repoAudit();

  let body;
  if (!r.target) {
    body = bodyLeeg(w, r, d, audit);
  } else {
    const [cats, core, rood, kost] = [
      await Q.byCategory(sql, r.target.id, r.prior && r.prior.id),
      await Q.coreTrend(sql, r.target.id, r.prior && r.prior.id),
      await Q.blijvendRood(sql),
      await Q.kosten(sql, w),
    ];
    body = bodyVol(w, r, cats, core, rood, kost, d, audit);
  }

  const title = `Trend — evalweek ${w.week}`;
  console.log(`== trendpagina ${w.week} · ${r.target ? `weekronde ${r.target.label} ${utc(r.target.created_at)}Z` : 'GEEN weekronde'} · ${body.length} tekens ==`);
  if (OUT) { fs.writeFileSync(OUT, body); console.log(`body → ${OUT}`); }
  if (DRY) {
    console.log(`-- dry-run: Confluence niet aangeraakt. Titel zou zijn: "${title}" onder ${PARENT}`);
    if (!OUT) console.log(body);
    process.exit(0);
  }

  const res = await C.upsertPage({ parentId: PARENT, title, body });
  console.log(`${res.created ? 'aangemaakt' : 'overschreven'}: ${res.id} v${res.version} · ${res.url}`);

  // Verifiëren, niet aannemen: `body.view` is wat de lezer ziet. Een ontsnapte
  // entity of een achtergebleven `${` valt daar op en in storage niet.
  const v = await C.renderedBody(res.id);
  const leaks = [];
  if (v.view.includes('${')) leaks.push('JS-rest ${');
  for (const e of ['&amp;mdash;', '&amp;middot;', '&amp;nbsp;', '&amp;ndash;']) if (v.view.includes(e)) leaks.push(e);
  if (!v.view.length) leaks.push('lege render');
  console.log(`verify: v${v.version} · ${v.view.length} tekens gerenderd · ${leaks.length ? `LEK: ${leaks.join(', ')}` : 'geen lekken'}`);
  process.exit(leaks.length ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(2); });
