#!/usr/bin/env node
// =============================================================================
// outlook_pin_probe.cjs — de pin-property van Outlook meten (en zetten)
// =============================================================================
// Outlook's "Aan bovenkant vastmaken" is geen Graph-veld maar een MAPI-property:
// PidTagPinTimestamp, id 0x6204. Er is geen `isPinned` op `message`, en
// Composio's `OUTLOOK_LIST_MESSAGES` strookt de `$expand` die je nodig hebt om
// hem te lezen (OUTLOOK-PARITY-RESEARCH §1.2). Dat leek het einde van het
// verhaal; het was het einde van de *toolkit*.
//
// Dit script praat langs de tools heen, via Composio's proxy-endpoint
// (`POST /api/v3/tools/execute/proxy`) rechtstreeks met Graph — dezelfde
// verbinding, dezelfde grant, zonder tool-schema ertussen. Daarmee kun je de
// property gewoon lezen, schrijven en wissen. Gemeten 2026-09-15.
//
// ── Waarvoor je hem draait ──────────────────────────────────────────────────
//
//   --scan          (default) leest de Inbox en zegt welke mails de property
//                   dragen, en in welke MAPI-vorm. Verandert niets.
//
//   --roundtrip --message-id '<AAMk…>'
//                   zet de property, leest hem terug, wist hem en leest nog
//                   eens. Dat is het bewijs dat de schrijfkant werkt. Laat de
//                   mail achter zoals hij was.
//
//   --pin / --unpin --message-id '<AAMk…>'
//                   zet of wist hem écht en laat het zo.
//
// ── De open vraag die dit script moet beantwoorden ──────────────────────────
// Een MAPI-property-tag is (id << 16 | type), dus `SystemTime 0x6204` en
// `Integer 0x6204` zijn voor Graph twee verschillende properties. Allebei laten
// zich schrijven. **Welke van de twee Outlook zelf gebruikt is niet bekend** —
// in Jelle's mailbox stond op het moment van meten geen enkele mail vastgemaakt,
// dus er was geen echt voorbeeld om tegenaan te houden.
//
// Zo kom je eruit, in één minuut:
//   1. Maak in Outlook (desktop of web) één mail in je Postvak IN vast.
//   2. `node scripts/outlook_pin_probe.cjs --scan`
//   3. De regel met PIN noemt de vorm die Outlook gebruikt.
// Zet die vorm daarna vooraan in `PIN_PROPS` in
// `supabase/functions/_shared/outlook-read.ts` en noteer hem in
// RESEARCH-PIN-STATUS.md. Tot die meting schrijft Maestro ze allebei — dat kan
// geen kwaad (het zijn losse properties) maar het is een gok met vangnet, geen
// antwoord.
//
// Gebruik:
//   SBT=<management_token> node scripts/outlook_pin_probe.cjs [--scan] [--top 100]
// =============================================================================

const fs = require('fs');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const COMPOSIO = 'https://backend.composio.dev/api/v3';

const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;
if (!SBT) { console.error('geen management-token: zet SBT='); process.exit(2); }

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

const MESSAGE_ID = val('--message-id', null);
const TOP = Number(val('--top', '100'));
const MODE = flag('--roundtrip') ? 'roundtrip'
  : flag('--pin') ? 'pin'
  : flag('--unpin') ? 'unpin'
  : 'scan';

// De vormen waarin PidTagPinTimestamp kan voorkomen, plus één controle-property
// die op élke mail staat. Die controle is het hele punt: als het filter niets
// oplevert weet je zonder hem niet of de mail niet gepind is óf de $expand
// onderweg gestript werd. Precies die verwarring hield de pin-baan tegen.
const PIN_PROPS = ['SystemTime 0x6204', 'Integer 0x6204', 'Binary 0x6204'];
const CONTROL_PROP = 'String 0x0070';   // PR_CONVERSATION_TOPIC

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql_${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

let cachedKey = null;
async function composioKey() {
  if (cachedKey) return cachedKey;
  const rows = await sql(`select get_skill_secret_service('global','composio_api_key') as k`);
  cachedKey = rows[0] && rows[0].k;
  if (!cachedKey) {
    const r2 = await sql(`select config_value from agent_config where agent_name='global' and config_key='composio_api_key'`);
    cachedKey = r2[0] && r2[0].config_value;
  }
  if (!cachedKey) throw new Error('geen composio_api_key');
  return String(cachedKey).replace(/^"|"$/g, '');
}

async function mailbox() {
  const rows = await sql(`select mailbox_email, composio_connection_id from mail_accounts
    where enabled and not paused order by created_at limit 1`);
  if (!rows.length) throw new Error('geen mail_accounts-rij');
  return rows[0];
}

/**
 * Eén Graph-call langs de proxy. `path` MOET met `/v1.0/` beginnen: zonder die
 * versie leest Graph het eerste segment als API-versie en antwoordt met
 * "Invalid version: me" — een 404 die niets met de mailbox te maken heeft.
 */
async function graph(conn, method, path, body) {
  const key = await composioKey();
  const payload = { connected_account_id: conn, endpoint: path, method };
  if (body) payload.body = body;
  const r = await fetch(`${COMPOSIO}/tools/execute/proxy`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let w; try { w = JSON.parse(text); } catch { throw new Error(`proxy_non_json_${r.status}`); }
  // De proxy geeft altijd 200; de échte status zit in het lichaam.
  const inner = typeof w.status === 'number' ? w.status : r.status;
  return { status: inner, body: w.data || {} };
}

const expand = (props) =>
  `$expand=singleValueExtendedProperties($filter=${encodeURIComponent(props.map(p => `id eq '${p}'`).join(' or '))})`;

function propsOf(m) {
  const list = Array.isArray(m.singleValueExtendedProperties) ? m.singleValueExtendedProperties : [];
  return list.map(p => `${p.id}=${String(p.value).slice(0, 32)}`);
}

(async () => {
  const acct = await mailbox();
  const conn = acct.composio_connection_id;
  console.log(`mailbox: ${acct.mailbox_email}\n`);

  if (MODE === 'scan') {
    const url = `/v1.0/me/mailFolders/inbox/messages?$top=${TOP}`
      + `&$select=id,subject,isRead,receivedDateTime&${expand([...PIN_PROPS, CONTROL_PROP])}`;
    const r = await graph(conn, 'GET', url);
    if (r.status !== 200) { console.error('scan faalde:', r.status, JSON.stringify(r.body).slice(0, 300)); process.exit(1); }
    const rows = r.body.value || [];
    let pins = 0, controls = 0;
    for (const m of rows) {
      const props = propsOf(m);
      const pin = props.filter(p => p.includes('0x6204'));
      if (props.some(p => /^String 0x70/.test(p))) controls++;
      if (pin.length) pins++;
      console.log(`${pin.length ? 'PIN ' : ' .  '} ${(m.subject || '(geen onderwerp)').slice(0, 58).padEnd(58)} ${pin.join(' ')}`);
    }
    console.log(`\n${rows.length} mails · ${pins} met de pin-property`);
    // Zonder deze regel is "0 pins" dubbelzinnig: niets gepind, of expand kapot.
    console.log(controls > 0
      ? `controle: ${controls}/${rows.length} droegen ${CONTROL_PROP} — $expand werkt, dus 0 pins betekent écht 0 pins`
      : `⚠ controle MISLUKT: geen enkele mail droeg ${CONTROL_PROP}. De $expand komt niet aan; deze uitslag zegt niets.`);
    if (pins > 0) console.log('→ de vorm hierboven is wat Outlook zelf schrijft. Zet die vooraan in PIN_PROPS (outlook-read.ts).');
    return;
  }

  if (!MESSAGE_ID) { console.error('--message-id ontbreekt'); process.exit(2); }
  const path = `/v1.0/me/messages/${encodeURIComponent(MESSAGE_ID)}`;
  const read = async () => {
    const r = await graph(conn, 'GET', `${path}?$select=id,subject&${expand(PIN_PROPS)}`);
    return propsOf(r.body);
  };
  const write = async (iso, unix) => graph(conn, 'PATCH', path, {
    singleValueExtendedProperties: [
      { id: 'SystemTime 0x6204', value: iso },
      { id: 'Integer 0x6204', value: unix },
    ],
  });
  const wipe = async () => {
    for (const p of ['SystemTime 0x6204', 'Integer 0x6204']) {
      await graph(conn, 'DELETE', `${path}/singleValueExtendedProperties/${encodeURIComponent(p)}`);
    }
  };

  const before = await read();
  console.log('vooraf :', before.length ? before.join(' ') : '(geen pin-property)');

  if (MODE === 'unpin') {
    await wipe();
    console.log('na     :', (await read()).join(' ') || '(geen pin-property)');
    return;
  }

  const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const unix = String(Math.floor(Date.now() / 1000));
  const w = await write(iso, unix);
  console.log('schrijf:', w.status);
  console.log('terug  :', (await read()).join(' ') || '(niets — de write kwam niet aan)');

  if (MODE === 'roundtrip') {
    await wipe();
    const after = await read();
    console.log('gewist :', after.length ? `⚠ er staat nog ${after.join(' ')}` : 'ja, schoon');
    console.log(before.length
      ? '\n⚠ deze mail was vooraf al gepind en is dat nu niet meer — zet hem in Outlook terug.'
      : '\nde mail is achtergelaten zoals hij was.');
  }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
