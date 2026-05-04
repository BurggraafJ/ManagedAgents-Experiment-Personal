// =============================================================================
// rag-search v4.0 — entity-aware optional retrieval (R.5 closing)
// =============================================================================
//
// v4 (2026-05-04 / R.5): optionele entity-filter via filter_entity_type +
//   filter_entity_id. Beide gegeven → match_chunks_for_entity (1-hop traversal
//   via v_entity_edges_full). Anders → match_chunks (semantic + BM25).
//
// v3 (2026-05-03 / R.4): hybrid retrieval via match_chunks RPC:
//   BM25 (FTS) + vector (HNSW halfvec) + RRF (Reciprocal Rank Fusion) + recency.
//   Returns chunks met out_vector_score, out_bm25_score, out_recency_score, out_combined_score.
//
// Frontend stuurt natuurlijke-taal query, deze functie embed via OpenAI en
// roept de juiste RPC aan. JWT-protected (anon key uit dashboard volstaat).
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const MODEL = "text-embedding-3-large";
const DIMENSIONS = 3072;
const MAX_INPUT_CHARS = 6000;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function embed(apiKey: string, input: string): Promise<{ embedding: number[]; tokens: number }> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: input.slice(0, MAX_INPUT_CHARS), dimensions: DIMENSIONS }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`openai_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return { embedding: json.data[0].embedding, tokens: json.usage.total_tokens };
}

function toVectorLiteral(arr: number[]): string {
  return "[" + arr.join(",") + "]";
}

interface SearchRequest {
  query: string;
  top_k?: number;
  filter_sources?: string[];
  filter_after?: string;
  filter_entity_type?: string;     // v4: 'company' | 'contact' | 'deal' | etc.
  filter_entity_id?: string;       // v4: id of entity to expand from
  min_similarity?: number;
  recency_weight?: number;
  recency_decay_days?: number;
  max_per_source?: number;         // v4: alleen relevant bij entity-filter
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    }});
  }
  const baseHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: SearchRequest;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders });
  }

  const query = (body.query ?? "").trim();
  if (!query || query.length < 2) {
    return new Response(JSON.stringify({ error: "query_required", min_chars: 2 }), { status: 400, headers: baseHeaders });
  }

  const top_k = Math.min(Math.max(body.top_k ?? 10, 1), 50);
  const min_similarity = body.min_similarity ?? 0.3;
  const recency_weight = body.recency_weight ?? 0.15;
  const recency_decay_days = body.recency_decay_days ?? 90.0;

  // v4: entity-filter detection
  const hasEntity = !!(body.filter_entity_type && body.filter_entity_id);
  const entity_type = hasEntity ? body.filter_entity_type! : null;
  const entity_id = hasEntity ? body.filter_entity_id! : null;
  const max_per_source = body.max_per_source ?? 3;

  try {
    const { data: health } = await supabase.rpc("sync_health_all");

    const apiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!apiKey) throw new Error("openai_embedding_key_missing");

    const t0 = Date.now();
    const { embedding, tokens } = await embed(apiKey, query);
    const tEmbed = Date.now() - t0;
    const embeddingLit = toVectorLiteral(embedding);

    const t1 = Date.now();
    let matches: any[] = [];
    let strategy: string;

    if (hasEntity) {
      // v4: entity-aware retrieval via match_chunks_for_entity
      const { data, error: rpcErr } = await supabase.rpc("match_chunks_for_entity", {
        p_entity_type: entity_type,
        p_entity_id: entity_id,
        p_query_embedding: embeddingLit,
        p_query_text: query,
        p_top_k: top_k,
        p_hop_depth: 1,
        p_filter_sources: body.filter_sources ?? null,
        p_filter_after: body.filter_after ?? null,
        p_min_similarity: min_similarity,
        p_recency_weight: recency_weight,
        p_recency_decay_days: recency_decay_days,
        p_max_per_source: max_per_source,
      });
      if (rpcErr) throw new Error(`rpc_failed: ${rpcErr.message}`);
      matches = data ?? [];
      strategy = "match_chunks_for_entity_v3";
    } else {
      // v3: standard hybrid via match_chunks
      const { data, error: rpcErr } = await supabase.rpc("match_chunks", {
        query_embedding: embeddingLit,
        query_text: query,
        top_k,
        filter_sources: body.filter_sources ?? null,
        filter_after: body.filter_after ?? null,
        filter_entity_id: null,
        min_similarity,
        recency_weight,
        recency_decay_days,
      });
      if (rpcErr) throw new Error(`rpc_failed: ${rpcErr.message}`);
      matches = data ?? [];
      strategy = "match_chunks_v1_hybrid";
    }
    const tSearch = Date.now() - t1;

    // Normaliseer naar legacy shape voor RagSearchView frontend
    const normalized = matches.map((m: any) => ({
      chunk_id: m.out_chunk_id,
      source: m.out_source,
      id: m.out_source_id,
      chunk_type: m.out_chunk_type,
      subject: (m.out_content ?? "").split("\n").slice(0, 1).join(" ").slice(0, 120) || null,
      preview: m.out_content,
      occurred_at: m.out_occurred_at,
      from_label: null,
      meta: m.out_metadata,
      similarity: m.out_combined_score,
      vector_score: m.out_vector_score,
      bm25_score: m.out_bm25_score,
      recency_score: m.out_recency_score,
      entity_path: m.out_entity_path ?? null,    // v4: alleen aanwezig bij entity-pad
    }));

    return new Response(JSON.stringify({
      ok: true,
      query,
      top_k,
      min_similarity,
      filter_sources: body.filter_sources ?? null,
      filter_entity_type: entity_type,
      filter_entity_id: entity_id,
      tokens_used: tokens,
      timing_ms: { embed: tEmbed, search: tSearch, total: tEmbed + tSearch },
      match_count: normalized.length,
      matches: normalized,
      retrieval_strategy: strategy,
      health,
    }), { status: 200, headers: baseHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
