// hubspot-sync-etl v1 - HubSpot CRM v3 REST API direct
// TruthOfSource voor HubSpot. Vervangt directe HubSpot-calls vanuit hubspot-daily-sync /
// sales-todos zodra die migreren. Geen Composio (Composio's HubSpot toolkit is OAuth, wij
// gebruiken Private App access_token).
//
// Secrets-storage: agent_config met is_secret=true (consistent met jira-sync-etl).
//   - hubspot-sync-etl.access_token   HubSpot Private App access token (pat-na1-...)
//   - hubspot-sync-etl.client_key     Optioneel, alleen voor OAuth Apps (niet gebruikt door Private)
//   - global.cron_secret              Shared met andere ETL functions
//
// Mirrors:
//   - hubspot_pipelines (pipeline_id PK, label, stages jsonb, sort_order, is_active, ...)
//   - hubspot_users (hubspot_owner_id PK, email, first_name, last_name, full_name, active, is_primary)
//   - hubspot_deals (deal_id PK, dealname, amount, dealstage, pipeline_id, closedate, owner, ...)
//   - hubspot_companies (company_id PK, name, domain, industry, ...)
//   - hubspot_contacts (contact_id PK, email, firstname, lastname, company, ...)
//   - hubspot_sync_state (singleton id=1)
//
// Trigger: pg_cron `*/30 * * * *` (elke 30 min).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "hubspot-edge-fn-v1";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_OBJECT = 20; // 2000 records max per object per run (safety)
const FULL_SYNC_INTERVAL_HOURS = 24;

const DEAL_PROPERTIES = [
  "dealname", "amount", "dealstage", "pipeline", "closedate", "createdate",
  "hs_lastmodifieddate", "hubspot_owner_id", "dealtype",
];
const COMPANY_PROPERTIES = [
  "name", "domain", "industry", "lifecyclestage", "numberofemployees", "city", "country",
  "hubspot_owner_id", "createdate", "hs_lastmodifieddate",
];
const CONTACT_PROPERTIES = [
  "email", "firstname", "lastname", "company", "jobtitle", "phone", "lifecyclestage",
  "hubspot_owner_id", "createdate", "hs_lastmodifieddate",
];

interface HubSpotContext {
  accessToken: string;
  authHeader: string;
  baseUrl: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<HubSpotContext> {
  const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
  if (!accessToken) throw new Error("hubspot_access_token_missing in agent_config(hubspot-sync-etl, access_token)");
  return {
    accessToken,
    authHeader: `Bearer ${accessToken}`,
    baseUrl: "https://api.hubapi.com",
  };
}

async function hsFetch(ctx: HubSpotContext, path: string, init?: RequestInit, retry = 0): Promise<unknown> {
  const url = `${ctx.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: ctx.authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [3000, 10000, 30000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return hsFetch(ctx, path, init, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`hs_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`hs_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`); }
}

// ── Owners ──────────────────────────────────────────────────────────────────
interface HsOwner {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  userId?: number;
  archived?: boolean;
}

async function syncOwners(supabase: SupabaseClient, ctx: HubSpotContext): Promise<number> {
  let after: string | null = null;
  let total = 0;
  let safety = 0;
  while (safety++ < MAX_PAGES_PER_OBJECT) {
    const path = `/crm/v3/owners?limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ""}&archived=false`;
    const res = await hsFetch(ctx, path) as { results?: HsOwner[]; paging?: { next?: { after?: string } } };
    const owners = res.results ?? [];
    if (owners.length === 0) break;

    const rows = owners.map((o) => ({
      hubspot_owner_id: o.id,
      email: o.email ?? null,
      first_name: o.firstName ?? null,
      last_name: o.lastName ?? null,
      // full_name is GENERATED in DB — niet zelf zetten
      active: o.archived !== true,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("hubspot_users").upsert(rows, { onConflict: "hubspot_owner_id" });
    if (error) throw new Error(`hubspot_users_upsert_failed: ${error.message}`);
    total += rows.length;

    const nextAfter = res.paging?.next?.after;
    if (!nextAfter) break;
    after = nextAfter;
  }
  return total;
}

// ── Pipelines ───────────────────────────────────────────────────────────────
interface HsPipeline {
  id: string;
  label: string;
  displayOrder?: number;
  stages?: Array<{ id: string; label: string; displayOrder?: number; metadata?: Record<string, string> }>;
  archived?: boolean;
}

async function syncPipelines(supabase: SupabaseClient, ctx: HubSpotContext): Promise<number> {
  const res = await hsFetch(ctx, "/crm/v3/pipelines/deals") as { results?: HsPipeline[] };
  const pipes = res.results ?? [];
  if (pipes.length === 0) return 0;

  const rows = pipes.map((p) => ({
    pipeline_id: p.id,
    label: p.label,
    sort_order: p.displayOrder ?? 0,
    is_active: p.archived !== true,
    stages: (p.stages ?? []).map((s) => ({
      id: s.id, label: s.label, displayOrder: s.displayOrder ?? 0,
      probability: s.metadata?.probability ?? null,
      isClosed: s.metadata?.isClosed === "true",
    })),
    updated_at: new Date().toISOString(),
    updated_by: SKILL_VERSION,
  }));
  const { error } = await supabase.from("hubspot_pipelines").upsert(rows, { onConflict: "pipeline_id" });
  if (error) throw new Error(`hubspot_pipelines_upsert_failed: ${error.message}`);
  return rows.length;
}

// ── Search-based sync (deals / companies / contacts) ────────────────────────
interface HsSearchResponse {
  results?: Array<{ id: string; properties: Record<string, string | null>; archived?: boolean }>;
  paging?: { next?: { after?: string } };
  total?: number;
}

async function searchObjects(
  ctx: HubSpotContext,
  objectType: "deals" | "companies" | "contacts",
  properties: string[],
  modifiedSinceMs: number | null,
): Promise<Array<{ id: string; properties: Record<string, string | null> }>> {
  const all: Array<{ id: string; properties: Record<string, string | null> }> = [];
  let after: string | null = null;
  let safety = 0;

  // Filter: hs_lastmodifieddate >= since (ms timestamp). Bij full sync: geen filter.
  const filterGroups = modifiedSinceMs !== null
    ? [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(modifiedSinceMs) }] }]
    : [];

  while (safety++ < MAX_PAGES_PER_OBJECT) {
    const body = {
      filterGroups,
      properties,
      limit: PAGE_SIZE,
      after: after ?? "0",
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    };
    const res = await hsFetch(ctx, `/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as HsSearchResponse;
    const batch = res.results ?? [];
    if (batch.length === 0) break;
    for (const r of batch) all.push({ id: r.id, properties: r.properties });

    const nextAfter = res.paging?.next?.after;
    if (!nextAfter) break;
    after = nextAfter;
  }
  return all;
}

function tsParse(v: string | null | undefined): string | null {
  if (!v) return null;
  // HubSpot returneert ISO strings of millisecond timestamps.
  const n = Number(v);
  if (!Number.isNaN(n) && /^\d{10,16}$/.test(v.trim())) {
    return new Date(n).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numParse(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

async function syncDeals(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null): Promise<number> {
  const items = await searchObjects(ctx, "deals", DEAL_PROPERTIES, modifiedSinceMs);
  if (items.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    deal_id: it.id,
    dealname: it.properties.dealname,
    amount: numParse(it.properties.amount),
    dealstage: it.properties.dealstage,
    pipeline_id: it.properties.pipeline,
    closedate: tsParse(it.properties.closedate),
    hubspot_owner_id: it.properties.hubspot_owner_id,
    dealtype: it.properties.dealtype,
    hs_created_at: tsParse(it.properties.createdate),
    hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
    properties: it.properties,
    is_archived: false,
    synced_at: now,
  }));
  const { error } = await supabase.from("hubspot_deals").upsert(rows, { onConflict: "deal_id" });
  if (error) throw new Error(`hubspot_deals_upsert_failed: ${error.message}`);
  return rows.length;
}

async function syncCompanies(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null): Promise<number> {
  const items = await searchObjects(ctx, "companies", COMPANY_PROPERTIES, modifiedSinceMs);
  if (items.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    company_id: it.id,
    name: it.properties.name,
    domain: it.properties.domain,
    industry: it.properties.industry,
    lifecyclestage: it.properties.lifecyclestage,
    num_employees: numParse(it.properties.numberofemployees) !== null ? Math.round(numParse(it.properties.numberofemployees)!) : null,
    city: it.properties.city,
    country: it.properties.country,
    hubspot_owner_id: it.properties.hubspot_owner_id,
    hs_created_at: tsParse(it.properties.createdate),
    hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
    properties: it.properties,
    is_archived: false,
    synced_at: now,
  }));
  const { error } = await supabase.from("hubspot_companies").upsert(rows, { onConflict: "company_id" });
  if (error) throw new Error(`hubspot_companies_upsert_failed: ${error.message}`);
  return rows.length;
}

async function syncContacts(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null): Promise<number> {
  const items = await searchObjects(ctx, "contacts", CONTACT_PROPERTIES, modifiedSinceMs);
  if (items.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = items.map((it) => ({
    contact_id: it.id,
    email: it.properties.email,
    firstname: it.properties.firstname,
    lastname: it.properties.lastname,
    company: it.properties.company,
    jobtitle: it.properties.jobtitle,
    phone: it.properties.phone,
    lifecyclestage: it.properties.lifecyclestage,
    hubspot_owner_id: it.properties.hubspot_owner_id,
    hs_created_at: tsParse(it.properties.createdate),
    hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
    properties: it.properties,
    is_archived: false,
    synced_at: now,
  }));
  const { error } = await supabase.from("hubspot_contacts").upsert(rows, { onConflict: "contact_id" });
  if (error) throw new Error(`hubspot_contacts_upsert_failed: ${error.message}`);
  return rows.length;
}

// ── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // Allow ?mode=full query-param to force full sync (smoke-test convenience)
  const url = new URL(req.url);
  const forceFull = url.searchParams.get("mode") === "full";

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    triggered_by: triggeredBy, triggered_at: startedAt,
    sync_mode: "delta" as "delta" | "full",
    owners_upserted: 0, pipelines_upserted: 0,
    deals_upserted: 0, companies_upserted: 0, contacts_upserted: 0,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "hubspot-sync", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);

    // Bepaal full vs delta
    const { data: state } = await supabase.from("hubspot_sync_state").select("*").eq("id", 1).maybeSingle();
    const needsFull = forceFull
      || !state
      || !state.last_full_sync
      || new Date(state.last_full_sync).getTime() < Date.now() - FULL_SYNC_INTERVAL_HOURS * 3_600_000;

    let modifiedSinceMs: number | null;
    if (needsFull) {
      modifiedSinceMs = null;
      stats.sync_mode = "full";
    } else {
      const since = new Date((state!.last_delta_sync as string) ?? Date.now() - 3_600_000);
      // Trek 5 min af voor lichte overlap (eventual consistency)
      modifiedSinceMs = since.getTime() - 5 * 60 * 1000;
      stats.sync_mode = "delta";
    }

    // 1. Owners (light, full elke run — kleine set)
    stats.owners_upserted = await syncOwners(supabase, ctx);

    // 2. Pipelines (light, full elke run — kleine set)
    stats.pipelines_upserted = await syncPipelines(supabase, ctx);

    // 3. Deals
    stats.deals_upserted = await syncDeals(supabase, ctx, modifiedSinceMs);

    // 4. Companies
    stats.companies_upserted = await syncCompanies(supabase, ctx, modifiedSinceMs);

    // 5. Contacts
    stats.contacts_upserted = await syncContacts(supabase, ctx, modifiedSinceMs);

    // 6. State update
    const stateRow: Record<string, unknown> = {
      id: 1,
      last_delta_sync: new Date().toISOString(),
      total_owners: stats.owners_upserted,
      total_pipelines: stats.pipelines_upserted,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    };
    if (needsFull) {
      stateRow.last_full_sync = new Date().toISOString();
      stateRow.total_deals = stats.deals_upserted;
      stateRow.total_companies = stats.companies_upserted;
      stateRow.total_contacts = stats.contacts_upserted;
    }
    const { error: stateErr } = await supabase.from("hubspot_sync_state").upsert(stateRow, { onConflict: "id" });
    if (stateErr) throw new Error(`hubspot_sync_state_upsert_failed: ${stateErr.message}`);

    const summary = `${stats.sync_mode}: ${stats.owners_upserted} owners, ${stats.pipelines_upserted} pipelines, ${stats.deals_upserted} deals, ${stats.companies_upserted} companies, ${stats.contacts_upserted} contacts`;
    await supabase.from("agent_runs").update({
      status: "success", completed_at: new Date().toISOString(), summary, stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }],
    }).eq("id", runId);
    // Persist the error in sync_state so dashboard sees it
    await supabase.from("hubspot_sync_state").upsert({
      id: 1, last_error: errMsg.slice(0, 500), last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
