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
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SKILL_VERSION = "context-build-v1.5";
// v1.5 (2026-06-02, RAG v2 F.0.3): avg_top_similarity = echte avg(vector_score/cosine)
// over de teruggegeven matches i.p.v. finalMatches[0].similarity (= combined_score van
// alléén de top-chunk, ~0.16, geen gemiddelde). + retrieval_meta.similarity-breakdown
// (avg_vector_score, top1_vector_score, avg_combined_score, n). Maakt retrieval-kwaliteit
// pas meetbaar voor de quality-loop (zie Confluence 467763202 §4 F.0).
// v1.4 (2026-05-30): Kennisbank-artikel-injectie als knowledge-laag (8c). Per intent
// in context_intents {inject_kb, kb_top_k} bepaalt of gevalideerde kb_articles
// (source=kb_article) source-agnostisch worden bijgehaald en aan de matches toegevoegd
// (gededupliceerd). Nodig omdat match_chunks_for_entity ze nooit vindt (geen entity_ids).
// Soft-fail: KB-fout blokkeert retrieval niet. Aan voor draft_reply/compose_followup/enrich_record.
// v1.3 (2026-05-18): Haiku-rerank loopt nu via centrale wrapper
// _shared/anthropic-fetch.ts — schrijft elke call naar claude_api_calls voor
// cost-attributie en loop-detectie. Functioneel identiek aan v1.2: zelfde
// model (claude-haiku-4-5), zelfde prompt-format, zelfde rerank-output.
// Optionele body-param agent_run_id wordt doorgegeven aan wrapper voor
// FK-koppeling naar agent_runs. Zie Confluence 450101261.
// v1.2 (2026-05-04): JelleMind-lesson injection als 4e laag in de bundle.
// Per intent in context_intents bepaalt {inject_jellemind, jellemind_scopes,
// jellemind_top_k} of en hoeveel lessons worden toegevoegd. RPC
// match_jellemind_lessons wordt per scope aangeroepen en de top-N over alle
// scopes komen in bundle.knowledge_lessons. Soft-fail als lesson-match faalt —
// retrieval blijft werken zonder lessons.
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
  supabase: SupabaseClient,
  apiKey: string,
  query: string,
  candidates: any[],
  topN: number = 5,
  agentRunId: string | null = null,
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

  // Centrale wrapper — logt elke call naar claude_api_calls (zie project 450101261).
  const r = await callAnthropic({
    supabase,
    apiKey,
    model: RERANK_MODEL,
    max_tokens: 64,
    messages: [{ role: "user", content: prompt }],
    attribution: {
      runId: agentRunId,
      edgeFunction: "context-build",
      skillName: "context-build",
    },
  });

  // Parse JSON-array uit response
  const match = r.content.match(/\[[\d,\s]+\]/);
  if (!match) {
    // Fallback: behoud originele volgorde
    return { ranked: candidates.slice(0, topN), tokens: r.input_tokens };
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
  const tokensUsed = r.input_tokens + r.output_tokens;
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
    const filterAudience = options.filter_audience ?? recipe.default_filter_audience ?? null;
    const filterMeetingCategory = options.filter_meeting_category ?? recipe.default_filter_meeting_category ?? null;

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
        p_filter_audience: filterAudience,
        p_filter_meeting_category: filterMeetingCategory,
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
        filter_audience: filterAudience,
        filter_meeting_category: filterMeetingCategory,
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
          const { ranked, tokens } = await rerankWithHaiku(
            supabase, haikuKey, queryText, normalized, top_k,
            (body.agent_run_id ?? null) as string | null,
          );
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

    // 8b. JelleMind lesson-injection — soft-fail
    // Per intent staat in context_intents of (en hoe) lessons mee moeten.
    // Lessons komen uit RPC match_jellemind_lessons, gefilterd op mind_scope.
    // Gebruikt min_similarity 0.40 (hoger dan chunks default) want lessons
    // landen in elke prompt — moeten echt relevant zijn anders ruis.
    let knowledgeLessons: any[] = [];
    let lessonScopesUsed: string[] = [];
    let lessonInjectError: string | null = null;
    const tLesson0 = Date.now();
    const injectFlag = recipe.inject_jellemind ?? false;
    const lessonScopes: string[] = Array.isArray(recipe.jellemind_scopes) ? recipe.jellemind_scopes : [];
    const lessonTopK: number = Number(recipe.jellemind_top_k ?? 0);
    if (injectFlag && lessonTopK > 0 && lessonScopes.length > 0) {
      const seenIds = new Set<string>();
      const collected: any[] = [];
      for (const scope of lessonScopes) {
        try {
          const { data: lessons, error: lessonErr } = await supabase.rpc("match_jellemind_lessons", {
            query_embedding: embeddingLit,
            top_k: lessonTopK,
            min_similarity: 0.40,
            applies_to_filter: null,
            mind_scope_filter: scope,
          });
          if (lessonErr) {
            lessonInjectError = lessonInjectError ?? lessonErr.message;
            continue;
          }
          for (const l of (lessons ?? [])) {
            if (seenIds.has(l.id)) continue;
            seenIds.add(l.id);
            collected.push({ ...l, mind_scope: l.mind_scope ?? scope });
          }
        } catch (e) {
          lessonInjectError = lessonInjectError ?? (e instanceof Error ? e.message : String(e));
        }
      }
      collected.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      knowledgeLessons = collected.slice(0, lessonTopK);
      lessonScopesUsed = lessonScopes;
    }
    const tLesson = Date.now() - tLesson0;

    // 8c. Kennisbank-artikel-injectie — soft-fail knowledge-laag.
    // KB-artikelen zijn generiek (niet entity-gebonden), dus match_chunks_for_entity
    // vindt ze nooit. We doen een aparte source-agnostische match_chunks(filter=kb_article)
    // en voegen de top-N toe aan finalMatches, gededupliceerd op chunk_id (zodat bij
    // source-agnostische intents geen dubbeling ontstaat). Consumers (auto-draft) zien
    // ze gewoon als context-matches met metadata.audience + knowledge_layer='kb_article'.
    let kbInjected = 0;
    let kbInjectError: string | null = null;
    const injectKb = recipe.inject_kb ?? false;
    const kbTopK = Number(recipe.kb_top_k ?? 0);
    const tKb0 = Date.now();
    if (injectKb && kbTopK > 0) {
      try {
        const { data: kbRows, error: kbErr } = await supabase.rpc("match_chunks", {
          query_embedding: embeddingLit,
          query_text: queryText,
          top_k: kbTopK,
          filter_sources: ["kb_article"],
          filter_after: null,
          filter_entity_id: null,
          min_similarity: 0.42,
          recency_weight: 0.05,
          recency_decay_days: 365,
          filter_audience: null,
          filter_meeting_category: null,
        });
        if (kbErr) {
          kbInjectError = kbErr.message;
        } else {
          const seen = new Set(finalMatches.map((m: any) => m.chunk_id));
          for (const m of (kbRows ?? [])) {
            if (seen.has(m.out_chunk_id)) continue;
            seen.add(m.out_chunk_id);
            finalMatches.push({
              chunk_id: m.out_chunk_id, source: m.out_source, id: m.out_source_id,
              chunk_type: m.out_chunk_type, preview: m.out_content, occurred_at: m.out_occurred_at,
              metadata: m.out_metadata, similarity: m.out_combined_score,
              vector_score: m.out_vector_score, bm25_score: m.out_bm25_score,
              recency_score: m.out_recency_score, entity_path: null, knowledge_layer: "kb_article",
            });
            kbInjected++;
          }
        }
      } catch (e) {
        kbInjectError = e instanceof Error ? e.message : String(e);
      }
    }
    const tKb = Date.now() - tKb0;

    // 9. Schrijf bundle
    const buildMs = Date.now() - t0;
    const tokensTotal = embedTokens + rerankTokens;

    // Retrieval-kwaliteit (F.0.3 RAG v2): echte cosine-stats over de matches.
    // Historiek: avg_top_similarity was finalMatches[0].similarity = combined_score
    // (RRF+recency) van alléén de top-chunk (~0.16) — geen gemiddelde, geen
    // embedding-kwaliteitsmaat. Nu: avg(vector_score) over alle matches + top1 cosine.
    const _vec = finalMatches.map((m: any) => m.vector_score).filter((v: any) => typeof v === "number");
    const avgVectorScore = _vec.length ? _vec.reduce((a: number, b: number) => a + b, 0) / _vec.length : null;
    const top1VectorScore = finalMatches.length > 0 ? (finalMatches[0].vector_score ?? null) : null;
    const _comb = finalMatches.map((m: any) => m.similarity).filter((v: any) => typeof v === "number");
    const avgCombinedScore = _comb.length ? _comb.reduce((a: number, b: number) => a + b, 0) / _comb.length : null;

    const retrievalMeta = {
      strategy, top_k, retrieved: rawMatches.length,
      recency_weight, recency_decay_days, min_similarity, max_per_source,
      filter_after: filterAfter, filter_sources: filterSources,
      filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory,
      enable_rerank: enableRerank, rerank_applied: enableRerank && rerankTokens > 0,
      timing_ms: { embed: tEmbed, search: tSearch, rerank: tRerank, lesson_inject: tLesson, kb_inject: tKb, total: buildMs },
      tokens: { embed: embedTokens, rerank: rerankTokens, total: tokensTotal },
      // Phase E — JelleMind A/B telemetrie
      jellemind_inject: injectFlag,
      jellemind_scopes_used: lessonScopesUsed,
      jellemind_lessons_count: knowledgeLessons.length,
      jellemind_inject_error: lessonInjectError,
      // Kennisbank knowledge-laag (v1.4)
      kb_inject: injectKb,
      kb_injected: kbInjected,
      kb_inject_error: kbInjectError,
      // Retrieval-kwaliteit (v1.5 / F.0.3): echte cosine-stats i.p.v. de oude mislabel
      similarity: {
        avg_vector_score: avgVectorScore,
        top1_vector_score: top1VectorScore,
        avg_combined_score: avgCombinedScore,
        n: finalMatches.length,
      },
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
        avg_top_similarity: avgVectorScore,  // v1.5: echte avg(cosine) over matches (was top1 combined_score)
        tokens_used: tokensTotal,
        build_ms: buildMs,
        knowledge_lessons: knowledgeLessons,
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
      knowledge_lessons: knowledgeLessons,
      knowledge_articles: finalMatches.filter((m: any) => m.knowledge_layer === "kb_article"),
      retrieval_meta: retrievalMeta,
      freshness,
    }), { status: 200, headers: baseHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
