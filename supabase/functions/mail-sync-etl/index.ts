// mail-sync-etl — Deno Edge Function
//
// Vervangt de mail-sync skill (heartbeat-skill draait via lokale orchestrator).
// Pure ETL: Microsoft Graph delta-sync → mail_messages / mail_folders / mail_sync_state.
// Geen LLM-redenering, geen Composio-dependency, geen Jelle's PC nodig.
//
// Trigger: pg_cron `*/5 * * * *` via pg_net.http_post (Authorization: Bearer CRON_SECRET).
// Tijdens parallel-run periode (Fase 2.5.8) draait dit naast de skill — vergelijking via agent_runs.
//
// Deploy: MCP `deploy_edge_function` of `supabase functions deploy mail-sync-etl`
// Schedule (Fase 2.5.7): zie README in deze folder
//
// Required env-vars (set via `supabase secrets set NAME=value` of dashboard):
//   - MS_GRAPH_TENANT_ID           Azure AD tenant id
//   - MS_GRAPH_CLIENT_ID           Azure AD app registration id
//   - MS_GRAPH_CLIENT_SECRET       Azure AD app client secret
//   - MS_GRAPH_REFRESH_TOKEN       OAuth refresh-token (offline_access scope)
//   - CRON_SECRET                  Random shared secret for pg_cron auth
//
// Auto-provided by Supabase:
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "edge-fn-v1.0";
const BODY_BYTE_CAP = 200_000;
const MAX_MESSAGES_PER_RUN = 500;
const FULL_SCAN_WINDOW_DAYS = 14;
const FULL_SCAN_REFRESH_DAYS = 7; // re-baseline elke week om delta-drift te voorkomen
const DEFAULT_FOLDERS = ["inbox", "sentitems"]; // well_known_name

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPES = "https://graph.microsoft.com/Mail.Read offline_access";

// ----- Type-helpers (intentioneel minimaal — alleen velden die we gebruiken) -----

interface GraphFolder {
  id: string;
  displayName: string;
  parentFolderId: string | null;
  wellKnownName?: string;
  totalItemCount?: number;
  unreadItemCount?: number;
}

interface GraphMessage {
  id: string;
  conversationId: string;
  internetMessageId?: string;
  inReplyTo?: { id: string } | string | null;
  receivedDateTime: string;
  sentDateTime?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  bccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  replyTo?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: "html" | "text"; content?: string };
  hasAttachments?: boolean;
  importance?: string;
  categories?: string[];
  parentFolderId?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: string };
  lastModifiedDateTime?: string;
  "@odata.etag"?: string;
  "@removed"?: { reason: string };
}

interface DeltaResponse {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

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

// ----- Microsoft Graph token-management -----

async function getAccessToken(): Promise<string> {
  const tenant = Deno.env.get("MS_GRAPH_TENANT_ID");
  const clientId = Deno.env.get("MS_GRAPH_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_GRAPH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("MS_GRAPH_REFRESH_TOKEN");

  if (!tenant || !clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "ms_graph_credentials_missing — set MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_REFRESH_TOKEN as Edge Function secrets",
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ms_graph_token_refresh_failed: ${res.status} ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`ms_graph_no_access_token_in_response: ${JSON.stringify(data).slice(0, 500)}`);
  }

  // Note: data.refresh_token kan een nieuwe rotated token zijn. Voor MVP loggen we 'm
  // niet — Microsoft accepteert het oude refresh-token meestal nog 90 dagen.
  // Voor production: schrijf rotation-flow in een aparte RPC die vault.update_secret aanroept.
  return data.access_token as string;
}

async function graphFetch(
  url: string,
  accessToken: string,
  retry = 0,
): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      Prefer: 'outlook.body-content-type="text"', // gewoon text-body — veel kleiner dan HTML
    },
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5_000, 15_000, 45_000];
    const ra = parseInt(res.headers.get("retry-after") || "0", 10) * 1000;
    await new Promise((r) => setTimeout(r, Math.max(delays[retry], ra)));
    return graphFetch(url, accessToken, retry + 1);
  }
  return res;
}

// ----- Folder-cache verversen -----

async function syncFolders(
  supabase: SupabaseClient,
  accessToken: string,
): Promise<Map<string, GraphFolder>> {
  const folderMap = new Map<string, GraphFolder>();
  let url: string | undefined =
    `${GRAPH_BASE}/me/mailFolders?$top=50&includeHiddenFolders=false`;

  while (url) {
    const res = await graphFetch(url, accessToken);
    if (!res.ok) {
      throw new Error(`folder_list_failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    for (const f of data.value as GraphFolder[]) {
      folderMap.set(f.id, f);
    }
    url = data["@odata.nextLink"];
  }

  if (folderMap.size === 0) return folderMap;

  const fullPath = (folder: GraphFolder): string => {
    const segs: string[] = [folder.displayName];
    let cur = folder.parentFolderId;
    let depth = 0;
    while (cur && depth < 8) {
      const parent = folderMap.get(cur);
      if (!parent) break;
      segs.unshift(parent.displayName);
      cur = parent.parentFolderId;
      depth++;
    }
    return segs.join("/");
  };

  const rows = Array.from(folderMap.values()).map((f) => ({
    id: f.id,
    display_name: f.displayName,
    parent_folder_id: f.parentFolderId,
    full_path: fullPath(f),
    well_known_name: f.wellKnownName ?? null,
    total_item_count: f.totalItemCount ?? null,
    unread_item_count: f.unreadItemCount ?? null,
    last_seen_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("mail_folders").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`mail_folders_upsert_failed: ${error.message}`);

  return folderMap;
}

// ----- Message-upsert helpers -----

function pickEmail(rec?: { emailAddress?: { address?: string; name?: string } }): string | null {
  return rec?.emailAddress?.address ?? null;
}

function pickName(rec?: { emailAddress?: { address?: string; name?: string } }): string | null {
  return rec?.emailAddress?.name ?? null;
}

function recipientsJson(
  list?: Array<{ emailAddress?: { address?: string; name?: string } }>,
): unknown {
  if (!list) return null;
  return list.map((r) => ({
    address: pickEmail(r),
    name: pickName(r),
  }));
}

function isFromMe(addr: string | null, fromAddresses: string[]): boolean {
  if (!addr) return false;
  return fromAddresses.includes(addr.toLowerCase());
}

function capBody(content: string | undefined): {
  body: string | null;
  truncated: boolean;
  byteSize: number | null;
} {
  if (!content) return { body: null, truncated: false, byteSize: null };
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return { body: content, truncated: false, byteSize: bytes };
  // Cap op bytes — substring op character-niveau kan overshooten, maar 200KB-marge accepteren
  let cap = content;
  while (new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP) {
    cap = cap.slice(0, Math.floor(cap.length * 0.95));
  }
  return { body: cap, truncated: true, byteSize: bytes };
}

function messageRow(
  m: GraphMessage,
  folderId: string,
  folderPath: string,
  fromAddresses: string[],
) {
  const fromAddr = pickEmail(m.from);
  const bodyText = capBody(m.body?.content);
  return {
    id: m.id,
    conversation_id: m.conversationId,
    internet_message_id: m.internetMessageId ?? null,
    in_reply_to:
      typeof m.inReplyTo === "string"
        ? m.inReplyTo
        : m.inReplyTo?.id ?? null,
    received_at: m.receivedDateTime,
    sent_at: m.sentDateTime ?? null,
    from_email: fromAddr,
    from_name: pickName(m.from),
    to_recipients: recipientsJson(m.toRecipients),
    cc_recipients: recipientsJson(m.ccRecipients),
    bcc_recipients: recipientsJson(m.bccRecipients),
    reply_to: recipientsJson(m.replyTo),
    subject: m.subject ?? null,
    body_preview: m.bodyPreview ?? null,
    body_html: m.body?.contentType === "html" ? bodyText.body : null,
    body_text: m.body?.contentType !== "html" ? bodyText.body : null,
    body_truncated: bodyText.truncated,
    body_byte_size: bodyText.byteSize,
    has_attachments: m.hasAttachments ?? false,
    attachment_count: null,
    importance: m.importance ?? null,
    categories: m.categories ?? null,
    folder_id: folderId,
    folder_path: folderPath,
    is_read: m.isRead ?? null,
    is_draft: m.isDraft ?? null,
    is_from_me: isFromMe(fromAddr, fromAddresses),
    flag_status: m.flag?.flagStatus ?? null,
    synced_at: new Date().toISOString(),
    last_modified_at: m.lastModifiedDateTime ?? null,
    graph_etag: m["@odata.etag"] ?? null,
    skill_version: SKILL_VERSION,
  };
}

// ----- Per folder syncen (delta of full-scan) -----

async function syncFolder(
  supabase: SupabaseClient,
  accessToken: string,
  folder: GraphFolder,
  folderPath: string,
  fromAddresses: string[],
): Promise<{ upserted: number; deleted: number; mode: "delta" | "full" }> {
  // State ophalen
  const { data: state } = await supabase
    .from("mail_sync_state")
    .select("*")
    .eq("folder_id", folder.id)
    .maybeSingle();

  const needsFull =
    !state ||
    !state.delta_link ||
    !state.last_full_scan_at ||
    new Date(state.last_full_scan_at).getTime() <
      Date.now() - FULL_SCAN_REFRESH_DAYS * 86_400_000;

  let initialUrl: string;
  if (needsFull) {
    const since = new Date(Date.now() - FULL_SCAN_WINDOW_DAYS * 86_400_000)
      .toISOString();
    initialUrl =
      `${GRAPH_BASE}/me/mailFolders/${folder.id}/messages/delta` +
      `?$select=id,conversationId,internetMessageId,receivedDateTime,sentDateTime,` +
      `from,toRecipients,ccRecipients,bccRecipients,replyTo,subject,bodyPreview,body,` +
      `hasAttachments,importance,categories,parentFolderId,isRead,isDraft,flag,lastModifiedDateTime` +
      `&$top=100&$filter=receivedDateTime ge ${since}`;
  } else {
    initialUrl = state!.delta_link as string;
  }

  let url: string | undefined = initialUrl;
  let totalUpserted = 0;
  let totalDeleted = 0;
  let nextDeltaLink: string | undefined;
  let processed = 0;

  while (url && processed < MAX_MESSAGES_PER_RUN) {
    const res = await graphFetch(url, accessToken);

    if (res.status === 410 && !needsFull) {
      // Delta link expired — fall back naar full-scan in volgende run
      await supabase
        .from("mail_sync_state")
        .update({
          delta_link: null,
          last_error: "delta_link_410_gone — full-scan in next run",
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("folder_id", folder.id);
      return { upserted: totalUpserted, deleted: totalDeleted, mode: "delta" };
    }

    if (!res.ok) {
      throw new Error(
        `delta_fetch_failed_${folder.id}: ${res.status} ${
          (await res.text()).slice(0, 500)
        }`,
      );
    }

    const data: DeltaResponse = await res.json();

    // Verzamel rows en deletes
    const upsertRows: ReturnType<typeof messageRow>[] = [];
    const deletedIds: string[] = [];

    for (const m of data.value) {
      if (m["@removed"]) {
        deletedIds.push(m.id);
      } else {
        upsertRows.push(messageRow(m, folder.id, folderPath, fromAddresses));
        processed++;
        if (processed >= MAX_MESSAGES_PER_RUN) break;
      }
    }

    if (upsertRows.length > 0) {
      const { error } = await supabase
        .from("mail_messages")
        .upsert(upsertRows, { onConflict: "id" });
      if (error) {
        throw new Error(`mail_messages_upsert_failed: ${error.message}`);
      }
      totalUpserted += upsertRows.length;
    }

    if (deletedIds.length > 0) {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("mail_messages")
        .update({ is_deleted: true, deleted_at: nowIso })
        .in("id", deletedIds);
      if (error) {
        throw new Error(`mail_messages_softdelete_failed: ${error.message}`);
      }
      totalDeleted += deletedIds.length;
    }

    if (data["@odata.deltaLink"]) {
      nextDeltaLink = data["@odata.deltaLink"];
      break;
    }
    url = data["@odata.nextLink"];
  }

  // mail_sync_state bijwerken
  const updates: Record<string, unknown> = {
    folder_id: folder.id,
    full_scan_window_days: FULL_SCAN_WINDOW_DAYS,
    enabled: true,
    last_delta_at: new Date().toISOString(),
    total_messages_synced:
      ((state?.total_messages_synced as number) ?? 0) + totalUpserted,
    last_error: null,
    last_error_at: null,
    updated_at: new Date().toISOString(),
  };
  if (nextDeltaLink) {
    updates.delta_link = nextDeltaLink;
  }
  if (needsFull) {
    updates.last_full_scan_at = new Date().toISOString();
  }

  const { error: stateErr } = await supabase
    .from("mail_sync_state")
    .upsert(updates, { onConflict: "folder_id" });
  if (stateErr) throw new Error(`mail_sync_state_upsert_failed: ${stateErr.message}`);

  return {
    upserted: totalUpserted,
    deleted: totalDeleted,
    mode: needsFull ? "full" : "delta",
  };
}

// ----- Main entrypoint -----

Deno.serve(async (req) => {
  // Authorization: accepteer Bearer met CRON_SECRET (van pg_cron) of service-role key (handmatige tests)
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

  // run-record openen
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const { data: runIns, error: runErr } = await supabase
    .from("agent_runs")
    .insert({
      agent_name: "mail-sync",
      run_type: "edge_function",
      status: "running",
      started_at: startedAt,
      stats: {
        triggered_by: triggeredBy,
        triggered_at: startedAt,
        folders_synced: 0,
        messages_upserted: 0,
        messages_deleted: 0,
        delta_runs: 0,
        full_scans: 0,
        warnings: [] as string[],
      } satisfies RunStats,
      errors: [],
    })
    .select("id")
    .single();
  if (runErr || !runIns) {
    return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  }
  const runId = runIns.id as string;

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

  try {
    const accessToken = await getAccessToken();
    const folderMap = await syncFolders(supabase, accessToken);

    // Welke folders syncen? Default: well_known_name in DEFAULT_FOLDERS,
    // plus ad-hoc opt-in via mail_sync_state.enabled = true.
    const { data: enabledStates } = await supabase
      .from("mail_sync_state")
      .select("folder_id")
      .eq("enabled", true);
    const enabledIds = new Set<string>(
      (enabledStates ?? []).map((r: { folder_id: string }) => r.folder_id),
    );

    const targets: GraphFolder[] = [];
    for (const f of folderMap.values()) {
      if (
        (f.wellKnownName && DEFAULT_FOLDERS.includes(f.wellKnownName)) ||
        enabledIds.has(f.id)
      ) {
        targets.push(f);
      }
    }

    // From-addresses uit agent_config (optional override). Default = burggraaf@legal-mind.nl.
    let fromAddresses = ["burggraaf@legal-mind.nl"];
    const { data: cfg } = await supabase
      .from("agent_config")
      .select("config_value")
      .eq("agent_name", "mail-sync")
      .eq("config_key", "from_addresses")
      .maybeSingle();
    if (cfg?.config_value) {
      const arr = Array.isArray(cfg.config_value)
        ? (cfg.config_value as string[])
        : null;
      if (arr) fromAddresses = arr.map((a) => a.toLowerCase());
    }

    const fullPath = (folder: GraphFolder): string => {
      const segs: string[] = [folder.displayName];
      let cur = folder.parentFolderId;
      let depth = 0;
      while (cur && depth < 8) {
        const parent = folderMap.get(cur);
        if (!parent) break;
        segs.unshift(parent.displayName);
        cur = parent.parentFolderId;
        depth++;
      }
      return segs.join("/");
    };

    for (const f of targets) {
      try {
        const r = await syncFolder(
          supabase,
          accessToken,
          f,
          fullPath(f),
          fromAddresses,
        );
        stats.folders_synced++;
        stats.messages_upserted += r.upserted;
        stats.messages_deleted += r.deleted;
        if (r.mode === "delta") stats.delta_runs++;
        else stats.full_scans++;
      } catch (folderErr) {
        const msg = folderErr instanceof Error ? folderErr.message : String(folderErr);
        stats.warnings.push(`folder_${f.wellKnownName ?? f.id}: ${msg.slice(0, 200)}`);
      }
    }

    const folderSummary = stats.folders_synced > 0
      ? `${stats.folders_synced} folder(s), ${stats.messages_upserted} upsert, ${stats.messages_deleted} deleted`
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
