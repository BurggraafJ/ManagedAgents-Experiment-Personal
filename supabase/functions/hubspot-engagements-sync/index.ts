// hubspot-engagements-sync v1.2 - cursor-state voor full-sync continuation
// v1.2: paging_cursor in state-tabel voor doorpaging tussen runs (fix voor v1.1 die telkens top-1000 pakte)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";
const SKILL_VERSION = "hubspot-engagements-sync-v1.2";
const PAGE_SIZE = 100;
const MAX_PAGES_DEFAULT = 20;
const MAX_PAGES_EMAILS = 10;
const MAX_WALL_TIME_MS = 90_000;
const SAFETY_MARGIN_MS = 15_000;
const BODY_BYTE_CAP = 100_000;
const FULL_SYNC_INTERVAL_HOURS = 24;
const ENGAGEMENT_CONFIGS = [
  {
    type: "calls",
    apiPath: "calls",
    properties: [
      "hs_call_title",
      "hs_call_body",
      "hs_call_duration",
      "hs_call_direction",
      "hs_call_status",
      "hs_call_disposition",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_createdate",
      "hs_lastmodifieddate"
    ],
    bodyField: "hs_call_body",
    subjectField: "hs_call_title",
    timestampField: "hs_timestamp",
    skipAssociations: false,
    maxPages: MAX_PAGES_DEFAULT
  },
  {
    type: "emails",
    apiPath: "emails",
    properties: [
      "hs_email_subject",
      "hs_email_text",
      "hs_email_html",
      "hs_email_direction",
      "hs_email_status",
      "hs_email_from_email",
      "hs_email_to_email",
      "hs_email_cc_email",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_createdate",
      "hs_lastmodifieddate"
    ],
    bodyField: "hs_email_text",
    subjectField: "hs_email_subject",
    timestampField: "hs_timestamp",
    skipAssociations: true,
    maxPages: MAX_PAGES_EMAILS
  },
  {
    type: "meetings",
    apiPath: "meetings",
    properties: [
      "hs_meeting_title",
      "hs_meeting_body",
      "hs_meeting_start_time",
      "hs_meeting_end_time",
      "hs_meeting_outcome",
      "hs_meeting_location",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_createdate",
      "hs_lastmodifieddate"
    ],
    bodyField: "hs_meeting_body",
    subjectField: "hs_meeting_title",
    timestampField: "hs_timestamp",
    skipAssociations: false,
    maxPages: MAX_PAGES_DEFAULT
  },
  {
    type: "notes",
    apiPath: "notes",
    properties: [
      "hs_note_body",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_createdate",
      "hs_lastmodifieddate"
    ],
    bodyField: "hs_note_body",
    subjectField: null,
    timestampField: "hs_timestamp",
    skipAssociations: false,
    maxPages: MAX_PAGES_DEFAULT
  },
  {
    type: "tasks",
    apiPath: "tasks",
    properties: [
      "hs_task_subject",
      "hs_task_body",
      "hs_task_status",
      "hs_task_priority",
      "hs_task_type",
      "hs_timestamp",
      "hubspot_owner_id",
      "hs_createdate",
      "hs_lastmodifieddate"
    ],
    bodyField: "hs_task_body",
    subjectField: "hs_task_subject",
    timestampField: "hs_timestamp",
    skipAssociations: false,
    maxPages: MAX_PAGES_DEFAULT
  }
];
async function getCfg(supabase, agentName, key) {
  // Vault first (canonical for secrets), agent_config fallback (non-secret config)
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}
async function buildCtx(supabase) {
  const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
  if (!accessToken) throw new Error("hubspot_access_token_missing");
  return {
    accessToken,
    authHeader: `Bearer ${accessToken}`,
    baseUrl: "https://api.hubapi.com"
  };
}
async function hsFetch(ctx, path, init, retry = 0) {
  const url = `${ctx.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: ctx.authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers ?? {}
    }
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [
      3000,
      10000,
      30000
    ];
    await new Promise((r)=>setTimeout(r, delays[retry]));
    return hsFetch(ctx, path, init, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`hs_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch  {
    throw new Error(`hs_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`);
  }
}
function tsParse(v) {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isNaN(n) && /^\d{10,16}$/.test(String(v).trim())) return new Date(n).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function capBody(content) {
  if (typeof content !== "string" || !content) return {
    body: null,
    truncated: false,
    byteSize: null
  };
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes <= BODY_BYTE_CAP) return {
    body: content,
    truncated: false,
    byteSize: bytes
  };
  let cap = content;
  while(new TextEncoder().encode(cap).byteLength > BODY_BYTE_CAP)cap = cap.slice(0, Math.floor(cap.length * 0.95));
  return {
    body: cap,
    truncated: true,
    byteSize: bytes
  };
}
async function searchEngagements(ctx, cfg, modifiedSinceMs, initialCursor, startTime) {
  const all = [];
  let after = initialCursor ?? "0";
  let safety = 0;
  let lastNext = null;
  let reachedEnd = false;
  const filterGroups = modifiedSinceMs !== null ? [
    {
      filters: [
        {
          propertyName: "hs_lastmodifieddate",
          operator: "GTE",
          value: String(modifiedSinceMs)
        }
      ]
    }
  ] : [];
  while(safety++ < cfg.maxPages && Date.now() - startTime < MAX_WALL_TIME_MS - SAFETY_MARGIN_MS){
    const body = {
      filterGroups,
      properties: cfg.properties,
      limit: PAGE_SIZE,
      after,
      sorts: [
        {
          propertyName: "hs_lastmodifieddate",
          direction: "DESCENDING"
        }
      ]
    };
    const res = await hsFetch(ctx, `/crm/v3/objects/${cfg.apiPath}/search`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    const batch = res.results ?? [];
    if (batch.length === 0) {
      reachedEnd = true;
      break;
    }
    for (const r of batch)all.push(r);
    const nextAfter = res.paging?.next?.after;
    if (!nextAfter) {
      reachedEnd = true;
      lastNext = null;
      break;
    }
    lastNext = nextAfter;
    after = nextAfter;
  }
  return {
    items: all,
    nextCursor: reachedEnd ? null : lastNext,
    reachedEnd
  };
}
async function batchReadAssociations(ctx, fromObjectType, toObjectType, fromIds) {
  const result = new Map();
  if (fromIds.length === 0) return result;
  const chunkSize = 100;
  for(let i = 0; i < fromIds.length; i += chunkSize){
    const chunk = fromIds.slice(i, i + chunkSize);
    const body = {
      inputs: chunk.map((id)=>({
          id
        }))
    };
    const res = await hsFetch(ctx, `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    for (const r of res.results ?? [])result.set(r.from.id, (r.to ?? []).map((t)=>t.toObjectId));
  }
  return result;
}
function toEngagementType(typeKey) {
  if (typeKey.endsWith("s")) return typeKey.slice(0, -1);
  return typeKey;
}
async function syncOneType(supabase, ctx, cfg, modifiedSinceMs, initialCursor, startTime) {
  const { items, nextCursor, reachedEnd } = await searchEngagements(ctx, cfg, modifiedSinceMs, initialCursor, startTime);
  if (items.length === 0) return {
    upserted: 0,
    pages: 0,
    nextCursor,
    reachedEnd
  };
  const ids = items.map((it)=>it.id);
  let companyAssoc, contactAssoc, dealAssoc;
  if (cfg.skipAssociations) {
    companyAssoc = new Map();
    contactAssoc = new Map();
    dealAssoc = new Map();
  } else {
    [companyAssoc, contactAssoc, dealAssoc] = await Promise.all([
      batchReadAssociations(ctx, cfg.apiPath, "companies", ids),
      batchReadAssociations(ctx, cfg.apiPath, "contacts", ids),
      batchReadAssociations(ctx, cfg.apiPath, "deals", ids)
    ]);
  }
  const now = new Date().toISOString();
  const engagementType = toEngagementType(cfg.type);
  const rows = items.map((it)=>{
    const props = it.properties ?? {};
    const subject = cfg.subjectField ? props[cfg.subjectField] ?? null : null;
    const bodyRaw = cfg.bodyField ? props[cfg.bodyField] : null;
    const bodyCapped = capBody(bodyRaw);
    const tsRaw = cfg.timestampField ? props[cfg.timestampField] : null;
    const typeSpecific = {};
    for (const k of cfg.properties){
      if (k === cfg.bodyField || k === cfg.subjectField || k === cfg.timestampField) continue;
      if (k === "hubspot_owner_id" || k === "hs_createdate" || k === "hs_lastmodifieddate") continue;
      if (props[k] !== null && props[k] !== undefined && props[k] !== "") typeSpecific[k] = props[k];
    }
    return {
      id: it.id,
      engagement_type: engagementType,
      subject,
      body_text: bodyCapped.body,
      body_truncated: bodyCapped.truncated,
      body_byte_size: bodyCapped.byteSize,
      hs_timestamp: tsParse(tsRaw),
      hs_created_at: tsParse(props["hs_createdate"]),
      hs_lastmodified_at: tsParse(props["hs_lastmodifieddate"]),
      hubspot_owner_id: props["hubspot_owner_id"] ?? null,
      associated_company_ids: companyAssoc.get(it.id) ?? [],
      associated_contact_ids: contactAssoc.get(it.id) ?? [],
      associated_deal_ids: dealAssoc.get(it.id) ?? [],
      type_specific: Object.keys(typeSpecific).length > 0 ? typeSpecific : null,
      properties: props,
      is_archived: false,
      synced_at: now,
      skill_version: SKILL_VERSION
    };
  });
  const upsertBatchSize = 500;
  for(let i = 0; i < rows.length; i += upsertBatchSize){
    const batch = rows.slice(i, i + upsertBatchSize);
    const { error } = await supabase.from("hubspot_engagements").upsert(batch, {
      onConflict: "id"
    });
    if (error) throw new Error(`hubspot_engagements_upsert_failed: ${error.message}`);
  }
  return {
    upserted: rows.length,
    pages: Math.ceil(rows.length / PAGE_SIZE),
    nextCursor,
    reachedEnd
  };
}
Deno.serve(async (req)=>{
  const startTime = Date.now();
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
  const typeFilter = url.searchParams.get("type");
  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    sync_mode: "delta",
    per_type: {},
    total_upserted: 0,
    warnings: []
  };
  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "hubspot-engagements-sync",
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
  try {
    const ctx = await buildCtx(supabase);
    const { data: stateRows } = await supabase.from("hubspot_engagements_sync_state").select("*");
    const stateByType = new Map();
    for (const r of stateRows ?? [])stateByType.set(r.engagement_type, r);
    const cfgsToRun = typeFilter ? ENGAGEMENT_CONFIGS.filter((c)=>c.type === typeFilter) : ENGAGEMENT_CONFIGS;
    for (const cfg of cfgsToRun){
      if (Date.now() - startTime >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
        stats.warnings.push(`wall_time_skip_${cfg.type}`);
        continue;
      }
      const state = stateByType.get(cfg.type);
      const hasOpenCursor = !!state?.paging_cursor;
      const needsFull = forceFull || !state?.last_full_sync || hasOpenCursor || new Date(state.last_full_sync).getTime() < Date.now() - FULL_SYNC_INTERVAL_HOURS * 3_600_000;
      const initialCursor = needsFull && hasOpenCursor ? state.paging_cursor : null;
      const modifiedSinceMs = needsFull ? null : new Date(state?.last_delta_sync ?? Date.now() - 3_600_000).getTime() - 5 * 60 * 1000;
      try {
        const result = await syncOneType(supabase, ctx, cfg, modifiedSinceMs, initialCursor, startTime);
        stats.per_type[cfg.type] = {
          upserted: result.upserted,
          pages: result.pages,
          mode: needsFull ? "full" : "delta",
          cursor: result.nextCursor,
          done: result.reachedEnd
        };
        stats.total_upserted += result.upserted;
        const newTotal = (state?.total ?? 0) + result.upserted;
        const stateUpdate = {
          engagement_type: cfg.type,
          last_delta_sync: new Date().toISOString(),
          total: newTotal,
          last_error: null,
          last_error_at: null,
          paging_cursor: result.nextCursor,
          updated_at: new Date().toISOString()
        };
        if (needsFull && result.reachedEnd) stateUpdate.last_full_sync = new Date().toISOString();
        await supabase.from("hubspot_engagements_sync_state").upsert(stateUpdate, {
          onConflict: "engagement_type"
        });
      } catch (typeErr) {
        const msg = typeErr instanceof Error ? typeErr.message : String(typeErr);
        stats.warnings.push(`${cfg.type}: ${msg.slice(0, 200)}`);
        await supabase.from("hubspot_engagements_sync_state").update({
          last_error: msg.slice(0, 500),
          last_error_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }).eq("engagement_type", cfg.type);
      }
    }
    if (forceFull) stats.sync_mode = "full";
    const summary = `${stats.sync_mode}: ${stats.total_upserted} engagements, ` + Object.entries(stats.per_type).map(([t, d])=>`${t}=${d.upserted}${d.done ? "✓" : "…"}`).join(", ");
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    await supabase.from("agent_runs").update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      summary,
      stats
    }).eq("id", runId);
    return new Response(JSON.stringify({
      ok: true,
      runId,
      stats,
      summary
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
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
