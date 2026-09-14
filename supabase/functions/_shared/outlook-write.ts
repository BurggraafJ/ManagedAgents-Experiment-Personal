// outlook-write.ts — de enige plek waar Maestro in Outlook schrijft.
//
// Twee functies gebruiken dit: `outlook-live` (browser, per ingelogde caller)
// en `auto-draft-execute-now` (pg_trigger op een autodraft-beslissing). Vóór
// deze module hadden ze elk hun eigen kopie van de slugs en de HTML-helpers,
// en dat is precies hoe ze uit elkaar liepen: `outlook-live` draaide op geldige
// slugs, `auto-draft-execute-now` op vier die Composio had ingetrokken.
//
// ── Slugs (live geverifieerd 2026-09-14 via GET /api/v3/tools/<slug>) ────────
// Composio heeft de Outlook-tools hernoemd naar een dubbele prefix. De oude
// namen geven 404 `Tool_ToolNotFound`, en een 404 in een try/catch ziet er
// precies zo uit als "niets te doen" — dat is hoe dit een kwartaal onzichtbaar
// stuk kon staan (OUTLOOK-CONNECTOR.md §5b).
//
//   OUTLOOK_MOVE_MESSAGE                      → OUTLOOK_OUTLOOK_MOVE_MESSAGE
//   OUTLOOK_UPDATE_EMAIL                      → OUTLOOK_OUTLOOK_UPDATE_EMAIL
//   OUTLOOK_GET_MESSAGE                       → OUTLOOK_OUTLOOK_GET_MESSAGE
//   OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT → OUTLOOK_OUTLOOK_CREATE_DRAFT_REPLY
//
// ── Nooit versturen ─────────────────────────────────────────────────────────
// Dezelfde toolkit bevat OUTLOOK_OUTLOOK_SEND_EMAIL en OUTLOOK_OUTLOOK_REPLY_EMAIL.
// Die verstúren. Het product zegt: Maestro zet een concept klaar, Jelle drukt
// zelf op verzenden. `execOutlookTool` draait daarom op een ALLOWLIST — een
// slug die hier niet in staat wordt niet uitgevoerd, ook niet als een caller
// hem meegeeft. De Entra-grant mist `Mail.Send` óók, maar dat is een tweede
// slot, geen reden om het eerste weg te laten.
//
// v1.195 (2026-09-14) — de allowlist, `execOutlookTool` en `respData` staan
// niet meer hier maar in `_shared/outlook-exec.ts`, omdat de agenda-schrijfbaan
// (`outlook-calendar.ts`) dezelfde poort gebruikt. Dit bestand houdt de
// MAIL-kant: HTML-helpers, mapresolutie en de twee schrijfacties. De re-exports
// hieronder houden de twee bestaande importeurs (`outlook-live`,
// `auto-draft-execute-now`) ongewijzigd — dit is een verplaatsing, geen
// gedragswijziging.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { execOutlookTool, OUTLOOK_TOOLS, respData } from "./outlook-exec.ts";
import type { OutlookCtx, ToolResponse } from "./outlook-exec.ts";

export { execOutlookTool, OUTLOOK_TOOLS, respData };
export type { OutlookCtx, ToolResponse };

// ── HTML ────────────────────────────────────────────────────────────────────
// Letterlijk de helpers uit `~/.claude/skills/auto-draft-execute/references/
// naar-outlook-html.md`. Bewust niet "verbeterd": de skill en deze functies
// moeten dezelfde draft opleveren, anders verschilt de opmaak per uitvoerder.

/** `final_body` is platte tekst met \n. Zonder conversie rendert Outlook één regel. */
export function plainToOutlookHtml(text: string): string {
  if (!text) return "";
  // Begint het met '<', dan is het al HTML — laat staan.
  if (/^\s*<[a-z!]/i.test(text)) return text;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const paragraphs = escaped.split(/\n\n+/);
  return paragraphs.map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("");
}

/**
 * Onze tekst bóven de handtekening + geciteerde chain van het antwoord-concept
 * dat Outlook zelf genereerde, zodat beide blijven staan.
 *
 * ⚠ Gemeten 2026-09-14 op de échte Graph/Composio-route: een `createReply`-
 * concept bevat GEEN van de vijf markers uit de skill-doc. Die vijf komen uit
 * een concept dat de Outlook-CLIENT opstelt (OWA zet `appendonsend`, voegt de
 * handtekening in). Graph levert een kaal `<html><head>…<body>` met meteen de
 * chain-divider, en zónder handtekening — handtekeningen zijn een client-
 * functie. Vandaar de twee extra markers onderaan de lijst.
 *
 * Ze staan bewust ACHTERAAN: een client-concept matcht nog steeds op zijn
 * eigen marker, precies zoals eerst. Ze vangen alleen het geval dat vóór
 * vandaag in de prepend-fallback viel — en die fallback plakte `<p>…` vóór
 * `<html>`, dus buiten de body. Dat ging goed omdat Outlook de HTML bij het
 * opslaan herstelt, maar op die reparatie wil je niet leunen.
 */
export function injectBodyAboveSignature(template: string, bodyHtml: string): string {
  const markers = [
    '<div id="appendonsend">',            // Outlook 365 standaard (client)
    '<div id="Signature">',               // oudere desktop-versie
    '<hr id="stopSpelling">',             // chain-divider
    '<div class="WordSection1">',         // Word-rendered template
    '<div class="OutlookMessageHeader">', // chain-header alternatief
    '<hr tabindex="-1"',                  // Graph createReply: de scheidingslijn
    '<div id="divRplyFwdMsg"',            // Graph createReply: de chain-kop
  ];
  for (const m of markers) {
    const idx = template.indexOf(m);
    if (idx !== -1) return template.slice(0, idx) + bodyHtml + template.slice(idx);
  }
  return bodyHtml + template;
}

// ── Mappen ──────────────────────────────────────────────────────────────────

/** Graph accepteert deze namen rechtstreeks als `destination_id`. */
const WELL_KNOWN = new Set([
  "inbox", "archive", "drafts", "sentitems", "deleteditems", "junkemail",
  "outbox", "clutter", "conflicts", "conversationhistory", "localfailures",
  "msgfolderroot", "recoverableitemsdeletions", "scheduled", "searchfolders",
  "serverfailures", "syncissues",
]);

/** Wat de UI schrijft vs. wat de mailbox heet. De mappen zijn Engels. */
const NL_ALIAS: Record<string, string> = {
  "verwijderde items": "deleteditems",
  "prullenbak": "deleteditems",
  "archief": "archive",
  "concepten": "drafts",
  "postvak in": "inbox",
  "verzonden items": "sentitems",
  "ongewenste e-mail": "junkemail",
};

/**
 * `target_folder` → een `destination_id` die Graph accepteert.
 *
 * De waarde kan van drie kanten komen: een Graph-folder-id (drag & drop), een
 * `full_path` uit de mirror (categorie-default) of een losse `display_name`.
 * Altijd gescopeerd op de mailbox-eigenaar — zonder dat filter levert
 * "Archive" bij twee mailboxen twee rijen en verplaats je in de verkeerde.
 *
 * `null` = niet te herleiden; de caller hoort dan NIET te verplaatsen en een
 * waarschuwing te loggen, niet in een default-map te gokken.
 */
export async function resolveFolderId(
  supabase: SupabaseClient,
  ownerUserId: string | null,
  target: string | null | undefined,
): Promise<string | null> {
  const want = String(target ?? "").trim();
  if (!want) return null;

  const lower = want.toLowerCase();
  if (WELL_KNOWN.has(lower)) return lower;
  if (NL_ALIAS[lower]) return NL_ALIAS[lower];

  // Bewust géén `.or(...)`: die filter is één string die PostgREST op komma's
  // splitst, en een mapnaam mag een komma bevatten. Eén mailbox is hooguit
  // enkele tientallen rijen — die matchen we hier, exact.
  let q = supabase.from("mail_folders").select("id, full_path, display_name");
  if (ownerUserId) q = q.eq("user_id", ownerUserId);
  const { data } = await q.limit(500);

  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  // Voorkeursorde: exacte id > exact pad > losse naam (hoofdletter-ongevoelig).
  // Geen maybeSingle(): twee mailboxen met dezelfde mapnaam zijn twee rijen,
  // geen fout.
  const hit = rows.find((r) => r.id === want)
    ?? rows.find((r) => r.full_path === want)
    ?? rows.find((r) => r.display_name === want)
    ?? rows.find((r) => String(r.full_path ?? "").toLowerCase() === lower)
    ?? rows.find((r) => String(r.display_name ?? "").toLowerCase() === lower);
  return hit?.id ? String(hit.id) : null;
}

// ── Schrijfacties ───────────────────────────────────────────────────────────

function addressList(list: unknown): Array<{ address: string }> {
  if (!Array.isArray(list)) return [];
  const out: Array<{ address: string }> = [];
  for (const raw of list) {
    const v = typeof raw === "string"
      ? raw
      : String((raw as Record<string, unknown>)?.address
        ?? ((raw as Record<string, unknown>)?.emailAddress as Record<string, unknown>)?.address
        ?? "");
    const addr = v.trim();
    if (/\S+@\S+\.\S+/.test(addr) && !out.some((o) => o.address.toLowerCase() === addr.toLowerCase())) {
      out.push({ address: addr });
    }
  }
  return out.slice(0, 20);
}

export interface ReplyDraftResult {
  draft_id: string;
  subject: string;
  to: string[];
  cc: string[];
  warnings: string[];
}

/**
 * Een ANTWOORD-concept op de bronmail — Graph `createReply`, dus met
 * `conversationId` en `In-Reply-To` van het origineel. Een los concept in
 * Concepten (CREATE_DRAFT) is nadrukkelijk niet hetzelfde en hoort hier niet.
 *
 * ⚠ Waarom stap 2 verplicht is: `UPDATE_EMAIL` is een VERVANG-call, geen patch.
 * Composio's eigen schema zegt het met zoveel woorden — "Omitting this field
 * removes all current CC recipients", en voor `subject`: "Omitting or providing
 * an empty string clears the subject". Het antwoord-concept dat Outlook net
 * maakte heeft zijn ontvanger (de afzender van het origineel) en zijn
 * "RE: …"-onderwerp al ingevuld; updaten zonder die velden mee te sturen
 * wist ze. Dat is geen fout die opvalt — je houdt een concept over met de
 * juiste tekst en zonder geadresseerde.
 */
export async function placeReplyDraft(
  ctx: OutlookCtx,
  p: {
    message_id: string;
    body_text: string;
    subject?: string | null;
    to?: unknown;
    cc?: unknown;
  },
): Promise<ReplyDraftResult> {
  const warnings: string[] = [];

  // 1 — Outlook maakt het antwoord-concept (handtekening + geciteerde chain).
  const created = await execOutlookTool(ctx, OUTLOOK_TOOLS.CREATE_DRAFT_REPLY, {
    user_id: "me",
    message_id: p.message_id,
    comment: "",
  });
  const draftId = String(respData(created).id ?? "");
  if (!draftId) throw new Error("reply_draft_id_missing");

  // 2 — lees terug wat Outlook invulde: template-HTML, onderwerp, ontvangers.
  let templateHtml: string | null = null;
  let draftSubject: string | null = null;
  let draftTo: unknown = null;
  let draftCc: unknown = null;
  let importance: string | null = null;
  try {
    const got = await execOutlookTool(ctx, OUTLOOK_TOOLS.GET_MESSAGE, {
      user_id: "me",
      message_id: draftId,
      select: "id,subject,body,toRecipients,ccRecipients,importance",
    });
    const m = respData(got);
    const body = m.body as { contentType?: string; content?: string } | undefined;
    if (typeof body?.content === "string" && body.content.length > 0) templateHtml = body.content;
    if (typeof m.subject === "string") draftSubject = m.subject;
    draftTo = m.toRecipients ?? null;
    draftCc = m.ccRecipients ?? null;
    if (typeof m.importance === "string") importance = m.importance;
  } catch {
    warnings.push("reply_template_fetch_failed");
  }

  // 3 — onze tekst bovenaan, chain en handtekening eronder.
  const userBodyHtml = plainToOutlookHtml(p.body_text || "");
  const combinedHtml = templateHtml
    ? injectBodyAboveSignature(templateHtml, userBodyHtml)
    : userBodyHtml;

  // 4 — velden samenstellen. Expliciete parameter wint van wat Outlook zette;
  // wat we niet weten laten we NIET leeglopen.
  const explicitTo = addressList(p.to);
  const explicitCc = addressList(p.cc);
  const to = explicitTo.length > 0 ? explicitTo : addressList(draftTo);
  const cc = explicitCc.length > 0 ? explicitCc : addressList(draftCc);
  const subject = (typeof p.subject === "string" && p.subject.trim())
    ? p.subject
    : (draftSubject ?? "");

  if (to.length === 0) warnings.push("reply_recipients_missing");
  if (!subject) warnings.push("reply_subject_missing");

  await execOutlookTool(ctx, OUTLOOK_TOOLS.UPDATE_EMAIL, {
    user_id: "me",
    message_id: draftId,
    subject,
    body: { contentType: "HTML", content: combinedHtml },
    to_recipients: to,
    cc_recipients: cc,
    ...(importance ? { importance } : {}),
  });

  return {
    draft_id: draftId,
    subject,
    to: to.map((r) => r.address),
    cc: cc.map((r) => r.address),
    warnings,
  };
}

/**
 * Bericht naar een map. Graph maakt bij een move een NIEUW bericht in de
 * doelmap en gooit het origineel weg: het id verandert. Wie daarna nog iets
 * met dit bericht wil (een antwoord-concept, een tweede move) moet het id uit
 * dit antwoord gebruiken — en dus verplaatst je altijd als LAATSTE stap.
 */
export async function moveMessage(
  ctx: OutlookCtx,
  messageId: string,
  destinationId: string,
): Promise<{ id: string; moved: true }> {
  const res = await execOutlookTool(ctx, OUTLOOK_TOOLS.MOVE_MESSAGE, {
    user_id: "me",
    message_id: messageId,
    destination_id: destinationId,
  });
  const newId = respData(res).id;
  return { id: typeof newId === "string" && newId ? newId : messageId, moved: true };
}
