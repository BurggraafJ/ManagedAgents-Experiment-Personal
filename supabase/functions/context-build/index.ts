// =============================================================================
// context-build — Context-as-a-Service endpoint (R.6)
//
// v2.10 (2026-09-06, spoor 06f-α): drie recept-kolommen gaan door naar de
//     RPC's — max_per_record (cap per (source, source_id), beide RPC's),
//     max_per_source (per-bron-cap van match_chunks; NIET default_max_per_source,
//     dat blijft de cap van het entity-pad) en source_overrides (exclude /
//     future_ok / caps per bron). Gemeten reden: meetings leverden 19,3 chunks
//     per search_fast-bundel, 1,87 per meeting (77 % uit multi-chunk-records).
//     De RPC zet nu zelf hnsw.ef_search=80 en, bij een hard filter, de
//     iteratieve HNSW-scan (een tijdscue op mail gaf 1 van 40 fragmenten) —
//     zie migratie 20260906210000. Niets anders in dit bestand verandert.
//
// v2.9 (2026-09-06, ANSWER-STACK S3b stap 1): OPENAI_RERANK_MODEL en
//     REWRITE_MODEL gpt-5.4-mini → gpt-5.6-luna. Zelfde endpoint en contract
//     (max_completion_tokens + reasoning_effort 'none'), 3,75× goedkoper op
//     input; de LLM-rerank over ~40 kandidaten is het grootste deel van de
//     niet-gelogde OpenAI-overhead per semantische vraag. Recepten ongewijzigd.
//
// v2.8 (2026-09-05, WP1+WP2): twee dingen.
//
// (a) `bm25_enabled` uit het recept. Is hij false, dan gaat query_text als NULL
//     naar match_chunks en slaat de lexicale arm zichzelf over. Gemeten reden:
//     de OR-tsquery (' & ' → ' | ') matcht 4.316-17.617 van de 48.475 chunks per
//     echte vraag, en ts_rank_cd moet over die hele set — 1 tot 10 seconden,
//     terwijl dezelfde aanroep vector-only 7 ms doet. Zie migratie
//     20260905180000 voor de volledige meting. Default true = niets verandert
//     voor de acht bestaande recepten.
//
// (b) `coverage` — een leeg antwoord noemt zijn oorzaak (beginsel 8). Vijf
//     redenen uit een gesloten verzameling: timeout | acl_filtered |
//     below_threshold | truly_empty | not_tracked. De duurdere twee (below_
//     threshold vs truly_empty) worden alleen onderscheiden als de bundel
//     werkelijk leeg is, met één goedkope probe zonder drempel. In het normale
//     geval kost dit niets.
//
// v2.7 (2026-09-05): caller_user_id-passthrough naar match_chunks /
// match_chunks_for_entity als p_caller_user_id — de Confluence-space-ACL.
// BEWUST een tweede as naast owner_user_id: die zegt "wiens mail", deze zegt
// "wie ben je". Zonder waarde = alleen org_baseline-spaces (fail-closed), dus
// een cron-agent komt nooit bij een restricted space. Zie CONFLUENCE-RAG.md.
// v2.6 (2026-09-02): owner_user_id-passthrough naar match_chunks /
// match_chunks_for_entity. Zonder waarde = de default-scope (gedeeld corpus +
// de scope='org'-mailbox), dus het gedrag van vandaag; mét waarde = gedeeld +
// die ene mailbox. Zie MAIL-PIPELINE.md §3.6.
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";
import { requireCronOrServiceRole } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "context-build-v2.10-caps";

// WP2 — de gesloten verzameling redenen waarom een bundel leeg is. Deze vijf
// woorden reizen ongewijzigd door naar rag-chat, naar het antwoord dat de
// gebruiker leest en naar rag_chat_query_log. Nooit uitbreiden zonder de
// eval-asserts (expect_coverage_reason) mee te nemen.
type CoverageReason = "timeout" | "acl_filtered" | "below_threshold" | "truly_empty" | "not_tracked";
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
const OPENAI_RERANK_MODEL = "gpt-5.6-luna"; // F.1e actief (v2.9: was gpt-5.4-mini): snel, reasoning_effort='none'; key skill:openai:embedding_key
const REWRITE_MODEL = "gpt-5.6-luna";       // F.1c HyDE/query-rewrite (zelfde model + endpoint, reasoning_effort='none')
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
    // v1.142: Confluence-spiegel. Bewust smal gehouden — "pagina" en
    // "kennisbank" zijn te generiek ("kennisbank" hoort bij kb_article, dat via
    // een eigen match_chunks-call met filter_sources=['kb_article'] loopt).
    if (/\b(confluence|wiki|documentatie|handboek)\b/.test(lower)) s.push("confluence");
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

  // F-05 (security review 2026-09-02): dit endpoint stond op verify_jwt=false
  // ZONDER interne auth-check, terwijl het RAG-chunks (mail-, meeting- en
  // HubSpot-inhoud) teruggeeft en per call betaalde embeddings + reranker-LLM's
  // aanroept. De aanroeper (rag-search) stuurde de cron_secret al mee — hij
  // werd alleen niet gecontroleerd. verify_jwt blijft false: server-to-server,
  // conform de hard-rule in CLAUDE.md.
  const gate = await requireCronOrServiceRole(req, supabase, { "Access-Control-Allow-Origin": "*" });
  if (!gate.ok) return gate.response;

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders }); }

  const intent = body.intent;
  const audience = body.audience ?? null;
  const triggerType = body.trigger_type ?? null;
  const triggerId = body.trigger_id ?? null;
  const queryText = (body.query_text ?? "").trim();
  const options = body.options ?? {};
  // Per-user RAG (2026-09-02): welke mailbox mag deze bundel zien?
  // null = de default-scope van rag_owner_scope_ids() → gedeeld corpus + de
  // scope='org'-mailbox(en). Een caller die de mailbox van één gebruiker wil,
  // geeft owner_user_id mee en krijgt gedeeld + die gebruiker.
  // Zie migratie mail_accounts_b_chunks_owner_2026_09_02.sql.
  const ownerUserId: string | null =
    typeof body.owner_user_id === "string" && body.owner_user_id.length > 0
      ? body.owner_user_id
      : (typeof options.owner_user_id === "string" && options.owner_user_id.length > 0
          ? options.owner_user_id : null);
  // v1.145 — WIE stelt de vraag? Aparte as, los van ownerUserId hierboven.
  // ownerUserId zegt "wiens mail mag meedoen" (rag_owner_scope_ids);
  // callerUserId zegt "welke Confluence-spaces mag deze persoon lezen"
  // (confluence_allowed_spaces). Ze hergebruiken zou betekenen dat het
  // repareren van de space-ACL stilzwijgend het mailbereik van elke chatvraag
  // verandert — zie migratie 20260905170000.
  //
  // Afwezig (cron, server-to-server) = null = alleen org_baseline-spaces.
  // Fail-closed: nooit een restricted space voor een naamloze aanroeper.
  const callerUserId: string | null =
    typeof body.caller_user_id === "string" && body.caller_user_id.length > 0
      ? body.caller_user_id
      : (typeof options.caller_user_id === "string" && options.caller_user_id.length > 0
          ? options.caller_user_id : null);
  if (!intent) return new Response(JSON.stringify({ error: "intent_required" }), { status: 400, headers: baseHeaders });
  if (!queryText || queryText.length < 2) return new Response(JSON.stringify({ error: "query_text_required" }), { status: 400, headers: baseHeaders });

  const t0 = Date.now();
  try {
    // v2.8 — drie onafhankelijke opstartrondjes, dus parallel. Ze stonden
    // achter elkaar en dat kostte drie PostgREST-retourtjes op het kritieke pad
    // (gemeten: get_context_intent 1 ms, sync_health_all 170 ms, Vault 2 ms —
    // de rekentijd is verwaarloosbaar, de latency niet).
    const [recipeRes, freshnessRes, apiKey] = await Promise.all([
      supabase.rpc("get_context_intent", { p_intent: intent }),
      supabase.rpc("sync_health_all"),
      getCfg(supabase, "openai", "embedding_key"),
    ]);
    const { data: recipe, error: recipeErr } = recipeRes as any;
    if (recipeErr || !recipe) throw new Error(`unknown_intent: ${intent}`);
    const freshness = (freshnessRes as any)?.data ?? null;
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
    // v2.10 (06f-α) — caps en bron-overrides uit het recept (migratie 20260906211000).
    // max_per_record geldt voor beide RPC's (PARTITION BY source, source_id).
    // maxPerSourceFlat is de per-bron-cap van match_chunks en staat bewust los van
    // max_per_source hierboven: dat is al jaren de cap van het entity-pad (waarde 3)
    // en dezelfde knop hergebruiken zou search_fast tot 3 mailchunks per bundel
    // terugbrengen. NULL = geen cap = het gedrag van vóór 2026-09-06.
    const maxPerRecord: number | null = options.max_per_record ?? recipe.max_per_record ?? null;
    const maxPerSourceFlat: number | null = options.max_per_source_flat ?? recipe.max_per_source ?? null;
    const sourceOverrides: Record<string, unknown> | null = options.source_overrides ?? recipe.source_overrides ?? null;
    const filterAfter = (() => {
      if (options.filter_after) return options.filter_after;
      if (qi && Object.prototype.hasOwnProperty.call(qi, "filter_after")) return qi.filter_after;
      if (recipe.default_lookback_days) { const d = new Date(); d.setDate(d.getDate() - recipe.default_lookback_days); return d.toISOString(); }
      return null;
    })();
    // v2.7 — laatste tak nieuw: het recept mag zelf zeggen welke bronnen erbij
    // horen. Nodig omdat query_intel_level='off' niet alleen HyDE uitzet maar
    // ook parseQueryIntent, en dáár zit de bron-hint in. Zonder deze fallback
    // doorzocht een documentatievraag op het lichte recept alle ~48k chunks
    // (8,3 s, statement-timeout) in plaats van de ~1000 wiki-chunks (0,5 s).
    // Volgorde blijft: wat de aanroeper vraagt wint, dan de query-hint, dan het
    // recept, dan alles. Zie migratie 20260905176000.
    const filterSources = options.filter_sources ?? qi?.filter_sources ?? recipe.default_filter_sources ?? null;
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

    // v2.8 — de lexicale arm. match_chunks slaat BM25 over zodra query_text NULL
    // is (`WHERE query_text IS NOT NULL AND length(query_text) > 1`), dus dit is
    // één waarde en geen tweede codepad. De aanroeper mag overrulen, daarna het
    // recept, daarna aan (het gedrag van vóór v2.8).
    const bm25Enabled: boolean = options.bm25 ?? recipe.bm25_enabled ?? true;
    const bm25Text: string | null = bm25Enabled ? queryText : null;

    const tSearch0 = Date.now();
    let strategy: string;
    let rawMatches: any[];
    // v2.7 — waarom een bundel leeg is. Zonder dit is een mislukte match_chunks
    // in het bundel-log niet te onderscheiden van een index zonder treffers.
    const vectorErrors: string[] = [];
    if (entityUsed) {
      strategy = "match_chunks_for_entity";
      const { data, error: rpcErr } = await supabase.rpc("match_chunks_for_entity", { p_entity_type: entityUsed.entity_type, p_entity_id: entityUsed.entity_id, p_query_embedding: embeddingLit, p_query_text: bm25Text, p_top_k: retrieveK, p_hop_depth: 1, p_filter_sources: filterSources, p_filter_after: filterAfter, p_min_similarity: min_similarity, p_recency_weight: recency_weight, p_recency_decay_days: recency_decay_days, p_max_edges: recipe.max_edges ?? 300, p_max_per_source: max_per_source, p_filter_audience: filterAudience, p_filter_meeting_category: filterMeetingCategory, p_owner_user_id: ownerUserId, p_caller_user_id: callerUserId, p_max_per_record: maxPerRecord, p_source_overrides: sourceOverrides });
      if (rpcErr) throw new Error(`match_chunks_for_entity_failed: ${rpcErr.message}`);
      rawMatches = data ?? [];
      // F.4/F.0 (RAG v3): entity-pad te dun (bv. kleine company met weinig 1-hop chunks) → aanvullen
      // met semantische match_chunks zodat het antwoord context heeft (fixt R01 Rutgers n=1, RFO n=2).
      if ((rawMatches?.length ?? 0) < 5) {
        strategy = "match_chunks_for_entity+semantic";
        const { data: sem, error: semErr } = await supabase.rpc("match_chunks", { query_embedding: embeddingLit, query_text: bm25Text, top_k: retrieveK, filter_sources: filterSources, filter_after: filterAfter, filter_entity_id: null, min_similarity, recency_weight, recency_decay_days, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory, p_owner_user_id: ownerUserId, p_caller_user_id: callerUserId, max_per_record: maxPerRecord, max_per_source: maxPerSourceFlat, source_overrides: sourceOverrides });
        if (semErr) vectorErrors.push(`entity_fallback: ${String(semErr.message).slice(0, 180)}`);
        const seenE = new Set((rawMatches ?? []).map((m: any) => m.out_chunk_id));
        for (const row of (sem ?? [])) { if (!seenE.has(row.out_chunk_id)) { seenE.add(row.out_chunk_id); rawMatches.push(row); } }
        rawMatches = rawMatches.slice(0, retrieveK);
      }
    } else {
      strategy = embeddingLits.length > 1 ? "match_chunks+hyde" : "match_chunks";
      // Multi-query (F.1c): één match_chunks per (her)formulering, parallel; union-dedup op chunk_id (max combined_score).
      const perQuery = await Promise.all(embeddingLits.map((lit) =>
        supabase.rpc("match_chunks", { query_embedding: lit, query_text: bm25Text, top_k: retrieveK, filter_sources: filterSources, filter_after: filterAfter, filter_entity_id: null, min_similarity, recency_weight, recency_decay_days, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory, filter_party_type: filterPartyType, filter_sentiment: filterSentiment, filter_asks_response: filterAsksResponse, p_owner_user_id: ownerUserId, p_caller_user_id: callerUserId, max_per_record: maxPerRecord, max_per_source: maxPerSourceFlat, source_overrides: sourceOverrides })
          // v2.7: de fout NIET meer weggooien. Dit stond hier als
          // `r.error ? [] : r.data` en maakte van een mislukte RPC stilzwijgend
          // "0 fragmenten" — niet te onderscheiden van "niets gevonden". Gemeten
          // op prod: dezelfde documentatievraag gaf afwisselend 20 fragmenten
          // (search 5,2s) en nul (search 8,2s), zonder één spoor in het bundel-log.
          // Een statement-timeout op het brede pad zag er dus precies zo uit als
          // een lege index. Nu landt de reden in retrieval_meta.vector_errors.
          .then((r: any) => { if (r.error) { vectorErrors.push(String(r.error.message || r.error).slice(0, 200)); return []; } return r.data ?? []; })
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
      // v2.8 — de scopes zijn onafhankelijk, dus parallel in plaats van in een
      // for-await. Drie scopes waren drie sequentiële PostgREST-retourtjes op
      // het kritieke pad voor ~1 ms rekenwerk per stuk. De dedup daarna houdt
      // de scope-volgorde aan, zodat de uitkomst identiek blijft.
      const perScope = await Promise.all(lessonScopes.map((scope) =>
        supabase.rpc("match_jellemind_lessons", { query_embedding: embeddingLit, top_k: lessonTopK, min_similarity: recipe.jellemind_min_similarity ?? 0.40, applies_to_filter: null, mind_scope_filter: scope })
          .then((r: any) => ({ scope, rows: r.error ? [] : (r.data ?? []), error: r.error?.message ?? null }))
          .catch((e: any) => ({ scope, rows: [], error: e instanceof Error ? e.message : String(e) }))
      ));
      for (const { scope, rows, error } of perScope) {
        if (error) { lessonInjectError = lessonInjectError ?? error; continue; }
        for (const l of rows) { if (seenIds.has(l.id)) continue; seenIds.add(l.id); collected.push({ ...l, mind_scope: l.mind_scope ?? scope }); }
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
        const { data: kbRows, error: kbErr } = await supabase.rpc("match_chunks", { query_embedding: embeddingLit, query_text: queryText, top_k: kbTopK, filter_sources: ["kb_article"], filter_after: null, filter_entity_id: null, min_similarity: recipe.kb_min_similarity ?? 0.42, recency_weight: 0.05, recency_decay_days: 365, filter_audience: null, filter_meeting_category: null, p_owner_user_id: ownerUserId, p_caller_user_id: callerUserId });
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

    // ── v2.8 (WP2): waarom is deze bundel leeg? ────────────────────────────
    // Beginsel 8 — een leeg antwoord noemt zijn oorzaak. Tot nu toe was
    // `total_chunks: 0` één woord voor vijf verschillende situaties, en de
    // gebruiker kreeg er dezelfde vriendelijke alinea bij.
    //
    // Alles hieronder draait ALLEEN als de bundel leeg is. Een normale vraag
    // betaalt hier niets voor.
    let coverageReason: CoverageReason | null = null;
    let coverageProbe: Record<string, unknown> | null = null;
    let aclScope: { caller_identified: boolean; visible_spaces: number | null; total_spaces: number | null } | null = null;
    if (finalMatches.length === 0) {
      // 1. Is de retrieval stukgelopen? Dan zegt "0 fragmenten" niets over de index.
      if (vectorErrors.some((e) => /timeout|timed ?out|canceling statement/i.test(e))) {
        coverageReason = "timeout";
      } else {
        // 2. Was de wiki in beeld én ziet deze aanroeper hem maar half? Alleen
        //    dán is acl_filtered een bewering die we kunnen waarmaken. We zeggen
        //    NOOIT wát er is afgeschermd — het bestaan van een pagina in een
        //    afgeschermde space is zelf informatie (§5.9).
        const lookedAtWiki = filterSources === null || (Array.isArray(filterSources) && filterSources.includes("confluence"));
        if (lookedAtWiki) {
          try {
            const [{ data: allowed }, { count: totalSpaces }] = await Promise.all([
              supabase.rpc("confluence_allowed_spaces", { p_user: callerUserId }),
              supabase.from("confluence_spaces").select("space_key", { count: "exact", head: true }),
            ]);
            const visible = Array.isArray(allowed) ? allowed.length : null;
            aclScope = { caller_identified: !!callerUserId, visible_spaces: visible, total_spaces: totalSpaces ?? null };
            if (visible != null && totalSpaces != null && visible < totalSpaces) coverageReason = "acl_filtered";
          } catch { /* ACL-scope is een toelichting, nooit een blokkade */ }
        }
        // 3. Stond er iets, maar onder de drempel? Eén probe zonder drempel en
        //    zonder bronfilter. Dit is de vraag "is de index leeg of is mijn
        //    lat te hoog", en het antwoord daarop stuurt de retry in rag-chat.
        if (!coverageReason) {
          try {
            const { data: probe, error: probeErr } = await supabase.rpc("match_chunks", {
              query_embedding: embeddingLit, query_text: null, top_k: 5,
              filter_sources: null, filter_after: null, filter_entity_id: null,
              min_similarity: 0.0, recency_weight, recency_decay_days,
              filter_audience: null, filter_meeting_category: null,
              p_owner_user_id: ownerUserId, p_caller_user_id: callerUserId,
            });
            if (probeErr) { coverageReason = "not_tracked"; coverageProbe = { error: String(probeErr.message).slice(0, 160) }; }
            else {
              const n = (probe ?? []).length;
              const best = n > 0 ? (probe[0].out_vector_score ?? null) : null;
              coverageReason = n > 0 ? "below_threshold" : "truly_empty";
              coverageProbe = { n, best_vector_score: best, threshold: min_similarity };
            }
          } catch (e) { coverageReason = "not_tracked"; coverageProbe = { error: e instanceof Error ? e.message.slice(0, 160) : String(e) }; }
        }
      }
    }
    // `searched` is wat er daadwerkelijk in de zoekruimte zat, niet wat we hoopten.
    const searchedSources: string[] = Array.isArray(filterSources) && filterSources.length > 0
      ? filterSources
      : ["mail", "meeting", "event", "deal", "engagement", "company", "contact", "jira", "confluence", "kb_article"];
    const coverage = {
      reason: coverageReason,
      searched: searchedSources,
      bm25: bm25Enabled,
      min_similarity,
      filter_after: filterAfter,
      acl: aclScope,
      probe: coverageProbe,
    };

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
      // v2.10 (06f-α) — de caps die naar de RPC's gingen; NULL = uit.
      max_per_record: maxPerRecord, max_per_source_flat: maxPerSourceFlat, source_overrides: sourceOverrides,
      filter_after: filterAfter, filter_sources: filterSources, filter_audience: filterAudience, filter_meeting_category: filterMeetingCategory,
      filter_party_type: filterPartyType, filter_sentiment: filterSentiment, filter_asks_response: filterAsksResponse,
      enable_rerank: enableRerank, rerank_applied: wasReranked, rerank_provider: rerankProvider,
      // Leeg = echt niets gevonden. Gevuld = de retrieval is stukgelopen; dan
      // zegt `retrieved: 0` niets over de index.
      vector_errors: vectorErrors,
      // v2.8 — de lexicale arm stond aan of uit, en waarom de bundel leeg is.
      bm25_enabled: bm25Enabled,
      coverage,
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

    // v2.8 — het bundel-schrijfje is de grootste rest-post op het kritieke pad:
    // 40 chunks mét volledige content als JSONB, gemeten 0,4-2,0 s vóór de
    // response de deur uit mag. Voor een interactieve chatvraag is dat een
    // audit-schrijfje waar de gebruiker op staat te wachten.
    //
    // `options.async_bundle: true` genereert de bundle_id hier en laat de INSERT
    // ná de response doorlopen (EdgeRuntime.waitUntil). De id in het antwoord is
    // dan al geldig; de rij verschijnt milliseconden later. Alleen rag-chat zet
    // hem aan — evalpaden die direct ná de call in context_bundles lezen houden
    // het synchrone gedrag, want daar is de race echt.
    const asyncBundle = options.async_bundle === true;
    const bundleRow = {
      intent, audience, trigger_type: triggerType, trigger_ref_id: triggerId,
      primary_record: options.primary_record ?? null, related_chunks: finalMatches, entity_used: entityUsed, freshness,
      retrieval_meta: retrievalMeta, reranked: wasReranked, total_chunks: finalMatches.length,
      avg_top_similarity: avgVectorScore, tokens_used: tokensTotal, build_ms: buildMs, knowledge_lessons: knowledgeLessons,
    };
    let bundleId: string;
    if (asyncBundle) {
      bundleId = crypto.randomUUID();
      const write = supabase.from("context_bundles").insert({ bundle_id: bundleId, ...bundleRow })
        .then(({ error }: any) => { if (error) console.error("[context-build] async bundle insert failed", error.message); });
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(write); } catch { /* lokaal/geen EdgeRuntime: de promise loopt gewoon door */ }
    } else {
      const { data: insertResult, error: insErr } = await supabase.from("context_bundles").insert(bundleRow).select("bundle_id").single();
      if (insErr || !insertResult) throw new Error(`bundle_insert_failed: ${insErr?.message}`);
      bundleId = insertResult.bundle_id;
    }

    return new Response(JSON.stringify({
      ok: true, bundle_id: bundleId, intent, audience, query: queryText,
      // v2.8 — `coverage` staat óók op het topniveau van het antwoord, niet
      // alleen in retrieval_meta: elke aanroeper moet hem kunnen lezen zonder
      // in de meta te hoeven graven. rag-chat bouwt hem door naar het antwoord.
      coverage,
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
