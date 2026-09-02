// outlook-calendar-sync-etl v1.0 - Composio + agent_config
// Pulls Outlook calendar events into calendar_events / calendar_attendees mirror.
// Delta = lastModifiedDateTime ge <last_delta - 5min>; full = start/dateTime ge <now - FULL_WINDOW_MONTHS>.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";
import { claimMailAccount, finishMailAccountClaim } from "../_shared/mail-account.ts";
const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
const SKILL_VERSION = "calendar-edge-fn-v1.0";
const TOOL_LIST_EVENTS = "OUTLOOK_OUTLOOK_LIST_EVENTS";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 30;
const FULL_WINDOW_MONTHS_BACK = 12;
const FULL_WINDOW_MONTHS_FWD = 6;
const FULL_REFRESH_HOURS = 24;
const DELTA_OVERLAP_MIN = 5;
const BODY_BYTE_CAP = 50_000;
const SELECT_FIELDS = [
  "id",
  "iCalUId",
  "subject",
  "bodyPreview",
  "body",
  "start",
  "end",
  "isAllDay",
  "location",
  "onlineMeeting",
  "organizer",
  "isOrganizer",
  "responseStatus",
  "showAs",
  "importance",
  "categories",
  "isCancelled",
  "recurrence",
  "seriesMasterId",
  "type",
  "attendees",
  "lastModifiedDateTime",
  "webLink"
];
async function getCfg(supabase, agentName, key) {
  // Vault first (canonical for secrets), agent_config fallback (non-secret config)
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}
// v1.1 (2026-09-02): de connectie komt uit het geclaimde mail_accounts-record
// (claim_next_mail_account('calendar')) i.p.v. uit agent_config. De API-key
// blijft globaal. Zie MAIL-PIPELINE.md §3.2.
async function buildCtx(supabase, account) {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");
  const userId = account.composio_user_id
    ?? await getCfg(supabase, "outlook-calendar-sync-etl", "composio_user_id")
    ?? await getCfg(supabase, "global", "composio_user_id") ?? "user-jelle";
  // Re-use mail-sync connection unless calendar-specific one configured.
  const connectionId = account.composio_connection_id
    ?? await getCfg(supabase, "outlook-calendar-sync-etl", "composio_connection_id")
    ?? await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id");
  if (!connectionId) throw new Error(`composio_connection_id_missing for ${account.mailbox_email ?? account.user_id}`);
  return {
    apiKey,
    userId,
    connectionId
  };
}
async function execTool(ctx, toolName, toolArgs, retry = 0) {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ctx.apiKey
    },
    body: JSON.stringify({
      user_id: ctx.userId,
      connected_account_id: ctx.connectionId,
      arguments: toolArgs
    })
  });
  if (res.status === 429 && retry < 3) {
    const delays = [
      5000,
      15000,
      45000
    ];
    await new Promise((r)=>setTimeout(r, delays[retry]));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch  {
    throw new Error(`composio_non_json_${toolName}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`composio_http_${res.status}_${toolName}: ${body?.error ?? text.slice(0, 200)}`);
  return body;
}
function extractEvents(result) {
  // Composio responses can wrap data variably. Walk to find an array of events.
  const candidates = [
    result?.data,
    result?.data?.response_data,
    result?.data?.response_data?.value,
    result?.data?.value
  ];
  for (const c of candidates){
    if (Array.isArray(c)) return c;
  }
  // If response_data is a single object with .value
  const rd = result?.data?.response_data;
  if (rd && typeof rd === "object" && !Array.isArray(rd)) {
    const v = rd.value;
    if (Array.isArray(v)) return v;
  }
  return [];
}
function capBody(content) {
  if (typeof content !== "string" || !content) return null;
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return content;
  let cap = content;
  while(new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP)cap = cap.slice(0, Math.floor(cap.length * 0.95));
  return cap;
}
function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function pickEmail(rec) {
  if (!rec || typeof rec !== "object") return null;
  const ea = rec.emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const addr = ea.address;
  return typeof addr === "string" ? addr.toLowerCase() : null;
}
function pickName(rec) {
  if (!rec || typeof rec !== "object") return null;
  const ea = rec.emailAddress;
  if (!ea || typeof ea !== "object") return null;
  const name = ea.name;
  return typeof name === "string" ? name : null;
}
function mapEventRow(e, ownerUserId) {
  const id = typeof e.id === "string" ? e.id : null;
  if (!id) return null;
  const start = e.start;
  const end = e.end;
  const startIso = start?.dateTime ? new Date(start.dateTime + (start.dateTime.endsWith("Z") ? "" : "Z")).toISOString() : null;
  const endIso = end?.dateTime ? new Date(end.dateTime + (end.dateTime.endsWith("Z") ? "" : "Z")).toISOString() : null;
  const location = e.location;
  const online = e.onlineMeeting;
  const organizer = e.organizer;
  const responseStatus = e.responseStatus;
  const body = e.body;
  const bodyText = body?.contentType === "html" ? stripHtml(body?.content ?? null) : body?.content ?? null;
  const recurrenceType = typeof e.type === "string" ? e.type : null;
  return {
    graph_id: id,
    user_id: ownerUserId,   // v1.1: expliciet, niet via kolom-DEFAULT
    ical_uid: typeof e.iCalUId === "string" ? e.iCalUId : null,
    subject: typeof e.subject === "string" ? e.subject : null,
    body_preview: typeof e.bodyPreview === "string" ? e.bodyPreview : null,
    body_text: capBody(bodyText),
    start_time: startIso,
    end_time: endIso,
    is_all_day: e.isAllDay === true,
    location_text: typeof location?.displayName === "string" ? location.displayName : null,
    online_meeting_url: typeof online?.joinUrl === "string" ? online.joinUrl : null,
    organizer_email: pickEmail(organizer),
    organizer_name: pickName(organizer),
    is_organizer: e.isOrganizer === true,
    response_status: typeof responseStatus?.response === "string" ? responseStatus.response : null,
    show_as: typeof e.showAs === "string" ? e.showAs : null,
    importance: typeof e.importance === "string" ? e.importance : null,
    categories: Array.isArray(e.categories) ? e.categories : null,
    is_cancelled: e.isCancelled === true,
    is_recurring: recurrenceType === "seriesMaster" || recurrenceType === "occurrence" || !!e.recurrence,
    series_master_id: typeof e.seriesMasterId === "string" ? e.seriesMasterId : null,
    raw: e,
    last_modified_at: typeof e.lastModifiedDateTime === "string" ? e.lastModifiedDateTime : null,
    updated_at: new Date().toISOString()
  };
}
function extractAttendeeRows(eventGraphId, eventRaw) {
  const list = Array.isArray(eventRaw.attendees) ? eventRaw.attendees : [];
  const rows = [];
  const organizer = eventRaw.organizer;
  const orgEmail = pickEmail(organizer);
  for (const a of list){
    const email = pickEmail(a);
    if (!email) continue;
    const status = a.status;
    rows.push({
      graph_id: eventGraphId,
      email,
      name: pickName(a),
      attendee_type: typeof a.type === "string" ? a.type : null,
      response_status: typeof status?.response === "string" ? status.response : null,
      is_organizer: orgEmail === email
    });
  }
  if (orgEmail && !rows.some((r)=>r.email === orgEmail)) {
    rows.push({
      graph_id: eventGraphId,
      email: orgEmail,
      name: pickName(organizer),
      attendee_type: "organizer",
      response_status: null,
      is_organizer: true
    });
  }
  return rows;
}
async function syncEvents(supabase, ctx, mode, state, ownerUserId) {
  let filter;
  if (mode === "full") {
    const back = new Date();
    back.setMonth(back.getMonth() - FULL_WINDOW_MONTHS_BACK);
    const fwd = new Date();
    fwd.setMonth(fwd.getMonth() + FULL_WINDOW_MONTHS_FWD);
    filter = `start/dateTime ge '${back.toISOString().slice(0, 19)}Z' and start/dateTime le '${fwd.toISOString().slice(0, 19)}Z'`;
  } else {
    const since = state?.last_delta_sync_at ? new Date(state.last_delta_sync_at) : new Date(Date.now() - 30 * 60_000);
    since.setMinutes(since.getMinutes() - DELTA_OVERLAP_MIN);
    filter = `lastModifiedDateTime ge '${since.toISOString().slice(0, 19)}Z'`;
  }
  let totalUpserted = 0;
  let pages = 0;
  for(let skip = 0; pages < MAX_PAGES_PER_RUN; skip += PAGE_SIZE){
    const args = {
      user_id: "me",
      top: PAGE_SIZE,
      skip,
      filter,
      select: SELECT_FIELDS,
      orderby: [
        "lastModifiedDateTime desc"
      ],
      timezone: "UTC",
      expand_recurring_events: false
    };
    const result = await execTool(ctx, TOOL_LIST_EVENTS, args);
    const events = extractEvents(result);
    pages++;
    if (events.length === 0) break;
    const rows = [];
    const attendeeRows = [];
    for (const e of events){
      const row = mapEventRow(e, ownerUserId);
      if (!row) continue;
      rows.push(row);
      attendeeRows.push(...extractAttendeeRows(row.graph_id, e));
    }
    if (rows.length > 0) {
      const { error } = await supabase.from("calendar_events").upsert(rows, {
        onConflict: "graph_id"
      });
      if (error) throw new Error(`calendar_events_upsert_failed: ${error.message}`);
      totalUpserted += rows.length;
    }
    if (attendeeRows.length > 0) {
      // Resolve calendar_event_id by graph_id via a single round-trip
      const graphIds = Array.from(new Set(attendeeRows.map((r)=>r.graph_id)));
      const { data: idMap } = await supabase.from("calendar_events").select("id, graph_id").eq("user_id", ownerUserId).in("graph_id", graphIds);
      const idByGraph = new Map();
      for (const r of idMap ?? [])idByGraph.set(r.graph_id, r.id);
      const resolved = attendeeRows.map((a)=>({
          ...a,
          calendar_event_id: idByGraph.get(a.graph_id) ?? null
        })).filter((a)=>a.calendar_event_id);
      if (resolved.length > 0) {
        const { error: aErr } = await supabase.from("calendar_attendees").upsert(resolved, {
          onConflict: "graph_id,email"
        });
        if (aErr) throw new Error(`calendar_attendees_upsert_failed: ${aErr.message}`);
      }
    }
    if (events.length < PAGE_SIZE) break;
  }
  return {
    upserted: totalUpserted,
    pages
  };
}
Deno.serve(async (req)=>{
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = await getCfg(supabase, "global", "cron_secret") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({
      error: "unauthorized"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const url = new URL(req.url);
  const forceFull = url.searchParams.get("mode") === "full";
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    sync_mode: "delta",
    events_upserted: 0,
    pages: 0,
    warnings: []
  };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "outlook-calendar-sync",
    run_type: "edge_function",
    status: "running",
    started_at: startedAt,
    stats,
    errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, {
    status: 500
  });
  const runId = runIns.id;
  let account = null;
  try {
    // v1.1: één mailbox per invocatie, round-robin via de registry.
    account = await claimMailAccount(supabase, "calendar", "outlook-calendar-sync-etl");
    if (!account) {
      stats.warnings.push("no_claimable_account");
      await supabase.from("agent_runs").update({
        status: "warning",
        completed_at: new Date().toISOString(),
        summary: "geen claimbaar mail_account",
        stats
      }).eq("id", runId);
      return new Response(JSON.stringify({ ok: true, runId, skipped: true, reason: "no_claimable_account" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    const ownerUserId = account.user_id;
    stats.mailbox_email = account.mailbox_email;
    stats.account_user_id = ownerUserId;
    stats.account_source = account.from_registry ? "mail_accounts" : "agent_config_fallback";

    const ctx = await buildCtx(supabase, account);
    // v1.1: de watermark hangt aan user_id, niet meer aan de vaste rij id=1
    // (migratie F voegde unique (user_id) toe). Anders zou mailbox #2 de
    // delta-watermark van mailbox #1 overschrijven — geen error, wel gemiste
    // of dubbel gelezen events.
    const { data: state } = await supabase.from("calendar_sync_state").select("*").eq("user_id", ownerUserId).maybeSingle();
    const needsFull = forceFull || !state?.last_full_sync_at || new Date(state.last_full_sync_at).getTime() < Date.now() - FULL_REFRESH_HOURS * 3_600_000;
    stats.sync_mode = needsFull ? "full" : "delta";
    const { upserted, pages } = await syncEvents(supabase, ctx, stats.sync_mode, state ?? null, ownerUserId);
    stats.events_upserted = upserted;
    stats.pages = pages;
    const stateRow = {
      user_id: ownerUserId,
      last_delta_sync_at: new Date().toISOString(),
      last_events_count: upserted,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString()
    };
    if (needsFull) stateRow.last_full_sync_at = new Date().toISOString();
    const { error: stateErr } = await supabase.from("calendar_sync_state").upsert(stateRow, {
      onConflict: "user_id"
    });
    if (stateErr) throw new Error(`calendar_sync_state_upsert_failed: ${stateErr.message}`);
    const summary = `${account.mailbox_email ? account.mailbox_email + ": " : ""}${stats.sync_mode}: ${upserted} events over ${pages} page(s)`;
    await finishMailAccountClaim(supabase, account, null);
    await supabase.from("agent_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      summary,
      stats
    }).eq("id", runId);
    return new Response(JSON.stringify({
      ok: true,
      runId,
      stats
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await finishMailAccountClaim(supabase, account, errMsg.slice(0, 300));
    if (account?.user_id) {
      await supabase.from("calendar_sync_state").upsert({
        user_id: account.user_id,
        last_error: errMsg.slice(0, 500),
        last_error_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: "user_id"
      });
    }
    await supabase.from("agent_runs").update({
      status: "error",
      completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500),
      stats,
      errors: [
        {
          message: errMsg,
          at: new Date().toISOString()
        }
      ]
    }).eq("id", runId);
    return new Response(JSON.stringify({
      ok: false,
      error: errMsg
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
