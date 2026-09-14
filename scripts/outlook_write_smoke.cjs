#!/usr/bin/env node
// =============================================================================
// outlook_write_smoke.cjs — gedragstest voor de Outlook-schrijfbaan
// =============================================================================
// Bewijst dat Maestro (a) een ANTWOORD-concept op een bestaande mail zet, met
// behoud van ontvanger, onderwerp, handtekening en geciteerde chain, en (b) een
// bericht naar een map verplaatst. En dat het nooit verstuurt.
//
// Waarom een gedragstest en geen 200-check: elke stap hier is eerder stil
// misgegaan. De slugs waren ingetrokken (404 in een try/catch = "niets te
// doen"), en `UPDATE_EMAIL` is een VERVANG-call die zonder `to_recipients` de
// geadresseerde wist. Een 200 zegt over geen van beide iets.
//
// Twee modi:
//
//   --composio   (default) praat rechtstreeks met Composio, met dezelfde
//                argumenten als _shared/outlook-write.ts. Draait zónder deploy
//                en is dus de poort vóór een PR.
//   --edge       praat met de gedeployde `outlook-live` als échte gebruiker
//                (gemunte JWT). Draait ná de deploy; toetst ook de
//                403 `no_mailbox_for_user` voor een gebruiker zonder postbus.
//
// Gebruik:
//   SBT=<management_token> node scripts/outlook_write_smoke.cjs \
//     --message-id '<AAMk...>' [--composio|--edge] [--keep] [--prove-wipe]
//
// Kies als --message-id een mail waar een antwoord-concept niets uitmaakt (een
// oude mail uit een afgesloten project). Het concept dat de test maakt gaat aan
// het eind naar Verwijderde items — dat is meteen de MOVE-assertie. Met --keep
// blijft het staan.
//
// ⚠ Er wordt nooit iets verstuurd: de allowlist in _shared/outlook-write.ts
//   kent geen send-slug, en deze test roept er ook geen aan.
// =============================================================================

const fs = require('fs');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const FN = `https://${REF}.supabase.co/functions/v1`;
const COMPOSIO = 'https://backend.composio.dev/api/v3';

const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;
if (!SBT) { console.error('geen management-token: zet SBT='); process.exit(2); }

const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const has = (name) => argv.includes(name);

const MESSAGE_ID = arg('--message-id');
const MODE = has('--edge') ? 'edge' : 'composio';
const KEEP = has('--keep');
const PROVE_WIPE = has('--prove-wipe');

// Herkenbaar genoeg om in de HTML terug te vinden, saai genoeg om per ongeluk
// in een echte mailbox te zien staan zonder schrikken.
const MARK = `maestro-smoke-${Date.now()}`;
const BODY = `Dit is een testconcept van de Outlook-schrijfbaan (${MARK}).\n`
  + `Regel twee, zelfde alinea.\n\nTweede alinea, met een <tag> en een & erin.`;

const results = [];
function assert(id, what, ok, detail = '') {
  results.push({ id, what, ok });
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id}  ${what}${detail ? `  — ${detail}` : ''}`);
}

async function sql(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify(readOnly ? { query, read_only: true } : { query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// ── Composio-modus ──────────────────────────────────────────────────────────

async function composioCtx() {
  const row = (await sql(
    `select public.get_skill_secret_service('global','composio_api_key') as k,
            (select composio_user_id from public.mail_accounts
              where enabled and not paused order by created_at limit 1) as uid,
            (select composio_connection_id from public.mail_accounts
              where enabled and not paused order by created_at limit 1) as cid`, false))[0];
  if (!row?.k) throw new Error('geen composio_api_key in de Vault');
  const uid = row.uid || (await sql(
    `select config_value #>> '{}' as v from public.agent_config
      where agent_name='global' and config_key='composio_user_id'`))[0]?.v || 'user-jelle';
  const cid = row.cid || (await sql(
    `select config_value #>> '{}' as v from public.agent_config
      where agent_name='mail-sync-etl-v2' and config_key='composio_connection_id'`))[0]?.v;
  if (!cid) throw new Error('geen composio_connection_id');
  return { apiKey: row.k, userId: uid, connectionId: cid };
}

async function exec(ctx, tool, args) {
  const r = await fetch(`${COMPOSIO}/tools/execute/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey, ...UA },
    body: JSON.stringify({ user_id: ctx.userId, connected_account_id: ctx.connectionId, arguments: args }),
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { throw new Error(`${tool} non-json ${r.status}: ${t.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`${tool} http ${r.status}: ${String(b?.error ?? '').slice(0, 200)}`);
  if (b.successful === false) throw new Error(`${tool} failed: ${String(b.error ?? '').slice(0, 200)}`);
  return b.data?.response_data ?? b.data ?? {};
}

const addrs = (list) => (Array.isArray(list) ? list : [])
  .map((r) => r?.emailAddress?.address ?? r?.address ?? '').filter(Boolean);

function plainToOutlookHtml(text) {
  if (!text) return '';
  if (/^\s*<[a-z!]/i.test(text)) return text;
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n\n+/).map((p) => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
}
// Moet gelijk blijven aan _shared/outlook-write.ts — anders meet deze test
// iets anders dan de functie doet.
const MARKERS = ['<div id="appendonsend">', '<div id="Signature">', '<hr id="stopSpelling">',
  '<div class="WordSection1">', '<div class="OutlookMessageHeader">',
  '<hr tabindex="-1"', '<div id="divRplyFwdMsg"'];
function injectBodyAboveSignature(template, bodyHtml) {
  for (const m of MARKERS) {
    const i = template.indexOf(m);
    if (i !== -1) return template.slice(0, i) + bodyHtml + template.slice(i);
  }
  return bodyHtml + template;
}

const GET_SELECT = 'id,subject,body,toRecipients,ccRecipients,importance,conversationId,isDraft';

async function runComposio() {
  const ctx = await composioCtx();
  const src = (await exec(ctx, 'OUTLOOK_OUTLOOK_GET_MESSAGE', {
    user_id: 'me', message_id: MESSAGE_ID, select: 'id,subject,conversationId,from',
  }));
  console.log(`  bron: "${String(src.subject ?? '').slice(0, 60)}"  conv=${String(src.conversationId ?? '').slice(-10)}`);

  // W1 — antwoord-concept ÓP de bronmail.
  const draft = await exec(ctx, 'OUTLOOK_OUTLOOK_CREATE_DRAFT_REPLY', {
    user_id: 'me', message_id: MESSAGE_ID, comment: '',
  });
  const draftId = String(draft.id ?? '');
  assert('W1', 'CREATE_DRAFT_REPLY levert een concept-id', !!draftId, draftId.slice(-12));
  if (!draftId) return;

  // W2 — het is een ANTWOORD: zelfde conversatie, niet een los concept.
  const before = await exec(ctx, 'OUTLOOK_OUTLOOK_GET_MESSAGE', {
    user_id: 'me', message_id: draftId, select: GET_SELECT,
  });
  const sameConv = !!src.conversationId && before.conversationId === src.conversationId;
  assert('W2', 'concept zit in dezelfde conversatie als de bronmail', sameConv,
    `draft=${String(before.conversationId ?? '').slice(-10)}`);

  const template = String(before.body?.content ?? '');
  const toBefore = addrs(before.toRecipients);
  assert('W3', 'Outlook vult ontvanger + onderwerp zelf in',
    toBefore.length > 0 && !!before.subject, `to=${toBefore.join(',')} subject="${before.subject}"`);
  const marker = MARKERS.find((m) => template.includes(m));
  console.log(`  template: ${template.length} tekens, injectie-marker: ${marker ?? 'GEEN (body wordt geprepend)'}`);
  assert('W3b', 'er is een injectie-marker (tekst landt binnen <body>, niet vóór <html>)', !!marker, marker ?? '');

  // W4 (optioneel) — laat zien waaróm we ontvangers meesturen: de oude call
  // (alleen subject + body) wist ze. Dit is de bug die v1 stil had.
  if (PROVE_WIPE) {
    await exec(ctx, 'OUTLOOK_OUTLOOK_UPDATE_EMAIL', {
      user_id: 'me', message_id: draftId, subject: before.subject,
      body: { contentType: 'HTML', content: template },
    });
    const wiped = await exec(ctx, 'OUTLOOK_OUTLOOK_GET_MESSAGE', {
      user_id: 'me', message_id: draftId, select: GET_SELECT,
    });
    assert('W4', 'UPDATE zonder to_recipients wist de ontvanger (= waarom stap 2 moet)',
      addrs(wiped.toRecipients).length === 0, `na=${addrs(wiped.toRecipients).join(',') || '(leeg)'}`);
  }

  // W5 — de echte schrijfactie: onze tekst boven handtekening/chain, velden mee.
  const combined = injectBodyAboveSignature(template, plainToOutlookHtml(BODY));
  await exec(ctx, 'OUTLOOK_OUTLOOK_UPDATE_EMAIL', {
    user_id: 'me', message_id: draftId,
    subject: before.subject,
    body: { contentType: 'HTML', content: combined },
    to_recipients: toBefore.map((address) => ({ address })),
    cc_recipients: addrs(before.ccRecipients).map((address) => ({ address })),
    ...(before.importance ? { importance: before.importance } : {}),
  });
  const after = await exec(ctx, 'OUTLOOK_OUTLOOK_GET_MESSAGE', {
    user_id: 'me', message_id: draftId, select: GET_SELECT,
  });
  const html = String(after.body?.content ?? '');
  assert('W5a', 'onze tekst staat in het concept', html.includes(MARK));
  assert('W5b', 'ontvanger staat er ná de update nog',
    addrs(after.toRecipients).length === toBefore.length, addrs(after.toRecipients).join(',') || '(leeg)');
  assert('W5c', 'onderwerp behouden', after.subject === before.subject, `"${after.subject}"`);
  // De chain is het staartstuk van de template; die moet ná onze tekst komen.
  const tail = template.slice(-160);
  assert('W5d', 'handtekening + geciteerde chain behouden',
    tail.length > 0 && html.includes(tail) && html.indexOf(MARK) < html.lastIndexOf(tail));
  assert('W5e', 'HTML is geen platte tekst (<p>/<br> toegepast)',
    html.includes('<p>') && html.includes('<br>'));
  assert('W5f', 'tekens ge-escaped, niet als markup doorgelaten',
    html.includes('&lt;tag&gt;') && html.includes('&amp;'));
  assert('W5g', 'concept is nog een CONCEPT (niet verstuurd)', after.isDraft !== false);
  const bodyOpen = html.indexOf('<body');
  assert('W5h', 'onze tekst staat binnen <body>, niet ervóór',
    bodyOpen !== -1 && html.indexOf(MARK) > bodyOpen);

  // W6 — MOVE. Meteen de opruiming: het testconcept gaat naar Verwijderde items.
  if (!KEEP) {
    const moved = await exec(ctx, 'OUTLOOK_OUTLOOK_MOVE_MESSAGE', {
      user_id: 'me', message_id: draftId, destination_id: 'deleteditems',
    });
    const newId = String(moved.id ?? '');
    assert('W6a', 'MOVE_MESSAGE verplaatst en geeft een id terug', !!newId, newId.slice(-12));
    assert('W6b', 'het id verandert door de move (Graph maakt een kopie)',
      !!newId && newId !== draftId);
    const gone = await exec(ctx, 'OUTLOOK_OUTLOOK_GET_MESSAGE', {
      user_id: 'me', message_id: newId, select: 'id,parentFolderId,isDraft',
    }).catch(() => null);
    assert('W6c', 'het verplaatste concept is op de nieuwe plek te lezen', !!gone?.id);
    console.log('  opgeruimd: testconcept staat in Verwijderde items');
  } else {
    console.log(`  --keep: testconcept ${draftId.slice(-12)} blijft in Concepten staan`);
  }
}

// ── Edge-modus ──────────────────────────────────────────────────────────────

async function runEdge() {
  const { mintUserJwt, revokeMintedSessions } = require('./lib/user-jwt.cjs');
  const keys = await sql(
    `select (select mailbox_email from public.mail_accounts
              where enabled and not paused order by created_at limit 1) as owner_email,
            (select u.email from auth.users u
              where u.id not in (select user_id from public.mail_accounts) limit 1) as no_mailbox_email`,
  );
  const ownerEmail = keys[0]?.owner_email;
  if (!ownerEmail) throw new Error('geen mailbox_email in mail_accounts');
  const serviceKey = (await sql(
    `select public.get_skill_secret_service('global','supabase_service_role_key') as k`, false))[0]?.k
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('geen service-role-sleutel (zet SUPABASE_SERVICE_ROLE_KEY=)');

  const call = async (jwt, body) => {
    const r = await fetch(`${FN}/outlook-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: jwt, ...UA },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const { jwt } = await mintUserJwt({ ref: REF, serviceKey, email: ownerEmail });
  const reply = await call(jwt, {
    action: 'reply_draft', message_id: MESSAGE_ID, body_text: BODY,
  });
  assert('E1', 'reply_draft levert een concept-id', reply.status === 200 && !!reply.body?.draft_id,
    reply.body?.reason ?? String(reply.body?.draft_id ?? '').slice(-12));
  assert('E2', 'ontvanger is bewaard', (reply.body?.to ?? []).length > 0,
    (reply.body?.to ?? []).join(',') || '(leeg)');
  assert('E3', 'geen onverwachte waarschuwingen', (reply.body?.warnings ?? []).length === 0,
    (reply.body?.warnings ?? []).join(' | ') || 'geen');

  if (reply.body?.draft_id && !KEEP) {
    const mv = await call(jwt, {
      action: 'move_message', message_id: reply.body.draft_id, target_folder: 'Verwijderde items',
    });
    assert('E4', 'move_message met de NL-naam "Verwijderde items" werkt',
      mv.status === 200 && !!mv.body?.id, mv.body?.reason ?? '');
  }

  // De tweede helft van het contract: een gebruiker zonder postbus krijgt 403
  // met een herkenbare reden, geen Composio-fout en geen stille org-mailbox.
  const other = keys[0]?.no_mailbox_email;
  if (!other) { console.log('  (geen gebruiker zonder mailbox gevonden — E5 overgeslagen)'); return; }
  const { jwt: jwt2 } = await mintUserJwt({ ref: REF, serviceKey, email: other });
  const denied = await call(jwt2, { action: 'reply_draft', message_id: MESSAGE_ID, body_text: 'x' });
  assert('E5', 'gebruiker zonder postbus krijgt 403 no_mailbox_for_user',
    denied.status === 403 && denied.body?.reason === 'no_mailbox_for_user',
    `${denied.status} ${denied.body?.reason ?? ''}`);
}

(async () => {
  if (!MESSAGE_ID) {
    console.error('gebruik: node scripts/outlook_write_smoke.cjs --message-id <AAMk...> [--composio|--edge] [--keep] [--prove-wipe]');
    process.exit(2);
  }
  console.log(`outlook-write smoke · modus=${MODE} · mark=${MARK}`);
  try {
    if (MODE === 'edge') await runEdge(); else await runComposio();
  } catch (e) {
    assert('XX', 'onverwachte fout', false, e.message);
  } finally {
    // Minten is inloggen; de sessies van deze rooktest horen niet in de
    // Gebruikers-lijst terecht te komen als activiteit (v1.192).
    await revokeMintedSessions();
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} groen`);
  process.exit(bad.length === 0 ? 0 : 1);
})();
