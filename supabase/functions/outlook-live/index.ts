// outlook-live — live Outlook-data én Outlook-schrijfacties voor Postvak,
// via Composio (zelfde verbinding als mail-sync-etl-v2). Acties:
//
//   { action: 'inline_images', message_id }                  → cid:-afbeeldingen als data-URL
//   { action: 'drafts' }                                     → de Concepten-map, live
//   { action: 'update_draft', message_id, subject, body_text, to[], cc[] }
//   { action: 'create_draft', subject, body_text, to[], cc[] }
//   { action: 'reply_draft', message_id, body_text, … , target_folder? }   (v4)
//   { action: 'move_message', message_id, target_folder }                  (v4)
//   { action: 'send_mail', subject, body_text, to[], cc[], bcc[] }         (v5)
//   { action: 'mark_read', message_id, is_read }                           (v6)
//   { action: 'set_pin', message_id, pinned }                              (v6)
//
// verify_jwt: TRUE + eigen role-check: dit endpoint geeft mail-INHOUD terug en
// muteert de mailbox, dus alleen 'authenticated' (ingelogde dashboard-
// gebruiker) — de anon-key (publiek, zit in de frontend-bundle) wordt geweigerd.
// De mailbox volgt uit de `sub` van de caller; geen stille terugval (v3, §B3).
//
// v4 (2026-09-14) — schrijfbaan; slugs in `_shared/outlook-write.ts`.
// v5 (2026-09-15) — `send_mail`.
// v6 (2026-09-15) — `mark_read` en `set_pin`. Allebei langs **Graph zelf**
//   (`_shared/graph-proxy.ts`), want de Composio-toolkit kan ze niet: er is geen
//   mark-as-read-tool en `LIST_MESSAGES` strookt de `$expand` die je voor de
//   pin-property nodig hebt. De proxy is dezelfde verbinding, dezelfde grant.
//   Elke geslaagde Graph-write wordt meteen in `mail_messages` gespiegeld, zodat
//   de lijst niet tot de volgende mail-sync (±15 min) op oude waarheid staat.
//
// Waarom de spiegel hier gebeurt en niet in een RPC uit de browser: deze functie
// weet al wie er belt (JWT), heeft de capability-poort al gepasseerd en schrijft
// met de service-role gescopeerd op `user_id = caller`. Een extra
// SECURITY DEFINER-RPC voor dezelfde update zou een tweede deur zijn naar
// dezelfde kamer — en eentje die de multi-user-poort (M2) moet bewaken.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { requireCapability } from '../_shared/user-gate.ts';
import { moveMessage, placeReplyDraft, resolveFolderId } from '../_shared/outlook-write.ts';
import { setMessagePin, setMessageRead } from '../_shared/outlook-read.ts';
import { buildCtxForCaller, jwtClaims, serviceClient, type Ctx } from './ctx.ts';
import { cleanEmails, createDraft, folderPathFor, inlineImages, listDrafts, updateDraft } from './mail-actions.ts';
import { handleSendMail } from './send-flow.ts';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  const claims = jwtClaims(req);
  if (claims.role !== 'authenticated') return json({ ok: false, reason: 'login_required' }, 403);
  if (!claims.sub) return json({ ok: false, reason: 'no_subject_claim' }, 403);

  // Multi-user M2 (GAP-3): deze functie leest en schrijft in de mailbox van de
  // aanroeper. Dat is `postvak` — in de member-preset, dus geen gedragswijziging
  // voor wie het vandaag gebruikt.
  const capGate = await requireCapability(req, 'postvak');
  if (!capGate.ok) return capGate.response!;

  let payload: {
    action?: string; message_id?: string; target_folder?: string;
    subject?: string; body_text?: string; to?: unknown; cc?: unknown; bcc?: unknown;
    is_read?: unknown; pinned?: unknown;
  };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const supabase = serviceClient();
  const messageId = (payload.message_id || '').trim();
  try {
    const ctx = await buildCtxForCaller(supabase, claims.sub);

    if (payload.action === 'inline_images') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      return json({ ok: true, images: await inlineImages(ctx, messageId) });
    }
    if (payload.action === 'drafts') {
      return json({ ok: true, drafts: await listDrafts(supabase, ctx) });
    }
    if (payload.action === 'update_draft') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      return json({ ok: true, ...await updateDraft(ctx, { ...payload, message_id: messageId }) });
    }
    if (payload.action === 'create_draft') {
      return json({ ok: true, ...await createDraft(ctx, payload) });
    }

    // Antwoord-concept óp de bronmail, optioneel gevolgd door het opbergen van
    // die bronmail. Volgorde is niet vrij: een move geeft de mail een nieuw id,
    // dus eerst antwoorden, dan verplaatsen.
    if (payload.action === 'reply_draft') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const draft = await placeReplyDraft(ctx, {
        message_id: messageId,
        body_text: String(payload.body_text ?? ''),
        subject: typeof payload.subject === 'string' ? payload.subject : null,
        to: payload.to, cc: payload.cc,
      });
      let movedTo: string | null = null;
      let sourceId = messageId;
      if (payload.target_folder) {
        const dest = await resolveFolderId(supabase, ctx.ownerUserId, payload.target_folder);
        if (!dest) {
          draft.warnings.push(`folder_not_found:${payload.target_folder}`.slice(0, 120));
        } else {
          sourceId = (await moveMessage(ctx, messageId, dest)).id;
          movedTo = dest;
        }
      }
      return json({ ok: true, ...draft, moved_to: movedTo, source_message_id: sourceId });
    }

    if (payload.action === 'send_mail') {
      const out = await handleSendMail(supabase, ctx, claims.sub, {
        subject: typeof payload.subject === 'string' ? payload.subject : undefined,
        body_text: typeof payload.body_text === 'string' ? payload.body_text : undefined,
        to: cleanEmails(payload.to), cc: cleanEmails(payload.cc), bcc: cleanEmails(payload.bcc),
      });
      return json(out.body, out.status);
    }

    if (payload.action === 'move_message') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const dest = await resolveFolderId(supabase, ctx.ownerUserId, payload.target_folder);
      if (!dest) return json({ ok: false, reason: `folder_not_found:${payload.target_folder ?? ''}` }, 400);
      const r = await moveMessage(ctx, messageId, dest);
      // De mail ligt nu in een andere map en heeft dáár een nieuw id (Graph
      // hernoemt bij een move). De spiegel krijgt het nieuwe pad, zodat de
      // Inbox-lijst hem meteen loslaat in plaats van pas na de volgende sync.
      // Geen `is_deleted`: het bericht is niet weg, het staat ergens anders.
      const path = await folderPathFor(supabase, ctx.ownerUserId, dest);
      await mirror(supabase, ctx, messageId, path
        ? { folder_id: dest, folder_path: path }
        : { folder_id: dest });
      return json({ ok: true, id: r.id, moved_to: dest, moved_to_path: path });
    }

    // ── Gelezen. Lokale spiegel pas ná Graph: anders staat de lijst op
    //    "gelezen" terwijl Outlook het vetgedrukt houdt. ───────────────────
    if (payload.action === 'mark_read') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const want = payload.is_read !== false;
      const now = await setMessageRead(ctx, messageId, want);
      await mirror(supabase, ctx, messageId, { is_read: now });
      return json({ ok: true, id: messageId, is_read: now });
    }

    if (payload.action === 'set_pin') {
      if (!messageId) return json({ ok: false, reason: 'missing_message_id' }, 400);
      const want = payload.pinned !== false;
      const state = await setMessagePin(ctx, messageId, want);
      await mirror(supabase, ctx, messageId, {
        is_pinned: state.pinned,
        pinned_at: state.pinned ? (state.pinned_at ?? new Date().toISOString()) : null,
      });
      return json({ ok: true, id: messageId, pinned: state.pinned, pinned_at: state.pinned_at, props: state.found });
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

/**
 * De lokale spiegel bijwerken ná een geslaagde Graph-write. Gescopeerd op de
 * mailbox van de caller, zodat een meegestuurd vreemd message_id nooit een rij
 * van iemand anders raakt. Een mislukte spiegel maakt de actie niet ongedaan —
 * de mail-sync haalt hem binnen ±15 minuten alsnog op — dus hij mag niet gooien.
 */
async function mirror(
  supabase: ReturnType<typeof serviceClient>,
  ctx: Ctx,
  messageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('mail_messages')
      .update({ ...patch, last_modified_at: new Date().toISOString() })
      .eq('id', messageId).eq('user_id', ctx.ownerUserId);
  } catch (e) {
    console.error('[outlook-live] lokale spiegel mislukt:', e instanceof Error ? e.message : String(e));
  }
}
