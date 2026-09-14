// outlook-calendar.ts — de enige plek waar Maestro in een Outlook-AGENDA schrijft.
//
// Drie acties: aanmaken, wijzigen, verwijderen. De poort naar Composio (de
// allowlist en de pin op `user_id: 'me'`) zit in `outlook-exec.ts`; dit bestand
// gaat over wat er in de argumenten hoort te staan. Dat is hier het hele
// verhaal, want elk van de vier valkuilen hieronder geeft **HTTP 200**.
//
// ── Val 1: UPDATE vult zijn defaults écht in ────────────────────────────────
// Gemeten 2026-09-14 (`agenda_write_smoke --composio`, C4b–C4e), op een echt
// event met één genodigde, een categorie, een locatie en `show_as: free`:
//
//     UPDATE { event_id, subject }        →  attendees   1 → 0
//                                            location    "Bestaande locatie" → ""
//                                            categories  ["Rode categorie"] → []
//                                            show_as     free → busy
//
// Een parameter met een NIET-NULL default (`subject` "", `location` {},
// `attendees` [], `categories` [], `show_as` "busy") wordt dus gematerialiseerd
// als je hem weglaat, en wist daarmee wat er stond. Composio's eigen schema
// zegt het zelfs met zoveel woorden: *"Providing this list (even if empty) will
// replace all existing attendees"*.
//
// Parameters met `default: null` (`body`, `start_datetime`, `end_datetime`)
// doen dat níét — die overleven het weglaten (C4f).
//
// Daarom is `updateEvent` een READ-MODIFY-WRITE en geen patch: eerst
// `GET_EVENT`, dan de wijziging van de gebruiker over de teruggelezen waarden
// heen, dan élk wissend veld expliciet mee. Bewezen met C4h (de positieve
// controle) — een negatieve assertie laat alleen zien dat je het probleem kent.
//
// ── Val 2: `body` sloopt de Teams-link ──────────────────────────────────────
// Graph: *"Inadvertently removing the meeting blob from the body would disable
// meeting online."* In het zichtbare venster heeft meer dan de helft van de
// events een `online_meeting_url`. `body` gaat daarom NOOIT mee bij een update
// (C5b/C5c bewijzen dat weglaten genoeg is). Het formulier heeft ook geen
// body-veld, dus er valt niets te verliezen.
//
// ── Val 3: de tijdzone, en de zomertijd ─────────────────────────────────────
// Graph wil een NAÏEVE tijd plus een aparte zone: "2027-04-15T14:00:00" mét
// `time_zone: "Europe/Amsterdam"`. Wie `toISOString()` gebruikt stuurt
// "…T12:00:00.000Z" én een zone, en dat is dubbelop. Wie zelf `+02:00` plakt
// heeft gelijk tot 25 oktober 2026 en daarna een half jaar lang een uur mis.
// Vandaar `naiveLocal()` en één constante. Gemeten aan weerskanten van de
// grens (C3a zomertijd, C3b wintertijd) — één datum bewijst niets.
//
// `time_zone` staat zelf óók op een niet-null default ("UTC"), dus hij gaat
// altijd mee mét `start_datetime`/`end_datetime`; anders leest Composio de
// naïeve lokale tijd als UTC.
//
// ── Val 4: verwijderen stuurt standaard een afzeggingsmail ──────────────────
// `send_notifications` heeft default **`true`**. Wie deze tool aanroept zoals
// de rest van de codebase tools aanroept — alleen de verplichte velden — stuurt
// afzeggingspost naar klanten. Besluit Jelle 2026-09-14: dat gebeurt nooit. De
// vlag staat hier hard op `false` en is geen parameter van `deleteEvent`, zodat
// geen enkele caller hem kan omzetten.

import { CALENDAR_TOOLS, execOutlookTool, respData } from "./outlook-exec.ts";
import type { OutlookCtx } from "./outlook-exec.ts";

/**
 * Eén zone, expliciet, nooit een offset. IANA-naam — beide tools accepteren die
 * (C1 en C4i draaiden erop). Legal Mind zit in Nederland; zou dat ooit per
 * gebruiker moeten, dan is dit de plek en niet een `+02:00` in een template.
 */
export const CAL_TZ = "Europe/Amsterdam";

/** "2027-04-15" + "14:00" → "2027-04-15T14:00:00". Naïef: geen Z, geen offset. */
export function naiveLocal(date: string, hhmm: string): string {
  const d = String(date ?? "").trim();
  const t = String(hhmm ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`bad_date:${d}`);
  if (!/^\d{2}:\d{2}$/.test(t)) throw new Error(`bad_time:${t}`);
  return `${d}T${t}:00`;
}

/** Graph geeft "2027-04-15T12:00:00.0000000" zonder Z, altijd in UTC. */
export function graphUtcToIso(dt: unknown): string | null {
  const s = String(dt ?? "").trim();
  if (!s) return null;
  const base = s.replace(/\.\d+$/, "").replace(/Z$/, "");
  const d = new Date(`${base}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface CalendarEventFields {
  subject?: string | null;
  /** "YYYY-MM-DD" — lokale datum uit het formulier. */
  date?: string | null;
  /** "HH:mm" — lokale tijd uit het formulier. */
  start?: string | null;
  end?: string | null;
  location?: string | null;
}

/** De Graph-payload van één event, zoals GET_EVENT hem teruggeeft. */
export type GraphEvent = Record<string, unknown>;

export async function getEvent(ctx: OutlookCtx, eventId: string): Promise<GraphEvent> {
  return respData(await execOutlookTool(ctx, CALENDAR_TOOLS.GET_EVENT, { event_id: eventId }));
}

/**
 * Nieuw event. Bewust zónder `attendees_info`: zodra die meegaat stuurt Graph
 * uitnodigingen, en Microsoft zegt daarover letterlijk dat het *"can't be
 * configured"*. Er is dus geen "maak hem alvast aan maar nodig nog niemand
 * uit"-stand, en het formulier heeft ook geen genodigden-veld. Wie genodigden
 * wil, gaat via de Outlook-deeplink die naast de knop blijft staan.
 */
export async function createEvent(
  ctx: OutlookCtx,
  f: CalendarEventFields,
): Promise<{ graphId: string; event: GraphEvent }> {
  if (!f.date || !f.start || !f.end) throw new Error("missing_datetime");
  const startDt = naiveLocal(f.date, f.start);
  const endDt = naiveLocal(f.date, f.end);
  if (endDt <= startDt) throw new Error("end_before_start");

  const res = await execOutlookTool(ctx, CALENDAR_TOOLS.CREATE_EVENT, {
    subject: String(f.subject ?? "").trim() || "(geen titel)",
    // `body` is verplicht bij create (anders dan bij update, waar hij juist
    // wegblijft). Leeg is een bewuste keuze: het formulier heeft geen
    // body-veld, en een verzonnen standaardtekst zou in Outlook opduiken.
    body: "",
    is_html: false,
    start_datetime: startDt,
    end_datetime: endDt,
    time_zone: CAL_TZ,
    location: String(f.location ?? ""),
    show_as: "busy",
  });
  const created = respData(res);
  const graphId = String(created.id ?? "");
  if (!graphId) throw new Error("create_event_id_missing");
  // Terug lezen: het antwoord van CREATE is niet noodzakelijk hetzelfde als wat
  // er in de agenda staat, en de spiegelrij hangt aan deze waarden.
  return { graphId, event: await getEvent(ctx, graphId) };
}

/**
 * De argumenten voor één UPDATE — het hart van val 1.
 *
 * **Moet gelijk blijven aan `scripts/agenda_write_smoke.cjs` →
 * `buildUpdateArgs`**, anders meet die test iets anders dan deze functie doet.
 *
 * Geëxporteerd zodat hij los te lezen en te vergelijken is; `updateEvent`
 * hieronder is de enige aanroeper.
 */
export function buildUpdateArgs(
  eventId: string,
  before: GraphEvent,
  f: CalendarEventFields,
): Record<string, unknown> {
  const loc = before.location as { displayName?: string } | undefined;
  const beforeAtt = Array.isArray(before.attendees) ? before.attendees as GraphEvent[] : [];

  const args: Record<string, unknown> = {
    event_id: eventId,
    // Alles hieronder wist bij weglaten (C4b–C4e) → altijd expliciet, met de
    // teruggelezen waarde als de gebruiker hem niet wijzigde.
    subject: f.subject != null ? String(f.subject) : String(before.subject ?? ""),
    location: {
      displayName: f.location != null ? String(f.location) : String(loc?.displayName ?? ""),
    },
    attendees: beforeAtt.map((a) => {
      const ea = a.emailAddress as { address?: string; name?: string } | undefined;
      return {
        emailAddress: { address: String(ea?.address ?? ""), name: String(ea?.name ?? "") },
        // Composio's schema noemt alleen 'required' en 'optional', maar Graph
        // kent ook 'resource' (een vergaderruimte). Doorgeven wat er stond is
        // het enige dat níét muteert; valt Composio erover, dan faalt de update
        // luid — en dat is beter dan een zaal die stil van de afspraak valt.
        type: String(a.type ?? "required"),
      };
    }).filter((a) => a.emailAddress.address),
    categories: Array.isArray(before.categories) ? before.categories : [],
    show_as: String(before.showAs ?? "busy"),
  };

  // start/end hebben `default: null` en overleven het weglaten (C4f). Ze gaan
  // alleen mee als de caller ze stuurt — en dan altijd mét `time_zone` (val 3).
  if (f.date && f.start && f.end) {
    const startDt = naiveLocal(f.date, f.start);
    const endDt = naiveLocal(f.date, f.end);
    if (endDt <= startDt) throw new Error("end_before_start");
    args.start_datetime = startDt;
    args.end_datetime = endDt;
    args.time_zone = CAL_TZ;
  }
  return args; // `body` gaat NOOIT mee — val 2.
}

export async function updateEvent(
  ctx: OutlookCtx,
  eventId: string,
  f: CalendarEventFields,
): Promise<{ event: GraphEvent; attendeeCount: number }> {
  const before = await getEvent(ctx, eventId);
  await execOutlookTool(ctx, CALENDAR_TOOLS.UPDATE_EVENT, buildUpdateArgs(eventId, before, f));
  const after = await getEvent(ctx, eventId);
  const att = Array.isArray(after.attendees) ? after.attendees.length : 0;
  return { event: after, attendeeCount: att };
}

/**
 * Verwijderen — altijd zonder afzeggingsmail (val 4). `send_notifications` is
 * met opzet géén parameter van deze functie: een vlag die je kunt meegeven is
 * een vlag die ooit `true` wordt.
 */
export async function deleteEvent(ctx: OutlookCtx, eventId: string): Promise<void> {
  await execOutlookTool(ctx, CALENDAR_TOOLS.DELETE_EVENT, {
    event_id: eventId,
    send_notifications: false,
  });
}
