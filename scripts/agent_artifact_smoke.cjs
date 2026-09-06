#!/usr/bin/env node
// =============================================================================
// agent_artifact_smoke.cjs — gedragstest op de artefact-pijplijn   (spoor 05 v2)
// =============================================================================
//   SBT=<management_token> node scripts/agent_artifact_smoke.cjs
//
// Twintig asserties (v1.146: tien). De belangrijkste zijn nog steeds A4 en A5:
// een artefact mag NOOIT zonder eigenaar gemaakt worden en NOOIT publiek
// leesbaar zijn. Een uitdraai van de klantenportefeuille achter een open URL is
// erger dan geen exportknop. Die twee gelden sinds v2 per formaat, dus ook voor
// pdf.
//
// Nieuw in v2: A2/A3/A5 voor pdf · een tweede A4 (anon-JWT, die de gateway wél
// doorlaat) · A7 meerdere tabbladen · A8 kolomdefinities · A9 WinAnsi-sanering
// (gemeten faalmodus: één CJK-teken gooide de hele export om) · A10 niets ouder
// dan zijn vervaldatum · A11 geen wezen · A12 bytes/tijd/kosten gelogd.
//
// Draai dit NOOIT tegelijk met een ander edge-zwaar script — dat geeft 502's.
// =============================================================================
const fs = require('fs');
const zlib = require('zlib');
const { mintUserJwt } = require('./lib/user-jwt.cjs');

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

const results = [];
function assert(id, wat, ok, gemeten) {
  results.push({ id, ok: !!ok });
  console.log(`  ${ok ? '✅' : '❌'} ${id.padEnd(3)} ${wat}${ok ? '' : `  → ${JSON.stringify(gemeten)}`}`);
}

async function mgmt(path, init) {
  const r = await fetch(`${MGMT}${path}`, { ...init, headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init?.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${path} ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}
async function sql(query) {
  const r = await fetch(`${MGMT}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA }, body: JSON.stringify({ query }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// ── het bestand echt openmaken ───────────────────────────────────────────────
// Een xlsx is een zip. De centrale directory aan het eind is de betrouwbare
// index (de lokale headers kunnen hun maten in een trailing descriptor hebben),
// dus die lopen we af.
function zipEntries(buf) {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (eocd < 0) return new Map();
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    let data;
    try { data = method === 8 ? zlib.inflateRawSync(raw) : raw; } catch { data = Buffer.alloc(0); }
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
function sheetNames(entries) {
  const wb = entries.get('xl/workbook.xml') || '';
  return [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

// pdf-lib comprimeert de contentstreams, dus grep op de ruwe bytes vindt niets.
// Uitpakken en de hex-strings terugvertalen geeft de echte tekst.
function pdfText(buf) {
  const latin = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) continue;
    const raw = Buffer.from(latin.slice(start, end), 'latin1');
    let txt;
    try { txt = zlib.inflateSync(raw).toString('latin1'); } catch { txt = raw.toString('latin1'); }
    out += txt.replace(/<([0-9A-Fa-f]+)>/g, (_, h) => Buffer.from(h, 'hex').toString('latin1'));
  }
  return out;
}

// Geen klantnamen in de repo: de testtabel is verzonnen en herkenbaar als test.
const ROWS = [
  { fase: 'Proeftijd', aantal: 3, waarde_eur: 1250.5, notitie: 'accénten & "aanhalings;tekens"' },
  { fase: 'Actieve deals', aantal: 12, waarde_eur: 18900, notitie: null },
  { fase: 'Self-service', aantal: 5, waarde_eur: 0, notitie: 'nul-waarde blijft nul' },
];
const COLS = ['fase', 'aantal', 'waarde_eur', 'notitie'];
const DEFS = [
  { key: 'waarde_eur', label: 'Maandwaarde', definition: 'minimale licenties maal prijs per gebruiker', type: 'currency' },
  { key: 'aantal', label: 'Aantal deals', definition: 'niet-gearchiveerde deals in deze fase', type: 'int' },
];
const PARAMS = {
  definition: 'Niet-gearchiveerde HubSpot-deals, gegroepeerd op pipeline en fase-label.',
  route: 'structured', searched: ['deal'], not_searched: ['mail', 'agenda'],
  period: { from: '2026-08-01', to: '2026-08-31', label: 'augustus 2026' },
};

(async () => {
  const fns = await mgmt('/functions');
  const fn = fns.find((f) => f.slug === 'agent-artifact-build');
  assert('A1', 'agent-artifact-build bestaat en verify_jwt = true', fn?.verify_jwt === true, fn?.verify_jwt);

  const keys = await mgmt('/api-keys?reveal=true');
  const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key;
  const anonKey = keys.find((k) => k.name === 'anon')?.api_key;
  if (!serviceKey) { console.error('geen service_role-sleutel'); process.exit(2); }

  const post = (bearer, body, apikey) => fetch(`${FN}/agent-artifact-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, apikey: apikey || serviceKey, ...UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  // A4 (2×) — een sleutel is geen persoon. De service-role-sleutel draagt er
  // geen, en de anon-JWT laat de gateway juist wél door: die moet de functie
  // dus zélf weigeren. Dubbele borging, dus twee metingen.
  const svc = await post(serviceKey, { type: 'csv', title: 'test', rows: ROWS });
  const svcJson = await svc.json().catch(() => ({}));
  assert('A4', 'zonder persoon (service_role) → 401', svc.status === 401 && svcJson.error === 'authenticated_user_required', { status: svc.status, body: svcJson });

  if (anonKey) {
    const an = await post(anonKey, { type: 'csv', title: 'test', rows: ROWS }, anonKey);
    const anJson = await an.json().catch(() => ({}));
    assert('A4', 'anon-JWT komt door de gateway maar wordt door de functie geweigerd → 401', an.status === 401, { status: an.status, body: anJson });
  } else {
    assert('A4', 'anon-sleutel opvraagbaar voor de negatieve test', false, 'geen anon-key in /api-keys');
  }

  // Een echte gebruiker: de eigenaar van het dashboard.
  const [{ email }] = await sql(`select email from auth.users order by created_at limit 1`);
  const { jwt, userId } = await mintUserJwt({ ref: REF, serviceKey, email });

  for (const type of ['xlsx', 'csv', 'pdf']) {
    const r = await post(jwt, {
      type, title: 'Deals per fase (rooktest)',
      question: 'Hoeveel deals staan er per fase in de Sales Pipeline?',
      rows: ROWS, columns: COLS, column_defs: DEFS, params: PARAMS,
    });
    const j = await r.json().catch(() => ({}));
    assert('A2', `${type}: gebouwd en ondertekend`, r.ok && j.ok && !!j.url && j.rows === ROWS.length, { status: r.status, body: j?.error ?? Object.keys(j) });
    if (!j.ok) continue;

    // A3 — de signed URL levert echt een bestand op, met de juiste magic bytes.
    const dl = await fetch(j.url, { headers: UA });
    const buf = Buffer.from(await dl.arrayBuffer());
    if (type === 'xlsx') {
      // xlsx is een zip: 'PK\x03\x04'
      assert('A3', 'xlsx: download is een echt zip/xlsx-bestand', dl.ok && buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 2000, { status: dl.status, bytes: buf.length, head: [...buf.slice(0, 4)] });
    } else if (type === 'csv') {
      // csv moet met de UTF-8 BOM beginnen, anders verminkt Excel-NL de accenten
      const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      const text = buf.toString('utf8');
      assert('A3', 'csv: UTF-8 BOM aanwezig', bom, [...buf.slice(0, 3)]);
      assert('A3', 'csv: verantwoording + accenten intact', text.includes('# Definitie:') && text.includes('accénten'), text.slice(0, 120));
    } else {
      const txt = pdfText(buf);
      assert('A3', 'pdf: %PDF-magic, > 1.500 bytes en het woord "Verantwoording" staat erin',
        dl.ok && buf.slice(0, 5).toString('latin1') === '%PDF-' && buf.length > 1500 && txt.includes('Verantwoording'),
        { status: dl.status, bytes: buf.length, head: buf.slice(0, 5).toString('latin1'), verantwoording: txt.includes('Verantwoording') });
    }

    // A5 — hetzelfde pad ZONDER handtekening moet dicht zijn.
    const naked = j.url.split('?')[0];
    const open = await fetch(naked, { headers: UA });
    assert('A5', `${type}: pad zonder handtekening is dicht`, [400, 401, 403, 404].includes(open.status), open.status);
  }

  // A6 — de administratie klopt: rij bestaat, hangt aan deze gebruiker.
  const rows6 = await sql(`select count(*)::int n from agent_artifacts where owner_id = '${userId}' and created_at > now() - interval '10 minutes'`);
  assert('A6', 'agent_artifacts-rijen op naam van de aanroeper', (rows6[0]?.n ?? 0) >= 3, rows6[0]);

  // A7 — meerdere tabbladen (AR06: "een Excel met per tabblad een maand").
  // De tweede naam is expres verboden én een botsing: Excel weigert [ ] : * ? / \
  // en eist unieke namen, en een botsing is geen foutmelding maar een corrupt
  // bestand.
  const r7 = await post(jwt, {
    type: 'xlsx', title: 'Per maand (rooktest)', question: 'Geef per tabblad een maand',
    sheets: [
      { name: 'januari', columns: COLS, rows: ROWS },
      { name: 'januari*/[2]', columns: COLS, rows: ROWS.slice(0, 2) },
    ],
    column_defs: DEFS, params: PARAMS,
  });
  const j7 = await r7.json().catch(() => ({}));
  let entries7 = new Map();
  let namen7 = [];
  if (j7.ok) {
    const buf7 = Buffer.from(await (await fetch(j7.url, { headers: UA })).arrayBuffer());
    entries7 = zipEntries(buf7);
    namen7 = sheetNames(entries7);
  }
  assert('A7', 'xlsx met 2 tabbladen: 3 werkbladen, databladnamen gesaniteerd en uniek',
    j7.ok && namen7.length === 3 && namen7[2] === 'Verantwoording'
      && new Set(namen7.map((n) => n.toLowerCase())).size === 3
      && !/[[\]:*?/\\]/.test(namen7.slice(0, 2).join('')),
    { ok: j7.ok, error: j7.error, namen: namen7 });

  // A8 — kolomdefinities. In de xlsx staan ze op het verantwoordingsblad (dat
  // hier bewezen bestaat), in de pdf op de laatste pagina — daar is de plek
  // zelfs direct te lezen.
  const strings8 = entries7.get('xl/sharedStrings.xml') || '';
  const xlsxHeeftDefs = DEFS.every((d) => strings8.includes(d.label) && strings8.includes(d.definition)) && namen7.includes('Verantwoording');
  const r8 = await post(jwt, {
    type: 'pdf', title: 'Kolomdefinities (rooktest)', question: 'Wat betekenen de kolommen?',
    rows: ROWS, columns: COLS, column_defs: DEFS, params: PARAMS,
  });
  const j8 = await r8.json().catch(() => ({}));
  let pdfHeeftDefs = false;
  if (j8.ok) {
    const t8 = pdfText(Buffer.from(await (await fetch(j8.url, { headers: UA })).arrayBuffer()));
    pdfHeeftDefs = t8.includes('Kolommen') && DEFS.every((d) => t8.includes(d.label) && t8.includes(d.definition));
  }
  assert('A8', 'kolomdefinities staan in de xlsx-verantwoording én op de pdf-pagina',
    xlsxHeeftDefs && pdfHeeftDefs, { xlsx: xlsxHeeftDefs, pdf: pdfHeeftDefs, error: j8.error });

  // A9 — de gemeten faalmodus: `WinAnsi cannot encode "日" (0x65e5)`. Eén teken
  // buiten CP1252 gooide, en dan valt de hele export om in plaats van die ene
  // cel. De build moet dus slagen én de vervangingen tellen.
  const r9 = await post(jwt, {
    type: 'pdf', title: 'WinAnsi (rooktest)', question: 'Werkt een teken buiten Latin-1?',
    rows: [...ROWS, { fase: '日本語', aantal: 1, waarde_eur: 42, notitie: 'CJK 日 en Grieks λ' }],
    columns: COLS, params: PARAMS,
  });
  const j9 = await r9.json().catch(() => ({}));
  let telling9 = false;
  if (j9.ok) {
    const t9 = pdfText(Buffer.from(await (await fetch(j9.url, { headers: UA })).arrayBuffer()));
    telling9 = /Tekens vervangen/.test(t9) && t9.includes('buiten Latin-1');
  }
  assert('A9', 'CJK-teken laat de build niet falen en de verantwoording telt de vervangingen',
    j9.ok && (j9.sanitized ?? 0) > 0 && telling9, { ok: j9.ok, error: j9.error, sanitized: j9.sanitized, verantwoording: telling9 });

  // A10 — niets ouder dan zijn vervaldatum, ná één opruimrun.
  const [{ s: cronSecret }] = await sql(`select public.get_skill_secret_service('global','cron_secret') as s`);
  let cleanupOk = false;
  let stats10 = null;
  if (cronSecret) {
    const c = await fetch(`${FN}/agent-artifact-cleanup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}`, 'Content-Type': 'application/json', ...UA },
      body: JSON.stringify({}), signal: AbortSignal.timeout(120_000),
    });
    const cj = await c.json().catch(() => ({}));
    cleanupOk = c.ok && cj.ok === true;
    stats10 = cj.stats ?? cj.error;
  }
  const [{ n: verlopen }] = await sql(`select count(*)::int n from agent_artifacts where expires_at < now()`);
  assert('A10', 'na één opruimrun staat er niets meer dat over zijn vervaldatum is',
    cleanupOk && verlopen === 0, { cleanup_ok: cleanupOk, verlopen, stats: stats10 });

  // A11 — geen wezen, in beide richtingen. Een bestand zonder rij is onzichtbaar
  // en blijft eeuwig staan; een rij zonder bestand is dode administratie.
  const [wezen] = await sql(`
    select
      (select count(*)::int from storage.objects o
        where o.bucket_id = 'agent-artifacts' and o.created_at < now() - interval '24 hours'
          and not exists (select 1 from agent_artifacts a where a.storage_path = o.name)) as objecten_zonder_rij,
      (select count(*)::int from agent_artifacts a
        where a.created_at < now() - interval '24 hours'
          and not exists (select 1 from storage.objects o where o.bucket_id = 'agent-artifacts' and o.name = a.storage_path)) as rijen_zonder_object`);
  assert('A11', 'geen wezen: 0 objecten zonder rij en 0 rijen zonder object (> 24 u oud)',
    wezen.objecten_zonder_rij === 0 && wezen.rijen_zonder_object === 0, wezen);

  // A12 — bytes, bouwtijd en kosten staan in de rij. `build_cost_usd` is
  // structureel 0,00 (de lichte weg kost niets) maar mag niet NULL zijn: de
  // kolom bestaat zodat een toekomstige leverancier niet ongezien binnenkomt.
  const [meting] = await sql(`
    select count(*)::int n,
           count(*) filter (where coalesce(bytes,0) > 0)::int met_bytes,
           count(*) filter (where coalesce(build_ms,0) > 0)::int met_ms,
           count(*) filter (where build_cost_usd is not null)::int met_kosten
      from agent_artifacts
     where owner_id = '${userId}' and created_at > now() - interval '10 minutes'`);
  assert('A12', 'elke nieuwe rij draagt bytes, build_ms en build_cost_usd',
    meting.n > 0 && meting.n === meting.met_bytes && meting.n === meting.met_ms && meting.n === meting.met_kosten, meting);

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${bad.length === 0 ? '✅ ALLES GROEN' : `❌ ${bad.length} ROOD`}  (${results.length} asserties)`);
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
