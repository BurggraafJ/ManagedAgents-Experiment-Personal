// vault-read-proxy v1 — Edge Function die skills (en lokale Claude-sessies) toegang
// geeft tot Vault-secrets, zonder dat ze zelf service_role of een Supabase
// Management PAT hoeven te hebben.
//
// Auth: Bearer <cron_secret> (in env CRON_SECRET) OF Bearer <service_role>.
// Cron_secret zit in Vault onder skill:global:cron_secret.
//
// Endpoint: POST /functions/v1/vault-read-proxy
// Body: { "skill_name": "global", "secret_name": "composio_api_key" }
// Response: { "ok": true, "value": "...", "last_4": "...", "skill_name": "...", "secret_name": "..." }
//          { "ok": false, "error": "..." }
//
// Validatie:
// 1. Auth header moet matchen met cron_secret (uit Vault) of service_role.
// 2. skill_name + secret_name moeten exact bestaan in skill_secrets_registry — geen wildcards.
// 3. Audit-log naar agent_runs (zonder de plaintext-waarde, alleen request-meta + last_4).
//
// Use-case (Claude-sessie zonder Supabase MCP):
//   curl -X POST "https://ezxihctobrqoklufawim.supabase.co/functions/v1/vault-read-proxy" \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"skill_name":"global","secret_name":"composio_api_key"}'

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const FN_VERSION = "vault-read-proxy-v1";

interface RequestBody {
  skill_name?: string;
  secret_name?: string;
}

async function getCronSecret(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: "global",
    p_secret_name: "cron_secret",
  });
  return typeof data === "string" && data.length > 0 ? data : null;
}

async function isAuthorized(supabase: SupabaseClient, presented: string): Promise<boolean> {
  if (!presented) return false;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (presented === serviceRole) return true;
  const cron = await getCronSecret(supabase);
  return cron !== null && presented === cron;
}

async function isWhitelisted(
  supabase: SupabaseClient,
  skill: string,
  secret: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("skill_secrets_registry")
    .select("skill_name,secret_name")
    .eq("skill_name", skill)
    .eq("secret_name", secret)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}

async function logAccess(
  supabase: SupabaseClient,
  skill: string,
  secret: string,
  status: "success" | "denied" | "not_found" | "auth_failed",
  last4: string | null,
  caller: string | null,
): Promise<void> {
  try {
    await supabase.from("agent_runs").insert({
      agent_name: "vault-read-proxy",
      run_type: "edge_function",
      status: status === "success" ? "success" : "warning",
      summary: `vault-read-proxy: ${status} (${skill}.${secret})`,
      stats: {
        schema_version: "1",
        skill_version: FN_VERSION,
        triggered_by: "skill_call",
        triggered_at: new Date().toISOString(),
        warnings: status === "success" ? [] : [`vault_proxy_${status}`],
        counts: { calls: 1 },
        extra: {
          requested_skill: skill,
          requested_secret: secret,
          last_4_returned: last4,
          caller_hint: caller, // optionele x-caller-id header voor traceability
        },
      },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  } catch {
    // Audit-log mag niet de skill-call breken
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ ok: false, error: "edge_fn_misconfigured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Method-check
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  // 2. Auth-check
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const callerHint = req.headers.get("x-caller-id") || null;
  if (!(await isAuthorized(supabase, presented))) {
    await logAccess(supabase, "<unknown>", "<unknown>", "auth_failed", null, callerHint);
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 3. Body-parse
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const skill = (body.skill_name ?? "").trim();
  const secret = (body.secret_name ?? "").trim();
  if (!skill || !secret) {
    return Response.json(
      { ok: false, error: "missing_fields", hint: "skill_name and secret_name required" },
      { status: 400 },
    );
  }

  // 4. Whitelist-check (skill_name + secret_name moet in registry staan)
  if (!(await isWhitelisted(supabase, skill, secret))) {
    await logAccess(supabase, skill, secret, "not_found", null, callerHint);
    return Response.json(
      { ok: false, error: "secret_not_in_registry", hint: `skill:${skill}:${secret} bestaat niet` },
      { status: 404 },
    );
  }

  // 5. Lees secret via service-role RPC
  const { data: value, error } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: skill,
    p_secret_name: secret,
  });
  if (error || typeof value !== "string" || value.length === 0) {
    await logAccess(supabase, skill, secret, "denied", null, callerHint);
    return Response.json({ ok: false, error: "vault_read_failed", detail: error?.message ?? null }, { status: 500 });
  }

  // 6. Success — audit-log met last_4 (geen plaintext naar agent_runs)
  const last4 = value.length >= 4 ? value.slice(-4) : null;
  await logAccess(supabase, skill, secret, "success", last4, callerHint);

  return Response.json({
    ok: true,
    skill_name: skill,
    secret_name: secret,
    value,
    last_4: last4,
  });
});
