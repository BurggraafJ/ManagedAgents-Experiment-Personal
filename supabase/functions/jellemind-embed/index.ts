// jellemind-embed v1
// Vervangt pass 4 van jellemind skill: embedt accepted lessons via OpenAI text-embedding-3-small.
// Geactiveerd via pg_cron (bv. */15 * * * *) of door trigger-RPC.
//
// Secrets-storage: agent_config met is_secret=true (consistent met andere edge fns).
//   - global.cron_secret             Shared met andere edge functies
//   - openai.embedding_key           OpenAI API key
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "jellemind-embed-edge-fn-v1";
const MAX_LESSONS_PER_RUN = 100;
const OPENAI_BATCH_SIZE = 100;
const MODEL = "text-embedding-3-large";
const DIMENSIONS = 3072;

interface Lesson {
  id: string;
  lesson_text: string;
  lesson_type: string;
  applies_to: string[] | null;
  evidence_summary: string | null;
  mind_scope: string;
  embedding: number[] | null;
  embedding_input_hash: string | null;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Secrets live in Supabase Vault (encrypted, audit-logged).
  // Non-secret config (project IDs, settings, watermarks) lives in agent_config.
  // Try Vault first; if not present, read non-secret from agent_config.
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

function buildEmbeddingInput(l: Lesson): string {
  const applies = l.applies_to && l.applies_to.length > 0 && l.applies_to[0] !== "*"
    ? l.applies_to.join(", ")
    : "alle agents";
  const evidence = l.evidence_summary ? `\nVoorbeeld: ${l.evidence_summary.split(/[.!?]/)[0].slice(0, 200)}` : "";
  return `[${l.mind_scope}] [${l.lesson_type}]\nToepassing: ${applies}\n${l.lesson_text}${evidence}`.slice(0, 8000);
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function embedBatch(apiKey: string, inputs: string[], retry = 0): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIMENSIONS }),
  });
  if (res.status === 429 && retry < 2) {
    const delays = [1000, 4000];
    await new Promise(r => setTimeout(r, delays[retry]));
    return embedBatch(apiKey, inputs, retry + 1);
  }
  if (res.status >= 500 && retry < 2) {
    const delays = [1000, 4000];
    await new Promise(r => setTimeout(r, delays[retry]));
    return embedBatch(apiKey, inputs, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`openai_embed_${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { data: { embedding: number[] }[] };
  return json.data.map(d => d.embedding);
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
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
    lessons_total_pending: 0,
    lessons_embedded: 0,
    lessons_skipped_unchanged: 0,
    lessons_skipped_empty: 0,
    openai_errors: 0,
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "jellemind-embed", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  const errors: { message: string; at: string }[] = [];

  try {
    const apiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!apiKey) throw new Error("openai_embedding_key_missing in agent_config(openai, embedding_key)");

    const { data: lessons, error: selErr } = await supabase
      .from("jellemind_lessons")
      .select("id, lesson_text, lesson_type, applies_to, evidence_summary, mind_scope, embedding, embedding_input_hash")
      .eq("active", true)
      .is("embedding", null)
      .order("created_at", { ascending: true })
      .limit(MAX_LESSONS_PER_RUN);

    if (selErr) throw new Error(`lesson_select_failed: ${selErr.message}`);
    stats.lessons_total_pending = lessons?.length ?? 0;

    if (!lessons || lessons.length === 0) {
      const summary = "Geen lessons zonder embedding.";
      await supabase.from("agent_runs").update({
        status: "success", completed_at: new Date().toISOString(), summary, stats
      }).eq("id", runId);
      return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Build inputs + filter unchanged hashes
    const candidates: { lesson: Lesson; input: string; hash: string }[] = [];
    for (const l of lessons as Lesson[]) {
      if (!l.lesson_text || l.lesson_text.trim().length === 0) {
        stats.lessons_skipped_empty++;
        continue;
      }
      const input = buildEmbeddingInput(l);
      const hash = await sha256Hex(input);
      if (l.embedding && l.embedding_input_hash === hash) {
        stats.lessons_skipped_unchanged++;
        continue;
      }
      candidates.push({ lesson: l, input, hash });
    }

    // Batch embed
    for (let i = 0; i < candidates.length; i += OPENAI_BATCH_SIZE) {
      const batch = candidates.slice(i, i + OPENAI_BATCH_SIZE);
      try {
        const vectors = await embedBatch(apiKey, batch.map(b => b.input));
        for (let j = 0; j < batch.length; j++) {
          const { lesson, hash } = batch[j];
          const embedding = vectors[j];
          if (!embedding || embedding.length !== DIMENSIONS) {
            stats.openai_errors++;
            errors.push({ message: `embedding_dim_mismatch_lesson_${lesson.id}`, at: new Date().toISOString() });
            continue;
          }
          const { error: updErr } = await supabase.from("jellemind_lessons").update({
            embedding: "[" + embedding.join(",") + "]",
            embedding_input_hash: hash,
            embedded_at: new Date().toISOString(),
            embedding_model: MODEL,
          }).eq("id", lesson.id);
          if (updErr) {
            stats.openai_errors++;
            errors.push({ message: `update_failed_lesson_${lesson.id}: ${updErr.message}`, at: new Date().toISOString() });
            continue;
          }
          stats.lessons_embedded++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stats.openai_errors += batch.length;
        errors.push({ message: `batch_failed: ${msg}`, at: new Date().toISOString() });
      }
    }

    const finalStatus = stats.openai_errors > 0 && stats.lessons_embedded === 0 ? "error"
      : stats.openai_errors > 0 ? "warning" : "success";
    const summary = `${stats.lessons_embedded} lessons embedded`
      + (stats.lessons_skipped_unchanged > 0 ? `, ${stats.lessons_skipped_unchanged} unchanged` : "")
      + (stats.openai_errors > 0 ? `, ${stats.openai_errors} errors` : "");

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(),
      summary, stats, errors,
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
