// =============================================================================
// context-build v1.0 — Context-as-a-Service endpoint (R.6)
// =============================================================================
// Eén centraal endpoint dat alle skills via bundle_id consumeren ipv elke skill
// zijn eigen RAG-call doet. Architectuur §5 Principe 2.
//
// Flow:
//   1. Skill stuurt {intent, audience, trigger_type, trigger_id, options}
//   2. Edge Function leest config uit context_intents
//   3. Embed query (uit trigger of options.query_text)
//   4. Optionele entity-resolution (uit options.entity_hint of from_email)
//   5. Roept match_chunks of match_chunks_for_entity aan obv default_strategy
//   6. Optionele Haiku-rerank op top-15 → top-K (default uit, search default aan)
//   7. Schrijft naar context_bundles + retourneert bundle_id + bundle-payload
//
// Skills lezen of via bundle_id (latere call) of direct uit response. Outcomes
// loggen ze via rag_outcomes met context_bundle_id-link voor R.7-analyse.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "context-build-v1.1";
// v1.1 (2026-05-04): 'hybrid' strategy probeert eerst entity-resolve, valt
// terug op match_chunks als entity niet kan worden bepaald. Fix voor draft_reply
// recipe waar v1.0 de entity-laag oversloeg.
const EMBED_MODEL = "text-embedding-3-large";
const EMBED_DIM = 3072;
const RERANK_MODEL = "claude-haiku-4-5";   // Goedkoop + voldoende voor query-relevance ranking
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
    body: JSON.stringify({ model: EMBED_MODEL, input: input.slice(0, MAX_INPUT_CHARS), dimensions: EMBED_DIM }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`openai_embed_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return { embedding: json.data[0].embedding, tokens: json.usage.total_tokens };
}

function toVectorLiteral(arr: number[]): string { return "[" + arr.join(",") + "]"; }

// ---------------------------------------------------------------------------
// Optionele Haiku-rerank — query-relevance scoring voorbij surface-similarity
// ---------------------------------------------------------------------------
async function rerankWithHaiku(
  apiKey: string,
  query: string,
  candidates: any[],
  topN: number = 5
): Promise<{ ranked: any[]; tokens: number }> {
  if (!candidates || candidates.length <= topN) return { ranked: candidates, tokens: 0 };

  // Compact candidate-payload zodat Haiku-context klein blijft
  const compact = candidates.slice(0, 20).map((c, i) => ({
    i,
    src: c.source,
    snippet: (c.preview ?? c.content ?? "").slice(0, 280),
  }));

  const prompt = `Je bent een retrieval-ranker. Hieronder een gebruiksvraag en ${compact.length} kandidaat-snippets uit verschillende bronnen. Rangschik de top ${topN} indices die het MEEST RELEVANT zijn voor de vraag — niet alleen op woordovereenkomst maar ook op intent en context.

Vraag: ${query.slice(0, 500)}

Kandidaten:
${compact.map(c => `[${c.i}] (${c.src}): ${c.snippet}`).join("\n")}

Antwoord ALLEEN met een JSON-array van ${topN} indices, hoogste relevantie eerst. Voorbeeld: [3,7,1,12,5]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: RERANK_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`anthropic_rerank_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const content = json.content?.[0]?.text ?? "";

  // Parse JSON-array uit response
  const match = content.match(/\[[\d,\s]+\]/);
  if (!match) {
    // Fallback: behoud originele volgorde
    return { ranked: candidates.slice(0, topN), tokens: json.usage?.input_tokens ?? 0 };
  }
  let indices: number[];
  try { indices = JSON.parse(match[0]); } catch { return { ranked: candidates.slice(0, topN), tokens: 0 }; }

  // Map terug op originele candidates, behoud rest als vulling
  const seen = new Set<number>();
  const ranked: any[] = [];
  for (const i of indices) {
    if (typeof i === "number" && i >= 0 && i < candidates.length && !seen.has(i)) {
      ranked.push({ ...candidates[i], _rerank_position: ranked.length });
      seen.add(i);
    }
    if (ranked.length >= topN) break;
  }
  // Vul aan als rerank te weinig gaf
  for (let i = 0; i < candidates.length && ranked.length < topN; i++) {
    if (!seen.has(i)) ranked.push(candidates[i]);
  }
  const tokensUsed = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
  return { ranked, tokens: tokensUsed };
}

// ---------------------------------------------------------------------------
// Entity-resolution helper — analoog aan autodraft-rag-prefill v4
// ---------------------------------------------------------------------------
async function resolveEntity(
  supabase: SupabaseClient,
  hint: { from_email?: string; from_domain?: string; entity_type?: string; entity_id?: string }
): Promise<any | null> {
  // 1. Expliciete entity in hint?
  if (hint.entity_type && hint.entity_id) {
    return { entity_type: hint.entity_type, entity_id: hint.entity_id, via: 'explicit', confidence: 1.0 };
  }
  // 2. from_email exact → contact
  if (hint.from_email) {
    const { data } = await supabase.from("entity_resolution")
      .select("entity_id, confidence")
      .eq("alias_type", "email").eq("alias_value", hint.from_email.toLowerCase())
      .eq("entity_type", "contact").order("confidence", { ascending: false }).limit(1).maybeSingle();
    if (data?.entity_id) return { entity_type: "contact", entity_id: data.entity_id, via: "email_exact", confidence: data.confidence };
  }
  // 3. from_domain → company
  if (hint.from_domain) {
    const { data } = await supabase.from("entity_resolution")
      .select("entity_id, confidence")
      .eq("alias_type", "email_domain").eq("alias_value", hint.from_domain.toLowerCase())
      .eq("entity_type", "company").order("confidence", { ascending: false }).limit(1).maybeSingle();
    if (data?.entity_id) return { entity_type: "company", entity_id: data.entity_id, via: "email_domain", confidence: data.confidence };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
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

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders });
  }

  const intent = body.intent;
  const audience = body.audience ?? null;
  const triggerType = body.trigger_type ?? null;
  const triggerId = body.trigger_id ?? null;
  const queryText = (body.query_text ?? "").trim();
  const options = body.options ?? {};

  if (!intent) return new Response(JSON.stringify({ error: "intent_required" }), { status: 400, headers: baseHeaders });
  if (!queryText || queryText.length < 2) return new Response(JSON.stringify({ error: "query_text_required" }), { status: 400, headers: baseHeaders });

  const t0 = Date.now();

  try {
    // 1. Lees recipe uit context_intents
    const { data: recipe, error: recipeErr } = await supabase.rpc("get_context_intent", { p_intent: intent });
    if (recipeErr || !recipe) throw new Error(`unknown_intent: ${intent}`);

    // 2. Sync-health snapshot
    const { data: freshness } = await supabase.rpc("sync_health_all");

    // 3. Embed
    const apiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!apiKey) throw new Error("openai_embedding_key_missing");
    const tEmbed0 = Date.now();
    const { embedding, tokens: embedTokens } = await embed(apiKey, queryText);
    const tEmbed = Date.now() - tEmbed0;
    const embeddingLit = toVectorLiteral(embedding);

    // 4. Entity-resolution — voor 'match_chunks_for_entity' (verplicht) en
    // 'hybrid' (best-effort: gebruik entity-aware als resolveerbaar, anders fallback).
    const wantsEntity = ['match_chunks_for_entity', 'hybrid'].includes(recipe.default_strategy)
      || options.force_entity === true;
    let entityUsed = null;
    if (wantsEntity) {
      entityUsed = await resolveEntity(supabase, {
        from_email: options.from_email,
        from_domain: options.from_domain,
        entity_type: options.entity_type,
        entity_id: options.entity_id,
      });
    }

    // 5. Retrieval params (recipe override-able via options)
    const top_k = options.top_k ?? recipe.default_top_k;
    const recency_weight = options.recency_weight ?? Number(recipe.default_recency_weight);
    const recency_decay_days = options.recency_decay_days ?? Number(recipe.default_recency_decay_days);
    const min_similarity = options.min_similarity ?? Number(recipe.default_min_similarity);
    const max_per_source = options.max_per_source ?? recipe.default_max_per_source;
    const filterAfter = (() => {
      if (options.filter_after) return options.filter_after;
      if (recipe.default_lookback_days) {
        const d = new Date();
        d.setDate(d.getDate() - recipe.default_lookback_days);
        return d.toISOString();
      }
      return null;
    })();
    const filterSources = options.filter_sources ?? null;

    // 6. Run retrieval — meer kandidaten ophalen (×3) als rerank aan staat
    const enableRerank = options.enable_rerank ?? recipe.default_rerank ?? false;
    const retrieveK = enableRerank ? Math.min(top_k * 3, 20) : top_k;

    const tSearch0 = Date.now();
    let strategy: string;
    let rawMatches: any[];

    if (entityUsed) {
      strategy = "match_chunks_for_entity";
      const { data, error: rpcErr } = await supabase.rpc("match_chunks_for_entity", {
        p_entity_type: entityUsed.entity_type,
        p_entity_id: entityUsed.entity_id,
        p_query_embedding: embeddingLit,
        p_query_text: queryText,
        p_top_k: retrieveK,
        p_hop_depth: 1,
        p_filter_sources: filterSources,
        p_filter_after: filterAfter,
        p_min_similarity: min_similarity,
        p_recency_weight: recency_weight,
        p_recency_decay_days: recency_decay_days,
        p_max_per_source: max_per_source,
      });
      if (rpcErr) throw new Error(`match_chunks_for_entity_failed: ${rpcErr.message}`);
      rawMatches = data ?? [];
    } else {
      strategy = "match_chunks";
      const { data, error: rpcErr } = await supabase.rpc("match_chunks", {
        query_embedding: embeddingLit,
        query_text: queryText,
        top_k: retrieveK,
        filter_sources: filterSources,
        filter_after: filterAfter,
        filter_entity_id: null,
        min_similarity,
        recency_weight,
        recency_decay_days,
      });
      if (rpcErr) throw new Error(`match_chunks_failed: ${rpcErr.message}`);
      rawMatches = data ?? [];
    }
    const tSearch = Date.now() - tSearch0;

    // 7. Normaliseer naar legacy match-shape
    const normalized = rawMatches.map((m: any) => ({
      chunk_id: m.out_chunk_id,
      source: m.out_source,
      id: m.out_source_id,
      chunk_type: m.out_chunk_type,
      preview: m.out_content,
      occurred_at: m.out_occurred_at,
      metadata: m.out_metadata,
      similarity: m.out_combined_score,
      vector_score: m.out_vector_score,
      bm25_score: m.out_bm25_score,
      recency_score: m.out_recency_score,
      entity_path: m.out_entity_path ?? null,
    }));

    // 8. Optionele Haiku-rerank
    let finalMatches = normalized;
    let rerankTokens = 0;
    let tRerank = 0;
    if (enableRerank && normalized.length > top_k) {
      const haikuKey = await getCfg(supabase, "anthropic", "api_key");
      if (haikuKey) {
        try {
          const tR0 = Date.now();
          const { ranked, tokens } = await rerankWithHaiku(haikuKey, queryText, normalized, top_k);
          finalMatches = ranked;
          rerankTokens = tokens;
          tRerank = Date.now() - tR0;
        } catch (e) {
          // Rerank-fail blokkeert niet — log warning, behoud retrieval-volgorde
          finalMatches = normalized.slice(0, top_k);
        }
      } else {
        // Geen Anthropic key beschikbaar — skip rerank, log warning
        finalMatches = normalized.slice(0, top_k);
      }
    } else if (normalized.length > top_k) {
      finalMatches = normalized.slice(0, top_k);
    }

    // 9. Schrijf bundle
    const buildMs = Date.now() - t0;
    const tokensTotal = embedTokens + rerankTokens;
    const retrievalMeta = {
      strategy, top_k, retrieved: rawMatches.length,
      recency_weight, recency_decay_days, min_similarity, max_per_source,
      filter_after: filterAfter, filter_sources: filterSources,
      enable_rerank: enableRerank, rerank_applied: enableRerank && rerankTokens > 0,
      timing_ms: { embed: tEmbed, search: tSearch, rerank: tRerank, total: buildMs },
      tokens: { embed: embedTokens, rerank: rerankTokens, total: tokensTotal },
    };

    const { data: insertResult, error: insErr } = await supabase
      .from("context_bundles")
      .insert({
        intent, audience, trigger_type: triggerType, trigger_ref_id: triggerId,
        primary_record: options.primary_record ?? null,
        related_chunks: finalMatches,
        entity_used: entityUsed,
        freshness,
        retrieval_meta: retrievalMeta,
        reranked: enableRerank && rerankTokens > 0,
        total_chunks: finalMatches.length,
        avg_top_similarity: finalMatches.length > 0 ? finalMatches[0].similarity : null,
        tokens_used: tokensTotal,
        build_ms: buildMs,
      })
      .select("bundle_id").single();
    if (insErr || !insertResult) throw new Error(`bundle_insert_failed: ${insErr?.message}`);

    return new Response(JSON.stringify({
      ok: true,
      bundle_id: insertResult.bundle_id,
      intent, audience,
      query: queryText,
      entity_used: entityUsed,
      retrieval_strategy: strategy,
      reranked: enableRerank && rerankTokens > 0,
      match_count: finalMatches.length,
      matches: finalMatches,
      retrieval_meta: retrievalMeta,
      freshness,
    }), { status: 200, headers: baseHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
