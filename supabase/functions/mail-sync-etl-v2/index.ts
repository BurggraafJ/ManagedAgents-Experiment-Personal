// mail-sync-etl v2.4 - Composio REST + reconciliation pass voor moved/deleted mails
//
// v2.4 (2026-05-06): Fix voor "Wintertaling-bug" — mails die Jelle in Outlook
// verplaatste bleven met oude folder_id in DB staan omdat delta-sync ze nooit
// meer ophaalt (ze zitten niet meer in de Inbox-poel die opgevraagd wordt).
// Reconciliation-pass: bij elke full-scan, vergelijk DB-rijen voor de folder
// met de actuele Outlook-lijst en zet is_deleted=true voor wat ontbreekt.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
const SKILL_VERSION = "edge-fn-v2.4-with-reconciliation";
const BODY_BYTE_CAP = 200_000;
const MAX_MESSAGES_PER_RUN = 200;
const FULL_SCAN_WINDOW_DAYS = 14;
const FULL_SCAN_REFRESH_DAYS = 7;
// Default folders gematcht op displayName (Composio response heeft geen wellKnownName)
const DEFAULT_FOLDER_NAMES = ["Inbox", "Sent Items"];
const TOOL_LIST_FOLDERS = "OUTLOOK_OUTLOOK_LIST_MAIL_FOLDERS";
const TOOL_LIST_MESSAGES = "OUTLOOK_OUTLOOK_LIST_MESSAGES";

// Velden die we van messages willen via $select — minimaliseert payload
const MESSAGE_SELECT = [
  "id","conversationId","internetMessageId","receivedDateTime","sentDateTime",
  "from","toRecipients","ccRecipients","bccRecipients","replyTo",
  "subject","bodyPreview","body","hasAttachments","importance","categories",
  "parentFolderId","isRead","isDraft","flag","lastModifiedDateTime",
];

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Secrets live in Supabase Vault (encrypted, audit-logged).
  // Non-secret config (project IDs, settings, watermarks) lives in agent_config.
  // Try Vault first; if not present, read non-secret from agent_config.
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
  if (!apiKey) throw new Error("composio_api_key_missing in agent_config(global, composio_api_key)");
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
  try { body = JSON.parse(text); } catch { throw new Error(`composio_non_json_${toolName}: ${res.status} ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}_${toolName}: ${(body as { error?: string })?.error ?? text.slice(0,200)}`);
  return body;
}

interface CachedFolder {
  id: string;
  display_name: string;
  parent_folder_id: string | null;
  is_hidden: boolean;
  total_item_count: number | null;
  unread_item_count: number | null;
}

async function syncFolders(supabase: SupabaseClient, ctx: ComposioContext): Promise<Map<string, CachedFolder>> {
  const folderMap = new Map<string, CachedFolder>();
  const result = await execTool(ctx, TOOL_LIST_FOLDERS, { user_id: "me", include_hidden_folders: false });
  const list = result?.data?.response_data?.value ?? [];
  for (const f of list) {
    const id = String(f.id ?? "");
    if (!id) continue;
    folderMap.set(id, {
      id,
      display_name: String(f.displayName ?? ""),
      parent_folder_id: f.parentFolderId ? String(f.parentFolderId) : null,
      is_hidden: f.isHidden === true,
      total_item_count: typeof f.totalItemCount === "number" ? f.totalItemCount : null,
      unread_item_count: typeof f.unreadItemCount === "number" ? f.unreadItemCount : null,
    });
  }
  if (folderMap.size === 0) return folderMap;

  const fullPath = (folder: CachedFolder): string => {
    const segs: string[] = [folder.display_name];
    let cur = folder.parent_folder_id; let depth = 0;
    while (cur && depth < 8) {
      const parent = folderMap.get(cur); if (!parent) break;
      segs.unshift(parent.display_name); cur = parent.parent_folder_id; depth++;
    }
    return segs.join("/");
  };

  const nowIso = new Date().toISOString();
  const rows = Array.from(folderMap.values()).map((f) => ({
    id: f.id,
    display_name: f.display_name,
    parent_folder_id: f.parent_folder_id,
    full_path: fullPath(f),
    well_known_name: null,  // Composio levert dit niet — kunnen later afgeleid worden
    total_item_count: f.total_item_count,
    unread_item_count: f.unread_item_count,
    last_seen_at: nowIso,
  }));
  const { error } = await supabase.from("mail_folders").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`mail_folders_upsert_failed: ${error.message}`);

  // V8.7 (2026-05-13): ook upsert naar `autodraft_folders` tabel die door de
  // dashboard-frontend (MaestroFoldersTree via useAutoDraft) wordt gelezen.
  // Tot V8.6 was deze tabel een statische snapshot; nieuwe Outlook-mappen
  // (zoals "In Afwachting") verschenen niet automatisch. autodraft_folders
  // heeft een unique-constraint op folder_id; column-mapping ietwat anders
  // dan mail_folders: id → folder_id, total_item_count → item_count, geen
  // unread_item_count / well_known_name.
  const adRows = Array.from(folderMap.values()).map((f) => ({
    folder_id: f.id,
    display_name: f.display_name,
    parent_folder_id: f.parent_folder_id,
    full_path: fullPath(f),
    role: null,                       // niet door Composio geleverd
    item_count: f.total_item_count,
    last_seen_at: nowIso,
  }));
  const { error: adErr } = await supabase
    .from("autodraft_folders")
    .upsert(adRows, { onConflict: "folder_id" });
  if (adErr) {
    // Niet-fatal — mail_folders is authoritative voor de sync zelf. Loggen
    // zodat de orchestrator-run-stats het oppakt; mail-sync gaat door.
    console.warn(`[mail-sync] autodraft_folders upsert failed: ${adErr.message}`);
  }

  return folderMap;
}

function pickEmail(rec: unknown): string | null {
  if (!rec || typeof rec !== "object") return null;
  const ea = (rec as Record<string, unknown>).emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const addr = (ea as Record<string, unknown>).address;
  return typeof addr === "string" ? addr : null;
}
function pickName(rec: unknown): string | null {
  if (!rec || typeof rec !== "object") return null;
  const ea = (rec as Record<string, unknown>).emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const name = (ea as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}
function recipientsJson(list: unknown): unknown {
  if (!Array.isArray(list)) return null;
  return list.map((r) => ({ address: pickEmail(r), name: pickName(r) }));
}
function isFromMe(addr: string | null, fromAddresses: string[]): boolean {
  if (!addr) return false; return fromAddresses.includes(addr.toLowerCase());
}
function capBody(content: unknown): { body: string | null; truncated: boolean; byteSize: number | null } {
  if (typeof content !== "string" || !content) return { body: null, truncated: false, byteSize: null };
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return { body: content, truncated: false, byteSize: bytes };
  let cap = content;
  while (new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP) cap = cap.slice(0, Math.floor(cap.length * 0.95));
  return { body: cap, truncated: true, byteSize: bytes };
}

function messageRow(m: Record<string, unknown>, folderId: string, folderPath: string, fromAddresses: string[]) {
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
    from_email: fromAddr, from_name: pickName(m.from),
    to_recipients: recipientsJson(m.toRecipients),
    cc_recipients: recipientsJson(m.ccRecipients),
    bcc_recipients: recipientsJson(m.bccRecipients),
    reply_to: recipientsJson(m.replyTo),
    subject: typeof m.subject === "string" ? m.subject : null,
    body_preview: typeof m.bodyPreview === "string" ? m.bodyPreview : null,
    body_html: body?.contentType === "html" ? bodyText.body : null,
    body_text: body?.contentType !== "html" ? bodyText.body : null,
    body_truncated: bodyText.truncated, body_byte_size: bodyText.byteSize,
    has_attachments: m.hasAttachments === true, attachment_count: null,
    importance: typeof m.importance === "string" ? m.importance : null,
    categories: Array.isArray(m.categories) ? m.categories : null,
    folder_id: folderId, folder_path: folderPath,
    is_read: typeof m.isRead === "boolean" ? m.isRead : null,
    is_draft: typeof m.isDraft === "boolean" ? m.isDraft : null,
    is_from_me: isFromMe(fromAddr, fromAddresses),
    flag_status: (m.flag as { flagStatus?: string })?.flagStatus ?? null,
    synced_at: new Date().toISOString(),
    last_modified_at: typeof m.lastModifiedDateTime === "string" ? m.lastModifiedDateTime : null,
    graph_etag: null, skill_version: SKILL_VERSION,
  };
}

// v2.4 — Reconciliation pass. Haal complete folder-inhoud op (paginated) zodat
// we DB-only mails (= Jelle verplaatst/verwijderd in Outlook maar mail-sync
// heeft delta gemist) kunnen markeren als is_deleted=true.
//
// Draait alleen bij full-scans (max 1x per 7 dagen per folder) zodat we niet
// elke run de complete Outlook-folder ophalen.
async function reconcileFolder(
  supabase: SupabaseClient, ctx: ComposioContext, folder: CachedFolder
): Promise<{ marked_deleted: number; outlook_count: number }> {
  const allOutlookIds = new Set<string>();
  let pageToken: string | undefined;
  let pages = 0;
  const MAX_PAGES = 30; // 30 * 100 = 3000 messages cap per folder

  do {
    const args: Record<string, unknown> = {
      user_id: "me",
      folder: folder.id,
      top: 999,                  // grootste page-size die Microsoft Graph accepteert
      select: ["id"],
      orderby: ["receivedDateTime desc"],
    };
    // Composio support voor pagination via skiptoken — best-effort
    if (pageToken) args.skip_token = pageToken;

    const result = await execTool(ctx, TOOL_LIST_MESSAGES, args);
    const messages = result?.data?.response_data?.value ?? [];
    for (const m of messages) {
      if (typeof m.id === "string") allOutlookIds.add(m.id);
    }
    // Probeer nextLink → skip_token te extraheren (alleen relevant bij >999 mails)
    const nextLink = result?.data?.response_data?.["@odata.nextLink"];
    if (typeof nextLink === "string") {
      const m = nextLink.match(/[?&]\$skiptoken=([^&]+)/i);
      pageToken = m ? decodeURIComponent(m[1]) : undefined;
    } else {
      pageToken = undefined;
    }
    pages++;
  } while (pageToken && pages < MAX_PAGES);

  if (allOutlookIds.size === 0) {
    // Lege response = waarschijnlijk Composio-fout, NIET reconciliëren
    return { marked_deleted: 0, outlook_count: 0 };
  }

  // Sanity-check: vertrouw op Outlook's eigen total_item_count als die bestaat.
  // Als wij minder mails ophalen dan de folder volgens metadata zou moeten
  // bevatten, is een page-fetch waarschijnlijk gefaald → niet reconciliëren.
  // (Geen aparte 50%-safety — die blokkeerde legitieme grote achterstanden bij
  // de eerste run na deploy.)
  if (folder.total_item_count != null && folder.total_item_count > 0
      && allOutlookIds.size < folder.total_item_count * 0.85) {
    return { marked_deleted: 0, outlook_count: allOutlookIds.size };
  }

  // DB-rijen voor deze folder die niet (meer) in Outlook staan
  const { data: dbRows } = await supabase
    .from("mail_messages")
    .select("id")
    .eq("folder_id", folder.id)
    .eq("is_deleted", false);

  const dbOnlyIds = (dbRows ?? [])
    .map((r: { id: string }) => r.id)
    .filter((id: string) => !allOutlookIds.has(id));

  if (dbOnlyIds.length === 0) {
    return { marked_deleted: 0, outlook_count: allOutlookIds.size };
  }

  // Mark als deleted in batches van 200 om SQL-limieten te respecteren
  let markedTotal = 0;
  for (let i = 0; i < dbOnlyIds.length; i += 200) {
    const batch = dbOnlyIds.slice(i, i + 200);
    const { error } = await supabase
      .from("mail_messages")
      .update({ is_deleted: true, synced_at: new Date().toISOString() })
      .in("id", batch);
    if (error) {
      // Stop bij eerste fout — partial progress is OK
      break;
    }
    markedTotal += batch.length;
  }
  return { marked_deleted: markedTotal, outlook_count: allOutlookIds.size };
}

async function syncFolder(supabase: SupabaseClient, ctx: ComposioContext, folder: CachedFolder, folderPath: string, fromAddresses: string[]): Promise<{ upserted: number; mode: "delta" | "full"; reconciled: number }> {
  const { data: state } = await supabase.from("mail_sync_state").select("*").eq("folder_id", folder.id).maybeSingle();
  const needsFull = !state || !state.last_full_scan_at
    || new Date(state.last_full_scan_at).getTime() < Date.now() - FULL_SCAN_REFRESH_DAYS * 86_400_000;

  // Bouw arguments — Composio LIST_MESSAGES neemt received_date_time_ge / _gt
  const args: Record<string, unknown> = {
    user_id: "me",
    folder: folder.id,
    top: Math.min(MAX_MESSAGES_PER_RUN, 100),
    select: MESSAGE_SELECT,
    orderby: ["receivedDateTime desc"],
  };
  if (needsFull) {
    args.received_date_time_ge = new Date(Date.now() - FULL_SCAN_WINDOW_DAYS * 86_400_000).toISOString();
  } else {
    args.received_date_time_gt = new Date(state!.last_delta_at as string).toISOString();
  }

  const result = await execTool(ctx, TOOL_LIST_MESSAGES, args);
  const messages = result?.data?.response_data?.value ?? [];

  let totalUpserted = 0;
  if (messages.length > 0) {
    const rows = messages.filter((m) => typeof m.id === "string")
      .map((m) => messageRow(m, folder.id, folderPath, fromAddresses));
    if (rows.length > 0) {
      const { error } = await supabase.from("mail_messages").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`mail_messages_upsert_failed: ${error.message}`);
      totalUpserted = rows.length;
    }
  }
  const updates: Record<string, unknown> = {
    folder_id: folder.id,
    full_scan_window_days: FULL_SCAN_WINDOW_DAYS,
    enabled: true,
    last_delta_at: new Date().toISOString(),
    total_messages_synced: ((state?.total_messages_synced as number) ?? 0) + totalUpserted,
    last_error: null, last_error_at: null,
    updated_at: new Date().toISOString(),
  };
  if (needsFull) updates.last_full_scan_at = new Date().toISOString();
  const { error: stateErr } = await supabase.from("mail_sync_state").upsert(updates, { onConflict: "folder_id" });
  if (stateErr) throw new Error(`mail_sync_state_upsert_failed: ${stateErr.message}`);

  // v2.4 — Reconciliation pass alleen bij full-scans (max 1x per 7d per folder).
  // Vangt mails op die uit deze folder zijn verplaatst maar in DB nog op deze
  // folder_id staan.
  let reconciled = 0;
  if (needsFull) {
    try {
      const r = await reconcileFolder(supabase, ctx, folder);
      reconciled = r.marked_deleted;
    } catch {
      // Reconciliation-fout mag de full-scan niet doen falen
    }
  }
  return { upserted: totalUpserted, mode: needsFull ? "full" : "delta", reconciled };
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
  const stats = { schema_version: "1", skill_version: "mail-sync-etl-v2.4", triggered_by: triggeredBy, triggered_at: startedAt, folders_synced: 0, messages_upserted: 0, messages_deleted: 0, messages_reconciled: 0, delta_runs: 0, full_scans: 0, warnings: [] as string[] };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "mail-sync", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);
    const folderMap = await syncFolders(supabase, ctx);
    const { data: enabledStates } = await supabase.from("mail_sync_state").select("folder_id").eq("enabled", true);
    const enabledIds = new Set<string>((enabledStates ?? []).map((r: { folder_id: string }) => r.folder_id));

    const targets: CachedFolder[] = [];
    for (const f of folderMap.values()) {
      if (!f.is_hidden && (DEFAULT_FOLDER_NAMES.includes(f.display_name) || enabledIds.has(f.id))) {
        targets.push(f);
      }
    }

    let fromAddresses = ["burggraaf@legal-mind.nl"];
    const { data: cfg } = await supabase.from("agent_config").select("config_value")
      .eq("agent_name", "mail-sync").eq("config_key", "from_addresses").maybeSingle();
    if (cfg?.config_value && Array.isArray(cfg.config_value)) {
      fromAddresses = (cfg.config_value as string[]).map((a) => a.toLowerCase());
    }

    const fullPath = (folder: CachedFolder): string => {
      const segs: string[] = [folder.display_name]; let cur = folder.parent_folder_id; let depth = 0;
      while (cur && depth < 8) { const parent = folderMap.get(cur); if (!parent) break; segs.unshift(parent.display_name); cur = parent.parent_folder_id; depth++; }
      return segs.join("/");
    };

    for (const f of targets) {
      try {
        const r = await syncFolder(supabase, ctx, f, fullPath(f), fromAddresses);
        stats.folders_synced++;
        stats.messages_upserted += r.upserted;
        stats.messages_reconciled += r.reconciled;
        if (r.mode === "delta") stats.delta_runs++; else stats.full_scans++;
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : String(folderErr);
        stats.warnings.push(`folder_${f.display_name}: ${msg.slice(0, 200)}`);
      }
    }

    const summary = stats.folders_synced > 0
      ? `${stats.folders_synced} folder(s), ${stats.messages_upserted} mails upsert via Composio`
      : "no target folders found";
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
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
