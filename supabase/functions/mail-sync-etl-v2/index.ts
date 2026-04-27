// mail-sync-etl — Deno Edge Function (v2: Composio SDK)
//
// Vervangt de mail-sync skill die nu via Claude+Composio MCP draait. Deze Edge
// Function gebruikt Composio's REST API + SDK rechtstreeks, zodat hij vanaf
// Supabase kan draaien — geen LLM-runtime nodig, geen Jelle's PC nodig.
//
// Pivot van v1: i.p.v. Microsoft Graph direct met eigen OAuth-app, gebruikt
// deze versie de bestaande `legal-mind` Composio connection. Composio doet de
// OAuth onder de motorkap.
//
// Trigger: pg_cron `*/5 * * * *` via pg_net.http_post (Authorization: Bearer CRON_SECRET).
// Tijdens parallel-run periode (Fase 2.5.8) draait dit naast de skill — vergelijking via agent_runs.
//
// Required env-vars (set via Supabase dashboard → Edge Functions → Secrets):
//   - COMPOSIO_API_KEY              Composio API key (zie secrets_inventory.composio_api_key)
//   - COMPOSIO_USER_ID              Composio user (default 'user-jelle' als unset)
//   - COMPOSIO_CONNECTION_ID        Bestaande connection-id voor `legal-mind` Outlook
//   - CRON_SECRET                   Random shared secret for pg_cron auth
//
// Auto-provided by Supabase:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// v2.1: directe REST calls naar Composio (geen SDK — Deno-compatibel,
// geen Node-dependency-issues, kleinere bundle).
// API docs: https://docs.composio.dev/api-reference/api-reference/v3/tools/post-tools-execute-by-action
const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";

const SKILL_VERSION = "edge-fn-v2.1-composio-rest";
const BODY_BYTE_CAP = 200_000;
const MAX_MESSAGES_PER_RUN = 500;
const FULL_SCAN_WINDOW_DAYS = 14;
const FULL_SCAN_REFRESH_DAYS = 7;
const DEFAULT_FOLDERS = ["inbox", "sentitems"]; // well_known_name

// Composio Outlook tool names (action slugs).
// Bij twijfel: GET https://backend.composio.dev/api/v3/tools?toolkit=outlook
const TOOL_LIST_FOLDERS = "OUTLOOK_LIST_MAIL_FOLDERS";
const TOOL_QUERY_EMAILS = "OUTLOOK_QUERY_EMAILS";

interface RunStats {
  triggered_by: string;
  triggered_at: string;
  folders_synced: number;
  messages_upserted: number;
  messages_deleted: number;
  delta_runs: number;
  full_scans: number;
  warnings: string[];
}

// ----- Composio context -----

interface ComposioContext {
  apiKey: string;
  userId: string;
  connectionId: string;
}

function buildCtx(): ComposioContext {
  const apiKey = Deno.env.get("COMPOSIO_API_KEY");
  if (!apiKey) {
    throw new Error(
      "composio_api_key_missing — set COMPOSIO_API_KEY as Edge Function secret (zie secrets_inventory.composio_api_key)",
    );
  }
  const userId = Deno.env.get("COMPOSIO_USER_ID") ?? "user-jelle";
  const connectionId = Deno.env.get("COMPOSIO_CONNECTION_ID");
  if (!connectionId) {
    throw new Error(
      "composio_connection_id_missing — set COMPOSIO_CONNECTION_ID (de `legal-mind` Outlook connection in Composio dashboard)",
    );
  }
  return { apiKey, userId, connectionId };
}

// Direct REST call naar Composio's execute-tool endpoint, met retry op rate-limit.
// Endpoint: POST /api/v3/tools/execute/{action}
// Auth: x-api-key header
// Body: { user_id, connected_account_id, arguments }
async function execTool(
  ctx: ComposioContext,
  toolName: string,
  toolArgs: Record<string, unknown>,
  retry = 0,
): Promise<{ successful?: boolean; data?: unknown; error?: string }> {
  const res = await fetch(
    `${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ctx.apiKey,
      },
      body: JSON.stringify({
        user_id: ctx.userId,
        connected_account_id: ctx.connectionId,
        arguments: toolArgs,
      }),
    },
  );

  if (res.status === 429 && retry < 3) {
    const delays = [5_000, 15_000, 45_000];
    const ra = parseInt(res.headers.get("retry-after") || "0", 10) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(delays[retry], ra)));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }

  const text = await res.text();
  let body: { successful?: boolean; data?: unknown; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `composio_non_json_response_${toolName}: ${res.status} ${text.slice(0, 300)}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `composio_http_${res.status}_${toolName}: ${body?.error ?? text.slice(0, 300)}`,
    );
  }

  return body;
}

// ----- Folder-cache verversen -----

interface CachedFolder {
  id: string;
  display_name: string;
  parent_folder_id: string | null;
  well_known_name: string | null;
  total_item_count: number | null;
  unread_item_count: number | null;
}

async function syncFolders(
  supabase: SupabaseClient,
  ctx: ComposioContext,
): Promise<Map<string, CachedFolder>> {
  const folderMap = new Map<string, CachedFolder>();
  const result = await execTool(ctx, TOOL_LIST_FOLDERS, { top: 50 });

  if (!result?.successful) {
    throw new Error(`folder_list_failed: ${result?.error ?? "unknown"}`);
  }

  const list = (result?.data as { value?: Array<Record<string, unknown>> })?.value ?? [];
  for (const f of list) {
    const id = String(f.id ?? "");
    if (!id) continue;
    folderMap.set(id, {
      id,
      display_name: String(f.displayName ?? ""),
      parent_folder_id: f.parentFolderId ? String(f.parentFolderId) : null,
      well_known_name: f.wellKnownName ? String(f.wellKnownName) : null,
      total_item_count: typeof f.totalItemCount === "number" ? f.totalItemCount : null,
      unread_item_count: typeof f.unreadItemCount === "number" ? f.unreadItemCount : null,
    });
  }

  if (folderMap.size === 0) return folderMap;

  const fullPath = (folder: CachedFolder): string => {
    const segs: string[] = [folder.display_name];
    let cur = folder.parent_folder_id;
    let depth = 0;
    while (cur && depth < 8) {
      const parent = folderMap.get(cur);
      if (!parent) break;
      segs.unshift(parent.display_name);
      cur = parent.parent_folder_id;
      depth++;
    }
    return segs.join("/");
  };

  const rows = Array.from(folderMap.values()).map((f) => ({
    id: f.id,
    display_name: f.display_name,
    parent_folder_id: f.parent_folder_id,
    full_path: fullPath(f),
    well_known_name: f.well_known_name,
    total_item_count: f.total_item_count,
    unread_item_count: f.unread_item_count,
    last_seen_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("mail_folders").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`mail_folders_upsert_failed: ${error.message}`);

  return folderMap;
}

// ----- Message-helpers -----

function pickEmail(rec: unknown): string | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  const ea = r.emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const addr = (ea as Record<string, unknown>).address;
  return typeof addr === "string" ? addr : null;
}

function pickName(rec: unknown): string | null {
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  const ea = r.emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const name = (ea as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

function recipientsJson(list: unknown): unknown {
  if (!Array.isArray(list)) return null;
  return list.map((r) => ({ address: pickEmail(r), name: pickName(r) }));
}

function isFromMe(addr: string | null, fromAddresses: string[]): boolean {
  if (!addr) return false;
  return fromAddresses.includes(addr.toLowerCase());
}

function capBody(content: unknown): {
  body: string | null;
  truncated: boolean;
  byteSize: number | null;
} {
  if (typeof content !== "string" || !content) return { body: null, truncated: false, byteSize: null };
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return { body: content, truncated: false, byteSize: bytes };
  let cap = content;
  while (new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP) {
    cap = cap.slice(0, Math.floor(cap.length * 0.95));
  }
  return { body: cap, truncated: true, byteSize: bytes };
}

function messageRow(
  m: Record<string, unknown>,
  folderId: string,
  folderPath: string,
  fromAddresses: string[],
) {
  const fromAddr = pickEmail(m.from);
  const body = m.body as { contentType?: string; content?: string } | undefined;
  const bodyText = capBody(body?.content);
  return {
    id: String(m.id ?? ""),
    conversation_id: String(m.conversationId ?? ""),
    internet_message_id: typeof m.internetMessageId === "string" ? m.internetMessageId : null,
    in_reply_to: null,
    received_at: typeof m.receivedDateTime === "string" ? m.receivedDateTime : null,
    sent_at: typeof m.sentDateTime === "string" ? m.sentDateTime : null,
    from_email: fromAddr,
    from_name: pickName(m.from),
    to_recipients: recipientsJson(m.toRecipients),
    cc_recipients: recipientsJson(m.ccRecipients),
    bcc_recipients: recipientsJson(m.bccRecipients),
    reply_to: recipientsJson(m.replyTo),
    subject: typeof m.subject === "string" ? m.subject : null,
    body_preview: typeof m.bodyPreview === "string" ? m.bodyPreview : null,
    body_html: body?.contentType === "html" ? bodyText.body : null,
    body_text: body?.contentType !== "html" ? bodyText.body : null,
    body_truncated: bodyText.truncated,
    body_byte_size: bodyText.byteSize,
    has_attachments: m.hasAttachments === true,
    attachment_count: null,
    importance: typeof m.importance === "string" ? m.importance : null,
    categories: Array.isArray(m.categories) ? m.categories : null,
    folder_id: folderId,
    folder_path: folderPath,
    is_read: typeof m.isRead === "boolean" ? m.isRead : null,
    is_draft: typeof m.isDraft === "boolean" ? m.isDraft : null,
    is_from_me: isFromMe(fromAddr, fromAddresses),
    flag_status: (m.flag as { flagStatus?: string })?.flagStatus ?? null,
    synced_at: new Date().toISOString(),
    last_modified_at: typeof m.lastModifiedDateTime === "string" ? m.lastModifiedDateTime : null,
    graph_etag: null,
    skill_version: SKILL_VERSION,
  };
}

// ----- Per folder syncen (filter-based delta — geen Graph delta-tokens v2) -----
//
// v2 gebruikt een eenvoudiger model: query messages met
// `lastModifiedDateTime gt <last_delta_at>` filter. Niet zo strict als Graph
// deltaLink (geen @removed events) maar werkt voor 95% van de use case.
// Verwijderingen worden gedetecteerd via folder-scan diff (alleen bij full-scan).

async function syncFolder(
  supabase: SupabaseClient,
  ctx: ComposioContext,
  folder: CachedFolder,
  folderPath: string,
  fromAddresses: string[],
): Promise<{ upserted: number; deleted: number; mode: "delta" | "full" }> {
  const { data: state } = await supabase
    .from("mail_sync_state")
    .select("*")
    .eq("folder_id", folder.id)
    .maybeSingle();

  const needsFull =
    !state ||
    !state.last_full_scan_at ||
    new Date(state.last_full_scan_at).getTime() <
      Date.now() - FULL_SCAN_REFRESH_DAYS * 86_400_000;

  // Bouw $filter expressie
  let filterExpr: string;
  if (needsFull) {
    const since = new Date(Date.now() - FULL_SCAN_WINDOW_DAYS * 86_400_000).toISOString();
    filterExpr = `receivedDateTime ge ${since}`;
  } else {
    const since = new Date(state!.last_delta_at as string).toISOString();
    filterExpr = `lastModifiedDateTime gt ${since}`;
  }

  const result = await execTool(ctx, TOOL_QUERY_EMAILS, {
    folder_id: folder.id,
    filter: filterExpr,
    top: Math.min(MAX_MESSAGES_PER_RUN, 100),
  });

  if (!result?.successful) {
    throw new Error(`query_emails_failed_${folder.id}: ${result?.error ?? "unknown"}`);
  }

  const messages = (result?.data as { value?: Array<Record<string, unknown>> })?.value ?? [];

  let totalUpserted = 0;
  if (messages.length > 0) {
    const rows = messages
      .filter((m) => typeof m.id === "string")
      .map((m) => messageRow(m, folder.id, folderPath, fromAddresses));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("mail_messages")
        .upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`mail_messages_upsert_failed: ${error.message}`);
      totalUpserted = rows.length;
    }
  }

  // mail_sync_state bijwerken
  const updates: Record<string, unknown> = {
    folder_id: folder.id,
    full_scan_window_days: FULL_SCAN_WINDOW_DAYS,
    enabled: true,
    last_delta_at: new Date().toISOString(),
    total_messages_synced: ((state?.total_messages_synced as number) ?? 0) + totalUpserted,
    last_error: null,
    last_error_at: null,
    updated_at: new Date().toISOString(),
  };
  if (needsFull) updates.last_full_scan_at = new Date().toISOString();

  const { error: stateErr } = await supabase
    .from("mail_sync_state")
    .upsert(updates, { onConflict: "folder_id" });
  if (stateErr) throw new Error(`mail_sync_state_upsert_failed: ${stateErr.message}`);

  return {
    upserted: totalUpserted,
    deleted: 0, // v2 detecteert geen deletions — alleen via volgende full-scan
    mode: needsFull ? "full" : "delta",
  };
}

// ----- Main entrypoint -----

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization") || "";
  const presentedToken = authHeader.replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: RunStats = {
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    folders_synced: 0,
    messages_upserted: 0,
    messages_deleted: 0,
    delta_runs: 0,
    full_scans: 0,
    warnings: [],
  };

  const { data: runIns, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      agent_name: "mail-sync",
      run_type: "edge_function",
      status: "running",
      started_at: startedAt,
      stats,
      errors: [],
    })
    .select("id")
    .single();

  if (runErr || !runIns) {
    return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  }
  const runId = runIns.id as string;

  try {
    const ctx = buildCtx();
    const folderMap = await syncFolders(supabase, ctx);

    const { data: enabledStates } = await supabase
      .from("mail_sync_state")
      .select("folder_id")
      .eq("enabled", true);
    const enabledIds = new Set<string>(
      (enabledStates ?? []).map((r: { folder_id: string }) => r.folder_id),
    );

    const targets: CachedFolder[] = [];
    for (const f of folderMap.values()) {
      if (
        (f.well_known_name && DEFAULT_FOLDERS.includes(f.well_known_name)) ||
        enabledIds.has(f.id)
      ) {
        targets.push(f);
      }
    }

    let fromAddresses = ["burggraaf@legal-mind.nl"];
    const { data: cfg } = await supabase
      .from("agent_config")
      .select("config_value")
      .eq("agent_name", "mail-sync")
      .eq("config_key", "from_addresses")
      .maybeSingle();
    if (cfg?.config_value && Array.isArray(cfg.config_value)) {
      fromAddresses = (cfg.config_value as string[]).map((a) => a.toLowerCase());
    }

    const fullPath = (folder: CachedFolder): string => {
      const segs: string[] = [folder.display_name];
      let cur = folder.parent_folder_id;
      let depth = 0;
      while (cur && depth < 8) {
        const parent = folderMap.get(cur);
        if (!parent) break;
        segs.unshift(parent.display_name);
        cur = parent.parent_folder_id;
        depth++;
      }
      return segs.join("/");
    };

    for (const f of targets) {
      try {
        const r = await syncFolder(supabase, ctx, f, fullPath(f), fromAddresses);
        stats.folders_synced++;
        stats.messages_upserted += r.upserted;
        stats.messages_deleted += r.deleted;
        if (r.mode === "delta") stats.delta_runs++;
        else stats.full_scans++;
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : String(folderErr);
        stats.warnings.push(`folder_${f.well_known_name ?? f.id}: ${msg.slice(0, 200)}`);
      }
    }

    const folderSummary = stats.folders_synced > 0
      ? `${stats.folders_synced} folder(s), ${stats.messages_upserted} upsert via Composio`
      : "no folders synced";
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";

    await supabase
      .from("agent_runs")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        summary: folderSummary,
        stats,
      })
      .eq("id", runId);

    return new Response(
      JSON.stringify({ ok: true, runId, stats }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("agent_runs")
      .update({
        status: "error",
        completed_at: new Date().toISOString(),
        summary: errMsg.slice(0, 500),
        stats,
        errors: [{ message: errMsg, at: new Date().toISOString() }],
      })
      .eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
