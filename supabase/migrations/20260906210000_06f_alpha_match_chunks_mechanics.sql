-- =============================================================================
-- 06f-α — mechanica in match_chunks / match_chunks_for_entity       (2026-09-06)
-- =============================================================================
-- Spoor 06 (RAG per bron), sub-spoor 06f-α. Onderzoek: /workspace/security/
-- maestro-agent-architecture/06-rag-per-source/RESEARCH.md §3.1 (a)–(d), §3.6.
-- Gemeten vóór deze migratie (runs/2026-09-06-explain-baseline.json):
--
--   (a) Gefilterde HNSW snijdt stil af. De vector-arm is een HNSW-scan die
--       hoogstens hnsw.ef_search (default 40) rijen oplevert en dáárna pas de
--       WHERE toepast. Door de functie gemeten met een opgeslagen embedding:
--         filter_sources=['mail'] + occurred_at ≥ now()-90d, top_k 40 →  1 rij
--         filter_sources=['mail'],                          top_k 40 →  7 rijen
--         filter_sources=['meeting'],                       top_k 40 →  0 rijen
--       Dezelfde query met hnsw.iterative_scan=relaxed_order geeft 40/80/40.
--       Dit is de oorzaak achter "een tijdscue op mail geeft één fragment" en
--       achter lege bronfilter-bundels (search_docs als agent-tool: 9/9 leeg).
--   (b) hnsw.ef_search: SET LOCAL werkt op deze instance; 40 → 40 kandidaten,
--       80 → 80 kandidaten (EXPLAIN actual rows), warm 4 → 7 ms, koud ~1 s
--       ongeacht ef (I/O, index 382 MB > 256 MB shared_buffers).
--   (c) Geen per-record-cap: meetings leveren 1,87 chunks per meeting per
--       bundel (77 % van de meeting-chunks komt uit multi-chunk-records),
--       Confluence 1,58.
--   (d) Toekomstige occurred_at (65 engagement-taken, 50 events) krijgt door
--       least(exp(...),1.0) de maximale recency 1,0.
--
-- Wat deze migratie doet — alleen mechanica, géén drempel, géén reranker,
-- géén BM25-wijziging (dat is 06f-β):
--
--   1. match_chunks wordt plpgsql zodat het lichaam zélf de GUC's zet
--      (set_config(..., is_local=true) = SET LOCAL, valt terug bij COMMIT/ROLLBACK
--      van de PostgREST-transactie):
--        hnsw.ef_search = 80                                     (altijd)
--        hnsw.iterative_scan = relaxed_order + max_scan_tuples 4000
--                                       (alleen als er een hard filter meegaat)
--      Geen wrapper-functie: dat zou een tweede ingang zijn naar een functie
--      waar de space-ACL in zit (DECISIONS 2026-09-05). Eén functie, één ACL.
--   2. LIMIT-regel in de vector-arm: top_k*10 diende de RRF-fusie met BM25.
--      Zonder query_text (bm25_enabled=false) is dat een iteratieve scan tot
--      400 rijen (gemeten 12,6 s). Nu: top_k*10 alleen mét query_text; met
--      caps top_k*2 (de pool waaruit de cap kiest); anders top_k.
--   3. max_per_record (PARTITION BY source, source_id) en max_per_source op
--      match_chunks; p_max_per_record op match_chunks_for_entity. Default NULL
--      = uit = gedrag van gisteren. De recepten zetten de waarde (WP2).
--   4. source_overrides jsonb: {"<source>":{"exclude":bool,"future_ok":bool,
--      "max_per_record":int,"max_per_source":int}}. exclude geldt niet voor
--      een bron die de aanroeper expliciet in filter_sources zet.
--   5. Recency-klem: een occurred_at in de toekomst telt met zijn afstand tot
--      nu (symmetrisch verval) in plaats van 1,0 — behalve voor bronnen met
--      future_ok (default: event, want een afspraak volgende week ís relevant).
--      Het onderzoek zei "tellen als vandaag"; dat is rekenkundig identiek aan
--      1,0 en dus geen wijziging — vandaar de symmetrische afstand.
--
-- ⛔ DROP + CREATE, geen CREATE OR REPLACE: nieuwe parameters met default via
-- CREATE OR REPLACE maken een OVERLOAD, geen vervanging (migratie 20260905170000).
-- ⛔ Rechten: DROP gooit de proacl weg. Gemeten vóór deze migratie, beide
-- functies: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- — géén PUBLIC. Onderaan 1:1 hersteld (memory drop-function-verliest-proacl).
--
-- Alle bestaande predicaten (owner-scope, cf_visible-ACL met p_caller_user_id,
-- action-uitsluiting, enrichment-filters) staan hieronder byte-voor-byte zoals
-- in 20260905170000; nieuw zijn alleen de v_excluded-regel, de LIMIT-regel, de
-- cap-CTE's en de recency-klem.
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_chunks(
  halfvec, text, integer, text[], timestamptz, text, double precision,
  double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid);

DROP FUNCTION IF EXISTS public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer,
  text[], text[], uuid, uuid);

CREATE FUNCTION public.match_chunks(
  query_embedding halfvec,
  query_text text DEFAULT NULL::text,
  top_k integer DEFAULT 5,
  filter_sources text[] DEFAULT NULL::text[],
  filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  filter_entity_id text DEFAULT NULL::text,
  min_similarity double precision DEFAULT 0.3,
  recency_weight double precision DEFAULT 0.15,
  recency_decay_days double precision DEFAULT 90.0,
  filter_audience text[] DEFAULT NULL::text[],
  filter_meeting_category text[] DEFAULT NULL::text[],
  filter_party_type text[] DEFAULT NULL::text[],
  filter_sentiment text[] DEFAULT NULL::text[],
  filter_asks_response boolean DEFAULT NULL::boolean,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  max_per_record integer DEFAULT NULL::integer,
  max_per_source integer DEFAULT NULL::integer,
  source_overrides jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(out_chunk_id uuid, out_source text, out_source_id text, out_chunk_type text, out_content text, out_content_with_context text, out_occurred_at timestamp with time zone, out_entity_ids text[], out_metadata jsonb, out_vector_score double precision, out_bm25_score double precision, out_recency_score double precision, out_combined_score double precision)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  -- Bronnen die het recept uitsluit, minus wat de aanroeper expliciet vraagt.
  v_excluded   text[];
  -- Bronnen waarvoor een datum in de toekomst gewoon 1,0 recency houdt.
  v_future_ok  text[];
  -- Gaat er een hard filter mee? Dan snijdt de HNSW-scan zonder iteratieve
  -- scan stil af (gemeten 1 van 40) en zetten we hnsw.iterative_scan aan.
  v_selective  boolean;
  -- Hoeveel kandidaten de vector-arm ophaalt (zie kop, punt 2).
  v_vec_limit  integer;
  v_has_bm25   boolean;
BEGIN
  SELECT coalesce(array_agg(k), '{}'::text[]) INTO v_excluded
    FROM jsonb_each(coalesce(source_overrides, '{}'::jsonb)) AS o(k, v)
   WHERE coalesce((v->>'exclude')::boolean, false)
     AND NOT (filter_sources IS NOT NULL AND k = ANY(filter_sources));

  SELECT coalesce(array_agg(k), '{}'::text[]) INTO v_future_ok
    FROM jsonb_each(coalesce(source_overrides, '{}'::jsonb)) AS o(k, v)
   WHERE coalesce((v->>'future_ok')::boolean, false);
  -- event = default future_ok, tenzij het recept expliciet {"event":{"future_ok":false}} zegt.
  IF coalesce((source_overrides->'event'->>'future_ok')::boolean, true) AND NOT ('event' = ANY(v_future_ok)) THEN
    v_future_ok := v_future_ok || 'event'::text;
  END IF;

  v_has_bm25 := query_text IS NOT NULL AND length(query_text) > 1;

  v_selective := filter_after IS NOT NULL OR filter_entity_id IS NOT NULL OR filter_sources IS NOT NULL
              OR filter_audience IS NOT NULL OR filter_meeting_category IS NOT NULL
              OR filter_party_type IS NOT NULL OR filter_sentiment IS NOT NULL OR filter_asks_response IS NOT NULL
              OR cardinality(v_excluded) > 0;

  v_vec_limit := CASE
    WHEN v_has_bm25 THEN top_k * 10                                                   -- pool voor RRF-fusie
    WHEN max_per_record IS NOT NULL OR max_per_source IS NOT NULL
      OR (source_overrides IS NOT NULL AND source_overrides <> '{}'::jsonb) THEN least(greatest(top_k * 2, top_k), 400)  -- pool waaruit de caps kiezen
    ELSE top_k
  END;

  -- (b) ef_search in het lichaam zelf: één ingang, ACL blijft op één plek.
  PERFORM set_config('hnsw.ef_search', '80', true);
  -- (a) iteratieve scan alleen als een filter de kandidaten anders stil afsnijdt;
  --     max_scan_tuples begrenst de koude-cache-kosten (R2: 9-12 s zonder grens).
  IF v_selective THEN
    PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    PERFORM set_config('hnsw.max_scan_tuples', '4000', true);
  ELSE
    PERFORM set_config('hnsw.iterative_scan', 'off', true);
  END IF;

  RETURN QUERY
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
  -- p_caller_user_id, NIET p_owner_user_id: identiteit is niet hetzelfde als
  -- mail-eigendom (migratie 20260905170000).
  cf_visible AS (
    SELECT p.page_id
      FROM public.confluence_pages p
     WHERE p.is_archived = false
       AND p.space_key = ANY (public.confluence_allowed_spaces(p_caller_user_id))
  ),
  vector_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY c.embedding <=> query_embedding) AS rk
    FROM chunks c
    WHERE c.embedding IS NOT NULL
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND NOT (c.source = ANY(v_excluded))
      AND (c.source <> 'confluence' OR c.source_id IN (SELECT page_id FROM cf_visible))
      AND (filter_after IS NULL OR c.occurred_at >= filter_after)
      AND (filter_entity_id IS NULL OR filter_entity_id = ANY(c.entity_ids) OR c.primary_entity_id = filter_entity_id)
      AND (filter_audience IS NULL OR c.source != 'meeting' OR (c.metadata->>'audience') = ANY(filter_audience))
      AND (filter_meeting_category IS NULL OR c.source != 'meeting' OR (c.metadata->>'meeting_category') = ANY(filter_meeting_category))
      AND (filter_party_type IS NULL OR c.source <> 'mail' OR (c.metadata->>'party_type') = ANY(filter_party_type))
      AND (filter_sentiment IS NULL OR c.source <> 'mail' OR (c.metadata->>'sentiment') = ANY(filter_sentiment))
      AND (filter_asks_response IS NULL OR c.source <> 'mail' OR (c.metadata->>'asks_response') = CASE WHEN filter_asks_response THEN 'true' ELSE 'false' END)
    ORDER BY c.embedding <=> query_embedding
    LIMIT v_vec_limit
  ),
  bm25_hits AS (
    SELECT c.chunk_id, row_number() OVER (ORDER BY ts_rank_cd(c.fts_vector, (SELECT q FROM tsq)) DESC) AS rk
    FROM chunks c
    WHERE v_has_bm25
      AND (SELECT q FROM tsq) IS NOT NULL AND c.fts_vector @@ (SELECT q FROM tsq)
      AND ((SELECT ids FROM owner_scope) IS NULL OR c.owner_user_id IS NULL OR c.owner_user_id = ANY(coalesce((SELECT ids FROM owner_scope), ARRAY[]::uuid[])))
      AND (filter_sources IS NULL OR c.source = ANY(filter_sources))
      AND (filter_sources IS NOT NULL OR c.source <> 'action')
      AND NOT (c.source = ANY(v_excluded))
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
  scored AS (
    SELECT f.*, greatest(max(f.bm25_raw) OVER (), 0.05) AS bm25_norm_div,
           -- (d) recency-klem: toekomst telt met zijn afstand tot nu, behalve future_ok-bronnen.
           CASE WHEN f.occurred_at > now() AND NOT (f.source = ANY(v_future_ok))
                THEN exp(-abs(extract(epoch from (now() - f.occurred_at)) / 86400.0) / recency_decay_days)
                ELSE least(exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / recency_decay_days), 1.0)
           END::double precision AS recency_score
    FROM filtered f
  ),
  combined AS (
    SELECT s.*,
           CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
           ((1 - recency_weight) * s.rrf_score + recency_weight * s.recency_score)::double precision AS combined_score
    FROM scored s
  ),
  -- (c) per-record-cap: hoogstens N chunks van dezelfde (source, source_id).
  ranked_rec AS (
    SELECT cb.*, row_number() OVER (PARTITION BY cb.source, cb.source_id ORDER BY cb.combined_score DESC) AS rn_rec,
           coalesce((source_overrides->cb.source->>'max_per_record')::int, max_per_record) AS cap_rec,
           coalesce((source_overrides->cb.source->>'max_per_source')::int, max_per_source) AS cap_src
    FROM combined cb
  ),
  ranked_src AS (
    SELECT r.*, row_number() OVER (PARTITION BY r.source ORDER BY r.combined_score DESC) AS rn_src
    FROM ranked_rec r
    WHERE r.cap_rec IS NULL OR r.rn_rec <= r.cap_rec
  )
  SELECT r.chunk_id, r.source, r.source_id, r.chunk_type, r.content, r.content_with_context, r.occurred_at, r.entity_ids, r.metadata,
         r.vector_score, r.bm25_score, r.recency_score, r.combined_score
  FROM ranked_src r
  WHERE r.cap_src IS NULL OR r.rn_src <= r.cap_src
  ORDER BY r.combined_score DESC
  LIMIT top_k;
END
$function$
;

-- match_chunks_for_entity blijft LANGUAGE sql: het kandidatenpad loopt via de
-- entity-edges (btree op (source, source_id)) en een exacte sortering over die
-- set — er is geen HNSW-scan, dus geen ef_search/iterative_scan om te zetten en
-- geen reden om van taal te wisselen (afwijking van RESEARCH §3.5, gemeten:
-- EXPLAIN toont Index Scan idx_chunks_source_id + Sort, geen hnsw). Nieuw:
-- p_max_per_record, p_source_overrides (exclude/future_ok/caps) en de klem.
CREATE FUNCTION public.match_chunks_for_entity(
  p_entity_type text,
  p_entity_id text,
  p_query_embedding halfvec,
  p_query_text text DEFAULT NULL::text,
  p_top_k integer DEFAULT 5,
  p_hop_depth integer DEFAULT 1,
  p_filter_sources text[] DEFAULT NULL::text[],
  p_filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_min_similarity double precision DEFAULT 0.3,
  p_recency_weight double precision DEFAULT 0.15,
  p_recency_decay_days double precision DEFAULT 90.0,
  p_max_edges integer DEFAULT 300,
  p_max_per_source integer DEFAULT 3,
  p_filter_audience text[] DEFAULT NULL::text[],
  p_filter_meeting_category text[] DEFAULT NULL::text[],
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_max_per_record integer DEFAULT NULL::integer,
  p_source_overrides jsonb DEFAULT NULL::jsonb)
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
  -- source_overrides: uitgesloten bronnen (niet als de aanroeper ze expliciet vraagt) en future_ok.
  ovr AS (
    SELECT coalesce((SELECT array_agg(k) FROM jsonb_each(coalesce(p_source_overrides, '{}'::jsonb)) AS o(k, v)
                      WHERE coalesce((v->>'exclude')::boolean, false)
                        AND NOT (p_filter_sources IS NOT NULL AND k = ANY(p_filter_sources))), '{}'::text[]) AS excluded,
           coalesce((SELECT array_agg(k) FROM jsonb_each(coalesce(p_source_overrides, '{}'::jsonb)) AS o(k, v)
                      WHERE coalesce((v->>'future_ok')::boolean, false)), '{}'::text[])
             || CASE WHEN coalesce((p_source_overrides->'event'->>'future_ok')::boolean, true) THEN ARRAY['event']::text[] ELSE '{}'::text[] END AS future_ok
  ),
  -- v1.145 space-ACL — zie match_chunks hierboven. Ook hier p_caller_user_id:
  -- een graph-expansie is anders een prima omweg naar een MT-pagina.
  cf_visible AS (
    SELECT p.page_id
      FROM public.confluence_pages p
     WHERE p.is_archived = false
       AND p.space_key = ANY (public.confluence_allowed_spaces(p_caller_user_id))
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
       AND NOT EXISTS (SELECT 1 FROM ovr o WHERE c.source = ANY(o.excluded))
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
           -- (d) recency-klem: toekomst telt met zijn afstand tot nu, behalve future_ok-bronnen.
           CASE WHEN f.occurred_at > now() AND NOT EXISTS (SELECT 1 FROM ovr o WHERE f.source = ANY(o.future_ok))
                THEN exp(-abs(extract(epoch from (now() - f.occurred_at)) / 86400.0) / p_recency_decay_days)
                ELSE least(exp(-(extract(epoch from (now() - f.occurred_at)) / 86400.0) / p_recency_decay_days), 1.0)
           END::double precision AS recency_score
      FROM filtered f
  ),
  with_combined AS (
    SELECT s.*,
           CASE WHEN s.bm25_raw = 0 THEN 0 ELSE least(s.bm25_raw / s.bm25_norm_div, 1.0) END::double precision AS bm25_score,
           ((1 - p_recency_weight) * s.rrf_score + p_recency_weight * s.recency_score)::double precision AS combined_score
      FROM scored s
  ),
  -- (c) per-record-cap vóór de bestaande per-source-cap.
  ranked_rec AS (
    SELECT w.*, row_number() OVER (PARTITION BY w.source, w.source_id ORDER BY w.combined_score DESC) AS rn_rec,
           coalesce((p_source_overrides->w.source->>'max_per_record')::int, p_max_per_record) AS cap_rec,
           coalesce((p_source_overrides->w.source->>'max_per_source')::int, p_max_per_source) AS cap_src
      FROM with_combined w
  ),
  ranked AS (
    SELECT r.*, row_number() OVER (PARTITION BY r.source ORDER BY r.combined_score DESC) AS rn_per_source
      FROM ranked_rec r
     WHERE r.cap_rec IS NULL OR r.rn_rec <= r.cap_rec
  )
  SELECT chunk_id, source, source_id, chunk_type, content, content_with_context,
         occurred_at, entity_path, metadata, vector_score, bm25_score, recency_score, combined_score
    FROM ranked
   WHERE cap_src IS NULL OR rn_per_source <= cap_src
   ORDER BY combined_score DESC
   LIMIT p_top_k;
$function$
;

-- ─── Rechten terug zoals ze vóór de DROP stonden ─────────────────────────────
-- Gemeten proacl vóór deze migratie (2026-09-06, pg_proc), beide functies:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Géén `=X`-entry, dus PUBLIC-execute was ingetrokken. Zonder onderstaande
-- REVOKE zou een kale CREATE dat recht teruggeven en `anon` toegang tot het
-- retrieval-pad verlenen.
REVOKE ALL ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid, integer, integer, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid, integer, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid, integer, integer, jsonb) IS
  'Hybride retrieval (vector + bm25, RRF 60.0 + recency). p_owner_user_id = wiens mail mag meedoen (rag_owner_scope_ids). p_caller_user_id = wie stelt de vraag (confluence_allowed_spaces) — twee losse begrippen, nooit hergebruiken. Confluence-chunks worden gefilterd op de spaces die de AANROEPER mag lezen; leeg = geen enkele Confluence-treffer (fail-closed). 06f-α (2026-09-06): plpgsql-lichaam zet hnsw.ef_search=80 en, alleen bij een hard filter, hnsw.iterative_scan=relaxed_order (max_scan_tuples 4000); LIMIT top_k*10 alleen met query_text; max_per_record / max_per_source / source_overrides ({"src":{"exclude","future_ok","max_per_record","max_per_source"}}); toekomstige occurred_at telt met zijn afstand tot nu (behalve future_ok, default event).';

COMMENT ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid, integer, jsonb) IS
  'Entity-aware retrieval met 1-hop graph-expansie. Zelfde parameter-scheiding als match_chunks: p_owner_user_id = mail-eigendom, p_caller_user_id = Confluence-space-ACL. 06f-α (2026-09-06): p_max_per_record (PARTITION BY source, source_id) vóór de bestaande p_max_per_source, p_source_overrides en de recency-klem op toekomstige datums (behalve future_ok, default event).';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906210000', '06f_alpha_match_chunks_mechanics')
ON CONFLICT (version) DO NOTHING;
