// outlook-live — live Outlook-data voor Postvak variant 2 (via Composio REST,
// zelfde verbinding als mail-sync-etl-v2). Twee acties:
//
//   { action: 'inline_images', message_id } →
//     inline (cid:) afbeeldingen van een mail als data-URLs, zodat de
//     frontend <img src="cid:X"> kan vervangen. mail-sync slaat geen
//     attachment-bytes op; deze functie haalt ze on-demand op.
//
//   { action: 'drafts' } →
//     de inhoud van de Outlook Concepten-map (mail-sync synct die map niet;
//     live ophalen = altijd actueel, geen sync-lag).
//
//   { action: 'update_draft', message_id, subject, body_text, to[], cc[] } →
//     bewerkt een bestaand Outlook-concept (Graph PATCH via Composio).
//     LET OP: to/cc VERVANGEN de bestaande ontvangers — altijd meesturen.
//
//   { action: 'create_draft', subject, body_text, to[], cc[] } →
//     maakt een nieuw concept in de Outlook Concepten-map (Nieuw-flow).
//
// verify_jwt: TRUE + eigen role-check: dit endpoint geeft mail-INHOUD terug,
// dus alleen 'authenticated' (ingelogde dashboard-gebruiker) — de anon-key
// (publiek, zit in de frontend-bundle) wordt geweigerd.
//
// v3 (2026-09-02) — PER CALLER, niet meer één vaste mailbox (blokkade B3).
// Tot v2 checkte deze functie alleen `role === 'authenticated'` en pakte dan de
// vaste Composio-connectie uit agent_config. Elke tweede dashboard-gebruiker
// las daarmee Jelle's Concepten en schreef er concepten in. Nu wordt de mailbox
// bepaald door de `sub` uit de (door de gateway al gevalideerde) JWT, via
// mail_accounts. Geen account voor die user = 403, geen stille fallback.
//
// Ook opgelost: listDrafts deed `mail_folders.eq('display_name','Drafts')
// .maybeSingle()`. Met twee mailboxen zijn dat twee rijen en breekt maybeSingle()
// hard (PGRST116) — de eerste zichtbare crash bij mailbox #2. Nu gescopeerd op
// de caller en met een expliciete voorkeursorde Drafts → Concepten.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const TOOL_LIST_ATTACHMENTS = 'OUTLOOK_LIST_OUTLOOK_ATTACHMENTS';
const TOOL_DOWNLOAD_ATTACHMENT = 'OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT';
const TOOL_LIST_MESSAGES = 'OUTLOOK_OUTLOOK_LIST_MESSAGES';
const TOOL_UPDATE_EMAIL = 'OUTLOOK_OUTLOOK_UPDATE_EMAIL';
const TOOL_CREATE_DRAFT = 'OUTLOOK_OUTLOOK_CREATE_DRAFT';
const MAX_INLINE_IMAGES = 8;
const MAX_IMAGE_BYTES = 1_500_000;

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

// Gateway (verify_jwt) checkt de handtekening al; hier alleen de role-claim
// lezen zodat de publieke anon-key geen mail-inhoud kan opvragen.
function jwtClaims(req: Request): { role: string | null; sub: string | null } {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    };
  } catch { return { role: null, sub: null }; }
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc('get_skill_secret_service', {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === 'string' && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from('agent_config').select('config_value')
    .eq('agent_name', agentName).eq('config_key', key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === 'string' ? data.config_value : String(data.config_value);
}

interface Ctx { apiKey: string; userId: string; connectionId: string; ownerUserId: string; mailboxEmail: string | null; }

/**
 * De mailbox van de INGELOGDE gebruiker, uit mail_accounts. Geen rij = geen
 * mailbox: dan expliciet 403, nooit terugvallen op de org-connectie (dat was
 * precies het lek). `caller` is de `sub` uit de door de gateway gevalideerde JWT.
 */
async function buildCtxForCaller(supabase: SupabaseClient, caller: string): Promise<Ctx> {
  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) throw new Error('composio_api_key_missing');

  const { data: acct } = await supabase.from('mail_accounts')
    .select('user_id, mailbox_email, composio_user_id, composio_connection_id, enabled, paused')
    .eq('user_id', caller).eq('enabled', true).eq('paused', false)
    .order('created_at', { ascending: true })
    .limit(1);
  const account = Array.isArray(acct) && acct.length > 0 ? acct[0] : null;
  if (!account) throw new Error('no_mailbox_for_user');

  const userId = (account.composio_user_id as string)
    ?? (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_user_id'))
    ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle';
  const connectionId = (account.composio_connection_id as string)
    ?? (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_connection_id'));
  if (!connectionId) throw new Error('composio_connection_id_missing');

  return {
    apiKey, userId, connectionId,
    ownerUserId: account.user_id as string,
    mailboxEmail: (account.mailbox_email as string) ?? null,
  };
}

async function execTool(ctx: Ctx, tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey },
    body: JSON.stringify({ user_id: ctx.userId, connected_account_id: ctx.connectionId, arguments: args }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`composio_${tool}_${res.status}`);
  return body as Record<string, unknown>;
}
function respValue(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const rd = (body.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined;
  const v = rd?.value;
  return Array.isArray(v) ? v as Array<Record<string, unknown>> : [];
}

async function inlineImages(ctx: Ctx, messageId: string): Promise<Record<string, string>> {
  const listed = await execTool(ctx, TOOL_LIST_ATTACHMENTS, { user_id: 'me', message_id: messageId });
  const atts = respValue(listed)
    .filter(a => a.isInline === true && typeof a.contentId === 'string'
      && typeof a.contentType === 'string' && String(a.contentType).startsWith('image/'))
    .slice(0, MAX_INLINE_IMAGES);
  const out: Record<string, string> = {};
  for (const a of atts) {
    try {
      const dl = await execTool(ctx, TOOL_DOWNLOAD_ATTACHMENT, {
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

async function listDrafts(supabase: SupabaseClient, ctx: Ctx): Promise<Array<Record<string, unknown>>> {
  const folderId = await draftsFolderId(supabase, ctx.ownerUserId);
  const res = await execTool(ctx, TOOL_LIST_MESSAGES, {
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

function cleanEmails(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(x => String(x || '').trim()).filter(e => /\S+@\S+\.\S+/.test(e)).slice(0, 20);
}

// Bewerkt een bestaand concept. Composio's UPDATE_EMAIL VERVANGT ontvangers
// bij elke call (weglaten = wissen), dus to/cc altijd expliciet meegeven.
async function updateDraft(ctx: Ctx, p: { message_id: string; subject?: string; body_text?: string; to?: unknown; cc?: unknown }) {
  const res = await execTool(ctx, TOOL_UPDATE_EMAIL, {
    user_id: 'me',
    message_id: p.message_id,
    subject: typeof p.subject === 'string' ? p.subject : '',
    body: { contentType: 'text', content: String(p.body_text ?? '') },
    to_recipients: cleanEmails(p.to).map(address => ({ address })),
    cc_recipients: cleanEmails(p.cc).map(address => ({ address })),
  });
  const rd = (res.data as Record<string, unknown> | undefined)?.response_data as Record<string, unknown> | undefined;
  if (res.successful !== true) throw new Error('update_failed');
  return { id: rd?.id ?? p.message_id, subject: rd?.subject ?? p.subject };
}

async function createDraft(ctx: Ctx, p: { subject?: string; body_text?: string; to?: unknown; cc?: unknown }) {
  const to = cleanEmails(p.to);
  const res = await execTool(ctx, TOOL_CREATE_DRAFT, {
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  const claims = jwtClaims(req);
  if (claims.role !== 'authenticated') return json({ ok: false, reason: 'login_required' }, 403);
  if (!claims.sub) return json({ ok: false, reason: 'no_subject_claim' }, 403);

  let payload: {
    action?: string; message_id?: string;
    subject?: string; body_text?: string; to?: unknown; cc?: unknown;
  };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const ctx = await buildCtxForCaller(supabase, claims.sub);
    if (payload.action === 'inline_images') {
      const messageId = (payload.message_id || '').trim();
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const images = await inlineImages(ctx, messageId);
      return json({ ok: true, images });
    }
    if (payload.action === 'drafts') {
      const drafts = await listDrafts(supabase, ctx);
      return json({ ok: true, drafts });
    }
    if (payload.action === 'update_draft') {
      const messageId = (payload.message_id || '').trim();
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const r = await updateDraft(ctx, { ...payload, message_id: messageId });
      return json({ ok: true, ...r });
    }
    if (payload.action === 'create_draft') {
      const r = await createDraft(ctx, payload);
      return json({ ok: true, ...r });
    }
    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Geen mailbox voor deze gebruiker is een autorisatie-antwoord, geen
    // upstream-storing: 403 zodat de frontend het als "nog geen postvak"
    // kan tonen i.p.v. als Composio-fout.
    if (msg === 'no_mailbox_for_user') return json({ ok: false, reason: 'no_mailbox_for_user' }, 403);
    return json({ ok: false, reason: msg.slice(0, 200) }, 502);
  }
});
