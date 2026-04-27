// jira-sync-etl v1 - Atlassian REST API direct
// Vervangt jira-sync skill. Geen Composio (Composio heeft geen Atlassian/Jira toolkit
// in onze instance). Direct Basic auth met email + API token.
//
// Secrets-storage: agent_config met is_secret=true (consistent met mail-sync-etl-v2).
//   - global.atlassian_email                 Email gebruikt voor Basic auth
//   - global.atlassian_api_token             API token (manage-profile/security/api-tokens)
//   - global.atlassian_site                  Bv. 'bg-intelligence' (voor URL bg-intelligence.atlassian.net)
//   - global.cron_secret                     Shared met mail-sync-etl-v2
//   - jira-sync-etl.project_filter           Optioneel: array of project keys (default: alle visible)
//
// Trigger: pg_cron `0 * * * *` (uur, of *? */15 * * * * voor delta-snel)
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "jira-edge-fn-v1";
const MAX_ISSUES_PER_RUN = 500;
const FULL_SYNC_INTERVAL_HOURS = 24;

interface JiraContext {
  email: string;
  apiToken: string;
  baseUrl: string;
  authHeader: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<JiraContext> {
  const email = await getCfg(supabase, "global", "atlassian_email");
  if (!email) throw new Error("atlassian_email_missing in agent_config(global, atlassian_email)");
  const apiToken = await getCfg(supabase, "global", "atlassian_api_token");
  if (!apiToken) throw new Error("atlassian_api_token_missing in agent_config(global, atlassian_api_token)");
  const site = (await getCfg(supabase, "global", "atlassian_site")) ?? "bg-intelligence";
  const baseUrl = `https://${site}.atlassian.net`;
  // btoa() is global in Deno
  const authHeader = "Basic " + btoa(`${email}:${apiToken}`);
  return { email, apiToken, baseUrl, authHeader };
}

async function jiraFetch(ctx: JiraContext, path: string, retry = 0): Promise<unknown> {
  const url = `${ctx.baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: ctx.authHeader, Accept: "application/json" },
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return jiraFetch(ctx, path, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`jira_http_${res.status}_${path.slice(0, 50)}: ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`jira_non_json_${path.slice(0, 50)}: ${text.slice(0, 200)}`); }
}

interface JiraProject {
  key: string;
  name: string;
  projectTypeKey?: string;
  projectCategory?: { name?: string };
  self?: string;
  avatarUrls?: Record<string, string>;
  lead?: { accountId?: string };
  archived?: boolean;
}

async function syncProjects(supabase: SupabaseClient, ctx: JiraContext): Promise<string[]> {
  // GET /rest/api/3/project/search returns paginated projects
  const allKeys: string[] = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const res = await jiraFetch(ctx, `/rest/api/3/project/search?startAt=${startAt}&maxResults=${maxResults}`) as { values?: JiraProject[]; isLast?: boolean; total?: number };
    const projects = res.values ?? [];
    if (projects.length === 0) break;

    const rows = projects.map((p) => ({
      key: p.key,
      name: p.name,
      project_type: p.projectTypeKey ?? null,
      category: p.projectCategory?.name ?? null,
      url: p.self ? `${ctx.baseUrl}/projects/${p.key}` : null,
      avatar_url: p.avatarUrls?.["48x48"] ?? null,
      lead_account_id: p.lead?.accountId ?? null,
      is_active: p.archived !== true,
      last_synced: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("jira_projects").upsert(rows, { onConflict: "key" });
    if (error) throw new Error(`jira_projects_upsert_failed: ${error.message}`);
    for (const p of projects) allKeys.push(p.key);

    if (res.isLast || projects.length < maxResults) break;
    startAt += maxResults;
    if (startAt > 1000) break; // safety
  }
  return allKeys;
}

interface JiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

async function syncIssues(supabase: SupabaseClient, ctx: JiraContext, jql: string): Promise<number> {
  // Use enhanced JQL search (v3): POST /rest/api/3/search/jql
  let totalUpserted = 0;
  let nextPageToken: string | null = null;
  let safety = 0;

  while (safety < 50) {  // max 50 pages of 100 = 5000 issues per run
    safety++;
    const path = nextPageToken
      ? `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&nextPageToken=${encodeURIComponent(nextPageToken)}&fields=summary,description,status,priority,issuetype,assignee,reporter,labels,components,duedate,created,updated,resolutiondate,parent,sprint,customfield_10020`
      : `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,status,priority,issuetype,assignee,reporter,labels,components,duedate,created,updated,resolutiondate,parent,sprint,customfield_10020`;

    const res = await jiraFetch(ctx, path) as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
    const issues = res.issues ?? [];
    if (issues.length === 0) break;

    const rows = issues.map((iss) => mapIssueRow(iss, ctx.baseUrl));
    const { error } = await supabase.from("jira_issues").upsert(rows, { onConflict: "issue_key" });
    if (error) throw new Error(`jira_issues_upsert_failed: ${error.message}`);
    totalUpserted += rows.length;

    if (totalUpserted >= MAX_ISSUES_PER_RUN) break;
    if (res.isLast || !res.nextPageToken) break;
    nextPageToken = res.nextPageToken;
  }
  return totalUpserted;
}

function mapIssueRow(iss: JiraIssue, baseUrl: string) {
  const f = iss.fields ?? {};
  const get = (k: string): unknown => (f as Record<string, unknown>)[k];
  const status = get("status") as { name?: string; statusCategory?: { key?: string } } | undefined;
  const priority = get("priority") as { name?: string } | undefined;
  const issueType = get("issuetype") as { name?: string } | undefined;
  const assignee = get("assignee") as { accountId?: string; emailAddress?: string; displayName?: string } | undefined;
  const reporter = get("reporter") as { accountId?: string; displayName?: string } | undefined;
  const parent = get("parent") as { key?: string } | undefined;
  const sprint = get("customfield_10020") as Array<{ name?: string; state?: string }> | undefined;
  const activeSprint = Array.isArray(sprint) ? sprint.find((s) => s.state === "active") : undefined;

  // Description in Atlassian Document Format (ADF) → plat tekst extract (best-effort)
  let descText: string | null = null;
  const desc = get("description") as { content?: unknown[] } | string | null;
  if (typeof desc === "string") descText = desc;
  else if (desc && typeof desc === "object") descText = adfToText(desc);

  return {
    issue_key: iss.key,
    project_key: iss.key.split("-")[0],
    summary: (get("summary") as string) ?? null,
    description: descText,
    status: status?.name ?? null,
    status_category: status?.statusCategory?.key ?? null,
    priority: priority?.name ?? null,
    issue_type: issueType?.name ?? null,
    assignee_account_id: assignee?.accountId ?? null,
    assignee_email: assignee?.emailAddress ?? null,
    assignee_name: assignee?.displayName ?? null,
    reporter_account_id: reporter?.accountId ?? null,
    reporter_name: reporter?.displayName ?? null,
    labels: Array.isArray(get("labels")) ? (get("labels") as string[]) : null,
    components: Array.isArray(get("components")) ? (get("components") as Array<{ name?: string }>).map((c) => c.name).filter(Boolean) as string[] : null,
    due_date: (get("duedate") as string) ?? null,
    in_backlog: !activeSprint && status?.statusCategory?.key !== "done",
    in_sprint: !!activeSprint,
    sprint_name: activeSprint?.name ?? null,
    parent_key: parent?.key ?? null,
    jira_created_at: (get("created") as string) ?? null,
    jira_updated_at: (get("updated") as string) ?? null,
    jira_resolved_at: (get("resolutiondate") as string) ?? null,
    url: `${baseUrl}/browse/${iss.key}`,
    raw_data: iss as unknown,
    synced_at: new Date().toISOString(),
  };
}

function adfToText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const segs: string[] = [];
  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "object") {
      const n = node as Record<string, unknown>;
      if (n.type === "text" && typeof n.text === "string") segs.push(n.text);
      const content = n.content;
      if (Array.isArray(content)) for (const c of content) walk(c);
    }
  };
  walk(adf);
  return segs.join(" ").trim().slice(0, 5000);
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
  const stats = { triggered_by: triggeredBy, triggered_at: startedAt, projects_synced: 0, issues_upserted: 0, sync_mode: "delta" as "delta" | "full", warnings: [] as string[] };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "jira-sync", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);

    // Bepaal full vs delta
    const { data: state } = await supabase.from("jira_sync_state").select("*").eq("id", 1).maybeSingle();
    const needsFull = !state || !state.last_full_sync
      || new Date(state.last_full_sync).getTime() < Date.now() - FULL_SYNC_INTERVAL_HOURS * 3_600_000;

    // 1. Sync projects (light)
    const projectKeys = await syncProjects(supabase, ctx);
    stats.projects_synced = projectKeys.length;

    // 2. Sync issues — JQL filter
    let jql: string;
    if (needsFull) {
      // Atlassian /search/jql vereist bounded JQL — gebruik created >= 2010 als bron-grens
      jql = `created >= "2010-01-01" ORDER BY updated DESC`;
      stats.sync_mode = "full";
    } else {
      const since = new Date(state!.last_delta_sync as string ?? Date.now() - 3600_000);
      const sinceStr = since.toISOString().replace("T", " ").slice(0, 16);
      jql = `updated >= "${sinceStr}" ORDER BY updated DESC`;
      stats.sync_mode = "delta";
    }

    const issuesUpserted = await syncIssues(supabase, ctx, jql);
    stats.issues_upserted = issuesUpserted;

    // 3. State update
    const stateRow: Record<string, unknown> = {
      id: 1,
      last_delta_sync: new Date().toISOString(),
      total_issues: ((state?.total_issues as number) ?? 0) + issuesUpserted,
      total_projects: projectKeys.length,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    };
    if (needsFull) stateRow.last_full_sync = new Date().toISOString();
    const { error: stateErr } = await supabase.from("jira_sync_state").upsert(stateRow, { onConflict: "id" });
    if (stateErr) throw new Error(`jira_sync_state_upsert_failed: ${stateErr.message}`);

    const summary = `${stats.sync_mode}: ${projectKeys.length} projects, ${issuesUpserted} issues`;
    await supabase.from("agent_runs").update({
      status: "success", completed_at: new Date().toISOString(), summary, stats
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
