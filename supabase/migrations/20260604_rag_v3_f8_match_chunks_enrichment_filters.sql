-- RAG v3 F.8 — enrichment-assen als ZACHTE retrieval-filters in match_chunks + F.6 overload-cleanup.
-- Live toegepast 2026-06-04 via MCP apply_migration; dit bestand is de repo-mirror (replay-veilig).
--
-- WAT: voegt 3 optionele filter-parameters toe aan de hybride retriever:
--   filter_party_type   text[]  — bv. ['klant'] (party_type-as uit mail_enrichment)
--   filter_sentiment    text[]  — bv. ['negative']
--   filter_asks_response boolean — true = alleen mails die om antwoord vragen
-- Elk filter is ZACHT voor non-mail: enrichment is alleen op source='mail' gevuld (~99%), dus
-- niet-mail chunks (meeting/deal/engagement/...) bypassen het filter (c.source <> 'mail' OR ...).
-- Zo verlies je geen niet-mail-context door een mail-only enrichment-as.
--
-- F.6 cleanup: dit consolideert de historische match_chunks-overloads (9-arg + 11-arg) naar één
-- 14-arg signatuur. De oude overloads worden gedropt zodat PostgREST niet ambigu wordt.
--
-- ACTIVATIE in context-build (v2.4): auto-apply uit query-intel ALLEEN voor asks_response
-- (17% van de mail-chunks, gemeten F8A answer_relevance=0.8). sentiment NIET auto (enricher labelt
-- negatief te conservatief: 23/13.088 mail-chunks = 0.18% → auto-filter stript de mail-laag,
-- gemeten F8B R=0/P=0). sentiment + party_type alleen via expliciete options.* (caller-keuze).

-- 1) Drop historische overloads (idempotent — al weg op live; IF EXISTS voor schone replay).
DROP FUNCTION IF EXISTS public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[]);

-- 2) Unified 14-arg hybride retriever (RRF vector+BM25 + recency-decay) met enrichment-filters.
CREATE OR REPLACE FUNCTION public.match_chunks(query_embedding halfvec, query_text text DEFAULT NULL::text, top_k integer DEFAULT 5, filter_sources text[] DEFAULT NULL::text[], filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, filter_entity_id text DEFAULT NULL::text, min_similarity double precision DEFAULT 0.3, recency_weight double precision DEFAULT 0.15, recency_decay_days double precision DEFAULT 90.0, filter_audience text[] DEFAULT NULL::text[], filter_meeting_category text[] DEFAULT NULL::text[], filter_party_type text[] DEFAULT NULL::text[], filter_sentiment text[] DEFAULT NULL::text[], filter_asks_response boolean DEFAULT NULL::boolean)
 RETURNS TABLE(out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text, out_content text, out_content_with_context text, out_occurred_at timestamp with time zone, out_entity_ids text[], out_metadata jsonb, out_vector_score double precision, out_bm25_score double precision, out_recency_score double precision, out_combined_score double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH tsq AS (
    SELECT to_tsquery('dutch', NULLIF(regexp_replace(plainto_tsquery('dutch', query_text)::text, ' & ', ' | ', 'g'), '')) AS q
  ),
  vector_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rk
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
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
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
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
$function$;
