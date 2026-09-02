// =============================================================================
// autodraft-rag-prefill v5.0 — context-build consumer (R.6)
// =============================================================================
// Per autodraft_mails-rij zonder rag_context: roep context-build aan met
// intent='draft_reply', ontvang bundle_id + matches, schrijf naar rag_context.
//
// History:
//   v1.0  2026-04-28 — match_all_sources over 6 truth-of-source tabellen
//   v2.0  2026-05-03 — text-embedding-3-large + halfvec (B.2)
//   v3.0  2026-05-03 — match_chunks (R.4 hybrid retrieval)
//   v4.0  2026-05-04 — twee-passes (semantic + entity-aware) (R.5)
//   v5.0  2026-05-04 — context-build CaaS consumer (R.6) — alle retrieval-logic
//                       zit nu in één centrale Edge Function
//
// Wat blijft hetzelfde: rag_context.matches[] shape, sync-staleness pre-flight,
// idempotent (skip rijen met rag_context IS NOT NULL), batch-cycle tot wall-time.
// Wat verandert: GEEN embedding-call meer hier (context-build doet dat). GEEN
// directe RPC-call meer naar match_chunks_for_entity. Alle retrieval-knoppen
// (top_k, recency_weight, etc.) komen uit context_intents.draft_reply recipe.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "autodraft-rag-prefill-v5.1";
// v5.1 (2026-05-04): JelleMind-lesson injection meegenomen uit context-build v1.2.
// rag_context bevat nu ook knowledge_lessons[] zodat auto-draft Jelle's geleerde
// voorkeuren in de prompt kan zetten.
const BATCH_SIZE = 30;
const MAX_INPUT_CHARS = 6000;
const MAX_WALL_TIME_MS = 90_000;
const SAFETY_MARGIN_MS = 15_000;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max); }

interface MailRow {
  id: string;
  subject: string | null;
  body_preview: string | null;
  body_text: string | null;
  body_html: string | null;
  from_email: string | null;
  from_domain: string | null;
}

function buildQueryText(mail: MailRow): string {
  const body = mail.body_text || stripHtml(mail.body_html);
  const from = mail.from_email ? `From: ${mail.from_email}` : "";
  return truncate([from, `Subject: ${mail.subject ?? ""}`, mail.body_preview ?? "", body]
    .filter(Boolean).join("\n"), MAX_INPUT_CHARS);
}

// ---------------------------------------------------------------------------
// Roep context-build aan voor één mail
// ---------------------------------------------------------------------------
async function callContextBuild(
  supabaseUrl: string, cronSecret: string,
  mail: MailRow
): Promise<{ bundle_id: string; matches: any[]; knowledge_lessons: any[]; entity_used: any; meta: any }> {
  const queryText = buildQueryText(mail);
  const res = await fetch(`${supabaseUrl}/functions/v1/context-build`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({
      intent: "draft_reply",
      audience: "auto-draft",
      trigger_type: "mail",
      trigger_id: mail.id,
      query_text: queryText,
      options: {
        from_email: mail.from_email,
        from_domain: mail.from_domain,
        // top_k, recency_weight, min_similarity etc. komen uit recipe
        // enable_rerank: false (default voor draft_reply intent)
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`context-build_${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(`context-build_response_not_ok: ${json.error ?? 'unknown'}`);
  return {
    bundle_id: json.bundle_id,
    matches: json.matches ?? [],
    knowledge_lessons: json.knowledge_lessons ?? [],
    entity_used: json.entity_used ?? null,
    meta: json.retrieval_meta ?? {},
  };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy, triggered_at: startedAt,
    processed: 0, skipped_empty: 0, skipped_no_mail: 0,
    bundles_created: 0,
    entity_resolved: 0,
    sync_check: null as object | null,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "autodraft-rag-prefill", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    // Pre-flight: sync-staleness
    const { data: syncCheck } = await supabase.rpc('sync_health', { source_name: 'mail', max_age_minutes: 30 });
    stats.sync_check = syncCheck ?? { warning: 'sync_health rpc unavailable' };
    if (syncCheck && syncCheck.is_fresh === false) {
      throw new Error(`mail_sync_stale: last sync ${syncCheck.age_minutes} min ago`);
    }

    while ((Date.now() - startTime) < MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
      const { data: pending, error: pendErr } = await supabase
        .from("autodraft_mails")
        .select("id, mail_id")
        .is("rag_context", null)
        .not("status", "in", "(archived,sent)")
        .order("scanned_at", { ascending: false })
        .limit(BATCH_SIZE);
      if (pendErr) throw new Error(`autodraft_select_failed: ${pendErr.message}`);
      if (!pending || pending.length === 0) break;

      const mailIds = pending.map((p) => p.mail_id).filter(Boolean);
      const { data: mails, error: mailErr } = await supabase
        .from("mail_messages")
        .select("id, subject, body_preview, body_text, body_html, from_email, from_domain")
        .in("id", mailIds);
      if (mailErr) throw new Error(`mail_lookup_failed: ${mailErr.message}`);
      const mailMap = new Map<string, MailRow>((mails ?? []).map((m: any) => [m.id as string, m as MailRow]));

      for (const draft of pending) {
        if ((Date.now() - startTime) >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) break;
        const mail = mailMap.get(draft.mail_id);
        if (!mail) {
          stats.skipped_no_mail++;
          await supabase.from("autodraft_mails").update({
            rag_context: { matches: [], reason: "mail_not_found_in_mirror" },
            rag_computed_at: new Date().toISOString(),
          }).eq("id", draft.id);
          continue;
        }
        const queryText = buildQueryText(mail);
        if (!queryText.trim() || queryText.length < 20) {
          stats.skipped_empty++;
          await supabase.from("autodraft_mails").update({
            rag_context: { matches: [], reason: "empty_query_text" },
            rag_computed_at: new Date().toISOString(),
          }).eq("id", draft.id);
          continue;
        }

        try {
          const { bundle_id, matches, knowledge_lessons, entity_used, meta } = await callContextBuild(
            supabaseUrl, cronSecret, mail
          );
          // Filter zelf-match: skip mail-chunks waar source_id == draft.mail_id
          const cleaned = matches.filter((m: any) => !(m.source === "mail" && m.id === draft.mail_id));

          stats.bundles_created++;
          if (entity_used) stats.entity_resolved++;

          const queryHash = await sha256(queryText);

          await supabase.from("autodraft_mails").update({
            rag_context: {
              bundle_id,                       // NIEUW v5: link naar context_bundles
              matches: cleaned,                // backwards-compat shape
              knowledge_lessons,               // NIEUW (JelleMind Activation): top-N lessons uit bundle
              query_text_preview: queryText.slice(0, 200),
              entity_used,
              retrieval_strategy: meta.strategy,
              retrieval_params: {
                top_k: meta.top_k,
                recency_weight: meta.recency_weight,
                recency_decay_days: meta.recency_decay_days,
                min_similarity: meta.min_similarity,
                max_per_source: meta.max_per_source,
              },
              reranked: meta.rerank_applied || false,
              jellemind_lessons_count: meta.jellemind_lessons_count ?? 0,
              jellemind_scopes_used: meta.jellemind_scopes_used ?? [],
              source_function: "context-build-v1.2",
              computed_at: new Date().toISOString(),
            },
            rag_computed_at: new Date().toISOString(),
            rag_query_hash: queryHash,
          }).eq("id", draft.id);
          stats.processed++;
        } catch (rowErr) {
          stats.warnings.push(`draft_${draft.id}: ${(rowErr instanceof Error ? rowErr.message : String(rowErr)).slice(0, 200)}`);
        }
      }
    }

    const summary = stats.processed === 0
      ? "no pending drafts"
      : `${stats.processed} drafts pre-filled (${stats.entity_resolved} entity-aware, ${stats.bundles_created} bundles)`;
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, summary, stats }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }]
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
