#!/usr/bin/env node
// =============================================================================
// mail_cadence_check.cjs — bewijst de cadans-formule van de mailbox-ETL's
// =============================================================================
//
// Waarom dit bestaat (S5, PR-D)
// -----------------------------
// Tot v1.219 claimde elke ETL-aanroep precies één mailbox
// (`claim_next_mail_account` → `LIMIT 1 … FOR UPDATE SKIP LOCKED`). De cadans
// deelde daarmee door het aantal mailboxen: bij zes mailboxen kwam mail elke
// 30 minuten binnen in plaats van elke vijf, en de agenda elke 90 minuten.
// Met één mailbox is dat onzichtbaar — en precies dáárom hoort er een poort
// omheen die het ook zonder tweede mailbox laat zien.
//
// Deze poort meet GEEN productie. Hij is deterministisch en heeft geen token
// nodig, zodat hij in CI kan staan en op elke laptop hetzelfde zegt:
//
//   1. de formule zelf, met de verwachte cadans bij 1, 2 en 6 mailboxen;
//   2. de code: claimen de drie ETL's N mailboxen per invocatie, begrensd?
//   3. de driver: blijft de claim-regel, de per-eigenaar-isolatie en de
//      begrensde looptijd staan?
//
// Met `--live` (management-token nodig) controleert hij bovendien dat de
// cron-perioden in de tabel hieronder nog kloppen met `cron.job` op productie.
// Zonder die vlag slaat hij dat zichtbaar over — nooit stil groen.
//
// Gebruik:
//   node scripts/mail_cadence_check.cjs            # deterministisch, geen token
//   node scripts/mail_cadence_check.cjs --live     # + cron-perioden op prod
// =============================================================================

const fs = require('fs');
const path = require('path');

const WORTEL = path.join(__dirname, '..');
const LIVE = process.argv.includes('--live');

// ── De vier ETL's die een mailbox claimen ────────────────────────────────────
//
// `schedule` is gemeten op prod (`select jobname, schedule from cron.job`),
// `p95_s` uit `agent_runs` over zeven dagen — beide op 2026-09-15 21:40 UTC
// (23:40 CEST). `--live` houdt allebei tegen de werkelijkheid; lopen ze achter,
// dan klopt de verwachte cadans hieronder ook niet meer en hoort de poort rood
// te zijn.
//
// De twee ándere consumenten van de registry staan bewust NIET in deze lijst,
// want ze claimen al meerdere accounts per aanroep. Ze worden hieronder wél
// gecontroleerd (assertie B1/B2), zodat "we zijn ze vergeten" niet stil kan.
const ETLS = [
  {
    slug: 'mail-sync-etl-v2',
    cron_job: 'mail-sync-etl',
    schedule: '*/5 * * * *',
    periode_min: 5,
    agent_run: 'mail-sync',
    p95_s: 16.2,
    wat: 'mail',
  },
  {
    slug: 'outlook-calendar-sync-etl',
    cron_job: 'outlook-calendar-sync-etl',
    schedule: '*/15 * * * *',
    periode_min: 15,
    agent_run: 'outlook-calendar-sync',
    p95_s: 4.2,
    wat: 'agenda',
  },
  {
    slug: 'mail-reconcile',
    cron_job: 'mail-reconcile-30min',
    schedule: '5,35 * * * *',
    periode_min: 30,
    agent_run: 'mail-reconcile',
    p95_s: 8.9,
    wat: 'mailrec',
  },
  {
    slug: 'calendar-reconcile',
    cron_job: 'calendar-reconcile-30min',
    schedule: '7,37 * * * *',
    periode_min: 30,
    agent_run: 'calendar-reconcile',
    p95_s: 4.1,
    wat: 'agendarec',
  },
];

// De twee die hun eigen N-per-aanroep al hadden. Hier alleen de controle dat
// dat zo blijft — geen wijziging in deze PR.
const AL_MEERDERE = [
  {
    naam: 'mail-backfill',
    bron: 'supabase/functions/mail-backfill/index.ts',
    patroon: /bucketsProcessed < MAX_BUCKETS_PER_RUN/,
    waarom: 'claimt buckets (claim_next_backfill_bucket), 5 per run, eigen wall-budget',
  },
  {
    naam: 'mail-enricher',
    bron: null,   // de lus staat in SQL, niet in de repo
    patroon: null,
    waarom: 'mail_enrichment_trigger_backfill_batch() loopt zelf over 2 accounts per tik; '
          + 'verhogen is een KOSTEN-knop (4 betaalde calls per account), geen cadans-knop',
  },
];

// De gateway kapt een invocatie af op ~150 s idle. Het wall-budget van een ETL
// moet daar ruim onder blijven, én onder zijn eigen cron-periode, anders halen
// twee runs elkaar in. Zie geheugen `edge-gateway-limits-and-readonly-mgmt-api`.
const GATEWAY_IDLE_MS = 150_000;

const uitslagen = [];
function assert(id, wat, ok, gemeten, verwacht) {
  uitslagen.push({ id, ok });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(5)} ${wat.padEnd(52)} ${String(gemeten).padEnd(26)} ${verwacht}`);
}
function overslaan(id, wat, reden) {
  uitslagen.push({ id, ok: true, overgeslagen: true });
  console.log(`OVER  ${id.padEnd(5)} ${wat.padEnd(52)} ${reden}`);
}

// ── De formule ───────────────────────────────────────────────────────────────
//
//   interval(A, N, P) = P × ceil(A / N)
//
//   A = aantal claimbare mailboxen
//   N = mailboxen per invocatie (MAX_ACCOUNTS_PER_RUN)
//   P = cron-periode in minuten
//
// N = 1 geeft P × A — de oude situatie, waarin de cadans door het aantal
// mailboxen deelt. N ≥ A geeft P: de cadans is dan onafhankelijk van het
// aantal mailboxen, en dát is wat deze PR koopt.
function interval(aantalMailboxen, perRun, periodeMin) {
  if (!Number.isInteger(aantalMailboxen) || aantalMailboxen < 1) throw new Error('A ≥ 1');
  if (!Number.isInteger(perRun) || perRun < 1) throw new Error('N ≥ 1');
  if (!(periodeMin > 0)) throw new Error('P > 0');
  return periodeMin * Math.ceil(aantalMailboxen / perRun);
}

function leesConstante(bron, naam) {
  const m = bron.match(new RegExp(`const\\s+${naam}\\s*=\\s*([0-9_]+)`));
  return m ? Number(m[1].replace(/_/g, '')) : null;
}

function main() {
  console.log(`mail_cadence_check — ${new Date().toISOString()}`);
  console.log(`formule: interval = cron_periode × ceil(A / N)\n`);

  // ── 1. De formule, met de hand nagerekend ─────────────────────────────────
  // Geen lus die zichzelf bevestigt: de verwachte waarden staan er als getal,
  // precies zoals ze in de PR-body en de impl-notes staan.
  const formuleGevallen = [
    // [A, N, P, verwacht]
    [1, 1, 5, 5], [2, 1, 5, 10], [6, 1, 5, 30],       // oud (N=1), mail
    [1, 6, 5, 5], [2, 6, 5, 5], [6, 6, 5, 5],          // nieuw (N=6), mail
    [1, 1, 15, 15], [2, 1, 15, 30], [6, 1, 15, 90],    // oud, agenda
    [1, 6, 15, 15], [2, 6, 15, 15], [6, 6, 15, 15],    // nieuw, agenda
    [1, 1, 30, 30], [2, 1, 30, 60], [6, 1, 30, 180],   // oud, reconcile
    [1, 6, 30, 30], [2, 6, 30, 30], [6, 6, 30, 30],    // nieuw, reconcile
    [7, 6, 5, 10], [12, 6, 5, 10], [13, 6, 5, 15],     // boven N: weer delen
  ];
  const mis = formuleGevallen.filter(([a, n, p, v]) => interval(a, n, p) !== v);
  assert('F1', 'interval-formule klopt op 21 handgerekende gevallen',
    mis.length === 0,
    mis.length === 0 ? '21/21' : `mis: ${JSON.stringify(mis.slice(0, 3))}`, '21/21');

  // Randgevallen moeten gooien, niet stil een getal geven.
  let gooitGoed = 0;
  for (const arg of [[0, 6, 5], [6, 0, 5], [6, 6, 0], [1.5, 6, 5]]) {
    try { interval(...arg); } catch { gooitGoed++; }
  }
  assert('F2', 'ongeldige invoer gooit i.p.v. een getal te verzinnen',
    gooitGoed === 4, `${gooitGoed}/4`, '4/4');

  // ── 2. De drie ETL's ──────────────────────────────────────────────────────
  const tabel = [];
  for (const etl of ETLS) {
    const pad = path.join(WORTEL, 'supabase', 'functions', etl.slug, 'index.ts');
    if (!fs.existsSync(pad)) { assert(`C-${etl.slug}`, 'bestand bestaat', false, 'ontbreekt', pad); continue; }
    const bron = fs.readFileSync(pad, 'utf8');

    const n = leesConstante(bron, 'MAX_ACCOUNTS_PER_RUN');
    const wall = leesConstante(bron, 'MAX_WALL_TIME_MS');

    assert(`N-${etl.wat}`, `${etl.slug}: MAX_ACCOUNTS_PER_RUN is een getal ≥ 2`,
      Number.isInteger(n) && n >= 2, n === null ? 'ontbreekt' : n, '≥ 2');

    assert(`W-${etl.wat}`, `${etl.slug}: wall-budget < gateway én < cron-periode`,
      Number.isInteger(wall) && wall > 0 && wall < GATEWAY_IDLE_MS && wall < etl.periode_min * 60_000,
      wall === null ? 'ontbreekt' : `${wall} ms`,
      `< ${GATEWAY_IDLE_MS} en < ${etl.periode_min * 60_000}`);

    // De belofte uit de cadans-tabel is pas waar als N mailboxen ook echt in
    // het budget pássen. Zonder deze controle zou je N kunnen verdubbelen en in
    // de PR-body "constant 5 minuten" schrijven terwijl de lus elke tik na drie
    // mailboxen afkapt — groen, en toch niet waar.
    const nodig = Math.round((n ?? 0) * etl.p95_s * 1000);
    assert(`T-${etl.wat}`, `${etl.slug}: N × p95 past in het budget (en dat past)`,
      Number.isInteger(n) && Number.isInteger(wall)
        && nodig <= wall && wall + etl.p95_s * 1000 < GATEWAY_IDLE_MS,
      `${n} × ${etl.p95_s}s = ${(nodig / 1000).toFixed(1)}s`,
      `≤ ${(wall ?? 0) / 1000}s · budget+p95 < ${GATEWAY_IDLE_MS / 1000}s`);

    // De lus moet via de gedeelde driver lopen. Een ETL die zelf
    // `claimMailAccount` aanroept heeft zijn eigen, tweede claim-regel — en
    // dan staat de begrenzing op twee plekken (geheugen
    // `doc12-definition-lives-in-three-places`).
    const viaDriver = /forEachClaimedMailAccount\s*\(/.test(bron);
    const eigenClaim = /\bclaimMailAccount\s*\(/.test(bron);
    assert(`D-${etl.wat}`, `${etl.slug}: claimt via de gedeelde driver, niet zelf`,
      viaDriver && !eigenClaim,
      `driver=${viaDriver} eigen_claim=${eigenClaim}`, 'driver=true eigen_claim=false');

    // Beide grenzen moeten ook echt worden meegegeven.
    assert(`P-${etl.wat}`, `${etl.slug}: geeft beide grenzen mee aan de driver`,
      /maxAccounts:\s*MAX_ACCOUNTS_PER_RUN/.test(bron) && /maxWallMs:\s*MAX_WALL_TIME_MS/.test(bron),
      `${/maxAccounts:\s*MAX_ACCOUNTS_PER_RUN/.test(bron)}/${/maxWallMs:\s*MAX_WALL_TIME_MS/.test(bron)}`,
      'true/true');

    if (Number.isInteger(n)) {
      tabel.push({ etl, n });
    }
  }

  // ── 3. De driver zelf ─────────────────────────────────────────────────────
  const driverPad = path.join(WORTEL, 'supabase', 'functions', '_shared', 'mail-account.ts');
  const driver = fs.readFileSync(driverPad, 'utf8');

  assert('S1', 'driver houdt de claim-regel in SQL (claim_next_mail_account)',
    /claim_next_mail_account/.test(driver), 'aanwezig', 'aanwezig');

  assert('S2', 'lus is begrensd door maxAccounts — geen while(true)',
    /for \(let i = 0; i < rondes; i\+\+\)/.test(driver) && !/while\s*\(\s*true\s*\)/.test(driver),
    'for i < rondes', 'begrensde for-lus');

  assert('S3', 'wall-budget stopt het claimen van een volgende mailbox',
    /Date\.now\(\) - startedMs >= limits\.maxWallMs/.test(driver), 'aanwezig', 'aanwezig');

  assert('S4', 'per-eigenaar-isolatie: try/catch rond handle() binnen de lus',
    /try \{\s*\n\s*fout = await handle\(/.test(driver), 'aanwezig', 'aanwezig');

  assert('S5', 'elke mailbox sluit zijn eigen claim af (retry-volgorde blijft)',
    /await finishMailAccountClaim\(supabase, account, fout/.test(driver), 'aanwezig', 'aanwezig');

  assert('S6', 'nooit twee keer dezelfde mailbox in één invocatie',
    /gezien\.has\(sleutel\)/.test(driver), 'aanwezig', 'aanwezig');

  // ── 3b. De twee consumenten die al meerdere accounts per tik deden ─────────
  for (const c of AL_MEERDERE) {
    if (!c.bron) { overslaan(`B-${c.naam}`, `${c.naam}: al N per tik`, c.waarom); continue; }
    const bron = fs.readFileSync(path.join(WORTEL, c.bron), 'utf8');
    assert(`B-${c.naam}`, `${c.naam}: doet nog steeds meerdere per aanroep`,
      c.patroon.test(bron), c.patroon.test(bron) ? 'lus aanwezig' : 'lus weg', c.waarom.slice(0, 40));
  }

  // calendar-reconcile was tot v1.0 niet per eigenaar gescopeerd: hij las en
  // schreef `calendar_events` zonder `user_id`-filter. Met twee agenda's zou
  // hij de events van de één als verwijderd markeren op grond van de agenda van
  // de ander. Deze assertie houdt die reparatie vast.
  const calRec = fs.readFileSync(
    path.join(WORTEL, 'supabase', 'functions', 'calendar-reconcile', 'index.ts'), 'utf8');
  const calRegels = calRec.split('\n');
  const calEventBlokken = calRegels
    .map((r, i) => (/\.from\("calendar_events"\)/.test(r) ? calRegels.slice(i, i + 6).join('\n') : null))
    .filter(Boolean);
  assert('S7', 'calendar-reconcile filtert elke calendar_events-query op user_id',
    calEventBlokken.length > 0 && calEventBlokken.every((b) => /\.eq\("user_id", ownerUserId\)/.test(b)),
    `${calEventBlokken.filter((b) => /\.eq\("user_id", ownerUserId\)/.test(b)).length}/${calEventBlokken.length}`,
    'alle queries gescopeerd');

  // ── 4. De cadans-tabel die in de PR-body hoort ────────────────────────────
  console.log('\nVerwachte cadans per mailbox (minuten tussen twee beurten):\n');
  console.log(`  ${'ETL'.padEnd(26)} ${'cron'.padEnd(13)} ${'N'.padEnd(3)} ${'A=1'.padEnd(12)} ${'A=2'.padEnd(12)} A=6`);
  for (const { etl, n } of tabel) {
    const rij = [1, 2, 6].map((a) => `${interval(a, 1, etl.periode_min)} → ${interval(a, n, etl.periode_min)}`);
    console.log(`  ${etl.slug.padEnd(26)} ${etl.schedule.padEnd(13)} ${String(n).padEnd(3)} ${rij[0].padEnd(12)} ${rij[1].padEnd(12)} ${rij[2]}`);
  }
  console.log('\n  (vóór → ná; "vóór" is N=1, de situatie tot en met v1.219)');

  // ── 5. Optioneel: kloppen de cron-perioden nog? ───────────────────────────
  if (!LIVE) {
    overslaan('L1', 'cron-perioden op productie', 'zonder --live niet gemeten');
    return klaar();
  }
  return liveCron().then(klaar);
}

async function liveCron() {
  const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
  const SBT = process.env.SBT || (() => {
    try {
      return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
        .mcpServers.supabase.headers.Authorization.split(' ')[1];
    } catch { return null; }
  })();
  if (!SBT) { assert('L1', 'cron-perioden op productie', false, 'geen token', 'token voor --live'); return; }

  let rijen;
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json',
        'User-Agent': 'legal-mind-dashboard-claude/1.0',
      },
      body: JSON.stringify({
        query: `select jobname, schedule, active from cron.job
                 where jobname in (${ETLS.map((e) => `'${e.cron_job}'`).join(',')})`,
        read_only: true,
      }),
    });
    if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
    rijen = await r.json();
  } catch (e) {
    // Onbereikbaar is ROOD, niet stil groen: een timeout bewijst niets.
    assert('L1', 'cron-perioden op productie', false, String(e.message).slice(0, 60), 'bereikbaar');
    return;
  }

  const perNaam = Object.fromEntries(rijen.map((r) => [r.jobname, r]));
  const afwijkend = ETLS.filter((e) => (perNaam[e.cron_job]?.schedule ?? null) !== e.schedule);
  assert('L1', 'cron-perioden in de tabel kloppen met cron.job',
    afwijkend.length === 0,
    afwijkend.length === 0 ? `${ETLS.length}/${ETLS.length}` :
      afwijkend.map((e) => `${e.cron_job}: ${perNaam[e.cron_job]?.schedule ?? 'ontbreekt'}`).join(' · '),
    ETLS.map((e) => `${e.cron_job}=${e.schedule}`).join(' · '));

  const uit = ETLS.filter((e) => perNaam[e.cron_job] && perNaam[e.cron_job].active === false);
  assert('L2', `de ${ETLS.length} cron-jobs staan aan`,
    uit.length === 0, uit.length === 0 ? 'alle vier actief' : uit.map((e) => e.cron_job).join(', '), 'actief');

  // De p95 in de tabel is het getal waarop het wall-budget is gekozen. Loopt de
  // werkelijkheid weg, dan is de belofte "N mailboxen in één tik" stil onwaar
  // geworden. 1,5× speling: dit is een drift-signaal, geen ruis-alarm.
  let gemeten;
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json',
        'User-Agent': 'legal-mind-dashboard-claude/1.0',
      },
      body: JSON.stringify({
        query: `select agent_name,
                       round((percentile_cont(0.95) within group (
                         order by extract(epoch from (completed_at - started_at))))::numeric, 1) as p95
                  from public.agent_runs
                 where agent_name in (${ETLS.map((e) => `'${e.agent_run}'`).join(',')})
                   and started_at > now() - interval '7 days' and completed_at is not null
                 group by agent_name`,
        read_only: true,
      }),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    gemeten = Object.fromEntries((await r.json()).map((x) => [x.agent_name, Number(x.p95)]));
  } catch (e) {
    assert('L3', 'p95 per mailbox in de tabel klopt nog', false, String(e.message).slice(0, 50), 'bereikbaar');
    return;
  }
  const gedreven = ETLS.filter((e) => {
    const nu = gemeten[e.agent_run];
    return !Number.isFinite(nu) || nu > e.p95_s * 1.5;
  });
  assert('L3', 'p95 per mailbox in de tabel klopt nog (≤ 1,5× drift)',
    gedreven.length === 0,
    ETLS.map((e) => `${e.wat}=${gemeten[e.agent_run] ?? '?'}`).join(' '),
    ETLS.map((e) => `${e.wat}≤${(e.p95_s * 1.5).toFixed(1)}`).join(' '));
}

function klaar() {
  const rood = uitslagen.filter((u) => !u.ok);
  const over = uitslagen.filter((u) => u.overgeslagen);
  console.log(`\n${uitslagen.length} controles · ${rood.length} rood · ${over.length} overgeslagen`);
  process.exit(rood.length === 0 ? 0 : 1);
}

const uit = main();
if (uit && typeof uit.then === 'function') uit.catch((e) => { console.error(e); process.exit(2); });
