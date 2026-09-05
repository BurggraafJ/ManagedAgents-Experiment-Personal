#!/usr/bin/env node
// =============================================================================
// agent_artifact_smoke.cjs — gedragstest op agent-artifact-build       (WP4)
// =============================================================================
//   SBT=<management_token> node scripts/agent_artifact_smoke.cjs
//
// Zes asserties. De belangrijkste zijn A4 en A5: een artefact mag NOOIT zonder
// eigenaar gemaakt worden en NOOIT publiek leesbaar zijn. Een uitdraai van de
// klantenportefeuille achter een open URL is erger dan geen exportknop.
// =============================================================================
const fs = require('fs');
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

// Geen klantnamen in de repo: de testtabel is verzonnen en herkenbaar als test.
const ROWS = [
  { fase: 'Proeftijd', aantal: 3, waarde_eur: 1250.5, notitie: 'accénten & "aanhalings;tekens"' },
  { fase: 'Actieve deals', aantal: 12, waarde_eur: 18900, notitie: null },
  { fase: 'Self-service', aantal: 5, waarde_eur: 0, notitie: 'nul-waarde blijft nul' },
];

(async () => {
  const fns = await mgmt('/functions');
  const fn = fns.find((f) => f.slug === 'agent-artifact-build');
  assert('A1', 'agent-artifact-build bestaat en verify_jwt = true', fn?.verify_jwt === true, fn?.verify_jwt);

  const keys = await mgmt('/api-keys?reveal=true');
  const serviceKey = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!serviceKey) { console.error('geen service_role-sleutel'); process.exit(2); }

  // A4 — een service-role-sleutel draagt geen persoon en hoort geweigerd te worden.
  const anon = await fetch(`${FN}/agent-artifact-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, ...UA },
    body: JSON.stringify({ type: 'csv', title: 'test', rows: ROWS }),
  });
  const anonJson = await anon.json().catch(() => ({}));
  assert('A4', 'zonder persoon (service_role) → 401', anon.status === 401 && anonJson.error === 'authenticated_user_required', { status: anon.status, body: anonJson });

  // Een echte gebruiker: de eigenaar van het dashboard.
  const [{ email }] = await sql(`select email from auth.users order by created_at limit 1`);
  const { jwt, userId } = await mintUserJwt({ ref: REF, serviceKey, email });

  for (const type of ['xlsx', 'csv']) {
    const r = await fetch(`${FN}/agent-artifact-build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: serviceKey, ...UA },
      body: JSON.stringify({
        type, title: 'Deals per fase (rooktest)',
        question: 'Hoeveel deals staan er per fase in de Sales Pipeline?',
        rows: ROWS, columns: ['fase', 'aantal', 'waarde_eur', 'notitie'],
        params: { definition: 'Niet-gearchiveerde HubSpot-deals, gegroepeerd op pipeline en fase-label.', route: 'structured', searched: ['deal'], not_searched: ['mail', 'agenda'] },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = await r.json().catch(() => ({}));
    assert('A2', `${type}: gebouwd en ondertekend`, r.ok && j.ok && !!j.url && j.rows === ROWS.length, { status: r.status, body: j?.error ?? Object.keys(j) });
    if (!j.ok) continue;

    // A3 — de signed URL levert echt een bestand op, met de juiste magic bytes.
    const dl = await fetch(j.url, { headers: UA });
    const buf = new Uint8Array(await dl.arrayBuffer());
    if (type === 'xlsx') {
      // xlsx is een zip: 'PK\x03\x04'
      assert('A3', 'xlsx: download is een echt zip/xlsx-bestand', dl.ok && buf[0] === 0x50 && buf[1] === 0x4b && buf.length > 2000, { status: dl.status, bytes: buf.length, head: [...buf.slice(0, 4)] });
    } else {
      // csv moet met de UTF-8 BOM beginnen, anders verminkt Excel-NL de accenten
      const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      const text = new TextDecoder().decode(buf);
      assert('A3', 'csv: UTF-8 BOM aanwezig', bom, [...buf.slice(0, 3)]);
      assert('A3', 'csv: verantwoording + accenten intact', text.includes('# Definitie:') && text.includes('accénten'), text.slice(0, 120));
    }

    // A5 — hetzelfde pad ZONDER handtekening moet dicht zijn.
    const naked = j.url.split('?')[0];
    const open = await fetch(naked, { headers: UA });
    assert('A5', `${type}: pad zonder handtekening is dicht`, open.status === 400 || open.status === 401 || open.status === 403 || open.status === 404, open.status);
  }

  // A6 — de administratie klopt: rij bestaat, hangt aan deze gebruiker.
  const rows = await sql(`select count(*)::int n from agent_artifacts where owner_id = '${userId}' and created_at > now() - interval '10 minutes'`);
  assert('A6', 'agent_artifacts-rijen op naam van de aanroeper', (rows[0]?.n ?? 0) >= 2, rows[0]);

  const bad = results.filter((r) => !r.ok);
  console.log(`\n${bad.length === 0 ? '✅ ALLES GROEN' : `❌ ${bad.length} ROOD`}  (${results.length} asserties)`);
  process.exit(bad.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
