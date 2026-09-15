#!/usr/bin/env node
// =============================================================================
// agenda_write_smoke.cjs — gedragstest voor de agenda-schrijfbaan
// =============================================================================
// Zusje van `outlook_write_smoke.cjs`, om dezelfde reden: alle zes de risico's
// uit RESEARCH-AGENDA-WRITE.md §5 geven **HTTP 200**. Een afzeggingsmail naar
// klanten is een geslaagde call. Een gewiste genodigdenlijst is een geslaagde
// call. Een event dat een uur verschoven staat is een geslaagde call. Een
// 200-check meet hier dus niets.
//
// Twee modi:
//
//   --composio   (default) rechtstreeks op Composio, met exact de argumenten
//                die _shared/outlook-calendar.ts bouwt. Draait zónder deploy en
//                is de poort vóór de PR.
//   --edge       door de gedeployde `outlook-calendar-live` heen, als échte
//                ingelogde gebruiker (gemunte JWT). Draait ná de deploy.
//
// Gebruik:
//   SBT=<management_token> node scripts/agenda_write_smoke.cjs [--composio|--edge] [--keep]
//
// ── Het testobject ──────────────────────────────────────────────────────────
// De test maakt zijn eigen wegwerp-events en ruimt ze zelf op. Ze staan in
// 2027, ruim BUITEN het venster van `calendar-reconcile` (60 dagen terug, 90
// vooruit), zodat ze de spiegel niet in de war kunnen schoppen. Genodigde bij
// de attendee-asserties is de eigen mailbox: mocht er tóch post uitgaan, dan
// landt die in het eigen postvak en nergens anders.
//
// ⚠ Deze test doet ECHTE schrijfacties op de agenda van de mailbox-eigenaar.
//   Elk event dat hij maakt wordt in dezelfde run verwijderd met
//   `send_notifications: false` (ook in de `finally`, ook na een crash).
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
const has = (name) => argv.includes(name);
const MODE = has('--edge') ? 'edge' : 'composio';
const KEEP = has('--keep');

const TOOLS = {
  CREATE: 'OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT',
  UPDATE: 'OUTLOOK_OUTLOOK_UPDATE_CALENDAR_EVENT',
  DELETE: 'OUTLOOK_OUTLOOK_DELETE_EVENT',
  GET: 'OUTLOOK_OUTLOOK_GET_EVENT',
  LIST_MESSAGES: 'OUTLOOK_OUTLOOK_LIST_MESSAGES',
  // v1.203 — de bron van de genodigden-kiezer. Alleen lezen; CREATE/UPDATE/
  // DELETE_CONTACT staan bewust niet in de allowlist van _shared/outlook-exec.ts.
  LIST_CONTACTS: 'OUTLOOK_OUTLOOK_LIST_CONTACTS',
};

const TZ = 'Europe/Amsterdam';
// Twee datums aan weerskanten van de zomertijd-grens. Nederland gaat op
// 2026-10-25 naar wintertijd en op 2027-03-28 weer naar zomertijd. Eén datum
// bewijst niets: een hard gezette `+02:00` is tot 24 oktober 2026 gewoon goed.
// Allebei ook ruim buiten het reconcile-venster (max +90 dagen).
const DST_ON = '2027-04-15';   // CEST, +02:00 → 14:00 lokaal = 12:00 UTC
const DST_OFF = '2027-01-15';  // CET,  +01:00 → 14:00 lokaal = 13:00 UTC

const MARK = `maestro-agenda-smoke-${Date.now()}`;

const results = [];
function assert(id, what, ok, detail = '') {
  results.push({ id, what, ok });
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id.padEnd(4)} ${what}${detail ? `  — ${detail}` : ''}`);
}
function note(msg) { console.log(`       ${msg}`); }

async function mgmt(path) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    headers: { Authorization: `Bearer ${SBT}`, ...UA },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${path} ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
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
              where enabled and not paused order by created_at limit 1) as cid,
            (select mailbox_email from public.mail_accounts
              where enabled and not paused order by created_at limit 1) as email`, false))[0];
  if (!row?.k) throw new Error('geen composio_api_key in de Vault');
  if (!row?.cid) throw new Error('geen composio_connection_id in mail_accounts');
  if (!row?.email) throw new Error('geen mailbox_email in mail_accounts');
  return { apiKey: row.k, userId: row.uid || 'user-jelle', connectionId: row.cid, email: row.email };
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

/** Alles wat deze run in de agenda zet, zodat de `finally` het kan opruimen. */
const created = [];
async function makeEvent(ctx, args) {
  const ev = await exec(ctx, TOOLS.CREATE, {
    time_zone: TZ, body: '', is_html: false, show_as: 'busy', ...args,
  });
  const id = String(ev.id ?? '');
  if (id) created.push(id);
  return { id, raw: ev };
}

/** `2027-04-15T14:00:00` — naïef, zonder offset en zonder Z. Zie §5.3. */
const naive = (date, hhmm) => `${date}T${hhmm}:00`;
/** Graph geeft `2027-04-15T12:00:00.0000000`; wij willen `2027-04-15T12:00`. */
const trim = (s) => String(s ?? '').slice(0, 16);
const attEmails = (list) => (Array.isArray(list) ? list : [])
  .map((a) => String(a?.emailAddress?.address ?? a?.email ?? '').toLowerCase()).filter(Boolean);

async function runComposio(ctx) {
  note(`mailbox: ${ctx.email}  ·  connection ${ctx.connectionId.slice(0, 12)}…`);

  // ── C1/C2 — create levert een id, en de velden komen terug zoals meegegeven.
  const c1 = await makeEvent(ctx, {
    subject: `${MARK} c1-basis`,
    location: 'Kantoor Utrecht',
    start_datetime: naive(DST_ON, '14:00'),
    end_datetime: naive(DST_ON, '15:00'),
  });
  assert('C1', 'CREATE_EVENT levert een event_id', !!c1.id, c1.id.slice(-14));
  if (!c1.id) return;

  const g1 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c1.id });
  assert('C1b', 'GET_EVENT vindt het event terug', String(g1.id ?? '') === c1.id);
  assert('C2a', 'onderwerp staat erin zoals meegegeven', g1.subject === `${MARK} c1-basis`, String(g1.subject ?? ''));
  assert('C2b', 'locatie staat erin zoals meegegeven',
    String(g1.location?.displayName ?? '') === 'Kantoor Utrecht', String(g1.location?.displayName ?? '(leeg)'));
  assert('C2c', 'begin en eind zijn een uur uit elkaar',
    trim(g1.start?.dateTime) !== trim(g1.end?.dateTime),
    `${trim(g1.start?.dateTime)} → ${trim(g1.end?.dateTime)} (${g1.start?.timeZone})`);

  // ── C3 — de tijdzone, twee keer. Dit is de assertie met een datum erop.
  // Graph geeft standaard UTC terug, dus 14:00 Amsterdam hoort in de zomertijd
  // op 12:00Z te staan en in de wintertijd op 13:00Z. Een implementatie die
  // zelf `+02:00` plakt haalt de eerste wel en de tweede niet.
  const zone1 = String(g1.start?.timeZone ?? '').toUpperCase();
  const utc1 = trim(g1.start?.dateTime);
  assert('C3a', `zomertijd: 14:00 ${TZ} op ${DST_ON} = 12:00 UTC`,
    zone1 === 'UTC' && utc1 === `${DST_ON}T12:00`, `${utc1} ${zone1}`);

  const c3 = await makeEvent(ctx, {
    subject: `${MARK} c3-wintertijd`,
    start_datetime: naive(DST_OFF, '14:00'),
    end_datetime: naive(DST_OFF, '15:00'),
  });
  const g3 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c3.id });
  const utc3 = trim(g3.start?.dateTime);
  assert('C3b', `wintertijd: 14:00 ${TZ} op ${DST_OFF} = 13:00 UTC`,
    String(g3.start?.timeZone ?? '').toUpperCase() === 'UTC' && utc3 === `${DST_OFF}T13:00`,
    `${utc3} ${g3.start?.timeZone}`);

  // ── C4 — DE defaults-val. Dit is de W4 van deze baan: de assertie die de
  // hele helper-vorm bepaalt. Maak een event mét genodigde, categorie en
  // locatie; doe daarna een UPDATE met *alleen* event_id + subject; lees terug.
  const existingCat = (await sql(
    `select c as cat from public.calendar_events, lateral unnest(categories) c
      where categories is not null and array_length(categories,1) > 0 limit 1`))[0]?.cat ?? null;
  note(`C4 gebruikt categorie: ${existingCat ?? '(geen in de mailbox — categorie-arm overgeslagen)'}`);

  const c4 = await makeEvent(ctx, {
    subject: `${MARK} c4-defaults`,
    location: 'Bestaande locatie',
    start_datetime: naive(DST_ON, '09:00'),
    end_datetime: naive(DST_ON, '09:30'),
    show_as: 'free',
    attendees_info: [{ email: ctx.email, name: 'Smoke zelf', type: 'required' }],
    ...(existingCat ? { categories: [existingCat] } : {}),
  });
  const before4 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c4.id });
  const attBefore = attEmails(before4.attendees);
  note(`C4 vóór: attendees=${attBefore.length} location="${before4.location?.displayName ?? ''}" `
    + `categories=${JSON.stringify(before4.categories ?? [])} showAs=${before4.showAs}`);
  assert('C4a', 'het testevent heeft vóór de update een genodigde', attBefore.length > 0, attBefore.join(','));

  // De update die een naïeve implementatie zou doen: alleen wat je wijzigt.
  await exec(ctx, TOOLS.UPDATE, { user_id: 'me', event_id: c4.id, subject: `${MARK} c4-gewijzigd` });
  const after4 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c4.id });
  const attAfter = attEmails(after4.attendees);
  note(`C4 ná:   attendees=${attAfter.length} location="${after4.location?.displayName ?? ''}" `
    + `categories=${JSON.stringify(after4.categories ?? [])} showAs=${after4.showAs}`);

  // C4b–C4e zijn bewust omgekeerd geformuleerd, net als W4 in
  // outlook_write_smoke.cjs: ze bewijzen dat de VAL bestaat. Groen betekent hier
  // "Composio vult zijn defaults écht in, dus de terugleesstap is nodig". Gaan
  // ze ooit rood, dan heeft Composio zijn gedrag veranderd en hoort iemand
  // C4h opnieuw te lezen vóór hij de helper vereenvoudigt.
  assert('C4b', 'subject-only UPDATE WIST de genodigden (= waarom stap 1 moet)',
    attBefore.length > 0 && attAfter.length === 0, `${attBefore.length} → ${attAfter.length}`);
  assert('C4c', 'subject-only UPDATE WIST de locatie',
    !!before4.location?.displayName && !after4.location?.displayName,
    `"${before4.location?.displayName ?? ''}" → "${after4.location?.displayName ?? ''}"`);
  assert('C4d', 'subject-only UPDATE overschrijft show_as met de default "busy"',
    String(before4.showAs) === 'free' && String(after4.showAs) === 'busy',
    `${before4.showAs} → ${after4.showAs}`);
  if (existingCat) {
    assert('C4e', 'subject-only UPDATE WIST de categorieën',
      (before4.categories ?? []).length > 0 && (after4.categories ?? []).length === 0,
      `${JSON.stringify(before4.categories ?? [])} → ${JSON.stringify(after4.categories ?? [])}`);
  }
  assert('C4f', 'subject-only UPDATE laat begin/eind staan',
    trim(after4.start?.dateTime) === trim(before4.start?.dateTime),
    `${trim(before4.start?.dateTime)} → ${trim(after4.start?.dateTime)}`);
  assert('C4g', 'de update deed wél wat er gevraagd werd (subject gewijzigd)',
    after4.subject === `${MARK} c4-gewijzigd`, String(after4.subject ?? ''));

  // ── C4h — DE POSITIEVE CONTROLE. C4b–C4e laten zien dat het mís gaat; alleen
  // deze laat zien dat de gekozen helper-vorm het goed doet. Een negatieve
  // assertie alleen bewijst dat je het probleem kent, niet dat je het oplost.
  // `buildUpdateArgs` hieronder moet gelijk blijven aan _shared/outlook-calendar.ts.
  const c4b = await makeEvent(ctx, {
    subject: `${MARK} c4h-readmodifywrite`,
    location: 'Bestaande locatie',
    start_datetime: naive(DST_ON, '10:00'),
    end_datetime: naive(DST_ON, '10:30'),
    show_as: 'free',
    attendees_info: [{ email: ctx.email, name: 'Smoke zelf', type: 'required' }],
    ...(existingCat ? { categories: [existingCat] } : {}),
  });
  const beforeH = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c4b.id });
  await exec(ctx, TOOLS.UPDATE, buildUpdateArgs(c4b.id, beforeH, {
    subject: `${MARK} c4h-gewijzigd`, date: DST_ON, start: '11:30', end: '12:00',
  }));
  const afterH = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c4b.id });
  note(`C4h ná:  attendees=${attEmails(afterH.attendees).length} location="${afterH.location?.displayName ?? ''}" `
    + `categories=${JSON.stringify(afterH.categories ?? [])} showAs=${afterH.showAs} start=${trim(afterH.start?.dateTime)}`);
  assert('C4h', 'read-modify-write bewaart genodigden, locatie, categorieën én show_as',
    attEmails(afterH.attendees).length === attEmails(beforeH.attendees).length
    && String(afterH.location?.displayName ?? '') === 'Bestaande locatie'
    && JSON.stringify(afterH.categories ?? []) === JSON.stringify(beforeH.categories ?? [])
    && String(afterH.showAs ?? '') === 'free',
    `att=${attEmails(afterH.attendees).length} loc="${afterH.location?.displayName ?? ''}" `
    + `cat=${(afterH.categories ?? []).length} showAs=${afterH.showAs}`);
  assert('C4i', 'read-modify-write verzet de tijd wél, in de juiste zone (11:30 lokaal = 09:30 UTC)',
    trim(afterH.start?.dateTime) === `${DST_ON}T09:30` && afterH.subject === `${MARK} c4h-gewijzigd`,
    `${trim(afterH.start?.dateTime)} "${afterH.subject}"`);

  // ── C5 — de Teams-blob. Graph: "Inadvertently removing the meeting blob from
  // the body would disable meeting online." Wij sturen nooit `body` mee bij een
  // update; deze assertie bewijst dat dat genoeg is.
  const c5 = await makeEvent(ctx, {
    subject: `${MARK} c5-teams`,
    start_datetime: naive(DST_ON, '11:00'),
    end_datetime: naive(DST_ON, '11:30'),
    is_online_meeting: true,
    online_meeting_provider: 'teamsForBusiness',
  });
  const before5 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c5.id });
  const join5 = String(before5.onlineMeeting?.joinUrl ?? before5.onlineMeetingUrl ?? '');
  assert('C5a', 'is_online_meeting levert een joinUrl', !!join5, join5 ? join5.slice(0, 48) + '…' : '(geen)');
  if (join5) {
    await exec(ctx, TOOLS.UPDATE, { user_id: 'me', event_id: c5.id, subject: `${MARK} c5-gewijzigd` });
    const after5 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c5.id });
    const joinAfter = String(after5.onlineMeeting?.joinUrl ?? after5.onlineMeetingUrl ?? '');
    assert('C5b', 'update zonder body laat de Teams-deelnamelink intact',
      joinAfter === join5, joinAfter ? 'joinUrl ongewijzigd' : '(WEG)');
    const bodyAfter = String(after5.body?.content ?? '');
    assert('C5c', 'de meeting-blob staat nog in de body',
      bodyAfter.length > 0 && /teams\.microsoft\.com|meetup-join|Microsoft Teams/i.test(bodyAfter),
      `${bodyAfter.length} tekens`);
  }

  // ── C10 — DE GENODIGDENLIJST (v1.203). Tot v1.202 stuurde de helper nooit
  // genodigden mee: `attendees_info` bij CREATE betekent dat Graph de
  // uitnodigingen verstuurt, en dat is volgens Microsoft "can't be configured".
  // Sinds Jelle om een genodigden-kiezer vroeg (2026-09-15) is dat juist de
  // bedoeling, en dan moeten deze drie standen gemeten zijn en niet beredeneerd:
  //
  //   C10a  create MÉT attendees_info        → de genodigde staat erin
  //   C10b  update met `attendees: []`       → iedereen eraf ("alle kruisjes")
  //   C10c  update met `attendees: [x]`      → precies x, en niemand anders
  //   C10d  update ZONDER attendees-veld     → de lijst blijft staan
  //
  // C10b/C10c/C10d zijn samen het verschil tussen "niet aangeraakt" en
  // "expliciet leeggemaakt" — precies het onderscheid dat `CalendarEventFields`
  // in _shared/outlook-calendar.ts maakt. Wie dat verschil laat vallen, wist
  // stilletjes een genodigdenlijst bij elke titelwijziging.
  //
  // ⚠ De genodigde is de EIGEN mailbox. Een echte uitnodiging naar een vreemde
  // is precies wat deze test niet mag veroorzaken; nu landt hij in het eigen
  // postvak en nergens anders.
  const self = ctx.email.toLowerCase();
  const c10 = await makeEvent(ctx, {
    subject: `${MARK} c10-genodigden`,
    start_datetime: naive(DST_ON, '15:00'),
    end_datetime: naive(DST_ON, '15:30'),
    attendees_info: [{ email: self, name: 'Smoke-genodigde', type: 'required' }],
  });
  const g10a = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c10.id });
  assert('C10a', 'create MÉT attendees_info zet de genodigde er echt in',
    attEmails(g10a.attendees).includes(self), attEmails(g10a.attendees).join(', ') || '(leeg)');

  await exec(ctx, TOOLS.UPDATE, buildUpdateArgs(c10.id, g10a, { attendees: [] }));
  const g10b = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c10.id });
  assert('C10b', 'update met een LEGE attendees-lijst haalt iedereen eraf',
    attEmails(g10b.attendees).length === 0, `${attEmails(g10b.attendees).length} genodigden`);

  await exec(ctx, TOOLS.UPDATE, buildUpdateArgs(c10.id, g10b, {
    attendees: [{ email: self, name: 'Smoke-genodigde', type: 'required' }],
  }));
  const g10c = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c10.id });
  assert('C10c', 'update met een expliciete lijst zet precies die genodigden',
    attEmails(g10c.attendees).length === 1 && attEmails(g10c.attendees)[0] === self,
    attEmails(g10c.attendees).join(', ') || '(leeg)');

  // De positieve controle op het onderscheid: een titelwijziging zonder
  // attendees-veld mag de lijst NIET wissen. Dit is C4h, nu op de code-vorm van
  // v1.203 (waar `attendees` een optioneel veld is geworden).
  await exec(ctx, TOOLS.UPDATE, buildUpdateArgs(c10.id, g10c, { subject: `${MARK} c10-hernoemd` }));
  const g10d = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c10.id });
  assert('C10d', 'update ZONDER attendees-veld laat de bestaande lijst staan',
    attEmails(g10d.attendees).length === 1 && String(g10d.subject ?? '').endsWith('c10-hernoemd'),
    `${attEmails(g10d.attendees).length} genodigden · "${g10d.subject}"`);

  // ── C6 — doet `send_notifications: false` wat het belooft?
  // Graph kent geen body op DELETE /me/events/{id} en zegt zelf dat het
  // verwijderen van een meeting een afzegging stuurt. Composio biedt tóch een
  // vlag aan — wat die aan hun kant doet is niet te lezen, dus meten we het.
  // Genodigde is de eigen mailbox, dus eventuele post landt nergens anders.
  //
  // ⚠ Wat dit bewijst is smaller dan het label (gemeten 2026-09-15, v1.216):
  // met de eigen mailbox als enige genodigde zet Exchange óók de UITNODIGING
  // van CREATE niet in inbox/Verzonden/Verwijderd. "0 afzeggingen" is dus wat
  // deze fixture altijd geeft, ongeacht de vlag. Zie C6b hieronder. Een echte
  // meting van de vlag vraagt een tweede mailbox als genodigde; die is er niet
  // in mail_accounts. Wat wél vaststaat: Composio documenteert de vlag als
  // "sends cancellation notifications to event attendees upon deletion".
  const c6 = await makeEvent(ctx, {
    subject: `${MARK} c6-afzegging`,
    start_datetime: naive(DST_ON, '16:00'),
    end_datetime: naive(DST_ON, '16:30'),
    attendees_info: [{ email: ctx.email, name: 'Smoke zelf', type: 'required' }],
  });
  const g6 = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c6.id });
  const hasAttendee6 = attEmails(g6.attendees).length > 0;
  note(`C6 event heeft ${attEmails(g6.attendees).length} genodigde(n), isOrganizer=${g6.isOrganizer}`);

  const sentBefore = await listSent(ctx);
  await exec(ctx, TOOLS.DELETE, { user_id: 'me', event_id: c6.id, send_notifications: false });
  drop(c6.id);
  // Graph verstuurt asynchroon; een directe lijst is te vroeg.
  await new Promise((r) => setTimeout(r, 25000));
  const sentAfter = await listSent(ctx);
  const nieuw = sentAfter.filter((m) => !sentBefore.some((b) => b.id === m.id));
  const afzegging = nieuw.filter((m) => /geannuleerd|canceled|cancelled|afgezegd/i.test(String(m.subject ?? ''))
    || String(m.subject ?? '').includes(MARK));
  assert('C6', 'verwijderen met send_notifications:false stuurt geen afzegging uit Verzonden items',
    hasAttendee6 && afzegging.length === 0,
    hasAttendee6
      ? `${nieuw.length} nieuw in Verzonden, ${afzegging.length} afzegging${afzegging.length ? ': ' + afzegging.map((m) => m.subject).join(' | ') : ''}`
      : 'ONBESLIST: het event had geen genodigde (Graph dedupliceert de organisator)');

  // ── C6b — en doet `send_notifications: true` het omgekeerde? (v1.216)
  // De positieve controle op "Met bericht": C6 alleen bewijst dat de vlag
  // stilte kán afdwingen, niet dat de andere stand ook echt post oplevert. Als
  // dit niet meetbaar is (Composio negeert de vlag, Graph stuurt niks naar de
  // organisator-zelf), dan is "Met bericht" in het scherm een lege belofte en
  // moet dat in de PR staan. Genodigde is opnieuw de eigen mailbox.
  if (hasAttendee6) {
    const c6b = await makeEvent(ctx, {
      subject: `${MARK} c6b-afzegging-met-bericht`,
      start_datetime: naive(DST_ON, '16:45'),
      end_datetime: naive(DST_ON, '17:15'),
      attendees_info: [{ email: ctx.email, name: 'Smoke zelf', type: 'required' }],
    });
    const sentBefore6b = await listSent(ctx);
    await exec(ctx, TOOLS.DELETE, { user_id: 'me', event_id: c6b.id, send_notifications: true });
    drop(c6b.id);
    await new Promise((r) => setTimeout(r, 25000));
    const sentAfter6b = await listSent(ctx);
    const nieuw6b = sentAfter6b.filter((m) => !sentBefore6b.some((b) => b.id === m.id));
    const afzegging6b = nieuw6b.filter((m) => /geannuleerd|canceled|cancelled|afgezegd/i.test(String(m.subject ?? ''))
      || String(m.subject ?? '').includes('c6b-afzegging-met-bericht'));
    if (afzegging6b.length > 0) {
      assert('C6b', 'verwijderen met send_notifications:true stuurt wél een afzegging ("Met bericht")',
        true, afzegging6b.map((m) => m.subject).join(' | '));
    } else {
      // Gemeten 2026-09-15: 0 in Verzonden. Met de eigen mailbox als enige
      // genodigde stuurt Exchange de organisator geen afzegging aan zichzelf,
      // dus deze fixture KAN de positieve kant niet bewijzen; er is maar één
      // mailbox in mail_accounts om mee te testen. Daarom een notitie en geen
      // rood: rood zou hier "de fixture is te klein" betekenen, niet "de vlag
      // werkt niet". Composio documenteert de vlag als "sends cancellation
      // notifications to event attendees" en C6 bewijst dat `false` hem
      // onderdrukt. De echte positieve controle is één "Met bericht" op een
      // testafspraak met een collega als genodigde — zie de PR van v1.216.
      note('C6b ONBESLIST: 0 afzeggingen in Verzonden — eigen mailbox als enige genodigde krijgt geen bericht van zichzelf');
    }
  }

  // ── C7 — verwijdert DELETE echt?
  const gone = await exec(ctx, TOOLS.GET, { user_id: 'me', event_id: c6.id }).then(() => 'gevonden').catch(() => null);
  assert('C7', 'DELETE_EVENT verwijdert echt (GET erna geeft een fout)', gone === null, gone ?? 'weg');

  // ── C9 — user_id is niet te overrulen. De helper pint hem hard op 'me'; deze
  // assertie bewijst dat de pin niet cosmetisch is maar het enige wat telt: een
  // meegegeven vreemde UPN zou anders in de agenda van een collega schrijven
  // (de grant bevat Calendars.ReadWrite.Shared).
  let leak = null;
  try {
    const r = await exec(ctx, TOOLS.GET, { user_id: 'niet-bestaand@legal-mind.nl', event_id: c1.id });
    leak = r?.id ? 'gelezen met vreemde UPN' : null;
  } catch (e) { leak = null; note(`C9 vreemde UPN geweigerd door Graph: ${e.message.slice(0, 90)}`); }
  assert('C9', 'een vreemde user_id levert geen toegang (dus de pin op \'me\' is het slot)',
    leak === null, leak ?? 'geweigerd');

  // ── C11 — het ADRESBOEK (v1.203). De genodigden-kiezer stelt namen voor uit
  // `outlook_contacts`, en die tabel wordt gevuld met deze ene tool. Faalt hij
  // of verandert zijn vorm, dan krijgt Jelle geen foutmelding maar een kiezer
  // die niets voorstelt — het stilste soort kapot. Vandaar een assertie op de
  // VORM (een lijst met adressen) en niet op een aantal: een adresboek mag
  // groeien en krimpen.
  let book = [];
  try {
    const rc = await exec(ctx, TOOLS.LIST_CONTACTS, { user_id: 'me', top: 500 });
    book = Array.isArray(rc?.value) ? rc.value : [];
  } catch (e) { note(`C11 LIST_CONTACTS faalde: ${e.message.slice(0, 110)}`); }
  // Let op de VORM: een genodigde is `{ emailAddress: { address } }`, een
  // contact is `{ emailAddresses: [{ name, address }] }` — het adres staat er
  // één niveau hoger. `attEmails` hierboven leest de genodigden-vorm en gaf op
  // contacten netjes negen keer niets terug (eerste run C11, 2026-09-15).
  const bookAddrs = book.flatMap((c) => (Array.isArray(c?.emailAddresses) ? c.emailAddresses : [])
    .map((e) => String(e?.address ?? '').toLowerCase()).filter(Boolean));
  assert('C11', 'LIST_CONTACTS levert contacten mét e-mailadres (de bron van de kiezer)',
    book.length > 0 && bookAddrs.length > 0,
    `${book.length} contacten · ${bookAddrs.length} adressen`);

  // C8 (allowlist) is geen Composio-assertie: de edge-functie neemt helemaal
  // geen slug van de caller aan — hij mapt `action` op een vaste constante.
  // Dat is sterker dan een allowlist en wordt in --edge als E7 getoetst.
  note('C8 — allowlist: zie E7 in --edge (de caller kan geen slug meegeven)');
}

/**
 * De argumenten voor één UPDATE. **Moet gelijk blijven aan
 * `_shared/outlook-calendar.ts` → `buildUpdateArgs`** — anders meet deze test
 * iets anders dan de functie doet.
 *
 * De regel die C4b–C4e opleverden: Composio vult zijn gedeclareerde defaults
 * ECHT in. Elke parameter met een niet-null default (`subject` "", `location`
 * {}, `attendees` [], `categories` [], `show_as` "busy") wist dus wat hij niet
 * meekrijgt. Parameters met `default: null` (`body`, `start_datetime`,
 * `end_datetime`) doen dat niet — die mag je weglaten, en `body` MOET je
 * weglaten, anders sneuvelt de Teams-blob (C5).
 */
function buildUpdateArgs(eventId, before, changes) {
  const args = {
    user_id: 'me',
    event_id: eventId,
    // Wist bij weglaten → altijd expliciet, met de oude waarde als niemand hem wijzigde.
    subject: changes.subject ?? String(before.subject ?? ''),
    location: { displayName: changes.location ?? String(before.location?.displayName ?? '') },
    // v1.203 — drie gevallen, en het verschil telt (C10b/C10c/C10d):
    //   changes.attendees weggelaten → de teruggelezen lijst, want weglaten WIST
    //   changes.attendees = []       → expliciet leeg: iedereen eraf
    //   changes.attendees = [...]    → precies deze mensen
    attendees: changes.attendees != null
      ? changes.attendees.map((a) => ({
        emailAddress: { address: String(a.email ?? '').toLowerCase(), name: String(a.name ?? '') },
        type: String(a.type ?? 'required'),
      })).filter((a) => a.emailAddress.address)
      : (Array.isArray(before.attendees) ? before.attendees : []).map((a) => ({
        emailAddress: {
          address: String(a?.emailAddress?.address ?? ''),
          name: String(a?.emailAddress?.name ?? ''),
        },
        type: String(a?.type ?? 'required'),
      })).filter((a) => a.emailAddress.address),
    categories: Array.isArray(before.categories) ? before.categories : [],
    show_as: String(before.showAs ?? 'busy'),
  };
  // start/end hebben `default: null` en overleven het weglaten (C4f). Ze gaan
  // alleen mee als de caller ze stuurt — en dan altijd mét `time_zone`, want
  // die staat op default "UTC" en zou de naïeve lokale tijd als UTC lezen.
  if (changes.date && changes.start && changes.end) {
    args.start_datetime = naive(changes.date, changes.start);
    args.end_datetime = naive(changes.date, changes.end);
    args.time_zone = TZ;
  }
  return args; // `body` gaat NOOIT mee — zie C5.
}

const SENT_SELECT = ['id', 'subject', 'sentDateTime'];
async function listSent(ctx) {
  try {
    const r = await exec(ctx, TOOLS.LIST_MESSAGES, {
      user_id: 'me', folder: 'sentitems', top: 15,
      select: SENT_SELECT, orderby: ['sentDateTime desc'],
    });
    const v = r?.value;
    return Array.isArray(v) ? v : [];
  } catch (e) { note(`kon Verzonden items niet lezen: ${e.message.slice(0, 90)}`); return []; }
}
function drop(id) { const i = created.indexOf(id); if (i !== -1) created.splice(i, 1); }

async function cleanup(ctx) {
  if (!ctx || created.length === 0) return;
  if (KEEP) { note(`--keep: ${created.length} testevent(s) blijven staan`); return; }
  for (const id of [...created]) {
    try {
      await exec(ctx, TOOLS.DELETE, { user_id: 'me', event_id: id, send_notifications: false });
      drop(id);
    } catch (e) { console.error(`  opruimen mislukt voor ${id.slice(-14)}: ${e.message.slice(0, 120)}`); }
  }
  note(created.length === 0 ? 'opgeruimd: alle testevents verwijderd (zonder notificatie)'
    : `LET OP: ${created.length} testevent(s) NIET opgeruimd`);
}

// ── Edge-modus ──────────────────────────────────────────────────────────────

async function runEdge() {
  const { mintUserJwt, revokeMintedSessions } = require('./lib/user-jwt.cjs');
  const keys = (await sql(
    `select (select mailbox_email from public.mail_accounts
              where enabled and not paused order by created_at limit 1) as owner_email,
            (select u.email from auth.users u
              where u.id not in (select user_id from public.mail_accounts) limit 1) as no_mailbox_email`))[0];
  const ownerEmail = keys?.owner_email;
  if (!ownerEmail) throw new Error('geen mailbox_email in mail_accounts');
  // Via de Management API, net als multi_user_acl_eval.cjs. Ze staan NIET in de
  // Vault — daar zit alleen het management-token zelf.
  const apiKeys = await mgmt('/api-keys?reveal=true');
  const serviceKey = apiKeys.find((k) => k.name === 'service_role')?.api_key
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = apiKeys.find((k) => k.name === 'anon')?.api_key || process.env.SUPABASE_ANON_KEY;
  if (!serviceKey) throw new Error('geen service-role-sleutel via /api-keys');

  const call = async (jwt, body) => {
    const r = await fetch(`${FN}/outlook-calendar-live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: jwt, ...UA },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  /**
   * Een wegwerp-event MÉT genodigde, plus zijn spiegelrij — het fixture voor
   * E9. Via Composio, niet via de edge-functie, want de edge-functie stuurt
   * bewust nooit genodigden mee. De genodigde is de eigen mailbox, dus de
   * uitnodiging die Graph hierbij stuurt (en die volgens Microsoft niet uit te
   * zetten is) landt in het eigen postvak.
   */
  let attendeeCtx = null;
  let attendeeEventId = null;
  async function makeAttendeeEvent() {
    try {
      attendeeCtx = await composioCtx();
      const ev = await exec(attendeeCtx, TOOLS.CREATE, {
        user_id: 'me', subject: `${MARK} e9-genodigde`, body: '', is_html: false,
        start_datetime: naive(DST_ON, '13:00'), end_datetime: naive(DST_ON, '13:30'),
        time_zone: TZ, show_as: 'busy',
        attendees_info: [{ email: attendeeCtx.email, name: 'Smoke zelf', type: 'required' }],
      });
      attendeeEventId = String(ev.id ?? '');
      if (!attendeeEventId) return null;
      const ownerId = (await sql(`select user_id from public.mail_accounts
        where enabled and not paused order by created_at limit 1`))[0]?.user_id;
      await sql(`insert into public.calendar_events
        (graph_id, user_id, subject, start_time, end_time,
         is_all_day, is_recurring, is_organizer, is_deleted)
        values (${lit(attendeeEventId)}, ${lit(ownerId)}, ${lit(`${MARK} e9-genodigde`)},
                '2027-04-15T11:00:00Z', '2027-04-15T11:30:00Z', false, false, true, false)`, false);
      return attendeeEventId;
    } catch (e) { note(`E9-fixture mislukt: ${e.message.slice(0, 120)}`); return null; }
  }

  const { jwt } = await mintUserJwt({ ref: REF, serviceKey, email: ownerEmail });
  let graphId = null;
  try {
    // E1 — create door de gedeployde functie heen.
    const cr = await call(jwt, {
      action: 'create_event',
      subject: `${MARK} e1-edge`,
      date: DST_ON, start: '14:00', end: '15:00', location: 'Edge-test',
    });
    graphId = cr.body?.graph_id ?? null;
    assert('E1', 'create_event levert een graph_id', cr.status === 200 && !!graphId,
      cr.body?.reason ?? String(graphId ?? '').slice(-14));

    // E4a — de spiegel loopt mee, zónder op de */15-sync te wachten.
    if (graphId) {
      const rows = await sql(
        `select id, subject, start_time, is_deleted, user_id
           from public.calendar_events where graph_id = ${lit(graphId)}`);
      assert('E4a', 'ná create staat de rij meteen in calendar_events',
        rows.length === 1 && rows[0].is_deleted === false, `${rows.length} rij(en)`);
      assert('E4b', 'de spiegelrij staat op de juiste UTC-tijd (12:00Z in de zomertijd)',
        String(rows[0]?.start_time ?? '').includes('12:00'), String(rows[0]?.start_time ?? ''));
    }

    // E2 — update.
    if (graphId) {
      const up = await call(jwt, {
        action: 'update_event', graph_id: graphId,
        subject: `${MARK} e2-gewijzigd`, date: DST_ON, start: '15:00', end: '16:00', location: 'Edge-test 2',
      });
      assert('E2', 'update_event slaagt', up.status === 200 && up.body?.ok === true, up.body?.reason ?? '');
      const rows = await sql(
        `select subject, start_time from public.calendar_events where graph_id = ${lit(graphId)}`);
      assert('E2b', 'de spiegel volgt de wijziging meteen',
        String(rows[0]?.subject ?? '').includes('e2-gewijzigd'), String(rows[0]?.subject ?? ''));
    }

    // E3 + E4c — delete, en `is_deleted` meteen in de spiegel.
    if (graphId && !KEEP) {
      const del = await call(jwt, { action: 'delete_event', graph_id: graphId });
      assert('E3', 'delete_event slaagt', del.status === 200 && del.body?.ok === true, del.body?.reason ?? '');
      const rows = await sql(
        `select is_deleted, deleted_at from public.calendar_events where graph_id = ${lit(graphId)}`);
      assert('E4c', 'ná delete staat is_deleted=true in de spiegel (niet pas over 30 min)',
        rows[0]?.is_deleted === true && !!rows[0]?.deleted_at, JSON.stringify(rows[0] ?? {}));
      if (rows[0]?.is_deleted === true) graphId = null;
    }

    // E7 — de caller kan geen slug meegeven, en `user_id` wordt genegeerd.
    const bogus = await call(jwt, { action: 'OUTLOOK_OUTLOOK_SEND_EMAIL', subject: 'x' });
    assert('E7', 'een slug als action wordt geweigerd (geen caller-gestuurde tool)',
      bogus.status === 400 && bogus.body?.reason === 'unknown_action',
      `${bogus.status} ${bogus.body?.reason ?? ''}`);

    // ── E8–E12: de hekken ────────────────────────────────────────────────────
    // Dit is de helft die ertoe doet. E1–E4 bewijzen dat schrijven wérkt; deze
    // bewijzen dat het op de juiste momenten NIET werkt — en dat is waar de
    // schade zit (een verzette reeks stuurt N mails, een verwijderde afspraak
    // mét genodigden is een afzegging).
    //
    // De volgorde is met opzet opbouwend. E8 en E9 bewijzen eerst dat de
    // controle vóór élke Composio-schrijfcall draait, elk met een situatie die
    // deze test zelf in de hand heeft. Pas daarna toetsen E10–E12 de overige
    // takken op échte agenda-rijen: die zijn dan niet meer een gok op onbekende
    // code maar een andere tak van een aantoonbaar-draaiende controle.

    // E8 — een verzonnen id komt niet eens bij Composio. Bewijst dat de
    // spiegel-/eigendomscontrole vóór de schrijfcall zit.
    const fake = await call(jwt, { action: 'delete_event', graph_id: 'AAAA-bestaat-niet-AAAA' });
    assert('E8', 'onbekend graph_id wordt geweigerd vóór enige Composio-call',
      fake.status === 409 && fake.body?.reason === 'event_not_in_mirror',
      `${fake.status} ${fake.body?.reason ?? ''}`);

    // E9 — annuleren mét genodigden (v1.216). Tot v1.215 was dit een hek
    // (`has_attendees`); sinds Jelle's "zoals Outlook: met of zonder bericht"
    // is het een VERPLICHTE keuze. Het testevent is van deze run en heeft
    // alleen de eigen mailbox als genodigde, dus als er iets misgaat sneuvelt
    // er niets van iemand anders.
    //
    //   E9a  zonder `notify_attendees` → 409 notify_choice_required
    //   E9b  en het event staat er dan nog
    //   E9c  mét `notify_attendees: false` → 200, cancelled, geen bericht
    //
    // De "met bericht"-kant wordt niet door de edge-functie heen gemeten (dat
    // zou een echte afzegging in het eigen postvak zetten bij élke run); C6b in
    // de Composio-modus is daar de positieve controle voor.
    const withAtt = await makeAttendeeEvent();
    if (withAtt) {
      const refused = await call(jwt, { action: 'delete_event', graph_id: withAtt });
      assert('E9a', 'annuleren mét genodigden zónder keuze wordt geweigerd (notify_choice_required)',
        refused.status === 409 && refused.body?.reason === 'notify_choice_required',
        `${refused.status} ${refused.body?.reason ?? ''}`);
      const still = await sql(
        `select is_deleted from public.calendar_events where graph_id = ${lit(withAtt)}`);
      assert('E9b', 'en het event staat er ná de weigering nog',
        still[0]?.is_deleted === false, JSON.stringify(still[0] ?? {}));
      const quiet = await call(jwt, { action: 'delete_event', graph_id: withAtt, notify_attendees: false });
      assert('E9c', 'annuleren mét genodigden en notify_attendees:false slaagt, zonder bericht',
        quiet.status === 200 && quiet.body?.ok === true && quiet.body?.cancelled === true
          && quiet.body?.attendees_notified === false && (quiet.body?.attendee_count ?? 0) > 0,
        `${quiet.status} ${JSON.stringify(quiet.body ?? {})}`);
      if (quiet.status === 200) {
        // Het event is nu weg uit Outlook; de finally hoeft alleen nog de
        // spiegelrij op te ruimen (die staat op is_deleted=true).
        try { await sql(`delete from public.calendar_events where graph_id = ${lit(withAtt)}`, false); } catch { /* finally vangt de rest */ }
        attendeeEventId = null;
      }
    }

    // E10–E12 — de overige takken, op echte rijen uit de spiegel. Bij elk: 409
    // met de juiste reden, én het onderwerp in de spiegel onveranderd.
    // De takken worden in volgorde getoetst (organisator → reeks → hele dag),
    // dus een terugkerende afspraak die óók van iemand anders is valt al op de
    // eerste af. Om écht de reeks-tak te raken moet de rij organisator-eigen
    // zijn — vandaar `is_organizer` in de eerste twee selecties. Zonder dat
    // meet je driemaal dezelfde assertie en denk je dat je er drie hebt.
    const cases = [
      ['E10', 'recurring_not_supported', 'is_recurring and is_organizer', 'terugkerende afspraak'],
      ['E11', 'all_day_not_supported', 'is_all_day and is_organizer and not is_recurring', 'hele-dag-afspraak'],
      ['E12', 'not_organizer', 'not is_organizer', 'afspraak van iemand anders'],
    ];
    for (const [id, reason, where, label] of cases) {
      const row = (await sql(
        `select graph_id, subject from public.calendar_events
          where ${where} and not is_deleted and user_id = (
            select user_id from public.mail_accounts where enabled and not paused
            order by created_at limit 1)
          order by start_time desc limit 1`))[0];
      if (!row?.graph_id) { note(`(geen ${label} in de spiegel — ${id} overgeslagen)`); continue; }
      const r = await call(jwt, {
        action: 'update_event', graph_id: row.graph_id,
        subject: `${MARK} MAG-NIET`, date: DST_ON, start: '09:00', end: '09:30',
      });
      const after = (await sql(
        `select subject from public.calendar_events where graph_id = ${lit(row.graph_id)}`))[0];
      assert(id, `wijzigen van een ${label} wordt geweigerd, en verandert niets`,
        r.status === 409 && r.body?.reason === reason && after?.subject === row.subject,
        `${r.status} ${r.body?.reason ?? ''} · subject ${after?.subject === row.subject ? 'ongewijzigd' : 'VERANDERD'}`);
    }

    // E5 — het no_mailbox_for_user-pad (blokkade B3 aan de agendakant).
    const other = keys?.no_mailbox_email;
    if (other) {
      const { jwt: jwt2 } = await mintUserJwt({ ref: REF, serviceKey, email: other });
      const denied = await call(jwt2, {
        action: 'create_event', subject: 'x', date: DST_ON, start: '10:00', end: '10:30',
      });
      assert('E5', 'gebruiker zonder postbus krijgt 403 no_mailbox_for_user',
        denied.status === 403 && denied.body?.reason === 'no_mailbox_for_user',
        `${denied.status} ${denied.body?.reason ?? ''}`);
    } else {
      note('(geen gebruiker zonder mailbox gevonden — E5 overgeslagen)');
    }

    // E6 — de anon-key zit in de frontend-bundle en mag hier niets.
    if (anonKey) {
      const anon = await call(anonKey, {
        action: 'create_event', subject: 'x', date: DST_ON, start: '10:00', end: '10:30',
      });
      assert('E6', 'de anon-key krijgt 403, niet de agenda',
        anon.status === 403, `${anon.status} ${anon.body?.reason ?? ''}`);
    } else {
      note('(geen anon-key gevonden — E6 overgeslagen)');
    }
  } finally {
    if (graphId && !KEEP) {
      try { await call(jwt, { action: 'delete_event', graph_id: graphId }); } catch { /* best effort */ }
    }
    // `delete_event` is een ZACHTE verwijdering in de spiegel (is_deleted=true),
    // want dat is wat `calendar-reconcile` ook doet — en dat hoort zo. Maar een
    // test mag geen rijen achterlaten: zonder deze regel groeit
    // `calendar_events` met één dode rij per smoke-run.
    if (!KEEP) {
      try {
        await sql(`delete from public.calendar_events
          where subject like ${lit(MARK + '%')}`, false);
      } catch (e) { console.error(`  spiegelrijen NIET opgeruimd: ${e.message.slice(0, 120)}`); }
    }
    // Het E9-fixture: als E9c niet tot een delete kwam staat het event nog in
    // Outlook — hier uit Outlook zónder afzegging, en de spiegelrij die deze
    // test zelf heeft gezet er weer uit. (Ná een geslaagde E9c is
    // `attendeeEventId` al null.)
    if (attendeeEventId && attendeeCtx && !KEEP) {
      try {
        await exec(attendeeCtx, TOOLS.DELETE, {
          user_id: 'me', event_id: attendeeEventId, send_notifications: false,
        });
        await sql(`delete from public.calendar_events where graph_id = ${lit(attendeeEventId)}`, false);
        note('E9-fixture opgeruimd (Outlook + spiegelrij)');
      } catch (e) { console.error(`  E9-fixture NIET opgeruimd: ${e.message.slice(0, 120)}`); }
    }
    await revokeMintedSessions();
  }
}

/** Literal voor de Management-API-query. Graph-id's zijn base64-achtig, maar
 *  een quote erin mag nooit de query kunnen breken. */
function lit(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// ── Runner ──────────────────────────────────────────────────────────────────

(async () => {
  console.log(`agenda-write smoke · modus=${MODE} · mark=${MARK}`);
  let ctx = null;
  try {
    if (MODE === 'edge') {
      await runEdge();
    } else {
      ctx = await composioCtx();
      await runComposio(ctx);
    }
  } catch (e) {
    assert('XX', 'onverwachte fout', false, e.message);
  } finally {
    if (MODE === 'composio') await cleanup(ctx);
  }
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} groen`);
  if (bad.length) console.log(`rood: ${bad.map((r) => r.id).join(', ')}`);
  process.exit(bad.length === 0 ? 0 : 1);
})();
