// vercel-control v1 - Vercel deploy management Edge Function
// Triggert redeploys, rollbacks, promotions en list-calls op de Vercel REST API
// zonder dat Jelle's PC aan hoeft te staan.
//
// Secrets-storage (gedeeld met dashboard-refresh skill):
//   - dashboard-refresh.vercel_token        Vercel API token (deployments+projects:write)
//   - dashboard-refresh.vercel_project_id   prj_... (legal-mind-dashboard)
//   - dashboard-refresh.vercel_team_id      team_...
//   - dashboard-refresh.vercel_team_slug    team-slug
//   - global.cron_secret                    Auth voor inkomende calls (zelfde pattern als andere ETL fns)
//
// Auth: Bearer cron_secret OF Bearer service_role (consistent met andere edge fns).
//
// Endpoints (POST /functions/v1/vercel-control met body):
//   { "action": "list",     "limit": 10 }              → recente deploys
//   { "action": "redeploy", "branch": "main" }         → force rebuild (nieuwe build met laatste commit)
//   { "action": "rollback", "deployment_id": "dpl_…" } → promote oudere deploy naar production
//   { "action": "promote",  "deployment_id": "dpl_…" } → preview → production (alias van rollback)
//   { "action": "cancel",   "deployment_id": "dpl_…" } → hangende deploy afkappen
//
// Trigger: HTTP-only (geen pg_cron). Vanuit dashboard rollback-knop of ad-hoc via curl.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const FN_VERSION = "vercel-control-v1";

interface VercelContext {
  token: string;
  authHeader: string;
  projectId: string;
  teamId: string | null;
  teamSlug: string | null;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<VercelContext> {
  const token = await getCfg(supabase, "dashboard-refresh", "vercel_token");
  if (!token) throw new Error("vercel_token_missing in agent_config(dashboard-refresh, vercel_token)");
  const projectId = await getCfg(supabase, "dashboard-refresh", "vercel_project_id");
  if (!projectId) throw new Error("vercel_project_id_missing");
  const teamId = await getCfg(supabase, "dashboard-refresh", "vercel_team_id");
  const teamSlug = await getCfg(supabase, "dashboard-refresh", "vercel_team_slug");
  return { token, authHeader: `Bearer ${token}`, projectId, teamId, teamSlug };
}

function teamQuery(ctx: VercelContext, leading = "?"): string {
  return ctx.teamId ? `${leading}teamId=${encodeURIComponent(ctx.teamId)}` : "";
}

async function vFetch(ctx: VercelContext, path: string, init?: RequestInit, retry = 0): Promise<unknown> {
  const url = `https://api.vercel.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: ctx.authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if ((res.status === 429 || res.status >= 500) && retry < 2) {
    const delays = [3000, 12000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return vFetch(ctx, path, init, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`vercel_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 400)}`);
  }
  if (text.length === 0) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`vercel_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`); }
}

interface DeploymentSummary {
  uid: string;
  name?: string;
  url?: string;
  created?: number;
  state?: string;
  target?: string | null;
  meta?: Record<string, string>;
  inspectorUrl?: string;
}

async function listDeployments(ctx: VercelContext, limit = 10): Promise<DeploymentSummary[]> {
  const path = `/v6/deployments?projectId=${encodeURIComponent(ctx.projectId)}${ctx.teamId ? `&teamId=${encodeURIComponent(ctx.teamId)}` : ""}&limit=${Math.min(Math.max(limit, 1), 100)}`;
  const res = await vFetch(ctx, path) as { deployments?: DeploymentSummary[] };
  return res.deployments ?? [];
}

async function actionRedeploy(ctx: VercelContext, branch: string): Promise<{ deploymentId: string; url?: string }> {
  // POST /v13/deployments {name, gitSource: {ref, type, repoId/owner+slug}, target: "production"}
  // Het minimum: gebruik laatste deploy als bron voor name + gitSource details.
  const recent = await listDeployments(ctx, 5);
  const lastProdLikely = recent.find((d) => (d.target ?? null) === "production") ?? recent[0];
  if (!lastProdLikely) throw new Error("no_recent_deployment_to_clone");
  const name = lastProdLikely.name || "legal-mind-dashboard";

  // Haal git-bron-info op uit de laatste deploy (meta.githubRepo etc.) via single-deploy endpoint
  const detailRes = await vFetch(ctx, `/v13/deployments/${encodeURIComponent(lastProdLikely.uid)}${ctx.teamId ? `?teamId=${encodeURIComponent(ctx.teamId)}` : ""}`) as { gitSource?: Record<string, unknown>; meta?: Record<string, string> };
  const gitSource = detailRes.gitSource ? { ...detailRes.gitSource, ref: branch } : { type: "github", ref: branch };

  const body = {
    name,
    gitSource,
    target: "production",
    project: ctx.projectId,
  };
  const path = `/v13/deployments${ctx.teamId ? `?teamId=${encodeURIComponent(ctx.teamId)}&forceNew=1` : "?forceNew=1"}`;
  const created = await vFetch(ctx, path, { method: "POST", body: JSON.stringify(body) }) as { id?: string; url?: string };
  if (!created.id) throw new Error("redeploy_no_id_returned");
  return { deploymentId: created.id, url: created.url };
}

async function actionPromote(ctx: VercelContext, deploymentId: string): Promise<void> {
  // POST /v10/projects/{projectId}/promote/{deploymentId} → instant promote without rebuild
  const path = `/v10/projects/${encodeURIComponent(ctx.projectId)}/promote/${encodeURIComponent(deploymentId)}${ctx.teamId ? `?teamId=${encodeURIComponent(ctx.teamId)}` : ""}`;
  await vFetch(ctx, path, { method: "POST", body: "{}" });
}

async function actionCancel(ctx: VercelContext, deploymentId: string): Promise<{ state?: string }> {
  // PATCH /v12/deployments/{id}/cancel
  const path = `/v12/deployments/${encodeURIComponent(deploymentId)}/cancel${ctx.teamId ? `?teamId=${encodeURIComponent(ctx.teamId)}` : ""}`;
  const res = await vFetch(ctx, path, { method: "PATCH", body: "{}" }) as { state?: string };
  return { state: res.state };
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presented || (presented !== cronSecret && presented !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let payload: { action?: string; deployment_id?: string; branch?: string; limit?: number } = {};
  try {
    if (req.method === "POST") {
      const text = await req.text();
      if (text) payload = JSON.parse(text);
    } else if (req.method === "GET") {
      const url = new URL(req.url);
      payload = {
        action: url.searchParams.get("action") ?? "list",
        deployment_id: url.searchParams.get("deployment_id") ?? undefined,
        branch: url.searchParams.get("branch") ?? undefined,
        limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
      };
    }
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const action = (payload.action || "list").toLowerCase();
  const validActions = ["list", "redeploy", "rollback", "promote", "cancel"];
  if (!validActions.includes(action)) {
    return new Response(JSON.stringify({ error: `invalid_action: ${action}`, valid: validActions }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "http";
  const startedAt = new Date().toISOString();
  const stats: Record<string, unknown> = {
    triggered_by: triggeredBy, triggered_at: startedAt,
    action, fn_version: FN_VERSION,
    payload: { deployment_id: payload.deployment_id, branch: payload.branch, limit: payload.limit },
  };

  const { data: runIns } = await supabase.from("agent_runs").insert({
    agent_name: "vercel-control", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  const runId = runIns?.id as string | undefined;

  try {
    const ctx = await buildCtx(supabase);
    let result: unknown;
    let summary: string;

    switch (action) {
      case "list": {
        const deploys = await listDeployments(ctx, payload.limit ?? 10);
        result = deploys.map((d) => ({
          uid: d.uid,
          name: d.name,
          url: d.url ? `https://${d.url}` : null,
          state: d.state,
          target: d.target ?? null,
          created_at: d.created ? new Date(d.created).toISOString() : null,
          inspector: d.inspectorUrl ?? null,
          commit_message: d.meta?.githubCommitMessage ?? null,
          commit_sha: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
        }));
        summary = `list: ${(result as unknown[]).length} deploys`;
        break;
      }
      case "redeploy": {
        const branch = payload.branch ?? "main";
        const r = await actionRedeploy(ctx, branch);
        result = r;
        summary = `redeploy from ${branch} → ${r.deploymentId}`;
        break;
      }
      case "rollback":
      case "promote": {
        if (!payload.deployment_id) throw new Error(`${action}_requires_deployment_id`);
        await actionPromote(ctx, payload.deployment_id);
        result = { promoted: payload.deployment_id };
        summary = `${action}: ${payload.deployment_id} promoted to production`;
        break;
      }
      case "cancel": {
        if (!payload.deployment_id) throw new Error("cancel_requires_deployment_id");
        const r = await actionCancel(ctx, payload.deployment_id);
        result = r;
        summary = `cancel: ${payload.deployment_id} → state=${r.state}`;
        break;
      }
      default:
        throw new Error(`unhandled_action: ${action}`);
    }

    if (runId) {
      await supabase.from("agent_runs").update({
        status: "success", completed_at: new Date().toISOString(), summary, stats: { ...stats, result },
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: true, action, result }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("agent_runs").update({
        status: "error", completed_at: new Date().toISOString(),
        summary: errMsg.slice(0, 500), stats,
        errors: [{ message: errMsg, at: new Date().toISOString() }],
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: false, action, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
