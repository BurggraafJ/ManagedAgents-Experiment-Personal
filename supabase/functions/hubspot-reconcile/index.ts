// hubspot-reconcile v1.0 — Sweeper die DB synchroon houdt met HubSpot.
//
// Pendant van mail-reconcile + calendar-reconcile, voor HubSpot CRM mirrors.
//
// Probleem: hubspot-sync-etl gebruikt search met default-filter archived=false en
// hardcodet `is_archived: false` bij elke upsert. Gevolg: zodra een record in
// HubSpot wordt gearchiveerd of hard-deleted, blijft hij in onze mirror met
// stale is_archived=false. Sales-todos / Postvak / Administratie zien dan deals,
// companies, contacts en engagements die niet meer bestaan in HubSpot.
//
// Effect: tussen "Jelle archiveert deal in HubSpot" en "deal verdwijnt uit
// dashboard" zit max ~30 min in plaats van nooit.
//
// Aanpak: per object-type halen we ALLE IDs op (zowel archived=false als
// archived=true) via /crm/v3/objects/{type}?properties=createdate&archived=...
// — minimal-payload calls. Combinatie = universe. DB-only IDs = hard-deleted.
// archived-set ∩ DB = HubSpot-archived. Beide flip is_archived=true.
//
// Voor hubspot_users gebruiken we `active` ipv `is_archived` (afwijkende kolom).
//
// Object-types in scope:
//   - deals      (hubspot_deals.deal_id)
//   - companies  (hubspot_companies.company_id)
//   - contacts   (hubspot_contacts.contact_id)
//   - owners     (hubspot_users.hubspot_owner_id, kolom = active)
//   - engagements/calls   (hubspot_engagements.id WHERE engagement_type='calls')
//   - engagements/emails  (idem 'emails')
//   - engagements/meetings (idem)
//   - engagements/notes   (idem)
//   - engagements/tasks   (idem)
//
// Cost: ~10 pagina's per type × 9 types ≈ 90 calls/run × 48 runs/dag = ~4300/dag.
// HubSpot daily limit is 250k+ — ruim binnen budget.
//
// Safety-rail: weigert te flippen als de live-fetch bijna leeg is (<10% van
// DB-set actieve rijen). Voorkomt dat een 5xx storm de DB onbedoeld wegnukt.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "hubspot-reconcile-v1.0";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_OBJECT = 50;   // 50×100 = 5k IDs cap per object-type
const SAFETY_LIVE_RATIO = 0.10;    // live moet ≥10% van db-active zijn

interface HubSpotContext {
  authHeader: string;
  baseUrl: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
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

async function buildCtx(supabase: SupabaseClient): Promise<HubSpotContext> {
  // Hergebruik dezelfde Private App access token als hubspot-sync-etl.
  const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
  if (!accessToken) throw new Error("hubspot_access_token_missing");
  return {
    authHeader: `Bearer ${accessToken}`,
    baseUrl: "https://api.hubapi.com",
  };
}

async function hsFetch<T>(ctx: HubSpotContext, path: string, retry = 0): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: ctx.authHeader, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [3000, 10000, 30000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return hsFetch(ctx, path, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`hs_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`hs_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`); }
}

interface HsListResponse {
  results?: Array<{ id: string }>;
  paging?: { next?: { after?: string } };
}

// Haal alle IDs op voor een object-type met gegeven archived-status. Geen
// properties = minimal payload (alleen id-veld).
async function fetchAllIds(
  ctx: HubSpotContext,
  apiPath: string,
  archived: boolean,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let after: string | null = null;
  let pages = 0;
  while (pages++ < MAX_PAGES_PER_OBJECT) {
    const query = `limit=${PAGE_SIZE}&archived=${archived}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await hsFetch<HsListResponse>(ctx, `${apiPath}?${query}`);
    const page = res.results ?? [];
    for (const r of page) if (r.id) ids.add(r.id);
    const nextAfter = res.paging?.next?.after;
    if (!nextAfter || page.length === 0) break;
    after = nextAfter;
  }
  return ids;
}

interface ReconcileTarget {
  label: string;                                // logging-naam ('deals', 'engagements/calls', ...)
  apiPath: string;                              // HubSpot CRM v3 endpoint zonder query-string
  dbTable: string;                              // Supabase tabel
  pkColumn: string;                             // PK-kolom op de tabel
  archivedColumn: "is_archived" | "active";     // tabel-specifieke vlag
  flippedValueForArchived: boolean;             // wat we erin schrijven om "weg" te markeren
  flippedValueForActive:   boolean;             // wat we erin schrijven bij revive
  engagementType?: string;                      // alleen voor hubspot_engagements: filter op engagement_type
  skipArchivedFetch?: boolean;                  // HubSpot weigert archived-paging voor MEETING_EVENT (0-47)
}

const TARGETS: ReconcileTarget[] = [
  {
    label: "deals",
    apiPath: "/crm/v3/objects/deals",
    dbTable: "hubspot_deals",
    pkColumn: "deal_id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
  },
  {
    label: "companies",
    apiPath: "/crm/v3/objects/companies",
    dbTable: "hubspot_companies",
    pkColumn: "company_id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
  },
  {
    label: "contacts",
    apiPath: "/crm/v3/objects/contacts",
    dbTable: "hubspot_contacts",
    pkColumn: "contact_id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
  },
  {
    label: "owners",
    apiPath: "/crm/v3/owners",
    dbTable: "hubspot_users",
    pkColumn: "hubspot_owner_id",
    archivedColumn: "active",
    // hubspot_users.active = true betekent actief; we flippen ELDERS:
    //   archived in HubSpot → active=false
    //   live in HubSpot     → active=true
    flippedValueForArchived: false,
    flippedValueForActive:   true,
  },
  {
    label: "engagements/calls",
    apiPath: "/crm/v3/objects/calls",
    dbTable: "hubspot_engagements",
    pkColumn: "id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
    engagementType: "calls",
  },
  {
    label: "engagements/emails",
    apiPath: "/crm/v3/objects/emails",
    dbTable: "hubspot_engagements",
    pkColumn: "id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
    engagementType: "emails",
  },
  {
    label: "engagements/meetings",
    apiPath: "/crm/v3/objects/meetings",
    dbTable: "hubspot_engagements",
    pkColumn: "id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
    engagementType: "meetings",
    // HubSpot API geeft VALIDATION_ERROR bij ?archived=true&limit=... voor
    // object type 0-47 (MEETING_EVENT). We doen alleen de live-fetch en
    // detecteren hard-deletes via DB-only-IDs. HubSpot-archived meetings
    // worden niet geflipt — Outlook-calendar is sowieso primary source.
    skipArchivedFetch: true,
  },
  {
    label: "engagements/notes",
    apiPath: "/crm/v3/objects/notes",
    dbTable: "hubspot_engagements",
    pkColumn: "id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
    engagementType: "notes",
  },
  {
    label: "engagements/tasks",
    apiPath: "/crm/v3/objects/tasks",
    dbTable: "hubspot_engagements",
    pkColumn: "id",
    archivedColumn: "is_archived",
    flippedValueForArchived: true,
    flippedValueForActive: false,
    engagementType: "tasks",
  },
];

interface ReconcileResult {
  label: string;
  live_count: number;
  archived_in_hs_count: number;
  db_active_count: number;
  marked_archived: number;
  revived: number;
  status: "ok" | "skipped_safety" | "error";
  detail?: string;
}

async function reconcileTarget(
  supabase: SupabaseClient,
  ctx: HubSpotContext,
  t: ReconcileTarget,
): Promise<ReconcileResult> {
  try {
    // Stap 1 — fetch live + archived IDs uit HubSpot. Sommige object-types
    // (MEETING_EVENT) ondersteunen archived-paging niet — skip dan die call
    // en val terug op live-only delta-detectie.
    const livePromise = fetchAllIds(ctx, t.apiPath, false);
    const archivedPromise: Promise<Set<string>> = t.skipArchivedFetch
      ? Promise.resolve(new Set<string>())
      : fetchAllIds(ctx, t.apiPath, true);
    const [liveIds, archivedIds] = await Promise.all([livePromise, archivedPromise]);

    // Stap 2 — DB-rows ophalen
    let dbQuery = supabase.from(t.dbTable).select(`${t.pkColumn}, ${t.archivedColumn}`);
    if (t.engagementType) dbQuery = dbQuery.eq("engagement_type", t.engagementType);
    const { data: dbRows, error: dbErr } = await dbQuery;
    if (dbErr) throw new Error(`db_select_failed: ${dbErr.message}`);

    // Map graph_id → current flag-value
    const dbFlagByPk = new Map<string, boolean>();
    for (const r of (dbRows ?? [])) {
      const pk = (r as Record<string, unknown>)[t.pkColumn];
      const flag = (r as Record<string, unknown>)[t.archivedColumn];
      if (typeof pk === "string") dbFlagByPk.set(pk, Boolean(flag));
    }

    const dbActiveCount = Array.from(dbFlagByPk.values())
      .filter(v => v === t.flippedValueForActive)
      .length;

    // Safety-rail: weiger als live-set verdacht klein is t.o.v. db-actief
    if (dbActiveCount > 50 && liveIds.size < dbActiveCount * SAFETY_LIVE_RATIO) {
      return {
        label: t.label,
        live_count: liveIds.size,
        archived_in_hs_count: archivedIds.size,
        db_active_count: dbActiveCount,
        marked_archived: 0, revived: 0,
        status: "skipped_safety",
        detail: `live=${liveIds.size} < ${Math.floor(dbActiveCount * SAFETY_LIVE_RATIO)} (${Math.round(SAFETY_LIVE_RATIO * 100)}% van db_active=${dbActiveCount})`,
      };
    }

    // Stap 3 — bereken delta
    const toArchive: string[] = []; // DB-active maar niet in live → flip naar archived
    const toRevive:  string[] = []; // DB-archived maar terug in live → flip naar active

    for (const [pk, currentFlag] of dbFlagByPk.entries()) {
      const inLive     = liveIds.has(pk);
      const isCurrentlyActive = currentFlag === t.flippedValueForActive;
      if (!inLive && isCurrentlyActive) toArchive.push(pk);
      if (inLive  && !isCurrentlyActive) toRevive.push(pk);
    }

    // Stap 4 — flip in batches van 200
    const nowIso = new Date().toISOString();
    let archivedTotal = 0;
    for (let i = 0; i < toArchive.length; i += 200) {
      const batch = toArchive.slice(i, i + 200);
      const update: Record<string, unknown> = {
        [t.archivedColumn]: t.flippedValueForArchived,
        synced_at: nowIso,
      };
      let q = supabase.from(t.dbTable).update(update).in(t.pkColumn, batch);
      if (t.engagementType) q = q.eq("engagement_type", t.engagementType);
      const { error } = await q;
      if (error) throw new Error(`db_archive_failed: ${error.message}`);
      archivedTotal += batch.length;
    }

    let revivedTotal = 0;
    for (let i = 0; i < toRevive.length; i += 200) {
      const batch = toRevive.slice(i, i + 200);
      const update: Record<string, unknown> = {
        [t.archivedColumn]: t.flippedValueForActive,
        synced_at: nowIso,
      };
      let q = supabase.from(t.dbTable).update(update).in(t.pkColumn, batch);
      if (t.engagementType) q = q.eq("engagement_type", t.engagementType);
      const { error } = await q;
      if (error) throw new Error(`db_revive_failed: ${error.message}`);
      revivedTotal += batch.length;
    }

    return {
      label: t.label,
      live_count: liveIds.size,
      archived_in_hs_count: archivedIds.size,
      db_active_count: dbActiveCount,
      marked_archived: archivedTotal,
      revived: revivedTotal,
      status: "ok",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      label: t.label,
      live_count: 0, archived_in_hs_count: 0, db_active_count: 0,
      marked_archived: 0, revived: 0,
      status: "error",
      detail: msg.slice(0, 300),
    };
  }
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const url = new URL(req.url);
  const filterLabel = url.searchParams.get("only");   // optioneel: alleen 1 target draaien (smoke-test)

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: Record<string, unknown> = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    targets: [] as ReconcileResult[],
    totals: { marked_archived: 0, revived: 0, errored: 0, safety_skipped: 0 },
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "hubspot-reconcile", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);
    const targets = filterLabel ? TARGETS.filter(t => t.label === filterLabel) : TARGETS;
    if (targets.length === 0) {
      (stats.warnings as string[]).push(`unknown_target_filter: ${filterLabel}`);
    }

    const results: ReconcileResult[] = [];
    for (const t of targets) {
      const r = await reconcileTarget(supabase, ctx, t);
      results.push(r);
      const totals = stats.totals as Record<string, number>;
      if (r.status === "ok") {
        totals.marked_archived += r.marked_archived;
        totals.revived         += r.revived;
      } else if (r.status === "skipped_safety") {
        totals.safety_skipped++;
        (stats.warnings as string[]).push(`${r.label}: ${r.detail}`);
      } else if (r.status === "error") {
        totals.errored++;
        (stats.warnings as string[]).push(`${r.label}: ${r.detail}`);
      }
    }
    stats.targets = results;

    const totals = stats.totals as Record<string, number>;
    const summary = (totals.marked_archived > 0 || totals.revived > 0)
      ? `${totals.marked_archived} gearchiveerd${totals.revived > 0 ? `, ${totals.revived} herleefd` : ''} over ${targets.length} object-type(s)`
      : `alles synchroon over ${targets.length} object-type(s)`;

    const finalStatus = totals.errored > 0 ? "warning" : (totals.safety_skipped > 0 ? "warning" : "success");

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats }), {
      status: 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }],
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
