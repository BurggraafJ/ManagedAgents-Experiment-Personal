// task-organizer-fireflies v1
// Vervangt stap 0 (Fireflies-scan) van task-organizer skill: haalt action-items voor Jelle
// uit recente Fireflies-meetings, dedupt, en insert ze als tasks via RPC.
//
// Trigger: pg_cron (bv. 23 6 * * * — elke ochtend om 06:23)
// Of handmatig via dashboard met x-trigger-source header.
//
// Secrets:
//   - global.cron_secret                       Shared met andere edge fns
//   - fireflies-sync-etl.api_key               Fireflies API key (Bearer)
//   - task-organizer.fireflies_last_scan_at    Laatste scan-tijd ({iso: "..."})
//
// Wat het doet:
//   1. Lees last_scan_at (default 7 dagen, cap op 30 dagen).
//   2. Haal Fireflies-transcripts op sinds last_scan via GraphQL.
//   3. Per transcript: action_items uit summary parsen, filter op Jelle.
//   4. Roep RPC register_fireflies_action_items aan voor bulk-insert + dedup.
//   5. Update last_scan_at als success.
//   6. Schrijf agent_runs.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "task-organizer-fireflies-edge-fn-v1";
const FIREFLIES_GRAPHQL = "https://api.fireflies.ai/graphql";
const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 30;
const TRANSCRIPT_FETCH_LIMIT = 50;
const ACTION_ITEM_CAP = 30;
const DEDUP_DAYS = 14;
const DEDUP_THRESHOLD = 0.85;

// Jelle-naming patterns to match in action_items text
const JELLE_PATTERNS = [
  /\bjelle\b/i,
  /\bburggraaf\b/i,
];

interface FirefliesTranscript {
  id: string;
  title: string | null;
  date: number | null;        // ms epoch
  transcript_url: string | null;
  meeting_link: string | null;
  summary: {
    action_items: string | null;
    overview: string | null;
    short_summary: string | null;
  } | null;
}

interface ActionItemCandidate {
  title: string;
  notes: string;
  source_ref: string;
  source_url: string | null;
  created_by: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<unknown> {
  // agent_config still holds non-secret config (timestamps, watermarks, settings)
  // Secrets are in Vault — see getCfgString below
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  return data?.config_value ?? null;
}

async function getCfgString(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Secrets live in Supabase Vault (encrypted, audit-logged).
  // Non-secret config (project IDs, settings, watermarks) lives in agent_config.
  // Try Vault first; if not present, read non-secret from agent_config.
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;

  const v = await getCfg(supabase, agentName, key);
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

async function setCfg(supabase: SupabaseClient, agentName: string, key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from("agent_config").upsert({
    agent_name: agentName,
    config_key: key,
    config_value: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_name,config_key" });
  if (error) throw new Error(`agent_config_upsert_failed: ${error.message}`);
}

async function firefliesQuery(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(FIREFLIES_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`fireflies_http_${res.status}: ${text.slice(0, 300)}`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`fireflies_non_json: ${text.slice(0, 200)}`); }
  if (json.errors) {
    throw new Error(`fireflies_graphql_error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

async function listTranscripts(apiKey: string, fromIso: string, toIso: string): Promise<FirefliesTranscript[]> {
  // Fireflies GraphQL: transcripts(fromDate, toDate, limit)
  const query = `
    query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int) {
      transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit) {
        id
        title
        date
        transcript_url
        meeting_link
        summary {
          action_items
          overview
          short_summary
        }
      }
    }
  `;
  const data = await firefliesQuery(apiKey, query, { fromDate: fromIso, toDate: toIso, limit: TRANSCRIPT_FETCH_LIMIT });
  return (data as { transcripts?: FirefliesTranscript[] })?.transcripts ?? [];
}

// Fireflies action_items format examples:
//   "**Jelle Burggraaf**\n- Stuur offerte naar Acme\n- Plan call met John\n\n**George**\n- ..."
//   "Jelle: Stuur offerte naar Acme; Plan call met John"
// Heuristic: split on bold-name headers OR "Name:" lines, then bullet points.
function parseActionItems(t: FirefliesTranscript): ActionItemCandidate[] {
  if (!t.summary?.action_items) return [];
  const text = t.summary.action_items;
  const out: ActionItemCandidate[] = [];

  // Pattern A: **Name**\n- item\n- item
  // Split on **Name** headers (non-greedy)
  const sectionRegex = /\*\*([^*]+)\*\*([^*]*?)(?=\*\*|$)/gs;
  const sections: { name: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRegex.exec(text)) !== null) {
    sections.push({ name: m[1].trim(), body: m[2] });
  }

  // Pattern B fallback: "Name: ..." lines (when no bold sections found)
  if (sections.length === 0) {
    const lines = text.split(/\n/);
    for (const line of lines) {
      const colon = line.match(/^([A-Za-zÀ-ÿ\s]+):\s*(.+)$/);
      if (colon) sections.push({ name: colon[1].trim(), body: colon[2] });
    }
  }

  // For each section: if name matches Jelle-pattern, extract bullets
  let idx = 0;
  for (const s of sections) {
    const isJelle = JELLE_PATTERNS.some(p => p.test(s.name));
    if (!isJelle) continue;
    // Extract items: bullet points or sentences
    const bullets = s.body
      .split(/\n/)
      .map(line => line.replace(/^[\s\-•*\d.]+/, "").trim())
      .filter(line => line.length > 5 && line.length < 500);

    for (const item of bullets) {
      out.push({
        title: item,
        notes: `Uit meeting: ${t.title ?? "(geen titel)"}` + (t.date ? ` (${new Date(t.date).toISOString().slice(0,10)})` : ""),
        source_ref: `${t.id}::${idx}`,
        source_url: t.transcript_url ?? t.meeting_link ?? null,
        created_by: "fireflies-edge",
      });
      idx++;
    }
  }

  return out;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfgString(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    window_from: "" as string,
    window_to: "" as string,
    transcripts_scanned: 0,
    action_items_found_for_jelle: 0,
    tasks_inserted: 0,
    tasks_skipped_duplicate: 0,
    tasks_skipped_existing: 0,
    tasks_skipped_cap: 0,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "task-organizer-fireflies", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  const errors: { message: string; at: string }[] = [];

  try {
    const apiKey = await getCfgString(supabase, "fireflies-sync-etl", "api_key");
    if (!apiKey) throw new Error("fireflies_api_key_missing in agent_config(fireflies-sync-etl, api_key)");

    // Determine window
    const lastScan = await getCfg(supabase, "task-organizer", "fireflies_last_scan_at") as { iso?: string } | null;
    const now = new Date();
    let fromDate: Date;
    if (lastScan?.iso) {
      fromDate = new Date(lastScan.iso);
      if (isNaN(fromDate.getTime())) {
        stats.warnings.push("invalid_last_scan_iso_using_default");
        fromDate = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86400_000);
      }
    } else {
      fromDate = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 86400_000);
    }
    const maxBack = new Date(now.getTime() - MAX_WINDOW_DAYS * 86400_000);
    if (fromDate < maxBack) {
      stats.warnings.push("window_capped_to_30_days");
      fromDate = maxBack;
    }
    stats.window_from = fromDate.toISOString();
    stats.window_to = now.toISOString();

    // Fetch transcripts
    const transcripts = await listTranscripts(apiKey, stats.window_from, stats.window_to);
    stats.transcripts_scanned = transcripts.length;

    // Extract action items for Jelle
    const candidates: ActionItemCandidate[] = [];
    for (const t of transcripts) {
      const items = parseActionItems(t);
      candidates.push(...items);
    }
    stats.action_items_found_for_jelle = candidates.length;

    // Bulk register via RPC
    if (candidates.length > 0) {
      const { data: regResult, error: regErr } = await supabase.rpc("register_fireflies_action_items", {
        p_items: candidates,
        p_dedup_days: DEDUP_DAYS,
        p_dedup_threshold: DEDUP_THRESHOLD,
        p_cap: ACTION_ITEM_CAP,
      });
      if (regErr) throw new Error(`register_rpc_failed: ${regErr.message}`);
      const r = regResult as { inserted: number; skipped_duplicate: number; skipped_existing: number; skipped_cap: number };
      stats.tasks_inserted = r.inserted;
      stats.tasks_skipped_duplicate = r.skipped_duplicate;
      stats.tasks_skipped_existing = r.skipped_existing;
      stats.tasks_skipped_cap = r.skipped_cap;
    }

    // Update last_scan_at only on success
    await setCfg(supabase, "task-organizer", "fireflies_last_scan_at", { iso: now.toISOString() });

    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    const summary = `${stats.transcripts_scanned} meetings, ${stats.tasks_inserted} new tasks`
      + (stats.tasks_skipped_duplicate + stats.tasks_skipped_existing > 0
          ? `, ${stats.tasks_skipped_duplicate + stats.tasks_skipped_existing} dedup skips` : "");

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats, errors
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [...errors, { message: errMsg, at: new Date().toISOString() }]
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
