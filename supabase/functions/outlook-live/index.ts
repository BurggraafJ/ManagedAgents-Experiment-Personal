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
// verify_jwt: TRUE + eigen role-check: dit endpoint geeft mail-INHOUD terug,
// dus alleen 'authenticated' (ingelogde dashboard-gebruiker) — de anon-key
// (publiek, zit in de frontend-bundle) wordt geweigerd.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { encodeBase64 } from 'https://deno.land/std@0.224.0/encoding/base64.ts';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const TOOL_LIST_ATTACHMENTS = 'OUTLOOK_LIST_OUTLOOK_ATTACHMENTS';
const TOOL_DOWNLOAD_ATTACHMENT = 'OUTLOOK_DOWNLOAD_OUTLOOK_ATTACHMENT';
const TOOL_LIST_MESSAGES = 'OUTLOOK_OUTLOOK_LIST_MESSAGES';
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
function jwtRole(req: Request): string | null {
  try {
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.role === 'string' ? payload.role : null;
  } catch { return null; }
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

interface Ctx { apiKey: string; userId: string; connectionId: string; }
async function buildCtx(supabase: SupabaseClient): Promise<Ctx> {
  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) throw new Error('composio_api_key_missing');
  const userId = (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_user_id'))
    ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle';
  const connectionId = await getCfg(supabase, 'mail-sync-etl-v2', 'composio_connection_id');
  if (!connectionId) throw new Error('composio_connection_id_missing');
  return { apiKey, userId, connectionId };
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

async function listDrafts(supabase: SupabaseClient, ctx: Ctx): Promise<Array<Record<string, unknown>>> {
  const { data: folder } = await supabase.from('mail_folders')
    .select('id').eq('display_name', 'Drafts').maybeSingle();
  if (!folder?.id) throw new Error('drafts_folder_unknown');
  const res = await execTool(ctx, TOOL_LIST_MESSAGES, {
    user_id: 'me', folder: folder.id, top: 30,
    select: ['id', 'subject', 'bodyPreview', 'body', 'toRecipients', 'lastModifiedDateTime', 'createdDateTime'],
    orderby: ['lastModifiedDateTime desc'],
  });
  return respValue(res).map(m => {
    const body = m.body as { contentType?: string; content?: string } | undefined;
    const to = Array.isArray(m.toRecipients)
      ? (m.toRecipients as Array<Record<string, unknown>>).map(r => {
          const ea = r.emailAddress as Record<string, unknown> | undefined;
          return { address: ea?.address ?? null, name: ea?.name ?? null };
        })
      : [];
    return {
      id: String(m.id ?? ''),
      subject: typeof m.subject === 'string' ? m.subject : '',
      body_preview: typeof m.bodyPreview === 'string' ? m.bodyPreview : '',
      body_html: body?.contentType === 'html' ? (body.content ?? null) : null,
      body_text: body?.contentType !== 'html' ? (body?.content ?? null) : null,
      to_recipients: to,
      last_modified_at: typeof m.lastModifiedDateTime === 'string' ? m.lastModifiedDateTime : null,
    };
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  if (jwtRole(req) !== 'authenticated') return json({ ok: false, reason: 'login_required' }, 403);

  let payload: { action?: string; message_id?: string };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const ctx = await buildCtx(supabase);
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
    return json({ ok: false, reason: 'unknown_action' }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, reason: msg.slice(0, 200) }, 502);
  }
});
