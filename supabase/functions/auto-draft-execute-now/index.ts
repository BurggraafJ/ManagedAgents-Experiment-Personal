// auto-draft-execute-now — Instant-Outlook reply-draft trigger.
//
// Wordt direct aangeroepen door een DB-trigger op autodraft_decisions INSERT
// (`trg_instant_outlook_execute`), zonder te wachten op de lokale orchestrator-
// poll. Gevolg: "Plaats concept" staat binnen ~3-5 sec als antwoord-concept in
// Outlook i.p.v. 0-30 min wachten.
//
// Scope: alleen action='send' met decision_kind='reply' — dezelfde filter als
// de trigger. Forward / amend / ignore / spam blijven via de lokale skill
// auto-draft-execute. Idempotent: `claim_autodraft_decision` zet
// execution_status='running' vóór de write, zodat de skill niet ook uitvoert.
//
// Auth: cron_secret bearer (zelfde patroon als mail-reconcile / csp-report).
// pg_net trigger geeft die mee, dashboard roept deze function NIET direct aan.
//
// ── v2.0 (2026-09-14) — de schrijfbaan gerepareerd ──────────────────────────
// Deze functie stond sinds 2026-05-06 op v1 en had in die hele periode NUL
// runs in agent_runs. Drie dingen zaten fout, en alle drie faalden ze stil:
//
//  1. Alle vier de Composio-slugs waren ingetrokken (404 Tool_ToolNotFound).
//     Ze staan nu in _shared/outlook-write.ts, live geverifieerd, en gedeeld
//     met outlook-live zodat ze niet opnieuw uit elkaar kunnen lopen.
//  2. Stap 4 riep UPDATE_EMAIL aan met alléén subject + body. Die call is een
//     VERVANG-call: zonder `to_recipients` wist hij de ontvanger die Outlook
//     net in het antwoord-concept had gezet. Je hield een keurig concept over
//     zonder geadresseerde. Nu leest stap 2 het concept terug en gaan de
//     velden expliciet mee.
//  3. Stap 5 verplaatste het CONCEPT naar een hardgecodeerde map 'SalesAgent',
//     en negeerde `decision.target_folder` — juist het veld waarin Postvak
//     Jelle's mapkeuze meestuurt. Nu verhuist de BRONMAIL naar die map: de
//     "beantwoord en opbergen"-beweging. Zonder target_folder wordt er niet
//     verplaatst (en dat staat als waarschuwing in stats), i.p.v. te gokken.
//
// Versturen kan niet en gebeurt niet: de helper draait op een allowlist zonder
// send-slugs, en de Entra-grant mist Mail.Send. Jelle drukt zelf op verzenden.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  moveMessage, placeReplyDraft, resolveFolderId, type OutlookCtx,
} from '../_shared/outlook-write.ts';

const SKILL_VERSION = 'auto-draft-execute-now-v2.0';

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

interface Ctx extends OutlookCtx { ownerUserId: string | null; fromRegistry: boolean; }

/**
 * De mailbox waarin dit bericht ligt — niet "de" mailbox.
 *
 * De eigenaar komt uit `mail_messages.user_id` van de bronmail: dát is per
 * definitie de postbus waar het antwoord-concept en de move moeten landen.
 * Staat die mailbox niet in `mail_accounts`, dan valt hij terug op de
 * agent_config-connectie — precies het gedrag van vóór de registry, zodat de
 * enkele-mailbox-situatie ongewijzigd blijft werken.
 */
async function buildCtx(supabase: SupabaseClient, mailId: string): Promise<Ctx> {
  const apiKey = await getCfg(supabase, 'global', 'composio_api_key');
  if (!apiKey) throw new Error('composio_api_key_missing');

  const { data: mail } = await supabase.from('mail_messages')
    .select('user_id').eq('id', mailId).maybeSingle();
  const ownerUserId = (mail?.user_id as string) ?? null;

  if (ownerUserId) {
    const { data: rows } = await supabase.from('mail_accounts')
      .select('user_id, composio_user_id, composio_connection_id')
      .eq('user_id', ownerUserId).eq('enabled', true).eq('paused', false)
      .order('created_at', { ascending: true }).limit(1);
    const acct = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (acct?.composio_connection_id) {
      return {
        apiKey,
        userId: (acct.composio_user_id as string)
          ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle',
        connectionId: acct.composio_connection_id as string,
        ownerUserId, fromRegistry: true,
      };
    }
  }

  const userId = (await getCfg(supabase, 'mail-sync-etl-v2', 'composio_user_id'))
    ?? (await getCfg(supabase, 'global', 'composio_user_id')) ?? 'user-jelle';
  const connectionId = await getCfg(supabase, 'mail-sync-etl-v2', 'composio_connection_id');
  if (!connectionId) throw new Error('composio_connection_id_missing');
  return { apiKey, userId, connectionId, ownerUserId, fromRegistry: false };
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
  // Alleen reply-send afhandelen. Andere combinaties laten we vrij voor de lokale skill.
  if (d.action !== 'send' || d.decision_kind !== 'reply') {
    await supabase.rpc('release_autodraft_decision', { p_decision_id: decisionId });
    return new Response(JSON.stringify({ ok: true, reason: 'skipped_not_reply_send' }), { status: 200 });
  }

  const startedAt = new Date().toISOString();
  let outcome: 'done' | 'failed' = 'failed';
  let errorMsg: string | null = null;
  let draftId: string | null = null;
  let movedTo: string | null = null;
  let sourceId: string = String(d.mail_id);
  const warnings: string[] = [];

  try {
    const ctx = await buildCtx(supabase, String(d.mail_id));
    if (!ctx.fromRegistry) warnings.push('mailbox_from_agent_config');

    // Stap 1-4 — antwoord-concept ÓP de bronmail, met onze tekst boven de
    // handtekening en de geciteerde chain, en met behoud van ontvangers.
    const draft = await placeReplyDraft(ctx, {
      message_id: String(d.mail_id),
      body_text: String(d.final_body ?? ''),
      subject: typeof d.final_subject === 'string' ? d.final_subject : null,
      to: Array.isArray(d.final_to) ? d.final_to : null,
    });
    draftId = draft.draft_id;
    warnings.push(...draft.warnings);

    // Stap 5 — bronmail opbergen in de map die Jelle koos. Als laatste, want
    // een move geeft het bericht een nieuw id. Mislukt dit, dan is het concept
    // er nog steeds: waarschuwing, geen mislukte beslissing.
    if (d.target_folder) {
      try {
        const dest = await resolveFolderId(supabase, ctx.ownerUserId, String(d.target_folder));
        if (!dest) {
          warnings.push(`folder_not_found:${String(d.target_folder).slice(0, 80)}`);
        } else {
          sourceId = (await moveMessage(ctx, String(d.mail_id), dest)).id;
          movedTo = dest;
        }
      } catch (moveErr) {
        warnings.push(`move_failed:${(moveErr instanceof Error ? moveErr.message : String(moveErr)).slice(0, 80)}`);
      }
    } else {
      warnings.push('no_target_folder');
    }

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
      ? `Antwoord-concept geplaatst voor mail ${String(d.mail_id).slice(-12)}`
        + (movedTo ? ' + bronmail opgeborgen' : '')
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
      target_folder: d.target_folder ?? null,
      moved_to_folder_id: movedTo,
      source_message_id_after_move: movedTo ? sourceId : null,
      warnings,
    },
    errors: errorMsg ? [{ message: errorMsg, at: new Date().toISOString() }] : [],
  });

  return new Response(JSON.stringify({
    ok: outcome === 'done',
    outcome,
    decision_id: decisionId,
    draft_outlook_id: draftId,
    moved_to: movedTo,
    warnings,
    error: errorMsg,
  }), { status: outcome === 'done' ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
});
