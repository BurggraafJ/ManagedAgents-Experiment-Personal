// outlook-calendar-live — de schrijfbaan van de Agenda. Drie acties:
//
//   { action: 'create_event', subject, date, start, end, location? } →
//     nieuw event in de standaardagenda van de INGELOGDE gebruiker. Zonder
//     genodigden: zodra die meegaan stuurt Graph uitnodigingen en dat is
//     volgens Microsoft "can't be configured".
//
//   { action: 'update_event', graph_id, subject, date, start, end, location? } →
//     bestaand event wijzigen. READ-MODIFY-WRITE, want een kale patch wist
//     genodigden, locatie, categorieën en show_as (zie _shared/outlook-calendar.ts).
//
//   { action: 'delete_event', graph_id } →
//     verwijderen, ALTIJD zonder afzeggingsmail.
//
// verify_jwt: TRUE + de capability-poort uit `_shared/user-gate.ts`. Dit
// endpoint MUTEERT een externe agenda, dus: ingelogd (de anon-key zit in de
// frontend-bundle en wordt geweigerd), mét het recht `agenda`, en mét een eigen
// mailbox. Dit is géén RAG-cron-functie — de vuistregel `verify_jwt:false` uit
// CLAUDE.md geldt hier niet, net zomin als bij `kb-compose` en `outlook-live`.
//
// De poort is *additief* op de eigendomscontrole hieronder, niet in plaats
// daarvan: `has_capability()` kent geen tweede factor, dus hij mag nooit een
// bestaande check vervangen — alleen ervóór komen.
//
// ── De hekken staan hier, niet (alleen) in de UI ────────────────────────────
// De UI verbergt de knoppen al waar ze niet horen, maar een knop die je niet
// ziet is geen slot. Vier categorieën events blijven daarom ook hier geweigerd,
// en de controle gebeurt op het LIVE event (GET_EVENT), niet op de spiegel —
// die loopt tot 15 minuten achter, en "vijftien minuten geleden had het nog
// geen genodigden" is geen grond om een afzegging te riskeren.
//
//   terugkerend     — een update op een seriesMaster verzet de HELE reeks, en
//                     stuurt volgens Graph één mail per aangepaste instantie.
//                     DELETE wist de hele reeks.
//   niet-organisator — PATCH raakt hooguit je eigen kopie, en DELETE is dan
//                     feitelijk AFWIJZEN: de organisator krijgt bericht.
//   hele dag        — die staan in de spiegel op 00:00 UTC, dus het formulier
//                     toont 01:00/02:00 en opslaan maakt er een afspraak van
//                     één uur van. Alleen bij wijzigen; verwijderen kan wel.
//   genodigden      — alleen bij verwijderen: geen afzegging, dus ook geen
//                     verwijderknop. Wijzigen mág wél (besluit Jelle
//                     2026-09-14) — Outlook stuurt dan een update-mail en de UI
//                     zegt dat er ook bij, vóór de klik.
//
// ── De spiegel loopt meteen mee ─────────────────────────────────────────────
// `calendar_events` heeft RLS met alleen een SELECT-policy voor gebruikers en
// een ALL-policy voor service_role: de browser KAN niet terugschrijven. Deze
// functie doet het dus zelf, in dezelfde call. Zonder dat klikt Jelle op
// Opslaan en blijft zijn scherm een kwartier onveranderd — erger dan geen knop.
// `graph_id` is de unieke sleutel waar ook de ETL op upsert, dus de
// eerstvolgende sync schrijft er gewoon overheen.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { requireCapability } from '../_shared/user-gate.ts';
import { buildCtxForCaller, type CallerCtx } from '../_shared/outlook-ctx.ts';
import {
  createEvent, deleteEvent, getEvent, graphUtcToIso, updateEvent,
  type CalendarEventFields, type GraphEvent,
} from '../_shared/outlook-calendar.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

interface MirrorRow {
  id: string;
  graph_id: string;
  user_id: string;
  is_all_day: boolean;
  is_recurring: boolean;
  is_organizer: boolean;
}

/**
 * De spiegelrij van dit graph_id, en of hij van de caller is.
 *
 * Dit is de multi-user-poort: zonder deze check kan gebruiker B het graph_id
 * van gebruiker A meesturen. Dat de Composio-connectie per caller wordt
 * opgehaald vangt dat meestal al af (Graph vindt het event dan niet), maar
 * "meestal" is bij een schrijfactie niet genoeg.
 */
async function ownedRow(
  supabase: SupabaseClient, graphId: string, caller: string,
): Promise<MirrorRow> {
  const { data } = await supabase.from('calendar_events')
    .select('id, graph_id, user_id, is_all_day, is_recurring, is_organizer')
    .eq('graph_id', graphId).limit(2);
  const rows = Array.isArray(data) ? data as MirrorRow[] : [];
  if (rows.length === 0) throw new Error('event_not_in_mirror');
  if (rows[0].user_id !== caller) throw new Error('event_not_yours');
  return rows[0];
}

const attendeeCount = (ev: GraphEvent): number =>
  Array.isArray(ev.attendees) ? ev.attendees.length : 0;

/** 'singleInstance' | 'occurrence' | 'exception' | 'seriesMaster' */
const isSeries = (ev: GraphEvent, row: MirrorRow): boolean =>
  (typeof ev.type === 'string' && ev.type !== 'singleInstance') || row.is_recurring === true;

/** Wijzigen: organisator, niet terugkerend, niet hele dag. */
function assertEditable(ev: GraphEvent, row: MirrorRow): void {
  if (ev.isOrganizer === false || row.is_organizer === false) throw new Error('not_organizer');
  if (isSeries(ev, row)) throw new Error('recurring_not_supported');
  if (ev.isAllDay === true || row.is_all_day === true) throw new Error('all_day_not_supported');
}

/** Verwijderen: organisator, niet terugkerend, en nul genodigden. */
function assertDeletable(ev: GraphEvent, row: MirrorRow): void {
  if (ev.isOrganizer === false || row.is_organizer === false) throw new Error('not_organizer');
  if (isSeries(ev, row)) throw new Error('recurring_not_supported');
  if (attendeeCount(ev) > 0) throw new Error('has_attendees');
}

// ── Spiegel ─────────────────────────────────────────────────────────────────

/**
 * De velden die de ETL ook zou schrijven, uit dezelfde bron (de Graph-payload).
 * Bewust geen poging om `raw` volledig na te bootsen: dit is een voorschot op
 * de eerstvolgende sync, geen vervanging ervan.
 */
function mirrorFields(ev: GraphEvent, userId: string): Record<string, unknown> {
  const loc = ev.location as { displayName?: string } | undefined;
  const org = (ev.organizer as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
  const online = ev.onlineMeeting as { joinUrl?: string } | undefined;
  return {
    graph_id: String(ev.id ?? ''),
    user_id: userId,
    subject: typeof ev.subject === 'string' ? ev.subject : null,
    body_preview: typeof ev.bodyPreview === 'string' ? ev.bodyPreview : null,
    start_time: graphUtcToIso((ev.start as { dateTime?: string } | undefined)?.dateTime),
    end_time: graphUtcToIso((ev.end as { dateTime?: string } | undefined)?.dateTime),
    location_text: loc?.displayName ? String(loc.displayName) : null,
    is_all_day: ev.isAllDay === true,
    is_organizer: ev.isOrganizer !== false,
    is_recurring: typeof ev.type === 'string' && ev.type !== 'singleInstance',
    is_cancelled: ev.isCancelled === true,
    show_as: typeof ev.showAs === 'string' ? ev.showAs : null,
    importance: typeof ev.importance === 'string' ? ev.importance : null,
    categories: Array.isArray(ev.categories) ? ev.categories : null,
    organizer_email: org?.address ? String(org.address) : null,
    organizer_name: org?.name ? String(org.name) : null,
    online_meeting_url: online?.joinUrl ? String(online.joinUrl) : null,
    graph_etag: typeof ev['@odata.etag'] === 'string' ? ev['@odata.etag'] : null,
    last_modified_at: graphUtcToIso(ev.lastModifiedDateTime) ?? null,
    is_deleted: false,
    deleted_at: null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * De genodigden meeschrijven, zodat het scherm ná een wijziging klopt. Alleen
 * bij een event dat er al is: `calendar_attendees` hangt aan `calendar_event_id`
 * én heeft een unieke `(graph_id, email)`.
 */
async function mirrorAttendees(
  supabase: SupabaseClient, eventRowId: string, graphId: string, userId: string, ev: GraphEvent,
): Promise<void> {
  const list = (Array.isArray(ev.attendees) ? ev.attendees as GraphEvent[] : []).map((a) => {
    const ea = a.emailAddress as { address?: string; name?: string } | undefined;
    const st = a.status as { response?: string } | undefined;
    return {
      calendar_event_id: eventRowId,
      graph_id: graphId,
      user_id: userId,
      email: String(ea?.address ?? '').toLowerCase(),
      name: ea?.name ? String(ea.name) : null,
      attendee_type: typeof a.type === 'string' ? a.type : null,
      response_status: st?.response ? String(st.response) : null,
      is_organizer: false,
    };
  }).filter((a) => a.email);
  // Weg wat er niet meer is; daarna wat er wel is. Twee stappen, want een
  // upsert alleen laat verwijderde genodigden staan.
  await supabase.from('calendar_attendees').delete().eq('graph_id', graphId);
  if (list.length > 0) {
    await supabase.from('calendar_attendees').upsert(list, { onConflict: 'graph_id,email' });
  }
}

async function upsertMirror(
  supabase: SupabaseClient, ev: GraphEvent, userId: string,
): Promise<string | null> {
  const { data, error } = await supabase.from('calendar_events')
    .upsert(mirrorFields(ev, userId), { onConflict: 'graph_id' })
    .select('id').limit(1);
  if (error) throw new Error(`mirror_write_failed: ${error.message.slice(0, 140)}`);
  const rowId = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
  if (rowId) await mirrorAttendees(supabase, rowId, String(ev.id ?? ''), userId, ev);
  return rowId;
}

// ── Acties ──────────────────────────────────────────────────────────────────

function fieldsFrom(p: Record<string, unknown>): CalendarEventFields {
  return {
    subject: typeof p.subject === 'string' ? p.subject : null,
    date: typeof p.date === 'string' ? p.date : null,
    start: typeof p.start === 'string' ? p.start : null,
    end: typeof p.end === 'string' ? p.end : null,
    location: typeof p.location === 'string' ? p.location : null,
  };
}

async function doCreate(
  supabase: SupabaseClient, ctx: CallerCtx, p: Record<string, unknown>,
) {
  const { graphId, event } = await createEvent(ctx, fieldsFrom(p));
  await upsertMirror(supabase, event, ctx.ownerUserId);
  return { ok: true, graph_id: graphId, subject: event.subject ?? null };
}

async function doUpdate(
  supabase: SupabaseClient, ctx: CallerCtx, caller: string, p: Record<string, unknown>,
) {
  const graphId = String(p.graph_id ?? '').trim();
  if (!graphId) throw new Error('missing_graph_id');
  const row = await ownedRow(supabase, graphId, caller);
  assertEditable(await getEvent(ctx, graphId), row);

  const { event, attendeeCount: n } = await updateEvent(ctx, graphId, fieldsFrom(p));
  await upsertMirror(supabase, event, ctx.ownerUserId);
  // `attendees_notified` is geen keuze maar een constatering: Graph stuurt bij
  // een tijd- of locatiewijziging een update-mail naar de genodigden en heeft
  // daar geen onderdrukkingsparameter voor. De UI zegt het vooraf; dit is de
  // bevestiging achteraf, zodat de toast kan kloppen.
  return { ok: true, graph_id: graphId, attendees_notified: n > 0, attendee_count: n };
}

async function doDelete(
  supabase: SupabaseClient, ctx: CallerCtx, caller: string, p: Record<string, unknown>,
) {
  const graphId = String(p.graph_id ?? '').trim();
  if (!graphId) throw new Error('missing_graph_id');
  const row = await ownedRow(supabase, graphId, caller);
  assertDeletable(await getEvent(ctx, graphId), row);

  await deleteEvent(ctx, graphId);
  const { error } = await supabase.from('calendar_events')
    .update({ is_deleted: true, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('graph_id', graphId);
  if (error) throw new Error(`mirror_delete_failed: ${error.message.slice(0, 140)}`);
  return { ok: true, graph_id: graphId };
}

/** Een geweigerd hek is een 409, geen 502: er is niets stuk, het mag niet. */
const REFUSALS = new Set([
  'not_organizer', 'recurring_not_supported', 'all_day_not_supported',
  'has_attendees', 'event_not_in_mirror', 'event_not_yours',
]);
const BAD_REQUEST = new Set([
  'missing_graph_id', 'missing_datetime', 'end_before_start',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  // De poort van een browser-functie (v1.198, `_shared/user-gate.ts`): mag deze
  // persoon de Agenda überhaupt? Zelfde vorm als `outlook-live`, die
  // `'postvak'` vraagt. Dit vervangt de losse role-check: `requireCapability`
  // doet die zelf (`callerSub` eist role === 'authenticated') en weigert daarná
  // pas op de capability, met een Nederlandse melding.
  const gate = await requireCapability(req, 'agenda');
  if (!gate.ok) return gate.response!;
  // Een service-role-call heeft geen persoon en dus geen agenda. Er is geen
  // "org-agenda" om op terug te vallen — dat terugvallen was blokkade B3.
  if (gate.service || !gate.sub) return json({ ok: false, reason: 'user_required' }, 403);
  const callerSubId = gate.sub;

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  try {
    const ctx = await buildCtxForCaller(supabase, callerSubId);
    switch (payload.action) {
      case 'create_event': return json(await doCreate(supabase, ctx, payload));
      case 'update_event': return json(await doUpdate(supabase, ctx, callerSubId, payload));
      case 'delete_event': return json(await doDelete(supabase, ctx, callerSubId, payload));
      default: return json({ ok: false, reason: 'unknown_action' }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'no_mailbox_for_user') return json({ ok: false, reason: msg }, 403);
    if (REFUSALS.has(msg)) return json({ ok: false, reason: msg }, 409);
    if (BAD_REQUEST.has(msg) || msg.startsWith('bad_date:') || msg.startsWith('bad_time:')) {
      return json({ ok: false, reason: msg }, 400);
    }
    return json({ ok: false, reason: msg.slice(0, 200) }, 502);
  }
});
