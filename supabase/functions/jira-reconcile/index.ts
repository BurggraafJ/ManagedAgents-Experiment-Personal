// jira-reconcile v1.0 — Sweeper die DB synchroon houdt met Jira.
//
// Pendant van mail-reconcile + calendar-reconcile + hubspot-reconcile, voor de
// Jira-mirror.
//
// Probleem: jira-sync-etl gebruikt delta-JQL (`updated >= since`) + upsert op
// issue_key. Inserts/updates werken, maar:
//   - Hard-deleted issues (Jira-trash → permanent) blijven hangen.
//   - Moved-to-other-project issues krijgen nieuwe key — oude rij blijft staan.
//   - Project-archivering laat issues van dat project actief in onze mirror.
//
// Aanpak: per active Jira-project halen we ALLE issue-keys op (zonder updated-
// filter), vergelijken met DB, flippen DB-only keys naar is_deleted=true.
//
// Effect: tussen "Jelle gooit issue weg in Jira" en "issue verdwijnt uit
// Taken/Future" zit max ~30 min (cron-cadence) ipv nooit.
//
// Window-keuze: we doen GEEN datum-window (zoals calendar-reconcile met
// 60d/90d). Reden: jira-sync-etl heeft géén window — hij pakt alles dat ooit
// gesynced is. Als we hier wel een window deden, zou een oude maar levende
// issue (status='Done' uit 2024) onterecht als deleted gemarkeerd worden.
// We halen dus per project ALLE issue-keys op (cap = MAX_PER_PROJECT).
//
// Cost: per project ~1-2 paginas (50 keys/page), ~10 actieve projecten ≈ 15
// calls/run. Bij 30-min cadence ~720 calls/dag. Atlassian rate-limit is ruim.
//
// Safety-rail: weigert te markeren als de live-fetch voor een project bijna
// leeg is (<10% van db-active). Voorkomt dat een tijdelijke Jira-5xx ons mirror
// wegnukt.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "jira-reconcile-v1.0";
const MAX_PER_PROJECT = 5000;
const PAGE_SIZE = 100;
const SAFETY_LIVE_RATIO = 0.10;

interface JiraContext {
  authHeader: string;
  baseUrl: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<JiraContext> {
  const email = await getCfg(supabase, "global", "atlassian_email");
  if (!email) throw new Error("atlassian_email_missing");
  const apiToken = await getCfg(supabase, "global", "atlassian_api_token");
  if (!apiToken) throw new Error("atlassian_api_token_missing");
  const site = (await getCfg(supabase, "global", "atlassian_site")) ?? "bg-intelligence";
  return {
    authHeader: "Basic " + btoa(`${email}:${apiToken}`),
    baseUrl: `https://${site}.atlassian.net`,
  };
}

async function jiraFetch<T>(ctx: JiraContext, path: string, retry = 0): Promise<T> {
  const res = await fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: ctx.authHeader, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return jiraFetch(ctx, path, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`jira_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`jira_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`); }
}

interface JqlSearchResponse {
  issues?: Array<{ key: string }>;
  nextPageToken?: string;
  isLast?: boolean;
}

// Haal alle issue-keys van een project op. Gebruikt enhanced JQL search (v3)
// met `fields=summary` om payload klein te houden — geen full issue-payload.
async function fetchAllKeys(ctx: JiraContext, projectKey: string): Promise<Set<string>> {
  const keys = new Set<string>();
  let nextPageToken: string | null = null;
  let pages = 0;
  const maxPages = Math.ceil(MAX_PER_PROJECT / PAGE_SIZE);

  while (pages++ < maxPages) {
    // Project-key altijd quoten: "IN", "OF", "AND" etc. zijn JQL-reserved
    // words die zonder quotes een 400 BAD_REQUEST geven.
    const jql = `project = "${projectKey}"`;
    const path = nextPageToken
      ? `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE_SIZE}&nextPageToken=${encodeURIComponent(nextPageToken)}&fields=summary`
      : `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE_SIZE}&fields=summary`;

    const res = await jiraFetch<JqlSearchResponse>(ctx, path);
    const issues = res.issues ?? [];
    for (const i of issues) if (i.key) keys.add(i.key);

    if (res.isLast || !res.nextPageToken || issues.length === 0) break;
    nextPageToken = res.nextPageToken;
  }
  return keys;
}

interface ProjectResult {
  project_key: string;
  live_count: number;
  db_active_count: number;
  marked_deleted: number;
  revived: number;
  status: "ok" | "skipped_safety" | "skipped_empty" | "error";
  detail?: string;
}

async function reconcileProject(
  supabase: SupabaseClient,
  ctx: JiraContext,
  projectKey: string,
): Promise<ProjectResult> {
  try {
    const liveKeys = await fetchAllKeys(ctx, projectKey);

    const { data: dbRows, error: dbErr } = await supabase
      .from("jira_issues")
      .select("issue_key, is_deleted")
      .eq("project_key", projectKey);
    if (dbErr) throw new Error(`db_select_failed: ${dbErr.message}`);

    const dbFlagByKey = new Map<string, boolean>();
    for (const r of (dbRows ?? [])) {
      if (r.issue_key) dbFlagByKey.set(r.issue_key, !!r.is_deleted);
    }
    const dbActiveCount = Array.from(dbFlagByKey.values()).filter(v => !v).length;

    // Empty-fetch safety: als project 0 issues teruggeeft maar DB heeft >50,
    // is dat verdacht (Jira-error of project zonder leestoegang). Skip.
    if (liveKeys.size === 0) {
      if (dbActiveCount > 50) {
        return {
          project_key: projectKey,
          live_count: 0, db_active_count: dbActiveCount,
          marked_deleted: 0, revived: 0,
          status: "skipped_safety",
          detail: `Jira returned 0 issues for project but DB has ${dbActiveCount} active — suspicious, refuse to mark`,
        };
      }
      return {
        project_key: projectKey,
        live_count: 0, db_active_count: dbActiveCount,
        marked_deleted: 0, revived: 0,
        status: "skipped_empty",
      };
    }

    // Safety-rail: live ≥10% van db-active
    if (dbActiveCount > 50 && liveKeys.size < dbActiveCount * SAFETY_LIVE_RATIO) {
      return {
        project_key: projectKey,
        live_count: liveKeys.size, db_active_count: dbActiveCount,
        marked_deleted: 0, revived: 0,
        status: "skipped_safety",
        detail: `live=${liveKeys.size} < ${Math.floor(dbActiveCount * SAFETY_LIVE_RATIO)} (${Math.round(SAFETY_LIVE_RATIO * 100)}% van db_active=${dbActiveCount})`,
      };
    }

    const toDelete: string[] = [];
    const toRevive: string[] = [];
    for (const [k, deleted] of dbFlagByKey.entries()) {
      const inLive = liveKeys.has(k);
      if (!inLive && !deleted) toDelete.push(k);
      if (inLive  &&  deleted) toRevive.push(k);
    }

    const nowIso = new Date().toISOString();
    let markedTotal = 0;
    for (let i = 0; i < toDelete.length; i += 200) {
      const batch = toDelete.slice(i, i + 200);
      const { error } = await supabase
        .from("jira_issues")
        .update({ is_deleted: true, deleted_at: nowIso, synced_at: nowIso })
        .in("issue_key", batch);
      if (error) throw new Error(`db_mark_deleted_failed: ${error.message}`);
      markedTotal += batch.length;
    }

    let revivedTotal = 0;
    for (let i = 0; i < toRevive.length; i += 200) {
      const batch = toRevive.slice(i, i + 200);
      const { error } = await supabase
        .from("jira_issues")
        .update({ is_deleted: false, deleted_at: null, synced_at: nowIso })
        .in("issue_key", batch);
      if (error) throw new Error(`db_revive_failed: ${error.message}`);
      revivedTotal += batch.length;
    }

    return {
      project_key: projectKey,
      live_count: liveKeys.size, db_active_count: dbActiveCount,
      marked_deleted: markedTotal, revived: revivedTotal,
      status: "ok",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      project_key: projectKey,
      live_count: 0, db_active_count: 0,
      marked_deleted: 0, revived: 0,
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
  const filterProject = url.searchParams.get("only");

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: Record<string, unknown> = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    per_project: [] as ProjectResult[],
    totals: { marked_deleted: 0, revived: 0, errored: 0, safety_skipped: 0, empty: 0 },
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "jira-reconcile", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);

    // Welke projecten reconciliëren? Alleen active projecten (jira_projects.is_active=true).
    let projQuery = supabase.from("jira_projects").select("key").eq("is_active", true);
    if (filterProject) projQuery = projQuery.eq("key", filterProject);
    const { data: projects } = await projQuery;
    const projectKeys = (projects ?? []).map((p: { key: string }) => p.key);

    if (projectKeys.length === 0) {
      (stats.warnings as string[]).push("no_active_projects");
    }

    const results: ProjectResult[] = [];
    for (const pk of projectKeys) {
      const r = await reconcileProject(supabase, ctx, pk);
      results.push(r);
      const totals = stats.totals as Record<string, number>;
      if (r.status === "ok") {
        totals.marked_deleted += r.marked_deleted;
        totals.revived        += r.revived;
      } else if (r.status === "skipped_safety") {
        totals.safety_skipped++;
        (stats.warnings as string[]).push(`${pk}: ${r.detail}`);
      } else if (r.status === "skipped_empty") {
        totals.empty++;
      } else if (r.status === "error") {
        totals.errored++;
        (stats.warnings as string[]).push(`${pk}: ${r.detail}`);
      }
    }
    stats.per_project = results;

    const totals = stats.totals as Record<string, number>;
    const summary = (totals.marked_deleted > 0 || totals.revived > 0)
      ? `${totals.marked_deleted} issue(s) gemarkeerd als deleted${totals.revived > 0 ? `, ${totals.revived} herleefd` : ''} over ${projectKeys.length} project(en)`
      : `alles synchroon over ${projectKeys.length} project(en)`;

    const finalStatus = (totals.errored > 0 || totals.safety_skipped > 0) ? "warning" : "success";

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
