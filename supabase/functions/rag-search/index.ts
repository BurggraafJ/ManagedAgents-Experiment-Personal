// =============================================================================
// rag-search v5.0 — context-build consumer (R.6)
// =============================================================================
//
// v5 (2026-05-04 / R.6): rag-search is nu een dunne wrapper rond context-build.
//   Stuurt door als intent='search' met audience='rag-search-page'. Bundle_id
//   wordt teruggegeven aan frontend zodat log_search_feedback per chunk-klik
//   kan loggen naar rag_outcomes (R.7-link).
//
// v4 (2026-05-04 / R.5): optionele entity-filter via filter_entity_type.
// v3 (2026-05-03 / R.4): hybrid retrieval via match_chunks RPC.
//
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

interface SearchRequest {
  query: string;
  top_k?: number;
  filter_sources?: string[];
  filter_after?: string;
  filter_entity_type?: string;
  filter_entity_id?: string;
  min_similarity?: number;
  recency_weight?: number;
  recency_decay_days?: number;
  max_per_source?: number;
  enable_rerank?: boolean;
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

  try {
    // Roep context-build aan — alle retrieval-logic zit daar
    const cronSecret = await getCfg(supabase, "global", "cron_secret");
    if (!cronSecret) throw new Error("cron_secret_missing");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    const options: Record<string, any> = {};
    if (body.top_k) options.top_k = body.top_k;
    if (body.filter_sources) options.filter_sources = body.filter_sources;
    if (body.filter_after) options.filter_after = body.filter_after;
    if (body.filter_entity_type) options.entity_type = body.filter_entity_type;
    if (body.filter_entity_id) options.entity_id = body.filter_entity_id;
    if (body.min_similarity != null) options.min_similarity = body.min_similarity;
    if (body.recency_weight != null) options.recency_weight = body.recency_weight;
    if (body.recency_decay_days != null) options.recency_decay_days = body.recency_decay_days;
    if (body.max_per_source != null) options.max_per_source = body.max_per_source;
    if (body.enable_rerank != null) options.enable_rerank = body.enable_rerank;

    const t0 = Date.now();
    const cbRes = await fetch(`${supabaseUrl}/functions/v1/context-build`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cronSecret}` },
      body: JSON.stringify({
        intent: "search",
        audience: "rag-search-page",
        trigger_type: "search",
        trigger_id: null,
        query_text: query,
        options,
      }),
    });
    const cbText = await cbRes.text();
    if (!cbRes.ok) throw new Error(`context-build_${cbRes.status}: ${cbText.slice(0, 300)}`);
    const cb = JSON.parse(cbText);
    if (!cb.ok) throw new Error(`context-build_response_not_ok: ${cb.error ?? 'unknown'}`);

    // Normaliseer naar legacy shape voor RagSearchView
    const normalized = (cb.matches ?? []).map((m: any) => ({
      chunk_id: m.chunk_id,
      source: m.source,
      id: m.id,
      chunk_type: m.chunk_type,
      subject: (m.preview ?? m.content ?? "").split("\n").slice(0, 1).join(" ").slice(0, 120) || null,
      preview: m.preview ?? m.content,
      occurred_at: m.occurred_at,
      from_label: null,
      meta: m.metadata,
      similarity: m.similarity,
      vector_score: m.vector_score,
      bm25_score: m.bm25_score,
      recency_score: m.recency_score,
      entity_path: m.entity_path,
    }));

    return new Response(JSON.stringify({
      ok: true,
      bundle_id: cb.bundle_id,                           // NIEUW v5: voor feedback-link
      query,
      top_k: body.top_k ?? cb.retrieval_meta?.top_k,
      min_similarity: body.min_similarity ?? cb.retrieval_meta?.min_similarity,
      filter_sources: body.filter_sources ?? null,
      filter_entity_type: cb.entity_used?.entity_type ?? body.filter_entity_type ?? null,
      filter_entity_id: cb.entity_used?.entity_id ?? body.filter_entity_id ?? null,
      entity_used: cb.entity_used,
      reranked: cb.reranked,
      tokens_used: cb.retrieval_meta?.tokens?.total ?? 0,
      timing_ms: cb.retrieval_meta?.timing_ms ?? { embed: 0, search: 0, total: Date.now() - t0 },
      match_count: normalized.length,
      matches: normalized,
      retrieval_strategy: cb.retrieval_strategy,
      retrieval_meta: cb.retrieval_meta,
      health: cb.freshness,
    }), { status: 200, headers: baseHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
