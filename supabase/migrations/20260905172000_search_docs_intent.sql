-- =============================================================================
-- context_intents: 'search_docs' — een licht recept voor wiki-vragen (v1.145)
-- =============================================================================
-- `search` is het zwaarste van de negen recepten: query_intel_level='full'
-- (HyDE), entity_anchor_top_n=4, default_rerank=true, max_edges=300. Gemeten
-- duurt intent=search 10-21 s, terwijl rag-chat de semantische route na 6 s
-- afbreekt. Uit rag_chat_query_log over 120 dagen: 15 van de 29 semantische
-- runs die context-build echt aanriepen kregen 0 fragmenten terug.
--
-- Een documentatievraag heeft dat gewicht niet nodig. Het is een platte
-- semantische zoekactie over ~1000 chunks: geen HyDE, geen entity-anchor,
-- geen rerank. En recency mag bijna niets doen — wiki-pagina's veranderen
-- zelden, dus de default 0,15/90 laat verse mail structureel over
-- documentatie heen ranken.
--
-- De waarden zijn niet verzonnen: 0,05 / 365 / 0,42 is exact het profiel dat
-- context-build al gebruikt voor de kb_article-call. Er was dus al een werkend
-- precedent voor "statische kennisbron" in dezelfde functie.
--
-- Waarom een apart intent en niet de 6 s-grens ophogen: de grens ophogen maakt
-- élke chatvraag trager en laat de oorzaak staan. Dit maakt de vraag sneller.
-- =============================================================================

INSERT INTO public.context_intents (
  intent, description, default_strategy, default_top_k,
  default_recency_weight, default_recency_decay_days, default_min_similarity,
  default_max_per_source, default_rerank, default_lookback_days,
  query_intel_level, entity_anchor_top_n, max_edges,
  inject_kb, kb_top_k, kb_min_similarity,
  inject_jellemind, jellemind_scopes, jellemind_top_k, jellemind_min_similarity,
  notes
) VALUES (
  'search_docs',
  'Documentatievraag: platte semantische zoekactie over de Confluence-spiegel en de kennisbank. Geen HyDE, geen entity-expansie, geen rerank — die kosten meer tijd dan ze op een statische bron opleveren.',
  'match_chunks', 10,
  0.05, 365, 0.42,
  3, false, NULL,
  'off', 0, 300,
  false, 3, 0.42,
  true, ARRAY['jelle','legalmind']::text[], 3, 0.40,
  'v1.145. Aangemaakt omdat intent=search 10-21 s duurt en rag-chat na 6 s afbreekt; een wiki-vraag hoort binnen die grens te passen. recency 0,05/365 = hetzelfde profiel als de kb_article-call, zodat verse mail documentatie niet wegdrukt.'
)
ON CONFLICT (intent) DO UPDATE SET
  default_strategy          = EXCLUDED.default_strategy,
  default_top_k             = EXCLUDED.default_top_k,
  default_recency_weight    = EXCLUDED.default_recency_weight,
  default_recency_decay_days= EXCLUDED.default_recency_decay_days,
  default_min_similarity    = EXCLUDED.default_min_similarity,
  default_rerank            = EXCLUDED.default_rerank,
  query_intel_level         = EXCLUDED.query_intel_level,
  entity_anchor_top_n       = EXCLUDED.entity_anchor_top_n,
  notes                     = EXCLUDED.notes,
  updated_at                = now();
