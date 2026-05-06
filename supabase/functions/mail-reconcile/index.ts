// mail-reconcile v1.0 — Lichte sweeper die DB synchroon houdt met Outlook.
//
// Waarom een aparte function naast mail-sync-etl-v2.4?
// - mail-sync doet delta + 14d-window full-scan: snel maar mist verplaatsingen
//   van oude mails. Reconciliation in v2.4 draait alleen bij full-scan (1x/7d).
// - mail-reconcile draait elke 30 min, haalt alleen mail-IDs op (geen bodies),
//   en markeert DB-only IDs als is_deleted. Goedkoop genoeg voor 30-min cadence.
//
// Effect: tussen "Jelle verplaatst mail in Outlook" en "mail verdwijnt uit
// Postvak" zit max ~30 min ipv 7 dagen.
//
// Cost: per Inbox 1 call (fetch alle IDs, top:999), per Sent Items 6 calls.
// ~8 calls per run x 48 runs/dag = ~400 calls/dag. Composio rate-limit ruim genoeg.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
const SKILL_VERSION = "mail-reconcile-v1.0";
const TOOL_LIST_MESSAGES = "OUTLOOK_OUTLOOK_LIST_MESSAGES";
const MAX_PAGES_PER_FOLDER = 30;  // 30 * 999 = 30k mails cap, ruim genoeg

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Vault first, agent_config fallback (zelfde patroon als mail-sync-etl-v2)
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;

  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<ComposioContext> {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");
  // Hergebruik de mail-sync-etl-v2 connection-id (zelfde Outlook-account)
  const userId = (await getCfg(supabase, "mail-sync-etl-v2", "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id"))
    ?? "user-jelle";
  const connectionId = await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id");
  if (!connectionId) throw new Error("composio_connection_id_missing");
  return { apiKey, userId, connectionId };
}

interface ToolResult {
  data?: { response_data?: { value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string } };
  error?: string;
}

async function execTool(ctx: ComposioContext, toolName: string, toolArgs: Record<string, unknown>, retry = 0): Promise<ToolResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({
      user_id: ctx.userId,
      connected_account_id: ctx.connectionId,
      arguments: toolArgs,
    }),
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }
  const text = await res.text();
  let body: ToolResult;
  try { body = JSON.parse(text); } catch { throw new Error(`composio_non_json: ${res.status} ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}: ${(body as { error?: string })?.error ?? text.slice(0,200)}`);
  return body;
}

interface FolderRow {
  id: string;
  full_path: string;
  total_item_count: number | null;
}

interface ReconcileResult {
  folder_id: string;
  folder_path: string;
  outlook_count: number;
  db_count: number;
  marked_deleted: number;
  outlook_only: number;
  status: "ok" | "skipped_safety" | "skipped_empty_fetch" | "error";
  detail?: string;
}

async function reconcileFolder(
  supabase: SupabaseClient,
  ctx: ComposioContext,
  folder: FolderRow,
): Promise<ReconcileResult> {
  // Fetch alle mail-IDs uit de folder, paginated
  const allOutlookIds = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const args: Record<string, unknown> = {
        user_id: "me",
        folder: folder.id,
        top: 999,
        select: ["id"],
        orderby: ["receivedDateTime desc"],
      };
      if (pageToken) args.skip_token = pageToken;

      const result = await execTool(ctx, TOOL_LIST_MESSAGES, args);
      const messages = result?.data?.response_data?.value ?? [];
      for (const m of messages) {
        if (typeof m.id === "string") allOutlookIds.add(m.id);
      }
      const nextLink = result?.data?.response_data?.["@odata.nextLink"];
      if (typeof nextLink === "string") {
        const m = nextLink.match(/[?&]\$skiptoken=([^&]+)/i);
        pageToken = m ? decodeURIComponent(m[1]) : undefined;
      } else {
        pageToken = undefined;
      }
      pages++;
    } while (pageToken && pages < MAX_PAGES_PER_FOLDER);
  } catch (err) {
    return {
      folder_id: folder.id, folder_path: folder.full_path,
      outlook_count: 0, db_count: 0, marked_deleted: 0, outlook_only: 0,
      status: "error",
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }

  if (allOutlookIds.size === 0) {
    return {
      folder_id: folder.id, folder_path: folder.full_path,
      outlook_count: 0, db_count: 0, marked_deleted: 0, outlook_only: 0,
      status: "skipped_empty_fetch",
    };
  }

  // Sanity: alleen reconciliëren als fetch ~ folder.total_item_count
  if (folder.total_item_count != null && folder.total_item_count > 0
      && allOutlookIds.size < folder.total_item_count * 0.85) {
    return {
      folder_id: folder.id, folder_path: folder.full_path,
      outlook_count: allOutlookIds.size, db_count: 0, marked_deleted: 0, outlook_only: 0,
      status: "skipped_safety",
      detail: `fetch=${allOutlookIds.size} < ${Math.floor(folder.total_item_count * 0.85)} (85% van metadata=${folder.total_item_count})`,
    };
  }

  // DB-rijen voor deze folder
  const { data: dbRows } = await supabase
    .from("mail_messages")
    .select("id")
    .eq("folder_id", folder.id)
    .eq("is_deleted", false);

  const dbIds = new Set<string>((dbRows ?? []).map((r: { id: string }) => r.id));
  const dbCount = dbIds.size;

  const dbOnlyIds: string[] = [];
  for (const id of dbIds) if (!allOutlookIds.has(id)) dbOnlyIds.push(id);

  // Outlook-only = mails die mail-sync nog niet binnen heeft gehaald.
  // We tellen ze maar markeren niets — mail-sync delta zal ze oppakken.
  let outlookOnly = 0;
  for (const id of allOutlookIds) if (!dbIds.has(id)) outlookOnly++;

  if (dbOnlyIds.length === 0) {
    return {
      folder_id: folder.id, folder_path: folder.full_path,
      outlook_count: allOutlookIds.size, db_count: dbCount, marked_deleted: 0, outlook_only: outlookOnly,
      status: "ok",
    };
  }

  // Mark als is_deleted=true in batches
  let markedTotal = 0;
  for (let i = 0; i < dbOnlyIds.length; i += 200) {
    const batch = dbOnlyIds.slice(i, i + 200);
    const { error } = await supabase
      .from("mail_messages")
      .update({ is_deleted: true, synced_at: new Date().toISOString() })
      .in("id", batch);
    if (error) {
      return {
        folder_id: folder.id, folder_path: folder.full_path,
        outlook_count: allOutlookIds.size, db_count: dbCount, marked_deleted: markedTotal, outlook_only: outlookOnly,
        status: "error",
        detail: `db_update_failed: ${error.message}`,
      };
    }
    markedTotal += batch.length;
  }

  // Cascadeer naar autodraft_mails: mark stale voor pending mails wiens onderliggende
  // mail nu is_deleted=true (zelfde logic als auto-draft skill stap 3).
  await supabase.rpc("mark_autodraft_stale_for_deleted_mails", { p_mail_ids: dbOnlyIds })
    .then(() => {})
    .catch(() => {
      // RPC bestaat misschien niet — dan probeert auto-draft scan dit later toch.
    });

  return {
    folder_id: folder.id, folder_path: folder.full_path,
    outlook_count: allOutlookIds.size, db_count: dbCount, marked_deleted: markedTotal, outlook_only: outlookOnly,
    status: "ok",
  };
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    folders_reconciled: 0,
    folders_skipped: 0,
    folders_failed: 0,
    messages_marked_deleted: 0,
    outlook_only_total: 0,
    per_folder: [] as ReconcileResult[],
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "mail-reconcile", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);

    // Welke folders reconciliëren? Alleen enabled folders in mail_sync_state.
    // (Zelfde set als mail-sync-etl-v2 om consistent te blijven.)
    const { data: enabledStates } = await supabase
      .from("mail_sync_state")
      .select("folder_id")
      .eq("enabled", true);
    const enabledIds = new Set<string>((enabledStates ?? []).map((r: { folder_id: string }) => r.folder_id));

    if (enabledIds.size === 0) {
      stats.warnings.push("no_enabled_folders");
    }

    const { data: folderRows } = await supabase
      .from("mail_folders")
      .select("id, full_path, total_item_count")
      .in("id", Array.from(enabledIds));

    const folders: FolderRow[] = (folderRows ?? []).map((r: any) => ({
      id: r.id,
      full_path: r.full_path,
      total_item_count: r.total_item_count,
    }));

    for (const f of folders) {
      try {
        const r = await reconcileFolder(supabase, ctx, f);
        stats.per_folder.push(r);
        if (r.status === "ok") {
          stats.folders_reconciled++;
          stats.messages_marked_deleted += r.marked_deleted;
          stats.outlook_only_total += r.outlook_only;
        } else if (r.status === "error") {
          stats.folders_failed++;
          stats.warnings.push(`${f.full_path}: ${r.detail || r.status}`);
        } else {
          stats.folders_skipped++;
          if (r.detail) stats.warnings.push(`${f.full_path}: ${r.detail}`);
        }
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : String(folderErr);
        stats.folders_failed++;
        stats.warnings.push(`${f.full_path}: ${msg.slice(0, 200)}`);
      }
    }

    const summary = stats.messages_marked_deleted > 0
      ? `${stats.folders_reconciled} folder(s), ${stats.messages_marked_deleted} mail(s) gemarkeerd als verplaatst/weg`
      : `${stats.folders_reconciled} folder(s), alles synchroon`;

    const finalStatus = stats.folders_failed > 0
      ? "warning"
      : (stats.warnings.length > 0 ? "warning" : "success");

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }]
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
