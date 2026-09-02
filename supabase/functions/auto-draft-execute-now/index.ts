// auto-draft-execute-now — Instant-Outlook reply-draft trigger.
//
// Wordt direct aangeroepen door een DB-trigger op autodraft_decisions INSERT,
// zonder te wachten op de lokale orchestrator-poll. Gevolg: Plaats concept staat
// binnen ~3-5 sec als draft in Outlook ipv 0-30 min wachten.
//
// Scope MVP: alleen action='send' met decision_kind='reply'. Forward / amend /
// ignore / spam blijven via lokale auto-draft-execute skill (orchestrator-poll).
// Idempotent: zet decision.execution_status='running' vóór write zodat de skill
// later niet opnieuw uitvoert.
//
// Auth: cron_secret bearer (zelfde patroon als mail-reconcile / csp-report).
// pg_net trigger geeft die mee, dashboard roept deze function NIET direct aan.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const SKILL_VERSION = 'auto-draft-execute-now-v1.0';

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function getCfg(supabase: SupabaseClient, agent: string, key: string): Promise<string | null> {
  const { data: vault } = await supabase.rpc('get_skill_secret_service', {
    p_skill_name: agent, p_secret_name: key,
  });
  if (typeof vault === 'string' && vault.length > 0) return vault;
  const { data } = await supabase.from('agent_config').select('config_value')
    .eq('agent_name', agent).eq('config_key', key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === 'string' ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<ComposioContext> {
  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) throw new Error('composio_api_key_missing');
  const userId = (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_user_id'))
    ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle';
  const connectionId = await getCfg(supabase, 'mail-sync-etl-v2', 'composio_connection_id');
  if (!connectionId) throw new Error('composio_connection_id_missing');
  return { apiKey, userId, connectionId };
}

interface ToolResult { data?: any; error?: string; }

async function execTool(ctx: ComposioContext, tool: string, args: Record<string, unknown>, retry = 0): Promise<ToolResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(tool)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.apiKey },
    body: JSON.stringify({ user_id: ctx.userId, connected_account_id: ctx.connectionId, arguments: args }),
  });
  if (res.status === 429 && retry < 2) {
    await new Promise(r => setTimeout(r, [3000, 9000][retry]));
    return execTool(ctx, tool, args, retry + 1);
  }
  const text = await res.text();
  let body: ToolResult;
  try { body = JSON.parse(text); }
  catch { throw new Error(`composio_non_json_${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}: ${body?.error ?? text.slice(0, 200)}`);
  return body;
}

function plainToOutlookHtml(text: string): string {
  if (!text) return '';
  if (/^\s*<[a-z!]/i.test(text)) return text;
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = escaped.split(/\n\n+/);
  return paragraphs.map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
}

function injectBodyAboveSignature(template: string, bodyHtml: string): string {
  const markers = [
    '<div id="appendonsend">',
    '<div id="Signature">',
    '<hr id="stopSpelling">',
    '<div class="WordSection1">',
    '<div class="OutlookMessageHeader">',
  ];
  for (const m of markers) {
    const idx = template.indexOf(m);
    if (idx !== -1) return template.slice(0, idx) + bodyHtml + template.slice(idx);
  }
  return bodyHtml + template;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const presentedToken = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const cronSecret = (await getCfg(supabase, 'global', 'cron_secret')) || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ ok: false, reason: 'unauthorized' }), { status: 401 });
  }

  let payload: { decision_id?: string };
  try { payload = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, reason: 'invalid_json' }), { status: 400 }); }

  const decisionId = payload.decision_id;
  if (!decisionId) return new Response(JSON.stringify({ ok: false, reason: 'decision_id_required' }), { status: 400 });

  // Atomic claim: pak deze decision exclusief aan zodat de lokale skill 'm niet ook oppakt.
  const { data: claim, error: claimErr } = await supabase.rpc('claim_autodraft_decision', { p_decision_id: decisionId });
  if (claimErr) return new Response(JSON.stringify({ ok: false, reason: 'claim_failed', detail: claimErr.message }), { status: 500 });
  if (!claim || claim.ok === false) return new Response(JSON.stringify({ ok: false, reason: claim?.reason || 'not_claimable' }), { status: 200 });

  const d = claim.decision;
  // MVP: alleen reply-send afhandelen. Andere combinaties laten we vrij voor de lokale skill.
  if (d.action !== 'send' || d.decision_kind !== 'reply') {
    await supabase.rpc('release_autodraft_decision', { p_decision_id: decisionId });
    return new Response(JSON.stringify({ ok: true, reason: 'skipped_not_reply_send' }), { status: 200 });
  }

  const startedAt = new Date().toISOString();
  let outcome: 'done' | 'failed' = 'failed';
  let errorMsg: string | null = null;
  let draftId: string | null = null;

  try {
    const ctx = await buildCtx(supabase);

    // Stap 1 — maak reply-all draft op de originele mail
    const replyRes = await execTool(ctx, 'OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT', {
      user_id: 'me',
      message_id: d.mail_id,
      comment: '',
    });
    draftId = replyRes?.data?.response_data?.id ?? replyRes?.data?.id ?? null;
    if (!draftId) throw new Error('reply_draft_id_missing');

    // Stap 2 — lees auto-gegenereerde body (handtekening + chain) zodat we 'm preserve
    let templateHtml: string | null = null;
    try {
      const tplRes = await execTool(ctx, 'OUTLOOK_GET_MESSAGE', { user_id: 'me', message_id: draftId });
      const tplBody = tplRes?.data?.response_data?.body?.content ?? tplRes?.data?.body?.content;
      if (typeof tplBody === 'string' && tplBody.length > 0) templateHtml = tplBody;
    } catch (_) { /* fallback op plain conversie */ }

    // Stap 3 — construct combined body
    const userBodyHtml = plainToOutlookHtml(d.final_body || '');
    const combinedHtml = templateHtml
      ? injectBodyAboveSignature(templateHtml, userBodyHtml)
      : userBodyHtml;

    // Stap 4 — update draft met subject + combined body
    await execTool(ctx, 'OUTLOOK_UPDATE_EMAIL', {
      user_id: 'me',
      message_id: draftId,
      subject: d.final_subject,
      body: { contentType: 'HTML', content: combinedHtml },
    });

    // Stap 5 — verplaats naar SalesAgent-map (best-effort, geen hard-fail)
    try {
      const { data: folderRow } = await supabase.from('mail_folders')
        .select('id').eq('display_name', 'SalesAgent')
        .ilike('full_path', 'Inbox/SalesAgent%').limit(1).maybeSingle();
      if (folderRow?.id) {
        await execTool(ctx, 'OUTLOOK_MOVE_MESSAGE', {
          user_id: 'me', message_id: draftId, destination_id: folderRow.id,
        });
      }
    } catch (_) { /* draft staat sowieso in Drafts — SalesAgent-move is bonus */ }

    outcome = 'done';
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  // Stap 6 — markeer decision af + mail.status
  await supabase.rpc('finalize_autodraft_decision_now', {
    p_decision_id: decisionId,
    p_outcome: outcome,
    p_error: errorMsg,
    p_draft_outlook_id: draftId,
  });

  // Run-record voor traceability
  await supabase.from('agent_runs').insert({
    agent_name: 'auto-draft-execute-now',
    run_type: 'edge_function',
    status: outcome === 'done' ? 'success' : 'error',
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    summary: outcome === 'done'
      ? `Concept geplaatst voor mail ${String(d.mail_id).slice(-12)} (instant)`
      : `Instant-execute mislukt: ${errorMsg?.slice(0, 200)}`,
    stats: {
      schema_version: '1',
      skill_version: SKILL_VERSION,
      decision_id: decisionId,
      mail_id: d.mail_id,
      action: d.action,
      decision_kind: d.decision_kind,
      outcome,
      draft_outlook_id: draftId,
    },
    errors: errorMsg ? [{ message: errorMsg, at: new Date().toISOString() }] : [],
  });

  return new Response(JSON.stringify({
    ok: outcome === 'done',
    outcome,
    decision_id: decisionId,
    draft_outlook_id: draftId,
    error: errorMsg,
  }), { status: outcome === 'done' ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
