// Edge Function: changelog-record
// ----------------------------------------------------------------------------
// Vol-automatische changelog. GitHub Actions stuurt na elke push naar main
// commit-info hierheen; we classificeren als 'platform' of 'admin' en
// schrijven naar public.platform_updates (één rij per dag per area, met
// commits jsonb-array die appendt). SHA-dedupe gebeurt hier.
//
// Auth: X-Changelog-Token header moet matchen met agent_config.changelog-recorder.token
// (gegenereerd in migration platform_updates_table). Token zit als
// GitHub Secret CHANGELOG_TOKEN bij de workflow.
//
// Verify_jwt = false (GitHub Actions heeft geen Supabase-JWT).

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ADMIN_PATH_PATTERNS = [
  "src/components/views/admin/",
  "supabase/functions/invite-user/",
  "supabase/functions/changelog-record/",
];

const ADMIN_PREFIX_RE = /^(admin|users|infra|beheer|multi[-_]?user):/i;
const PLATFORM_PREFIX_RE = /^platform:/i;

function classifyArea(message: string, modified: string[]): "platform" | "admin" {
  if (PLATFORM_PREFIX_RE.test(message)) return "platform";
  if (ADMIN_PREFIX_RE.test(message)) return "admin";
  if (Array.isArray(modified) && modified.some((f) => ADMIN_PATH_PATTERNS.some((p) => f.startsWith(p)))) {
    return "admin";
  }
  return "platform";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1) Token-check
  const provided = req.headers.get("x-changelog-token");
  if (!provided) return jsonResponse({ error: "missing-token" }, 401);

  const { data: tokRec, error: tokErr } = await supabase
    .from("agent_config")
    .select("config_value")
    .eq("agent_name", "changelog-recorder")
    .eq("config_key", "token")
    .single();
  if (tokErr || !tokRec) return jsonResponse({ error: "token-lookup-failed" }, 500);
  const expected = String(tokRec.config_value || "").replace(/^"|"$/g, "");
  if (provided !== expected) return jsonResponse({ error: "invalid-token" }, 403);

  // 2) Parse payload
  let payload: {
    sha?: string;
    message?: string;
    author?: string;
    timestamp?: string;
    modified?: string[];
  };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid-json" }, 400);
  }
  const sha = (payload.sha || "").trim();
  const message = (payload.message || "").trim();
  const author = (payload.author || "").trim();
  const timestamp = payload.timestamp || new Date().toISOString();
  const modified = Array.isArray(payload.modified) ? payload.modified.filter((x) => typeof x === "string") : [];

  if (!sha || !message) return jsonResponse({ error: "missing-sha-or-message" }, 400);

  // 3) Classify
  const area = classifyArea(message, modified);
  const release_date = timestamp.slice(0, 10); // YYYY-MM-DD in commit timezone

  // 4) Read existing rij voor deze (date, area) en append (met sha-dedupe)
  const { data: existing } = await supabase
    .from("platform_updates")
    .select("commits")
    .eq("release_date", release_date)
    .eq("area", area)
    .maybeSingle();

  const newEntry = { sha, message, author, timestamp, files: modified };
  const list: any[] = Array.isArray(existing?.commits) ? [...existing!.commits] : [];

  // Dedupe op sha (idempotent — werkflow kan een commit per ongeluk 2x sturen)
  const seenIdx = list.findIndex((c) => c?.sha === sha);
  if (seenIdx >= 0) list[seenIdx] = newEntry;
  else list.push(newEntry);

  // Newest-first sortering
  list.sort((a, b) => (b?.timestamp || "").localeCompare(a?.timestamp || ""));

  // 5) Upsert
  const { error: upsertErr } = await supabase
    .from("platform_updates")
    .upsert({
      release_date,
      area,
      commits: list,
    }, { onConflict: "release_date,area" });

  if (upsertErr) return jsonResponse({ error: `upsert-failed: ${upsertErr.message}` }, 500);

  return jsonResponse({
    success: true,
    sha,
    area,
    release_date,
    commits_in_day: list.length,
    deduplicated: seenIdx >= 0,
  });
});
