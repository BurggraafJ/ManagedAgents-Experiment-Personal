-- =============================================================================
-- context_intents: 'search_fast' + de bm25-schakelaar                  (WP1)
-- =============================================================================
-- GEMETEN, niet aangenomen (2026-09-05, scripts/agent_retrieval_bench.cjs,
-- 20 echte vragen uit rag_chat_query_log, exact de parameters die rag-chat
-- stuurt):
--
--   intent=search zoals vandaag                p50 13.282 ms  p95 23.318 ms
--   idem zonder HyDE en zonder rerank          p50 10.756 ms  p95 21.881 ms
--   idem + top_k 24 i.p.v. 60                  p50  9.970 ms  p95 19.877 ms
--   idem + geen entity-routing                 p50  8.021 ms
--
-- rag-chat kapt af op 6.000 ms. In de eerste meting lag 18 van de 20 daarboven:
-- 90 % van de semantische chatvragen kwam dus als "0 fragmenten" bij de
-- gebruiker aan. Het onderzoeksrapport dacht dat HyDE (3 × match_chunks) en de
-- dubbele reranker de oorzaak waren. Dat klopt niet: samen zijn ze goed voor
-- ~3 van de ~13 seconden.
--
-- Waar de tijd wél zit — de BM25-arm van match_chunks:
--
--   plainto_tsquery('dutch', vraag) wordt met een regexp_replace van ' & ' naar
--   ' | ' omgezet: ELKE term matcht. Gemeten cardinaliteit op vier echte vragen:
--
--     'zorgen … advocatenkantoren … AI … betrouwbaarheid'   7.966 chunks
--     'welke trainingen … vorige maand … klanten'          10.401 chunks
--     'turn in april … juni'                                4.316 chunks
--     'welke hubspot taken zijn nu kritiek'                17.617 chunks  (36 % van 48.475)
--
--   Voor élk van die rijen moet ts_rank_cd worden berekend en de hele set
--   gesorteerd; daar bestaat geen index voor. EXPLAIN ANALYZE op de losse
--   BM25-arm: 2.988 ms koud, 34k buffers. Onder HyDE draaien er drie van, op
--   een instance met max_parallel_workers_per_gather = 1.
--
--   De LIMIT (top_k * 10) verandert daar niets aan — de rangschikking gaat
--   over de hele match-set, niet over de LIMIT. Dat verklaart waarom top_k van
--   80 naar 24 brengen maar 1,3 s scheelde.
--
--   De vector-arm daarentegen is bijna gratis: dezelfde match_chunks-aanroep
--   met query_text = NULL (BM25 slaat zichzelf dan over) deed 7 ms en gaf
--   40 rijen. Ook dát is gemeten, niet geschat.
--
--   Bijvangst: de vector-arm levert nooit meer dan hnsw.ef_search rijen (default
--   40), hoe hoog de LIMIT ook staat — EXPLAIN toont "LIMIT 800 … rows=40".
--   top_k 60 vragen leverde dus altijd al 40 vector-kandidaten plus BM25-vulling.
--   Daarom is default_top_k hier 40: dat is wat de index kán geven en precies
--   wat rag-chat (MAX_CONTEXT_CHUNKS) gebruikt.
--
-- Vandaar deze twee dingen:
--
--   1. bm25_enabled — een recept mag de lexicale arm uitzetten. Default TRUE,
--      dus elk bestaand recept gedraagt zich exact zoals gisteren.
--   2. search_fast — het chat-recept: vector-only, geen HyDE, geen anchors,
--      geen rerank. Het zware 'search' blijft ongewijzigd bestaan en blijft
--      bereikbaar als agent-tool (semantic_search, eigen budget van 30 s),
--      want dáár mag lexicaal zoeken acht seconden kosten.
--
-- Wat we hiermee opgeven: lexicale treffers op zeldzame termen (een dossiernaam,
-- "EasyPark", "AI Act") op de snelle route. Drie dingen vangen dat op: rag-chat
-- resolvet de entity zelf en haalt de RPC-tijdlijn op, WP2 doet één tweede
-- poging met een lagere drempel, en de agent kan alsnog semantic_search kiezen.
--
-- default_filter_sources blijft bewust NULL (afwijking van het onderzoeksrapport,
-- §5.6a). Dat advies is gemeten op het documentatiepad, waar het filter de zoek-
-- ruimte van 48k naar ~1000 chunks brengt. Een gewone chatvraag kan élke bron
-- raken; een gevulde lijst met alle bronnen erin is geen versmalling maar een
-- extra predicaat, en een korte lijst zou juist bronnen uitsluiten. Zodra
-- query_intel_level='entity' geen bron-hint meer oplevert is NULL het eerlijke
-- antwoord. Zie AGENT-REBUILD.md.
-- =============================================================================

ALTER TABLE public.context_intents
  ADD COLUMN IF NOT EXISTS bm25_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.context_intents.bm25_enabled IS
  'false = context-build stuurt query_text NULL naar match_chunks, waardoor de BM25-arm zichzelf overslaat (gemeten 7 ms i.p.v. 1-10 s). Alleen zinnig op recepten waar snelheid boven lexicale recall gaat.';

INSERT INTO public.context_intents (
  intent, description, default_strategy, default_top_k,
  default_recency_weight, default_recency_decay_days, default_min_similarity,
  default_max_per_source, default_rerank, default_lookback_days,
  query_intel_level, entity_anchor_top_n, max_edges, default_filter_sources,
  bm25_enabled,
  inject_kb, kb_top_k, kb_min_similarity,
  inject_jellemind, jellemind_scopes, jellemind_top_k, jellemind_min_similarity,
  notes
) VALUES (
  'search_fast',
  'De standaard chatvraag: één vector-zoekactie over de kennisindex, zonder HyDE, zonder entity-anchors, zonder rerank en zonder de BM25-arm. Bedoeld om binnen de 6 s-grens van rag-chat te passen. Het zware ''search'' blijft bestaan voor de agent-tool semantic_search.',
  'match_chunks', 40,
  0.15, 90, 0.30,
  3, false, NULL,
  'entity', 0, 120, NULL,
  false,
  false, 2, 0.42,
  true, ARRAY['jelle','skill','legalmind']::text[], 3, 0.40,
  'WP1 (2026-09-05). Gemeten: intent=search p50 13,3 s / p95 23,3 s met 90 % boven de 6 s-grens van rag-chat; de BM25-arm rangschikt 4k-18k chunks per vraag. Vector-only meet 7 ms. Zie de kop van migratie 20260905180000 en /workspace/security/AGENT-REBUILD.md.'
)
ON CONFLICT (intent) DO UPDATE SET
  description                = EXCLUDED.description,
  default_strategy           = EXCLUDED.default_strategy,
  default_top_k              = EXCLUDED.default_top_k,
  default_recency_weight     = EXCLUDED.default_recency_weight,
  default_recency_decay_days = EXCLUDED.default_recency_decay_days,
  default_min_similarity     = EXCLUDED.default_min_similarity,
  default_rerank             = EXCLUDED.default_rerank,
  query_intel_level          = EXCLUDED.query_intel_level,
  entity_anchor_top_n        = EXCLUDED.entity_anchor_top_n,
  max_edges                  = EXCLUDED.max_edges,
  default_filter_sources     = EXCLUDED.default_filter_sources,
  bm25_enabled               = EXCLUDED.bm25_enabled,
  inject_kb                  = EXCLUDED.inject_kb,
  inject_jellemind           = EXCLUDED.inject_jellemind,
  jellemind_scopes           = EXCLUDED.jellemind_scopes,
  jellemind_top_k            = EXCLUDED.jellemind_top_k,
  notes                      = EXCLUDED.notes,
  updated_at                 = now();
