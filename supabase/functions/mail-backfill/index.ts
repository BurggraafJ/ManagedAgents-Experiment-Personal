// mail-backfill v1.4 - atomic claim via RPC + multi-bucket per run (5 buckets of 60s wall).
//
// v1.4 (2026-09-02): per-user mailbox. claim_next_backfill_bucket() geeft nu de
// Composio-credential van de bijbehorende mail_accounts-rij mee, dus de ctx is
// PER BUCKET i.p.v. één globale. Daarmee kan een bucket per constructie niet
// meer met de verkeerde connectie draaien (blokkade B4). mail_messages krijgt
// user_id expliciet mee; de kolom-DEFAULT verdwijnt in migratie G.
// Zie MAIL-PIPELINE.md §3.3.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
const SKILL_VERSION = "edge-fn-mail-backfill-v1.4";
const BODY_BYTE_CAP = 250_000;
const MAX_PAGES_PER_BUCKET = 10;
const TOP_PER_PAGE = 200;
const MAX_BUCKETS_PER_RUN = 5;
const MAX_WALL_TIME_MS = 60_000;

const TOOL_LIST_MESSAGES = "OUTLOOK_OUTLOOK_LIST_MESSAGES";

const MESSAGE_SELECT = [
  "id","conversationId","internetMessageId","receivedDateTime","sentDateTime",
  "from","toRecipients","ccRecipients","bccRecipients","replyTo",
  "subject","bodyPreview","body","hasAttachments","importance","categories",
  "parentFolderId","isRead","isDraft","flag","lastModifiedDateTime",
];

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

// v1.4: alleen de globale API-key komt nog uit config; user/connection komen
// per bucket uit de claim (met agent_config als fallback zolang de registry
// die kolommen nog niet gevuld heeft).
async function composioApiKey(supabase: SupabaseClient): Promise<string> {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");
  return apiKey;
}

async function ctxForBucket(
  supabase: SupabaseClient, apiKey: string, bucket: BucketRow,
): Promise<ComposioContext> {
  const userId = bucket.composio_user_id
    ?? (await getCfg(supabase, "mail-backfill", "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id")) ?? "user-jelle";
  const connectionId = bucket.composio_connection_id
    ?? (await getCfg(supabase, "mail-backfill", "composio_connection_id"))
    ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id"));
  if (!connectionId) {
    throw new Error(`composio_connection_id_missing for ${bucket.mailbox_email ?? bucket.account_user_id}`);
  }
  return { apiKey, userId, connectionId };
}

interface ToolResult {
  data?: { response_data?: { value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string } };
  error?: unknown;
}
function stringifyErr(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e).slice(0, 300); } catch { return String(e).slice(0, 300); }
}
async function execTool(ctx: ComposioContext, toolName: string, toolArgs: Record<string, unknown>, retry = 0): Promise<ToolResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({ user_id: ctx.userId, connected_account_id: ctx.connectionId, arguments: toolArgs }),
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }
  const text = await res.text();
  let body: ToolResult;
  try { body = JSON.parse(text); } catch { throw new Error(`composio_non_json_${toolName}: ${res.status} ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}_${toolName}: ${stringifyErr(body?.error ?? text.slice(0,200))}`);
  return body;
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
  if (!addr) return false;
  return fromAddresses.includes(addr.toLowerCase());
}
function capBody(content: unknown): { body: string | null; truncated: boolean; byteSize: number | null } {
  if (typeof content !== "string" || !content) return { body: null, truncated: false, byteSize: null };
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return { body: content, truncated: false, byteSize: bytes };
  let cap = content;
  while (new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP) cap = cap.slice(0, Math.floor(cap.length * 0.95));
  return { body: cap, truncated: true, byteSize: bytes };
}

function messageRow(m: Record<string, unknown>, folderId: string, folderPath: string, fromAddresses: string[], ownerUserId: string) {
  const fromAddr = pickEmail(m.from);
  const body = m.body as { contentType?: string; content?: string } | undefined;
  const bodyText = capBody(body?.content);
  return {
    id: String(m.id ?? ""),
    user_id: ownerUserId,   // v1.4: expliciet, niet via kolom-DEFAULT
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
    is_deleted: false,
    flag_status: (m.flag as { flagStatus?: string })?.flagStatus ?? null,
    synced_at: new Date().toISOString(),
    last_modified_at: typeof m.lastModifiedDateTime === "string" ? m.lastModifiedDateTime : null,
    skill_version: SKILL_VERSION,
  };
}

interface BucketRow {
  folder_id: string; month_bucket: string; folder_path: string;
  status: string; messages_fetched: number; pages_done: number;
  // v1.4 — eigenaar + credential van de bijbehorende mail_accounts-rij.
  account_user_id: string | null;
  mailbox_email: string | null;
  composio_user_id: string | null;
  composio_connection_id: string | null;
}

async function claimBucket(supabase: SupabaseClient): Promise<BucketRow | null> {
  const { data, error } = await supabase.rpc("claim_next_backfill_bucket");
  if (error) throw new Error(`claim_rpc_failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  const row = data[0];
  // Postgres date kolommen komen als YYYY-MM-DD strings terug
  return {
    folder_id: row.folder_id, folder_path: row.folder_path,
    month_bucket: typeof row.month_bucket === "string" ? row.month_bucket : new Date(row.month_bucket).toISOString().slice(0, 10),
    status: row.status,
    messages_fetched: row.messages_fetched ?? 0, pages_done: row.pages_done ?? 0,
    account_user_id: row.account_user_id ?? null,
    mailbox_email: row.mailbox_email ?? null,
    composio_user_id: row.composio_user_id ?? null,
    composio_connection_id: row.composio_connection_id ?? null,
  };
}

function addMonthIso(bucketDate: string, n: number): string {
  const d = new Date(bucketDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

async function backfillBucket(
  supabase: SupabaseClient, ctx: ComposioContext, bucket: BucketRow,
  fromAddresses: string[], ownerUserId: string
): Promise<{ upserted: number; status: string; pages: number }> {
  const startIso = bucket.month_bucket + "T00:00:00Z";
  const endIso = addMonthIso(bucket.month_bucket, 1);

  let pagesDoneTotal = bucket.pages_done || 0;
  let pagesThisRun = 0;
  let upsertedThisRun = 0;
  let isFinalPage = false;

  while (pagesThisRun < MAX_PAGES_PER_BUCKET) {
    const skipCount = pagesDoneTotal * TOP_PER_PAGE;
    const args: Record<string, unknown> = {
      user_id: "me", folder: bucket.folder_id,
      top: TOP_PER_PAGE, skip: skipCount,
      select: MESSAGE_SELECT, orderby: ["receivedDateTime asc"],
      received_date_time_ge: startIso, received_date_time_lt: endIso,
    };

    const result = await execTool(ctx, TOOL_LIST_MESSAGES, args);
    const messages = result?.data?.response_data?.value ?? [];

    if (messages.length > 0) {
      const rows = messages.filter((m) => typeof m.id === "string")
        .map((m) => messageRow(m, bucket.folder_id, bucket.folder_path, fromAddresses, ownerUserId));
      if (rows.length > 0) {
        const { error } = await supabase.from("mail_messages").upsert(rows, { onConflict: "id" });
        if (error) throw new Error(`mail_messages_upsert_failed: ${error.message}`);
        upsertedThisRun += rows.length;
      }
    }
    pagesDoneTotal++;
    pagesThisRun++;

    if (messages.length < TOP_PER_PAGE) {
      isFinalPage = true;
      break;
    }
  }

  const newMessagesFetched = (bucket.messages_fetched || 0) + upsertedThisRun;
  const newStatus = isFinalPage
    ? (newMessagesFetched === 0 ? "empty" : "done")
    : "pending";

  await supabase.from("mail_backfill_state").update({
    status: newStatus, messages_fetched: newMessagesFetched,
    pages_done: pagesDoneTotal, last_run_at: new Date().toISOString(), last_error: null,
  }).eq("folder_id", bucket.folder_id).eq("month_bucket", bucket.month_bucket);

  return { upserted: upsertedThisRun, status: newStatus, pages: pagesThisRun };
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

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    triggered_by: triggeredBy, triggered_at: startedAt,
    buckets_processed: [] as Array<{ bucket: string; msgs: number; pages: number; status: string }>,
    total_upserted: 0, warnings: [] as string[],
  };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "mail-backfill", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const apiKey = await composioApiKey(supabase);

    // Alias-adressen zijn globaal; de mailbox zelf komt per bucket erbij.
    // NIET op own_domains matchen — dan zou elke collega op hetzelfde domein
    // is_from_me=true krijgen en het Sent-corpus vervuilen.
    let aliasAddresses: string[] = [];
    const { data: cfg } = await supabase.from("agent_config").select("config_value")
      .eq("agent_name", "mail-sync").eq("config_key", "from_addresses").maybeSingle();
    if (cfg?.config_value && Array.isArray(cfg.config_value)) {
      aliasAddresses = (cfg.config_value as string[]).map((a) => a.toLowerCase());
    }

    let bucketsProcessed = 0;
    while (bucketsProcessed < MAX_BUCKETS_PER_RUN && (Date.now() - startTime) < MAX_WALL_TIME_MS) {
      const bucket = await claimBucket(supabase);
      if (!bucket) break;

      try {
        if (!bucket.account_user_id) throw new Error("bucket_without_owner: mail_backfill_state.user_id leeg");
        // v1.4: credential PER BUCKET — nooit meer één globale connectie over
        // buckets van verschillende mailboxen heen.
        const ctx = await ctxForBucket(supabase, apiKey, bucket);
        const fromAddresses = bucket.mailbox_email
          ? Array.from(new Set([bucket.mailbox_email.toLowerCase(), ...aliasAddresses]))
          : (aliasAddresses.length > 0 ? aliasAddresses : ["burggraaf@legal-mind.nl"]);

        const result = await backfillBucket(supabase, ctx, bucket, fromAddresses, bucket.account_user_id);
        stats.buckets_processed.push({
          bucket: `${bucket.mailbox_email ?? "?"} · ${bucket.folder_path} × ${bucket.month_bucket}`,
          msgs: result.upserted, pages: result.pages, status: result.status,
        });
        stats.total_upserted += result.upserted;
      } catch (bucketErr) {
        const msg = stringifyErr(bucketErr);
        stats.warnings.push(`${bucket.folder_path} × ${bucket.month_bucket}: ${msg.slice(0, 200)}`);
        // Mark bucket als error zodat 'm niet weer geclaimd wordt door stale-detect
        await supabase.from("mail_backfill_state").update({
          status: "error", last_error: msg.slice(0, 500), last_run_at: new Date().toISOString()
        }).eq("folder_id", bucket.folder_id).eq("month_bucket", bucket.month_bucket);
      }
      bucketsProcessed++;
    }

    const summary = bucketsProcessed === 0
      ? "no pending buckets — backfill complete"
      : `${bucketsProcessed} buckets, ${stats.total_upserted} mails upserted in ${Math.round((Date.now() - startTime) / 1000)}s`;
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, stats, summary }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const errMsg = stringifyErr(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }]
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
