DROP FUNCTION IF EXISTS public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision);

CREATE FUNCTION public.match_chunks(
  query_embedding   halfvec(3072),
  query_text        text DEFAULT NULL,
  top_k             integer DEFAULT 5,
  filter_sources    text[] DEFAULT NULL,
  filter_after      timestamptz DEFAULT NULL,
  filter_entity_id  text DEFAULT NULL,
  min_similarity    double precision DEFAULT 0.3,
  recency_weight    double precision DEFAULT 0.15,
  recency_decay_days double precision DEFAULT 90.0
) RETURNS TABLE(
  out_chunk_id      uuid,
  out_source        text,
  out_source_id     text,
  out_chunk_type    text,
  out_content       text,
  out_occurred_at   timestamptz,
  out_entity_ids    text[],
  out_metadata      jsonb,
  out_vector_score  double precision,
  out_bm25_score    double precision,
  out_recency_score double precision,
  out_combined_score double precision
) LANGUAGE sql STABLE SET search_path TO 'public' AS $body$
  WITH vector_hits AS (
    SELECT c.chunk_id, c.source, c.source_id, c.chunk_type, c.content,
           c.occurred_at, c.entity_ids, c.metadata,
           (1 - (c.embedding <=> query_embedding))::double precision AS sim,
           row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rk
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
    ORDER BY c.embedding <=> query_embedding
    LIMIT (top_k * 10)
  ),
  bm25_hits AS (
    SELECT c.chunk_id, c.source, c.source_id, c.chunk_type, c.content,
           c.occurred_at, c.entity_ids, c.metadata,
           ts_rank_cd(c.fts_vector, plainto_tsquery('dutch', query_text))::double precision AS bm25,
           row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, plainto_tsquery('dutch', query_text)) DESC) AS rk
    FROM chunks c
    WHERE query_text IS NOT NULL AND length(query_text) > 1
      AND c.fts_vector @@ plainto_tsquery('dutch', query_text)
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
    ORDER BY ts_rank_cd(c.fts_vector, plainto_tsquery('dutch', query_text)) DESC
    LIMIT (top_k * 10)
  ),
  unified AS (
    SELECT chunk_id, source, source_id, chunk_type, content, occurred_at, entity_ids, metadata,
           sim, NULL::double precision AS bm25, rk AS vec_rk, NULL::bigint AS bm_rk
    FROM vector_hits
    UNION ALL
    SELECT chunk_id, source, source_id, chunk_type, content, occurred_at, entity_ids, metadata,
           NULL::double precision AS sim, bm25, NULL::bigint AS vec_rk, rk AS bm_rk
    FROM bm25_hits
  ),
  fused AS (
    SELECT u.chunk_id,
           max(u.source) AS source,
           max(u.source_id) AS source_id,
           max(u.chunk_type) AS chunk_type,
           max(u.content) AS content,
           max(u.occurred_at) AS occurred_at,
           max(u.entity_ids) AS entity_ids,
           (jsonb_agg(u.metadata) -> 0) AS metadata,
           coalesce(max(u.sim), 0)::double precision AS vector_score,
           coalesce(max(u.bm25), 0)::double precision AS bm25_score,
           ((1.0 / (60.0 + min(coalesce(u.vec_rk, 9999::bigint)))) + (1.0 / (60.0 + min(coalesce(u.bm_rk, 9999::bigint)))))::double precision AS rrf_score
    FROM unified u
    GROUP BY u.chunk_id
  )
  SELECT f.chunk_id, f.source, f.source_id, f.chunk_type, f.content, f.occurred_at, f.entity_ids, f.metadata,
         f.vector_score, f.bm25_score,
         exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / recency_decay_days)::double precision AS recency_score,
         ((1 - recency_weight) * f.rrf_score + recency_weight * exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / recency_decay_days))::double precision AS combined_score
  FROM fused f
  WHERE f.vector_score >= min_similarity OR f.bm25_score > 0
  ORDER BY combined_score DESC
  LIMIT top_k;
$body$;

GRANT EXECUTE ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision) TO authenticated, service_role;
