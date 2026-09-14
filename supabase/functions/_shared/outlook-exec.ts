// outlook-exec.ts — de ENE poort naar Composio's Outlook-toolkit.
//
// Tot v1.194 stond `execOutlookTool` in `_shared/outlook-write.ts`, samen met
// de mail-slugs. Met de agenda-schrijfbaan erbij zijn er twee domeinen (mail en
// agenda) en drie functies die schrijven, en dan is "elke schrijver zijn eigen
// kopie van de slugs" precies de fout die de mailbaan een kwartaal onzichtbaar
// kapot hield (OUTLOOK-CONNECTOR.md §5b). Dus: één allowlist, hier.
//
// ── Twee sloten ─────────────────────────────────────────────────────────────
//
// 1. **De allowlist.** Een slug die hier niet in staat wordt niet uitgevoerd,
//    ook niet als een caller hem meegeeft. De toolkit bevat
//    OUTLOOK_OUTLOOK_SEND_EMAIL en OUTLOOK_OUTLOOK_REPLY_EMAIL; die verstúren,
//    en het product zegt: Maestro zet klaar, Jelle drukt zelf op verzenden.
//
// 2. **`user_id` hard op 'me'.** Alle Outlook-tools accepteren een `user_id`
//    met een willekeurige UPN, en de Entra-grant bevat
//    `Calendars.ReadWrite.Shared` — schrijfrecht op agenda's die aan de
//    mailbox-eigenaar gedeeld zijn. Eén verkeerd doorgegeven `user_id` schrijft
//    dus in de agenda van een collega, zonder foutmelding. `execOutlookTool`
//    overschrijft het veld daarom altijd, ná de spread van de caller-args.
//    Gemeten (agenda_write_smoke C9): een vreemde UPN wordt door Graph zelf ook
//    geweigerd (ErrorInvalidUser) — maar dat is hún slot, niet het onze.
//
// ── Slugs (live geverifieerd 2026-09-14 via GET /api/v3/tools/<slug>) ────────
// Let op de drie naamvormen bij de agenda: het woord CALENDAR staat bij create
// in het midden, bij update achteraan en bij delete helemaal niet. Dat is geen
// patroon om uit je hoofd te typen — vandaar deze tabel.

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";

/** Mail-slugs. Bewust zonder send-slug: zie slot 1 hierboven. */
export const OUTLOOK_TOOLS = {
  GET_MESSAGE: "OUTLOOK_OUTLOOK_GET_MESSAGE",
  UPDATE_EMAIL: "OUTLOOK_OUTLOOK_UPDATE_EMAIL",
  MOVE_MESSAGE: "OUTLOOK_OUTLOOK_MOVE_MESSAGE",
  CREATE_DRAFT_REPLY: "OUTLOOK_OUTLOOK_CREATE_DRAFT_REPLY",
  CREATE_DRAFT: "OUTLOOK_OUTLOOK_CREATE_DRAFT",
  LIST_MESSAGES: "OUTLOOK_OUTLOOK_LIST_MESSAGES",
  LIST_ATTACHMENTS: "OUTLOOK_LIST_OUTLOOK_ATTACHMENTS",
  DOWNLOAD_ATTACHMENT: "OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT",
} as const;

/** Agenda-slugs. */
export const CALENDAR_TOOLS = {
  CREATE_EVENT: "OUTLOOK_OUTLOOK_CALENDAR_CREATE_EVENT",
  UPDATE_EVENT: "OUTLOOK_OUTLOOK_UPDATE_CALENDAR_EVENT",
  DELETE_EVENT: "OUTLOOK_OUTLOOK_DELETE_EVENT",
  GET_EVENT: "OUTLOOK_OUTLOOK_GET_EVENT",
} as const;

/**
 * Adresboek-slugs. Bewust ALLEEN de lees-tool.
 *
 * De toolkit heeft ook CREATE_CONTACT, UPDATE_CONTACT en DELETE_CONTACT.
 * Maestro spiegelt het adresboek om er genodigden uit te kunnen kiezen; het
 * heeft geen enkele reden om erin te schrijven, en een slug die niet in deze
 * tabel staat kán niet worden uitgevoerd (slot 1). Dat is dezelfde afweging als
 * bij de send-slugs aan de mailkant.
 *
 * Live geverifieerd 2026-09-15 (`GET /api/v3/tools/OUTLOOK_OUTLOOK_LIST_CONTACTS`):
 * de scope `Contacts.ReadWrite` staat al in de auth-config sinds 2026-04-24, dus
 * hier is geen nieuwe consent-ronde voor nodig.
 */
export const CONTACT_TOOLS = {
  LIST_CONTACTS: "OUTLOOK_OUTLOOK_LIST_CONTACTS",
} as const;

const ALLOWED: ReadonlySet<string> = new Set([
  ...Object.values(OUTLOOK_TOOLS),
  ...Object.values(CALENDAR_TOOLS),
  ...Object.values(CONTACT_TOOLS),
]);

export interface OutlookCtx {
  apiKey: string;
  /** Composio user_id van de mailbox-eigenaar. */
  userId: string;
  /** Composio connected_account_id van die mailbox. */
  connectionId: string;
}

export interface ToolResponse {
  data?: Record<string, unknown>;
  error?: string | null;
  successful?: boolean;
}

/**
 * Eén Composio-tool uitvoeren. Allowlist-bewaakt, met 429-backoff.
 *
 * Faalt hard op `successful === false`: Composio geeft dan HTTP 200 met een
 * `error`-veld, en dat stil doorlaten is hoe een halve schrijfactie een
 * "geslaagde" run wordt.
 */
export async function execOutlookTool(
  ctx: OutlookCtx,
  tool: string,
  args: Record<string, unknown>,
  retry = 0,
): Promise<ToolResponse> {
  if (!ALLOWED.has(tool)) {
    throw new Error(`outlook_tool_not_allowed:${tool}`);
  }
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(tool)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({
      user_id: ctx.userId,
      connected_account_id: ctx.connectionId,
      // De spread eerst, de pin erná: wat een caller ook meegeeft, we schrijven
      // in de eigen mailbox. Zie slot 2.
      arguments: { ...args, user_id: "me" },
    }),
  });
  if (res.status === 429 && retry < 2) {
    await new Promise((r) => setTimeout(r, [3000, 9000][retry]));
    return execOutlookTool(ctx, tool, args, retry + 1);
  }
  const text = await res.text();
  let body: ToolResponse;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`composio_non_json_${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`composio_http_${res.status}: ${body?.error ?? text.slice(0, 200)}`);
  if (body.successful === false) {
    throw new Error(`composio_${tool}_failed: ${String(body.error ?? "unknown").slice(0, 200)}`);
  }
  return body;
}

/** Graph-payload uit het Composio-antwoord. Twee vormen in het wild. */
export function respData(body: ToolResponse): Record<string, unknown> {
  const d = body.data as Record<string, unknown> | undefined;
  const rd = d?.response_data as Record<string, unknown> | undefined;
  return rd ?? d ?? {};
}
