-- =============================================================================
-- match_chunks + match_chunks_for_entity: space-ACL erin      (v1.145, 2026-09-05)
-- =============================================================================
-- Deze twee functies zijn HET retrieval-pad: context-build, rag-search,
-- autodraft-rag-prefill en de agentic semantic_search komen er allemaal langs.
-- Ze draaien als SECURITY INVOKER en worden door edge functions met de
-- service-role-key aangeroepen, dus RLS op `chunks` doet daar niets. De ACL
-- MOET dus in de functie zelf zitten en niet alleen in een policy.
--
-- Waarom geen extra parameter `p_allowed_spaces`: dan bepaalt de aanroeper de
-- ACL, en een aanroeper die hem vergeet krijgt stilzwijgend alles. Dat is
-- fail-OPEN. De allowlist wordt daarom BINNEN de functie afgeleid uit
-- `confluence_allowed_spaces(p_owner_user_id)` — vergeten kan niet meer, en
-- een browsersessie kan hem niet spoofen (zie migratie 20260905140000).
--
-- Gegenereerd uit de live prod-definitie met tmp/gen-match-chunks-patch.cjs:
-- alleen de `cf_visible`-CTE en één AND-conditie per kandidaten-tak zijn nieuw,
-- de rest is byte-exact het bestaande RRF-pad (rang-fusie 60.0 + recency).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding halfvec, query_text text DEFAULT NULL::text, top_k integer DEFAULT 5, filter_sources text[] DEFAULT NULL::text[], filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, filter_entity_id text DEFAULT NULL::text, min_similarity double precision DEFAULT 0.3, recency_weight double precision DEFAULT 0.15, recency_decay_days double precision DEFAULT 90.0, filter_audience text[] DEFAULT NULL::text[], filter_meeting_category text[] DEFAULT NULL::text[], filter_party_type text[] DEFAULT NULL::text[], filter_sentiment text[] DEFAULT NULL::text[], filter_asks_response boolean DEFAULT NULL::boolean, p_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text, out_content text, out_content_with_context text, out_occurred_at timestamp with time zone, out_entity_ids text[], out_metadata jsonb, out_vector_score double precision, out_bm25_score double precision, out_recency_score double precision, out_combined_score double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH tsq AS (
    SELECT to_tsquery('dutch', NULLIF(regexp_replace(plainto_tsquery('dutch', CASE WHEN length(query_text) > 500 THEN NULL ELSE query_text END)::text, ' & ', ' | ', 'g'), '')) AS q
  ),
  -- Eén keer geëvalueerd (uncorrelated InitPlan), niet per rij.
  owner_scope AS (
    SELECT public.rag_owner_scope_ids(p_owner_user_id) AS ids
  ),
  -- v1.145 space-ACL — welke Confluence-pagina's mag DEZE aanroeper zien?
  -- Leeg resultaat = geen enkele Confluence-treffer. Fail-closed dus, en
  -- uncorrelated: één keer geëvalueerd (InitPlan) over 366 rijen, niet per chunk.
  -- Waarom via confluence_pages en niet via chunks.metadata->>'space_key':
  -- metadata is een momentopname van het chunk-moment, de spiegel is de waarheid.
  -- Zo valt een pagina die naar een andere space verhuist of gearchiveerd wordt
  -- meteen uit de retrieval, zonder te wachten op een her-chunk-ronde.
  cf_visible AS (
    SELECT p.page_id
      FROM public.confluence_pages p
     WHERE p.is_archived = false
       AND p.space_key = ANY (public.confluence_allowed_spaces(p_owner_user_id))
  ),
  vector_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rk
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND (c.source <> 'confluence' OR c.source_id IN (SELECT page_id FROM cf_visible))
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
      AND (filter_audience IS NULL OR c.source != 'meeting' OR (c.metadata->>'audience') = ANY(filter_audience))
      AND (filter_meeting_category IS NULL OR c.source != 'meeting' OR (c.metadata->>'meeting_category') = ANY(filter_meeting_category))
      AND (filter_party_type IS NULL OR c.source <> 'mail' OR (c.metadata->>'party_type') = ANY(filter_party_type))
      AND (filter_sentiment IS NULL OR c.source <> 'mail' OR (c.metadata->>'sentiment') = ANY(filter_sentiment))
      AND (filter_asks_response IS NULL OR c.source <> 'mail' OR (c.metadata->>'asks_response') = CASE WHEN filter_asks_response THEN 'true' ELSE 'false' END)
    ORDER BY c.embedding <=> query_embedding
    LIMIT (top_k * 10)
  ),
  bm25_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, (SELECT q FROM tsq)) DESC) AS rk
    FROM chunks c
    WHERE query_text IS NOT NULL AND length(query_text) > 1
      AND (SELECT q FROM tsq) IS NOT NULL AND c.fts_vector @@ (SELECT q FROM tsq)
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND (c.source <> 'confluence' OR c.source_id IN (SELECT page_id FROM cf_visible))
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
      AND (filter_audience IS NULL OR c.source != 'meeting' OR (c.metadata->>'audience') = ANY(filter_audience))
      AND (filter_meeting_category IS NULL OR c.source != 'meeting' OR (c.metadata->>'meeting_category') = ANY(filter_meeting_category))
      AND (filter_party_type IS NULL OR c.source <> 'mail' OR (c.metadata->>'party_type') = ANY(filter_party_type))
      AND (filter_sentiment IS NULL OR c.source <> 'mail' OR (c.metadata->>'sentiment') = ANY(filter_sentiment))
      AND (filter_asks_response IS NULL OR c.source <> 'mail' OR (c.metadata->>'asks_response') = CASE WHEN filter_asks_response THEN 'true' ELSE 'false' END)
    ORDER BY ts_rank_cd(c.fts_vector, (SELECT q FROM tsq)) DESC
    LIMIT (top_k * 10)
  ),
  candidates AS (
    SELECT chunk_id, rk AS vec_rk, NULL::bigint AS bm_rk FROM vector_hits
    UNION ALL SELECT chunk_id, NULL::bigint AS vec_rk, rk AS bm_rk FROM bm25_hits
  ),
  fused_ranks AS (SELECT chunk_id, min(vec_rk) AS vec_rk, min(bm_rk) AS bm_rk FROM candidates GROUP BY chunk_id),
  enriched AS (
    SELECT c.chunk_id, c.source, c.source_id, c.chunk_type, c.content, c.content_with_context, c.occurred_at, c.entity_ids, c.metadata,
           (1 - (c.embedding <=> query_embedding))::double precision AS vector_score,
           CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND c.fts_vector @@ (SELECT q FROM tsq) THEN ts_rank_cd(c.fts_vector, (SELECT q FROM tsq))::double precision ELSE 0::double precision END AS bm25_raw,
           f.vec_rk, f.bm_rk,
           ((1.0 / (60.0 + coalesce(f.vec_rk, 9999::bigint))) + (1.0 / (60.0 + coalesce(f.bm_rk, 9999::bigint))))::double precision AS rrf_score
    FROM fused_ranks f JOIN chunks c ON c.chunk_id = f.chunk_id
  ),
  filtered AS (SELECT * FROM enriched WHERE vector_score >= min_similarity OR bm25_raw > 0),
  scored AS (SELECT f.*, greatest(max(f.bm25_raw) OVER (), 0.05) AS bm25_norm_div FROM filtered f)
  SELECT s.chunk_id, s.source, s.source_id, s.chunk_type, s.content, s.content_with_context, s.occurred_at, s.entity_ids, s.metadata,
         s.vector_score,
         CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
         least(exp(-(extract(epoch from (now() - s.occurred_at)) / 86400.0) / recency_decay_days), 1.0)::double precision AS recency_score,
         ((1 - recency_weight) * s.rrf_score + recency_weight * least(exp(-(extract(epoch from (now() - s.occurred_at)) / 86400.0) / recency_decay_days), 1.0))::double precision AS combined_score
  FROM scored s ORDER BY combined_score DESC LIMIT top_k;
$function$
;

CREATE OR REPLACE FUNCTION public.match_chunks_for_entity(p_entity_type text, p_entity_id text, p_query_embedding halfvec, p_query_text text DEFAULT NULL::text, p_top_k integer DEFAULT 5, p_hop_depth integer DEFAULT 1, p_filter_sources text[] DEFAULT NULL::text[], p_filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_similarity double precision DEFAULT 0.3, p_recency_weight double precision DEFAULT 0.15, p_recency_decay_days double precision DEFAULT 90.0, p_max_edges integer DEFAULT 300, p_max_per_source integer DEFAULT 3, p_filter_audience text[] DEFAULT NULL::text[], p_filter_meeting_category text[] DEFAULT NULL::text[], p_owner_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text, out_content text, out_content_with_context text, out_occurred_at timestamp with time zone, out_entity_path jsonb, out_metadata jsonb, out_vector_score double precision, out_bm25_score double precision, out_recency_score double precision, out_combined_score double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH tsq AS (
    SELECT to_tsquery('dutch',
      NULLIF(regexp_replace(plainto_tsquery('dutch', CASE WHEN length(p_query_text) > 500 THEN NULL ELSE p_query_text END)::text, ' & ', ' | ', 'g'), '')
    ) AS q
  ),
  owner_scope AS (
    SELECT public.rag_owner_scope_ids(p_owner_user_id) AS ids
  ),
  -- v1.145 space-ACL — welke Confluence-pagina's mag DEZE aanroeper zien?
  -- Leeg resultaat = geen enkele Confluence-treffer. Fail-closed dus, en
  -- uncorrelated: één keer geëvalueerd (InitPlan) over 366 rijen, niet per chunk.
  -- Waarom via confluence_pages en niet via chunks.metadata->>'space_key':
  -- metadata is een momentopname van het chunk-moment, de spiegel is de waarheid.
  -- Zo valt een pagina die naar een andere space verhuist of gearchiveerd wordt
  -- meteen uit de retrieval, zonder te wachten op een her-chunk-ronde.
  cf_visible AS (
    SELECT p.page_id
      FROM public.confluence_pages p
     WHERE p.is_archived = false
       AND p.space_key = ANY (public.confluence_allowed_spaces(p_owner_user_id))
  ),
  expanded_forward AS (
    SELECT e.dst_type AS type, e.dst_id AS id, e.edge_type AS via_edge, e.confidence
      FROM v_entity_edges_full e
     WHERE e.src_type = p_entity_type AND e.src_id = p_entity_id
     ORDER BY e.confidence DESC NULLS LAST, e.edge_type DESC
     LIMIT p_max_edges
  ),
  expanded_backward AS (
    SELECT e.src_type AS type, e.src_id AS id, e.edge_type AS via_edge, e.confidence
      FROM v_entity_edges_full e
     WHERE e.dst_type = p_entity_type AND e.dst_id = p_entity_id
     ORDER BY e.confidence DESC NULLS LAST, e.edge_type DESC
     LIMIT p_max_edges
  ),
  expanded AS (
    SELECT p_entity_type AS type, p_entity_id AS id, 'self'::text AS via_edge, 1.0::numeric AS confidence
    UNION ALL SELECT * FROM expanded_forward
    UNION ALL SELECT * FROM expanded_backward
  ),
  candidate_chunks AS (
    SELECT DISTINCT ON (c.chunk_id)
           c.chunk_id, c.source, c.source_id, c.chunk_type,
           c.content, c.content_with_context,
           c.occurred_at, c.metadata, c.embedding, c.fts_vector,
           jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'via_edge', e.via_edge, 'confidence', e.confidence) AS entity_path
      FROM chunks c
      JOIN expanded e ON e.type = c.source AND e.id = c.source_id
     WHERE c.embedding IS NOT NULL
       AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
       AND (p_filter_sources IS NULL OR c.source = ANY(p_filter_sources))
       AND (c.source <> 'confluence' OR c.source_id IN (SELECT page_id FROM cf_visible))
       AND (p_filter_after IS NULL OR c.occurred_at >= p_filter_after)
       AND (p_filter_audience IS NULL
            OR c.source != 'meeting'
            OR (c.metadata->>'audience') = ANY(p_filter_audience))
       AND (p_filter_meeting_category IS NULL
            OR c.source != 'meeting'
            OR (c.metadata->>'meeting_category') = ANY(p_filter_meeting_category))
  ),
  vector_hits AS (
    SELECT chunk_id, row_number() OVER (ORDER BY embedding <=> p_query_embedding) AS rk
      FROM candidate_chunks
     ORDER BY embedding <=> p_query_embedding
     LIMIT (p_top_k * 10)
  ),
  bm25_hits AS (
    SELECT chunk_id, row_number() OVER (ORDER BY ts_rank_cd(fts_vector, (SELECT q FROM tsq)) DESC) AS rk
      FROM candidate_chunks
     WHERE p_query_text IS NOT NULL AND length(p_query_text) > 1
       AND (SELECT q FROM tsq) IS NOT NULL
       AND fts_vector @@ (SELECT q FROM tsq)
     ORDER BY ts_rank_cd(fts_vector, (SELECT q FROM tsq)) DESC
     LIMIT (p_top_k * 10)
  ),
  candidates AS (
    SELECT chunk_id, rk AS vec_rk, NULL::bigint AS bm_rk FROM vector_hits
    UNION ALL
    SELECT chunk_id, NULL::bigint AS vec_rk, rk AS bm_rk FROM bm25_hits
  ),
  fused_ranks AS (
    SELECT chunk_id, min(vec_rk) AS vec_rk, min(bm_rk) AS bm_rk FROM candidates GROUP BY chunk_id
  ),
  enriched AS (
    SELECT cc.chunk_id, cc.source, cc.source_id, cc.chunk_type,
           cc.content, cc.content_with_context, cc.occurred_at, cc.entity_path, cc.metadata,
           (1 - (cc.embedding <=> p_query_embedding))::double precision AS vector_score,
           CASE WHEN (SELECT q FROM tsq) IS NOT NULL AND cc.fts_vector @@ (SELECT q FROM tsq)
                THEN ts_rank_cd(cc.fts_vector, (SELECT q FROM tsq))::double precision
                ELSE 0::double precision END AS bm25_raw,
           f.vec_rk, f.bm_rk,
           ((1.0 / (60.0 + coalesce(f.vec_rk, 9999::bigint)))
          + (1.0 / (60.0 + coalesce(f.bm_rk, 9999::bigint))))::double precision AS rrf_score
      FROM fused_ranks f
      JOIN candidate_chunks cc ON cc.chunk_id = f.chunk_id
  ),
  filtered AS (
    SELECT * FROM enriched WHERE vector_score >= p_min_similarity OR bm25_raw > 0
  ),
  scored AS (
    SELECT f.*, greatest(max(f.bm25_raw) OVER (), 0.05) AS bm25_norm_div,
           least(exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / p_recency_decay_days), 1.0)::double precision AS recency_score
      FROM filtered f
  ),
  with_combined AS (
    SELECT s.*,
           CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
           ((1 - p_recency_weight) * s.rrf_score + p_recency_weight * s.recency_score)::double precision AS combined_score
      FROM scored s
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY source ORDER BY combined_score DESC) AS rn_per_source
      FROM with_combined
  )
  SELECT chunk_id, source, source_id, chunk_type, content, content_with_context,
         occurred_at, entity_path, metadata, vector_score, bm25_score, recency_score, combined_score
    FROM ranked
   WHERE rn_per_source <= p_max_per_source
   ORDER BY combined_score DESC
   LIMIT p_top_k;
$function$
;
