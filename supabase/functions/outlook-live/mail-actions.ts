// mail-actions.ts — de lees- en concept-acties van `outlook-live`.
//
// Stond tot v1.204 in `index.ts`. Met `send_mail`, `mark_read` en `set_pin`
// erbij liep dat bestand tegen de 400-regel-cap van het project aan; `index.ts`
// is nu de router en niets anders. Gedrag ongewijzigd — dit is verhuizing, geen
// herschrijving.
//
// `deploy-edge-fn.cjs` loopt de imports transitief af en neemt buurbestanden in
// de functie-map mee (v1.140), dus de deploy blijft één commando.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';
import { execOutlookTool, OUTLOOK_TOOLS, type ToolResponse } from '../_shared/outlook-write.ts';
import { type Ctx } from './ctx.ts';

const MAX_INLINE_IMAGES = 8;
const MAX_IMAGE_BYTES = 1_500_000;

export function respValue(body: ToolResponse): Array<Record<string, unknown>> {
  const rd = (body.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined;
  const v = rd?.value;
  return Array.isArray(v) ? v as Array<Record<string, unknown>> : [];
}

export function cleanEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(x => String(x || '').trim()).filter(e => /\S+@\S+\.\S+/.test(e)).slice(0, 20);
}

// Graph's well-known mapnamen → hoe de map in de spiegel heet. `resolveFolderId`
// geeft voor die mappen géén id terug maar de well-known naam (MOVE_MESSAGE
// accepteert die rechtstreeks), en `mail_folders.well_known_name` staat op deze
// mailbox op één rij na leeg. Zonder deze vertaling weet de spiegel na een move
// naar "Verwijderde items" dus niet wélk pad de mail kreeg.
const WELL_KNOWN_DISPLAY: Record<string, string[]> = {
  deleteditems: ['Deleted Items', 'Verwijderde items'],
  archive: ['Archive', 'Archief'],
  drafts: ['Drafts', 'Concepten'],
  inbox: ['Inbox', 'Postvak IN'],
  sentitems: ['Sent Items', 'Verzonden items'],
  junkemail: ['Junk Email', 'Ongewenste e-mail'],
};

/**
 * Het `full_path` van de doelmap, voor de lokale spiegel ná een move. `null` =
 * niet gevonden, en dan schrijft de caller liever niets dan een verzonnen pad:
 * de mail-sync zet het binnen ±15 minuten alsnog goed.
 */
export async function folderPathFor(
  supabase: SupabaseClient, ownerUserId: string, dest: string,
): Promise<string | null> {
  const { data } = await supabase.from('mail_folders')
    .select('id, full_path, display_name, well_known_name')
    .eq('user_id', ownerUserId).limit(500);
  const rows = Array.isArray(data) ? data : [];
  const lower = dest.toLowerCase();
  const names = WELL_KNOWN_DISPLAY[lower] ?? [];
  const hit = rows.find(r => r.id === dest)
    ?? rows.find(r => String(r.well_known_name ?? '').toLowerCase() === lower)
    ?? rows.find(r => names.includes(String(r.display_name ?? '')));
  if (!hit) return null;
  return String(hit.full_path ?? hit.display_name ?? '') || null;
}

export async function inlineImages(ctx: Ctx, messageId: string): Promise<Record<string, string>> {
  const listed = await execOutlookTool(ctx, OUTLOOK_TOOLS.LIST_ATTACHMENTS, { user_id: 'me', message_id: messageId });
  const atts = respValue(listed)
    .filter(a => a.isInline === true && typeof a.contentId === 'string'
      && typeof a.contentType === 'string' && String(a.contentType).startsWith('image/'))
    .slice(0, MAX_INLINE_IMAGES);
  const out: Record<string, string> = {};
  for (const a of atts) {
    try {
      const dl = await execOutlookTool(ctx, OUTLOOK_TOOLS.DOWNLOAD_ATTACHMENT, {
        user_id: 'me', message_id: messageId,
        attachment_id: String(a.id), file_name: String(a.name || 'inline.png'),
      });
      const file = ((dl.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined)?.file
        ?? (dl.data as Record<string, unknown> | undefined)?.file;
      const url = file && typeof (file as Record<string, unknown>).s3url === 'string'
        ? String((file as Record<string, unknown>).s3url) : null;
      if (!url) continue;
      const bin = await fetch(url);
      if (!bin.ok) continue;
      const buf = new Uint8Array(await bin.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) continue;
      out[String(a.contentId)] = `data:${a.contentType};base64,${encodeBase64(buf)}`;
    } catch { /* één afbeelding mag falen zonder de rest te blokkeren */ }
  }
  return out;
}

// Concepten-map van DEZE mailbox. Voorkeursorde gelijk aan
// DEFAULT_FOLDER_NAMES in mail-sync-etl-v2: eerst 'Drafts', dan 'Concepten'.
// Geen maybeSingle(): met meerdere mailboxen (of beide namen in één mailbox)
// zijn dat meerdere rijen en dan faalt maybeSingle met PGRST116.
async function draftsFolderId(supabase: SupabaseClient, ownerUserId: string): Promise<string> {
  const { data: rows } = await supabase.from('mail_folders')
    .select('id, display_name')
    .eq('user_id', ownerUserId)
    .in('display_name', ['Drafts', 'Concepten']);
  const list = Array.isArray(rows) ? rows : [];
  for (const name of ['Drafts', 'Concepten']) {
    const hit = list.find((r) => r.display_name === name);
    if (hit?.id) return String(hit.id);
  }
  throw new Error('drafts_folder_unknown');
}

export async function listDrafts(supabase: SupabaseClient, ctx: Ctx): Promise<Array<Record<string, unknown>>> {
  const folderId = await draftsFolderId(supabase, ctx.ownerUserId);
  const res = await execOutlookTool(ctx, OUTLOOK_TOOLS.LIST_MESSAGES, {
    user_id: 'me', folder: folderId, top: 30,
    select: ['id', 'subject', 'bodyPreview', 'body', 'toRecipients', 'ccRecipients', 'lastModifiedDateTime', 'createdDateTime'],
    orderby: ['lastModifiedDateTime desc'],
  });
  const mapRecip = (list: unknown) => Array.isArray(list)
    ? (list as Array<Record<string, unknown>>).map(r => {
        const ea = r.emailAddress as Record<string, unknown> | undefined;
        return { address: ea?.address ?? null, name: ea?.name ?? null };
      })
    : [];
  return respValue(res).map(m => {
    const body = m.body as { contentType?: string; content?: string } | undefined;
    const to = mapRecip(m.toRecipients);
    return {
      id: String(m.id ?? ''),
      subject: typeof m.subject === 'string' ? m.subject : '',
      body_preview: typeof m.bodyPreview === 'string' ? m.bodyPreview : '',
      body_html: body?.contentType === 'html' ? (body.content ?? null) : null,
      body_text: body?.contentType !== 'html' ? (body?.content ?? null) : null,
      to_recipients: to,
      cc_recipients: mapRecip(m.ccRecipients),
      last_modified_at: typeof m.lastModifiedDateTime === 'string' ? m.lastModifiedDateTime : null,
    };
  });
}

// Bewerkt een bestaand concept. Composio's UPDATE_EMAIL VERVANGT ontvangers
// bij elke call (weglaten = wissen), dus to/cc altijd expliciet meegeven.
export async function updateDraft(ctx: Ctx, p: { message_id: string; subject?: string; body_text?: string; to?: unknown; cc?: unknown }) {
  const res = await execOutlookTool(ctx, OUTLOOK_TOOLS.UPDATE_EMAIL, {
    user_id: 'me',
    message_id: p.message_id,
    subject: typeof p.subject === 'string' ? p.subject : '',
    body: { contentType: 'text', content: String(p.body_text ?? '') },
    to_recipients: cleanEmails(p.to).map(address => ({ address })),
    cc_recipients: cleanEmails(p.cc).map(address => ({ address })),
  });
  const rd = (res.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined;
  // execOutlookTool gooit al op `successful === false`; deze extra check vangt
  // ook het geval waarin de vlag helemaal ontbreekt — een write die we niet
  // bevestigd zien is geen geslaagde write.
  if (res.successful !== true) throw new Error('update_failed');
  return { id: rd?.id ?? p.message_id, subject: rd?.subject ?? p.subject };
}

export async function createDraft(ctx: Ctx, p: { subject?: string; body_text?: string; to?: unknown; cc?: unknown }) {
  const to = cleanEmails(p.to);
  const res = await execOutlookTool(ctx, OUTLOOK_TOOLS.CREATE_DRAFT, {
    user_id: 'me',
    subject: String(p.subject ?? '').trim() || '(geen onderwerp)',
    body: String(p.body_text ?? ''),
    is_html: false,
    // CREATE_DRAFT vereist to_recipients; zonder ontvanger nog steeds een
    // geldig concept kunnen maken → leeg array is toegestaan door Graph.
    to_recipients: to,
    ...(cleanEmails(p.cc).length ? { cc_recipients: cleanEmails(p.cc) } : {}),
  });
  const rd = (res.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined;
  if (res.successful !== true || !rd?.id) throw new Error('create_failed');
  return { id: rd.id };
}
