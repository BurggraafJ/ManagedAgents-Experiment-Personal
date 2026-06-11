// =============================================================================
// context-build — Context-as-a-Service endpoint (R.6)
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SKILL_VERSION = "context-build-v2.5";
// v2.5 (2026-06-11, RAG v3.2 V2+V3): (a) query-intelligentie per intent via
// context_intents.query_intel_level ('off'|'entity'|'full') i.p.v. hardcoded search-only —
// enrich_record/extract_actions/compose_followup='full', analyze_meeting='entity',
// draft_reply HARD 'off' (kritiek pad; DR-asserts in rag_eval_questions bewaken query_intent=null).
// (b) entity-anchors: bij entity-routing worden de recipe.entity_anchor_top_n meest recente
// chunks met de entity-NAAM in content gegarandeerd aan de kandidatenset toegevoegd
// (naam-only BM25-matches verloren in RRF van vage vector-matches; vangt ook duplicate
// entity-records zoals 2x Rutgers & Posch). Default 0 = uit; per intent aangezet na meting.
// v2.4 (2026-06-04, RAG v3 F.8): enrichment-assen als ZACHTE retrieval-filters in match_chunks
// (alleen mail; non-mail bypasst). Auto-apply uit query-intel: ALLEEN asks_response (openstaande vragen,
// 17% mail-chunks, gemeten F8A R=0.8). sentiment=negative NIET auto: enricher labelt te conservatief
// (23/13k mail-chunks = 0.18%) → auto-filter stript de mail-laag (gemeten F8B R=0/P=0, alles naar
// engagement-bypass). party_type NIET auto (intern-over-klant-regressierisico). Beide alleen expliciet
// via options.filter_sentiment/filter_party_type. Activeert de mail_enrichment-investering (asks_response).
// v2.3 (2026-06-04, RAG v3 F.4+F.5): (a) entity-pad fallback — bij <5 entity-chunks aanvullen met
// semantische match_chunks (union-dedup); fixt dunne entities (Rutgers/Forsyte, F.0-baseline R=0).
// (b) retrieveK=min(max(top_k*3,40),80) zodat rerank daadwerkelijk vuurt (pool>top_k). (c) parseQueryIntent:
// bron-hints (meeting etc.) mergen met bedrag-sources i.p.v. uitsluiten. E06 false-positive opgelost in
// rag_resolve_entity (v_stop-uitbreiding, aparte migration).
// v2.2 (2026-06-04, RAG v3 F.1): fuzzy named-entity resolutie via rag_resolve_entity (harde
// distinctive-token gate in de RPC) op het zoek-pad (intent='search') als email/domein niets
// opleverde → match_chunks_for_entity. Fixt "stand met [kantoor]"-vragen zonder vrije semantiek
// te raken (gate weigert generieke woorden als 'advocaten'/'prijs'). Uit: options.resolve_entity=false.
// v2.1 (2026-06-03, RAG v2 F.1c): HyDE/multi-query voor intent='search' (niet-entity-pad).
// gpt-5.4-mini herschrijft de vraag naar 1-2 declaratieve varianten; origineel + varianten
// batch-embed (1 call); per variant match_chunks (parallel) → union-dedup op chunk_id (max
// combined_score). Skipt entity-pad (narrowt al) → chat-latency ongemoeid. Uit: options.rewrite=false.
// v2.0 (2026-06-03, RAG v2 F.3): recipe-params uit context_intents i.p.v. hardcode —
// p_max_edges (was load-bearing DB-default, P0-2-oorzaak), kb_min_similarity, jellemind_min_similarity.
// + recipe_params in retrieval_meta. Tunebaar zonder redeploy.
// v1.9 (2026-06-03): OpenAI-reranker gpt-4o-mini → gpt-5.4-mini (actueel; verouderd model
// vervangen na /v1/models-probe). Contract: max_completion_tokens + reasoning_effort='none'
// (geen max_tokens/temperature). reasoning_tokens=0 → snel.
// v1.8 (2026-06-03, RAG v2 F.1e): rerank-keten Cohere → OpenAI(gpt-5.4-mini) → Grok → Haiku.
// grok-4-fast bleek ~8s (te traag voor interactief zoeken); gpt-4o-mini is ~1-2s en de
// OpenAI-key bestaat al. Cohere blijft preferred-when-key-present. Harde 5s timeout op elke
// reranker -> zoeken hangt nooit (val terug op hybride volgorde). Jelle's keuze 'rerank nu'.
// v1.7 grok-rerank (te traag). v1.6 parseQueryIntent (F.1a). v1.5 avg_top_similarity=cosine (F.0.3).
// v1.4 KB-injectie. v1.3 Haiku via _shared. v1.2 JelleMind. v1.1 hybrid entity-fallback.
const EMBED_MODEL = "text-embedding-3-large";
const EMBED_DIM = 3072;
const RERANK_MODEL = "claude-haiku-4-5";
const COHERE_RERANK_ENDPOINT = "https://api.cohere.com/v2/rerank";
const COHERE_RERANK_MODEL = "rerank-v3.5";
const OPENAI_RERANK_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_RERANK_MODEL = "gpt-5.4-mini"; // F.1e actief: actueel + snel (reasoning_effort='none'); key skill:openai:embedding_key
const REWRITE_MODEL = "gpt-5.4-mini";       // F.1c HyDE/query-rewrite (zelfde model + endpoint, reasoning_effort='none')
const GROK_RERANK_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const GROK_RERANK_MODEL = "grok-4-fast";
const RERANK_TIMEOUT_MS = 5000;
const MAX_INPUT_CHARS = 6000;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
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

// F.1c — batch-embed meerdere queries in één OpenAI-call (volgorde-veilig via data.index).
async function embedMany(apiKey: string, inputs: string[]): Promise<{ vectors: number[][]; tokens: number }> {
  const clean = inputs.map((s) => (s ?? "").slice(0, MAX_INPUT_CHARS));
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: clean, dimensions: EMBED_DIM }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`openai_embed_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const vectors = (json.data ?? []).slice().sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
  return { vectors, tokens: json.usage?.total_tokens ?? 0 };
}

// F.1c — HyDE/query-rewrite: gpt-5.4-mini → tot 2 declaratieve herformuleringen voor betere recall.
async function rewriteQuery(apiKey: string, query: string): Promise<string[]> {
  if (!query || query.length < 4) return [];
  const prompt = `Herschrijf deze zoekvraag naar 2 korte, declaratieve alternatieve formuleringen die hetzelfde bedoelen (synoniemen/andere woordvolgorde) — voor betere semantische retrieval over zakelijke mail, meetings en deals. Geen uitleg.\n\nVraag: ${query.slice(0, 300)}\n\nAntwoord ALLEEN met een JSON-array van 2 strings.`;
  try {
    const res = await fetch(OPENAI_RERANK_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: REWRITE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: 200, reasoning_effort: "none" }),
      signal: AbortSignal.timeout(RERANK_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? "";
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    const ql = query.toLowerCase().trim();
    return arr.filter((x) => typeof x === "string" && x.trim().length > 2 && x.toLowerCase().trim() !== ql).map((x) => x.trim()).slice(0, 2);
  } catch { return []; }
}

// F.1a — parseQueryIntent: deterministische regex-routing vóór retrieval (Confluence 467763202 §5.2).
function parseQueryIntent(qRaw: string): {
  filter_after?: string | null; recency_weight?: number; filter_sources?: string[];
  from_email?: string; enrichment: Record<string, unknown>; matched: string[];
} {
  const out: any = { enrichment: {}, matched: [] };
  const q = qRaw ?? "";
  const lower = q.toLowerCase();
  const now = Date.now();
  const daysAgoIso = (d: number) => new Date(now - d * 86400000).toISOString();
  const rel = lower.match(/\b(vorige|afgelopen|deze|komende|laatste)\s+(week|weken|maand|maanden|kwartaal|jaar)\b/);
  if (rel) {
    const u = rel[2];
    const win = u.startsWith("week") ? 14 : u.startsWith("maand") ? 45 : u.startsWith("kwartaal") ? 100 : 400;
    out.filter_after = daysAgoIso(win); out.matched.push("relatieve_periode");
  }
  const yr = lower.match(/\b(?:in|sinds|sind|vanaf|voor|na|sedert)\s+(20\d{2})\b/);
  if (yr) { out.filter_after = `${yr[1]}-01-01T00:00:00Z`; out.matched.push("jaartal"); }
  if (/\b(recent|recente|recentste|laatste|laatst|meest recente|nu|huidige|momenteel|actuele|actueel)\b/.test(lower)) { out.recency_weight = 0.35; out.matched.push("recency_cue"); }
  if (/\b(ooit|allereerste|aller eerste|begin|historie|geschiedenis|vroeger|oorspronkelijk|destijds)\b/.test(lower)) { out.recency_weight = 0.05; out.filter_after = null; out.matched.push("historie_cue"); }
  if (/€\s?\d|\b\d+([.,]\d+)?\s?(k|mln|miljoen|euro)\b|\b(offerte|offertes|prijs|prijzen|tarief|tarieven|bedrag|factuur|amount|kost(en)?)\b/.test(lower)) { out.filter_sources = ["deal", "engagement", "mail"]; out.enrichment.amount_query = true; out.matched.push("bedrag"); }
  const em = q.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (em) { out.from_email = em[0].toLowerCase(); out.matched.push("email"); }
  if (/\b(proefperiode|pilot|trial|closed won|afgesloten|onderhandeling|kennismaking|verlenging|opzeg|opzegging|churn|renewal)\b/.test(lower)) { out.enrichment.cycle_stage_signal = true; out.matched.push("deal_stage"); }
  if (/\b(openstaand|openstaande|wacht.*antwoord|moet ik.*reageren|nog reageren|nog beantwoorden|onbeantwoord|vraag van)\b/.test(lower)) { out.enrichment.asks_response = true; out.matched.push("openstaande_vraag"); }
  const role = lower.match(/\b(advocaat|advocaten|partner|recruiter|leverancier|vendor|klant|klanten|aandeelhouder)\b/);
  if (role) { out.enrichment.party_role = role[1]; out.matched.push("persoon_rol"); }
  if (/\b(klacht|klachten|ontevreden|boos|gefrustreerd|urgent|spoed|escalat|asap)\b/.test(lower)) { out.enrichment.sentiment = "negative"; out.enrichment.urgency = "high"; out.matched.push("sentiment_urgentie"); }
  {
    // F.5 (RAG v3): bron-hints ALTIJD bepalen en mergen met eventuele bedrag-sources, zodat
    // "recente meetings over prijzen" niet de meetings verliest door de bedrag-regel.
    const s: string[] = [];
    if (/\b(mail|mails|e-?mail|e-?mails|mailtje|bericht|berichten)\b/.test(lower)) s.push("mail");
    if (/\b(meeting|meetings|gesprek|gesprekken|call|calls|fireflies)\b/.test(lower)) s.push("meeting");
    if (/\b(afspraak|afspraken|agenda)\b/.test(lower)) s.push("event");
    if (/\b(deal|deals|pijplijn|pipeline)\b/.test(lower)) s.push("deal");
    if (/\b(notitie|notities|note|notes)\b/.test(lower)) s.push("engagement");
    if (/\b(jira|taak|taken|ticket|tickets|issue|issues)\b/.test(lower)) s.push("jira");
    if (s.length) { out.filter_sources = out.filter_sources ? Array.from(new Set([...out.filter_sources, ...s])) : Array.from(new Set(s)); if (!out.matched.includes("bron_hint")) out.matched.push("bron_hint"); }
  }
  return out;
}

// Parseert een JSON-array van indices uit LLM-output en mapt terug op candidates (gedeeld door grok/openai/haiku-rerank).
function applyIndexRanking(content: string, candidates: any[], topN: number): { chunks: any[]; used: boolean } {
  const m = content.match(/\[[\d,\s]+\]/);
  if (!m) return { chunks: candidates.slice(0, topN), used: false };
  let idx: number[];
  try { idx = JSON.parse(m[0]); } catch { return { chunks: candidates.slice(0, topN), used: false }; }
  const seen = new Set<number>();
  const ranked: any[] = [];
  for (const i of idx) {
    if (typeof i === "number" && i >= 0 && i < candidates.length && !seen.has(i)) { ranked.push(candidates[i]); seen.add(i); }
    if (ranked.length >= topN) break;
  }
  for (let i = 0; i < candidates.length && ranked.length < topN; i++) if (!seen.has(i)) ranked.push(candidates[i]);
  return { chunks: ranked, used: ranked.length > 0 };
}

function rankPrompt(query: string, candidates: any[], topN: number, cap: number): string {
  const compact = candidates.slice(0, cap).map((c, i) => ({ i, src: c.source, snippet: (c.preview ?? c.content ?? "").slice(0, 260) }));
  return `Je bent een retrieval-ranker. Rangschik de top ${topN} kandidaat-indices die het MEEST RELEVANT zijn voor de vraag — op intent en inhoud, niet alleen woordmatch.

Vraag: ${query.slice(0, 500)}

Kandidaten:
${compact.map(c => `[${c.i}] (${c.src}): ${c.snippet}`).join("\n")}

Antwoord ALLEEN met een JSON-array van ${topN} indices, hoogste relevantie eerst. Voorbeeld: [3,7,1,12,5]`;
}

// F.1e — Cohere rerank-v3.5 (preferred-when-key-present; key onder skill 'rag-chat').
async function rerankWithCohere(apiKey: string, query: string, candidates: any[], topN: number): Promise<{ chunks: any[]; used: boolean; error?: string }> {
  if (!apiKey || candidates.length <= topN) return { chunks: candidates.slice(0, topN), used: false };
  try {
    const documents = candidates.slice(0, 60).map((c) => (c.preview ?? c.content ?? "").slice(0, 1200));
    const res = await fetch(COHERE_RERANK_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: COHERE_RERANK_MODEL, query, documents, top_n: topN }), signal: AbortSignal.timeout(RERANK_TIMEOUT_MS) });
    if (!res.ok) { const t = await res.text().catch(() => ""); return { chunks: candidates.slice(0, topN), used: false, error: `cohere_${res.status}: ${t.slice(0, 150)}` }; }
    const json = await res.json();
    const results: Array<{ index: number; relevance_score: number }> = json.results || [];
    if (!results.length) return { chunks: candidates.slice(0, topN), used: false };
    return { chunks: results.map((r) => ({ ...candidates[r.index], rerank_score: r.relevance_score })), used: true };
  } catch (e) { return { chunks: candidates.slice(0, topN), used: false, error: e instanceof Error ? e.message : String(e) }; }
}

// F.1e — OpenAI gpt-4o-mini LLM-rerank (ACTIEVE reranker; snel; key skill:openai:embedding_key).
async function rerankWithOpenAI(apiKey: string, query: string, candidates: any[], topN: number): Promise<{ chunks: any[]; used: boolean; error?: string }> {
  if (!apiKey || candidates.length <= topN) return { chunks: candidates.slice(0, topN), used: false };
  try {
    const res = await fetch(OPENAI_RERANK_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: OPENAI_RERANK_MODEL, messages: [{ role: "user", content: rankPrompt(query, candidates, topN, 30) }], max_completion_tokens: 512, reasoning_effort: "none" }), signal: AbortSignal.timeout(RERANK_TIMEOUT_MS) });
    if (!res.ok) { const t = await res.text().catch(() => ""); return { chunks: candidates.slice(0, topN), used: false, error: `openai_${res.status}: ${t.slice(0, 150)}` }; }
    const json = await res.json();
    return applyIndexRanking(json.choices?.[0]?.message?.content ?? "", candidates, topN);
  } catch (e) { return { chunks: candidates.slice(0, topN), used: false, error: e instanceof Error ? e.message : String(e) }; }
}

// F.1e — Grok-4-fast LLM-rerank (fallback; trager ~8s).
async function rerankWithGrok(apiKey: string, query: string, candidates: any[], topN: number): Promise<{ chunks: any[]; used: boolean; error?: string }> {
  if (!apiKey || candidates.length <= topN) return { chunks: candidates.slice(0, topN), used: false };
  try {
    const res = await fetch(GROK_RERANK_ENDPOINT, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: GROK_RERANK_MODEL, messages: [{ role: "user", content: rankPrompt(query, candidates, topN, 40) }], max_tokens: 128, temperature: 0 }), signal: AbortSignal.timeout(RERANK_TIMEOUT_MS) });
    if (!res.ok) { const t = await res.text().catch(() => ""); return { chunks: candidates.slice(0, topN), used: false, error: `grok_${res.status}: ${t.slice(0, 150)}` }; }
    const json = await res.json();
    return applyIndexRanking(json.choices?.[0]?.message?.content ?? "", candidates, topN);
  } catch (e) { return { chunks: candidates.slice(0, topN), used: false, error: e instanceof Error ? e.message : String(e) }; }
}

// Haiku-rerank — dormant fallback (geen anthropic-key).
async function rerankWithHaiku(supabase: SupabaseClient, apiKey: string, query: string, candidates: any[], topN: number = 5, agentRunId: string | null = null): Promise<{ ranked: any[]; tokens: number }> {
  if (!candidates || candidates.length <= topN) return { ranked: candidates, tokens: 0 };
  const r = await callAnthropic({ supabase, apiKey, model: RERANK_MODEL, max_tokens: 64, messages: [{ role: "user", content: rankPrompt(query, candidates, topN, 20) }], attribution: { runId: agentRunId, edgeFunction: "context-build", skillName: "context-build" } });
  const res = applyIndexRanking(r.content, candidates, topN);
  return { ranked: res.chunks, tokens: r.input_tokens + r.output_tokens };
}

async function resolveEntity(supabase: SupabaseClient, hint: { from_email?: string; from_domain?: string; entity_type?: string; entity_id?: string }): Promise<any | null> {
  if (hint.entity_type && hint.entity_id) return { entity_type: hint.entity_type, entity_id: hint.entity_id, via: 'explicit', confidence: 1.0 };
  if (hint.from_email) {
    const { data } = await supabase.from("entity_resolution").select("entity_id, confidence").eq("alias_type", "email").eq("alias_value", hint.from_email.toLowerCase()).eq("entity_type", "contact").order("confidence", { ascending: false }).limit(1).maybeSingle();
    if (data?.entity_id) return { entity_type: "contact", entity_id: data.entity_id, via: "email_exact", confidence: data.confidence };
  }
  if (hint.from_domain) {
    const { data } = await supabase.from("entity_resolution").select("entity_id, confidence").eq("alias_type", "email_domain").eq("alias_value", hint.from_domain.toLowerCase()).eq("entity_type", "company").order("confidence", { ascending: false }).limit(1).maybeSingle();
    if (data?.entity_id) return { entity_type: "company", entity_id: data.entity_id, via: "email_domain", confidence: data.confidence };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }});
  const baseHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders }); }

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
    const { data: recipe, error: recipeErr } = await supabase.rpc("get_context_intent", { p_intent: intent });
    if (recipeErr || !recipe) throw new Error(`unknown_intent: ${intent}`);
    const { data: freshness } = await supabase.rpc("sync_health_all");

    const apiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!apiKey) throw new Error("openai_embedding_key_missing");

    // v2.5: intel-niveau uit het intent-recipe; fallback = oud gedrag (search=full, rest off).
    const intelLevel: string = (recipe.query_intel_level as string) ?? (intent === "search" ? "full" : "off");
    const applyFullIntel = intelLevel === "full";
    const applyEntityIntel = intelLevel === "full" || intelLevel === "entity";
    const qi = applyFullIntel ? parseQueryIntent(queryText) : null;

    const wantsEntity = ['match_chunks_for_entity', 'hybrid'].includes(recipe.default_strategy) || options.force_entity === true;
    let entityUsed = null;
    if (wantsEntity) {
      entityUsed = await resolveEntity(supabase, { from_email: options.from_email ?? qi?.from_email, from_domain: options.from_domain, entity_type: options.entity_type, entity_id: options.entity_id });
    }

    // F.1 (RAG v3): fuzzy named-entity resolutie op het zoek-pad als email/domein niets opleverde.
    // Alleen intent='search' (draft_reply/enrich hebben from_email/explicit entity → ongemoeid).
    // rag_resolve_entity heeft een harde distinctive-token gate, dus generieke woorden routeren niet.
    if (!entityUsed && applyEntityIntel && (options.resolve_entity ?? true)) {
      try {
        const { data: rpcHit } = await supabase.rpc("rag_resolve_entity", { p_query: queryText });
        if (Array.isArray(rpcHit) && rpcHit.length > 0 && rpcHit[0]?.entity_id && Number(rpcHit[0].confidence ?? 0) >= 0.6) {
          const h = rpcHit[0];
          entityUsed = { entity_type: h.entity_type, entity_id: h.entity_id, via: h.via ?? "rag_resolve_entity", confidence: Number(h.confidence) || 0.7, name: h.name ?? null };
        }
      } catch (_e) { /* fuzzy resolutie is optioneel; val terug op match_chunks(+hyde) */ }
    }

    // 4.5 HyDE/multi-query (F.1c) — alleen op het niet-entity zoek-pad (entity narrowt al + houdt chat snel).
    const doRewrite = applyFullIntel && !entityUsed && (options.rewrite ?? true);
    let rewriteVariants: string[] = [];
    if (doRewrite) { rewriteVariants = await rewriteQuery(apiKey, queryText); }
    const queryList = [queryText, ...rewriteVariants].slice(0, 3);
    const tEmbed0 = Date.now();
    const embRes = await embedMany(apiKey, queryList);
    const embedTokens = embRes.tokens;
    const embeddingLits = embRes.vectors.map(toVectorLiteral);
    const embeddingLit = embeddingLits[0];
    const tEmbed = Date.now() - tEmbed0;

    const top_k = options.top_k ?? recipe.default_top_k;
    const recency_weight = options.recency_weight ?? qi?.recency_weight ?? Number(recipe.default_recency_weight);
    const recency_decay_days = options.recency_decay_days ?? Number(recipe.default_recency_decay_days);
    const min_similarity = options.min_similarity ?? Number(recipe.default_min_similarity);
    const max_per_source = options.max_per_source ?? recipe.default_max_per_source;
    const filterAfter = (() => {
      if (options.filter_after) return options.filter_after;
      if (qi && Object.prototype.hasOwnProperty.call(qi, "filter_after")) return qi.filter_after;
      if (recipe.default_lookback_days) { const d = new Date(); d.setDate(d.getDate() - recipe.default_lookback_days); return d.toISOString(); }
      return null;
    })();
    const filterSources = options.filter_sources ?? qi?.filter_sources ?? null;
    const filterAudience = options.filter_audience ?? recipe.default_filter_audience ?? null;
    const filterMeetingCategory = options.filter_meeting_category ?? recipe.default_filter_meeting_category ?? null;
    // F.8 (RAG v3): enrichment-filters (zacht voor non-mail in de RPC). Auto ALLEEN asks_response (gemeten goed, F8A R=0.8).
    const filterAsksResponse = options.filter_asks_response ?? (applyFullIntel && qi?.enrichment?.asks_response === true ? true : null);
    // sentiment NIET auto: enricher labelt negatief te conservatief (23/13k mail-chunks) → auto-filter stript de
    // mail-laag (F8B-meting R=0/P=0, alles via engagement-bypass). Alleen expliciet via options.filter_sentiment.
    const filterSentiment = options.filter_sentiment ?? null;
    const filterPartyType = options.filter_party_type ?? null; // niet auto: intern-over-klant-risico

    const enableRerank = options.enable_rerank ?? recipe.default_rerank ?? false;
    // F.4 (RAG v3): grotere candidate-pool zodat de reranker daadwerkelijk vuurt (pool > top_k).
    const retrieveK = enableRerank ? Math.min(Math.max(top_k * 3, 40), 80) : top_k;

    const tSearch0 = Date.now();
    let strategy: string;
    let rawMatches: any[];
    if (entityUsed) {
      strategy = "match_chunks_for_entity";
      const { data, error: rpcErr } = await supabase.rpc("match_chunks_for_entity", { p_entity_type: entityUsed.entity_type, p_entity_id: entityUsed.entity_id, p_query_embedding: embeddingLit, p_query_text: queryText, p_top_k: retrieveK, p_hop_depth: 1, p_filter_sources: filterSources, p_filter_after: filterAfter, p_min_similarity: min_similarity, p_recency_weight: recency_weight, p_recency_decay_days: recency_decay_days, p_max_edges: recipe.max_edges ?? 300, p_max_per_source: max_per_source, p_filter_audience: filterAudience, p_filter_meeting_category: filterMeetingCategory });
      if (rpcErr) throw new Error(`match_chunks_for_entity_failed: ${rpcErr.message}`);
      rawMatches = data ?? [];
      // F.4/F.0 (RAG v3): entity-pad te dun (bv. kleine company met weinig 1-hop chunks) → aanvullen
      // met semantische match_chunks zodat het antwoord context heeft (fixt R01 Rutgers n=1, RFO n=2).
      if ((rawMatches?.length ?? 0) < 5) {
        strategy = "match_chunks_for_entity+semantic";
        const { data: sem } = await supabase.rpc("match_chunks", { query_embedding: embeddingLit, query_text: queryText, top_k: retrieveK, filter_sources: filterSources, filter_after: filterAfter, filter_entity_id: null, min_similarity, recency_weight, recency_decay_days, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory });
        const seenE = new Set((rawMatches ?? []).map((m: any) => m.out_chunk_id));
        for (const row of (sem ?? [])) { if (!seenE.has(row.out_chunk_id)) { seenE.add(row.out_chunk_id); rawMatches.push(row); } }
        rawMatches = rawMatches.slice(0, retrieveK);
      }
    } else {
      strategy = embeddingLits.length > 1 ? "match_chunks+hyde" : "match_chunks";
      // Multi-query (F.1c): één match_chunks per (her)formulering, parallel; union-dedup op chunk_id (max combined_score).
      const perQuery = await Promise.all(embeddingLits.map((lit) =>
        supabase.rpc("match_chunks", { query_embedding: lit, query_text: queryText, top_k: retrieveK, filter_sources: filterSources, filter_after: filterAfter, filter_entity_id: null, min_similarity, recency_weight, recency_decay_days, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory, filter_party_type: filterPartyType, filter_sentiment: filterSentiment, filter_asks_response: filterAsksResponse })
          .then((r: any) => r.error ? [] : (r.data ?? []))
      ));
      const byId = new Map<string, any>();
      for (const rows of perQuery) for (const row of rows) {
        const ex = byId.get(row.out_chunk_id);
        if (!ex || (row.out_combined_score ?? 0) > (ex.out_combined_score ?? 0)) byId.set(row.out_chunk_id, row);
      }
      rawMatches = Array.from(byId.values()).sort((a, b) => (b.out_combined_score ?? 0) - (a.out_combined_score ?? 0)).slice(0, retrieveK);
    }
    // v2.5 (RAG v3.2 V3): entity-anchors — gegarandeerde inclusie van de meest recente chunks
    // die de entity-NAAM letterlijk noemen. Naam-only matches (deal/jira-kaarten) verloren in
    // RRF van vage vector-matches; bij een named-entity-vraag zijn ze juist de kern. Vangt ook
    // duplicate entity-records (naam-match is id-onafhankelijk). Config: recipe.entity_anchor_top_n.
    let anchorsInjected = 0;
    const anchorTopN = Number(recipe.entity_anchor_top_n ?? 0);
    if (entityUsed && anchorTopN > 0 && typeof entityUsed.name === "string" && entityUsed.name.length >= 3) {
      try {
        const { data: anchors } = await supabase.from("chunks")
          .select("chunk_id, source, source_id, chunk_type, content, occurred_at, metadata")
          .ilike("content", `%${entityUsed.name}%`)
          .not("embedding", "is", null)
          .neq("source", "action")
          .order("occurred_at", { ascending: false })
          .limit(anchorTopN);
        const seenA = new Set(rawMatches.map((m: any) => m.out_chunk_id));
        for (const a of (anchors ?? [])) {
          if (seenA.has(a.chunk_id)) continue;
          seenA.add(a.chunk_id);
          rawMatches.push({ out_chunk_id: a.chunk_id, out_source: a.source, out_source_id: a.source_id, out_chunk_type: a.chunk_type, out_content: a.content, out_occurred_at: a.occurred_at, out_metadata: a.metadata, out_combined_score: 0.5, out_vector_score: null, out_bm25_score: null, out_recency_score: null, out_entity_path: { via: "name_anchor", entity_id: entityUsed.entity_id } });
          anchorsInjected++;
        }
      } catch (_e) { /* anchors zijn optioneel — nooit de build laten falen */ }
      // Zonder reranker zou de ongesorteerde top_k-slice de (achteraan gepushte) anchors
      // direct weer afsnijden (gemeten: E29 kreeg 4 anchors en verloor ze alle 4).
      // Sorteer op combined_score: anchors (0.5) staan dan vóór RRF-scores (~0.02) —
      // bij rerank-intents beslist de reranker alsnog inhoudelijk over de hele pool.
      if (anchorsInjected > 0) {
        rawMatches.sort((a: any, b: any) => (b.out_combined_score ?? 0) - (a.out_combined_score ?? 0));
      }
    }
    const tSearch = Date.now() - tSearch0;

    const normalized = rawMatches.map((m: any) => ({ chunk_id: m.out_chunk_id, source: m.out_source, id: m.out_source_id, chunk_type: m.out_chunk_type, preview: m.out_content, occurred_at: m.out_occurred_at, metadata: m.out_metadata, similarity: m.out_combined_score, vector_score: m.out_vector_score, bm25_score: m.out_bm25_score, recency_score: m.out_recency_score, entity_path: m.out_entity_path ?? null }));

    // 8. Rerank — Cohere (preferred) → OpenAI gpt-4o-mini (actief) → Grok → Haiku.
    let finalMatches = normalized;
    let rerankTokens = 0;
    let tRerank = 0;
    let rerankProvider: string | null = null;
    if (enableRerank && normalized.length > top_k) {
      const tR0 = Date.now();
      const cohereKey = await getCfg(supabase, "rag-chat", "cohere_api_key");
      const openaiKey = cohereKey ? null : (await getCfg(supabase, "openai", "embedding_key"));
      if (cohereKey) {
        const r = await rerankWithCohere(cohereKey, queryText, normalized, top_k);
        finalMatches = r.chunks; if (r.used) rerankProvider = "cohere";
      } else if (openaiKey) {
        const r = await rerankWithOpenAI(openaiKey, queryText, normalized, top_k);
        finalMatches = r.chunks; if (r.used) rerankProvider = "openai";
      } else {
        const grokKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
        if (grokKey) {
          const r = await rerankWithGrok(grokKey, queryText, normalized, top_k);
          finalMatches = r.chunks; if (r.used) rerankProvider = "grok";
        } else {
          const haikuKey = await getCfg(supabase, "anthropic", "api_key");
          if (haikuKey) {
            try { const { ranked, tokens } = await rerankWithHaiku(supabase, haikuKey, queryText, normalized, top_k, (body.agent_run_id ?? null) as string | null); finalMatches = ranked; rerankTokens = tokens; rerankProvider = "haiku"; } catch (e) { finalMatches = normalized.slice(0, top_k); }
          } else { finalMatches = normalized.slice(0, top_k); }
        }
      }
      tRerank = Date.now() - tR0;
    } else if (normalized.length > top_k) {
      finalMatches = normalized.slice(0, top_k);
    }
    const wasReranked = rerankProvider !== null;

    // 8b. JelleMind lesson-injection — soft-fail
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
          const { data: lessons, error: lessonErr } = await supabase.rpc("match_jellemind_lessons", { query_embedding: embeddingLit, top_k: lessonTopK, min_similarity: recipe.jellemind_min_similarity ?? 0.40, applies_to_filter: null, mind_scope_filter: scope });
          if (lessonErr) { lessonInjectError = lessonInjectError ?? lessonErr.message; continue; }
          for (const l of (lessons ?? [])) { if (seenIds.has(l.id)) continue; seenIds.add(l.id); collected.push({ ...l, mind_scope: l.mind_scope ?? scope }); }
        } catch (e) { lessonInjectError = lessonInjectError ?? (e instanceof Error ? e.message : String(e)); }
      }
      collected.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      knowledgeLessons = collected.slice(0, lessonTopK);
      lessonScopesUsed = lessonScopes;
    }
    const tLesson = Date.now() - tLesson0;

    // 8c. Kennisbank-artikel-injectie — soft-fail.
    let kbInjected = 0;
    let kbInjectError: string | null = null;
    const injectKb = recipe.inject_kb ?? false;
    const kbTopK = Number(recipe.kb_top_k ?? 0);
    const tKb0 = Date.now();
    if (injectKb && kbTopK > 0) {
      try {
        const { data: kbRows, error: kbErr } = await supabase.rpc("match_chunks", { query_embedding: embeddingLit, query_text: queryText, top_k: kbTopK, filter_sources: ["kb_article"], filter_after: null, filter_entity_id: null, min_similarity: recipe.kb_min_similarity ?? 0.42, recency_weight: 0.05, recency_decay_days: 365, filter_audience: null, filter_meeting_category: null });
        if (kbErr) { kbInjectError = kbErr.message; }
        else {
          const seen = new Set(finalMatches.map((m: any) => m.chunk_id));
          for (const m of (kbRows ?? [])) {
            if (seen.has(m.out_chunk_id)) continue;
            seen.add(m.out_chunk_id);
            finalMatches.push({ chunk_id: m.out_chunk_id, source: m.out_source, id: m.out_source_id, chunk_type: m.out_chunk_type, preview: m.out_content, occurred_at: m.out_occurred_at, metadata: m.out_metadata, similarity: m.out_combined_score, vector_score: m.out_vector_score, bm25_score: m.out_bm25_score, recency_score: m.out_recency_score, entity_path: null, knowledge_layer: "kb_article" });
            kbInjected++;
          }
        }
      } catch (e) { kbInjectError = e instanceof Error ? e.message : String(e); }
    }
    const tKb = Date.now() - tKb0;

    const buildMs = Date.now() - t0;
    const tokensTotal = embedTokens + rerankTokens;
    const _vec = finalMatches.map((m: any) => m.vector_score).filter((v: any) => typeof v === "number");
    const avgVectorScore = _vec.length ? _vec.reduce((a: number, b: number) => a + b, 0) / _vec.length : null;
    const top1VectorScore = finalMatches.length > 0 ? (finalMatches[0].vector_score ?? null) : null;
    const _comb = finalMatches.map((m: any) => m.similarity).filter((v: any) => typeof v === "number");
    const avgCombinedScore = _comb.length ? _comb.reduce((a: number, b: number) => a + b, 0) / _comb.length : null;

    const retrievalMeta = {
      strategy, top_k, retrieved: rawMatches.length,
      recency_weight, recency_decay_days, min_similarity, max_per_source,
      filter_after: filterAfter, filter_sources: filterSources, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory,
      filter_party_type: filterPartyType, filter_sentiment: filterSentiment, filter_asks_response: filterAsksResponse,
      enable_rerank: enableRerank, rerank_applied: wasReranked, rerank_provider: rerankProvider,
      query_intent: qi,
      query_intel_level: intelLevel, anchors_injected: anchorsInjected,
      hyde: { applied: rewriteVariants.length > 0, variants: rewriteVariants, n_queries: queryList.length },
      recipe_params: { max_edges: recipe.max_edges ?? 300, kb_min_similarity: recipe.kb_min_similarity ?? null, jellemind_min_similarity: recipe.jellemind_min_similarity ?? null },
      timing_ms: { embed: tEmbed, search: tSearch, rerank: tRerank, lesson_inject: tLesson, kb_inject: tKb, total: buildMs },
      tokens: { embed: embedTokens, rerank: rerankTokens, total: tokensTotal },
      jellemind_inject: injectFlag, jellemind_scopes_used: lessonScopesUsed, jellemind_lessons_count: knowledgeLessons.length, jellemind_inject_error: lessonInjectError,
      kb_inject: injectKb, kb_injected: kbInjected, kb_inject_error: kbInjectError,
      similarity: { avg_vector_score: avgVectorScore, top1_vector_score: top1VectorScore, avg_combined_score: avgCombinedScore, n: finalMatches.length },
    };

    const { data: insertResult, error: insErr } = await supabase.from("context_bundles").insert({
      intent, audience, trigger_type: triggerType, trigger_ref_id: triggerId,
      primary_record: options.primary_record ?? null, related_chunks: finalMatches, entity_used: entityUsed, freshness,
      retrieval_meta: retrievalMeta, reranked: wasReranked, total_chunks: finalMatches.length,
      avg_top_similarity: avgVectorScore, tokens_used: tokensTotal, build_ms: buildMs, knowledge_lessons: knowledgeLessons,
    }).select("bundle_id").single();
    if (insErr || !insertResult) throw new Error(`bundle_insert_failed: ${insErr?.message}`);

    return new Response(JSON.stringify({
      ok: true, bundle_id: insertResult.bundle_id, intent, audience, query: queryText,
      entity_used: entityUsed, retrieval_strategy: strategy, reranked: wasReranked, match_count: finalMatches.length,
      matches: finalMatches, knowledge_lessons: knowledgeLessons,
      knowledge_articles: finalMatches.filter((m: any) => m.knowledge_layer === "kb_article"),
      retrieval_meta: retrievalMeta, query_intent: qi, freshness,
    }), { status: 200, headers: baseHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
