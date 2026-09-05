-- =============================================================================
-- Confluence space-ACL: identiteit los van eigendom            (v1.145, 2026-09-05)
-- =============================================================================
-- Migratie 20260905140500 hing de space-ACL aan `p_owner_user_id`. Dat is de
-- verkeerde parameter, en niet cosmetisch: die stuurt `rag_owner_scope_ids()`
-- aan — de MAIL-eigendomsscope — en is op het chat-pad bewust NULL. Wie de ACL
-- repareert door rag-chat alsnog een owner te laten sturen, verandert als
-- neveneffect het mailbereik van élke chatvraag.
--
-- Twee begrippen, twee parameters:
--   p_owner_user_id   WIENS mail mag meedoen   -> rag_owner_scope_ids()
--   p_caller_user_id  WIE stelt de vraag       -> confluence_allowed_spaces()
--
-- ⛔ Waarom hier DROP staat en geen kale CREATE OR REPLACE: een parameter met
-- default toevoegen via CREATE OR REPLACE maakt een NIEUWE functie, geen
-- vervanging. Een named-arg call die alleen de oude namen noemt matcht dan op
-- beide signaturen en Postgres geeft `function is not unique` — een stille
-- breuk die het hele chat-pad omlegt. Eerst droppen dus.
--
-- ⛔ En waarom de GRANTs onderaan opnieuw worden gezet: DROP gooit de proacl
-- weg. Beide functies hadden PUBLIC-execute expliciet ingetrokken
-- ({postgres=X,authenticated=X,service_role=X} — géén `=X`-entry). Een kale
-- CREATE zet PUBLIC-execute terug en zou `anon` dus uitvoerrechten geven op het
-- hele retrieval-pad. Gemeten vóór de drop, hieronder 1:1 hersteld.
--
-- Verder is dit byte-voor-byte het bestaande RRF-pad uit 20260905140500. De
-- enige inhoudelijke wijziging is `confluence_allowed_spaces(p_caller_user_id)`
-- in plaats van `(p_owner_user_id)` in de cf_visible-CTE van beide functies.
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_chunks(
  halfvec, text, integer, text[], timestamptz, text, double precision,
  double precision, double precision, text[], text[], text[], text[], boolean, uuid);

DROP FUNCTION IF EXISTS public.match_chunks_for_entity(
  text, text, halfvec, text, integer, integer, text[], timestamptz,
  double precision, double precision, double precision, integer, integer,
  text[], text[], uuid);

CREATE FUNCTION public.match_chunks(query_embedding halfvec, query_text text DEFAULT NULL::text, top_k integer DEFAULT 5, filter_sources text[] DEFAULT NULL::text[], filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, filter_entity_id text DEFAULT NULL::text, min_similarity double precision DEFAULT 0.3, recency_weight double precision DEFAULT 0.15, recency_decay_days double precision DEFAULT 90.0, filter_audience text[] DEFAULT NULL::text[], filter_meeting_category text[] DEFAULT NULL::text[], filter_party_type text[] DEFAULT NULL::text[], filter_sentiment text[] DEFAULT NULL::text[], filter_asks_response boolean DEFAULT NULL::boolean, p_owner_user_id uuid DEFAULT NULL::uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
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
  -- p_caller_user_id, NIET p_owner_user_id: identiteit is niet hetzelfde als
  -- mail-eigendom (zie de kop van deze migratie).
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

CREATE FUNCTION public.match_chunks_for_entity(p_entity_type text, p_entity_id text, p_query_embedding halfvec, p_query_text text DEFAULT NULL::text, p_top_k integer DEFAULT 5, p_hop_depth integer DEFAULT 1, p_filter_sources text[] DEFAULT NULL::text[], p_filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_similarity double precision DEFAULT 0.3, p_recency_weight double precision DEFAULT 0.15, p_recency_decay_days double precision DEFAULT 90.0, p_max_edges integer DEFAULT 300, p_max_per_source integer DEFAULT 3, p_filter_audience text[] DEFAULT NULL::text[], p_filter_meeting_category text[] DEFAULT NULL::text[], p_owner_user_id uuid DEFAULT NULL::uuid, p_caller_user_id uuid DEFAULT NULL::uuid)
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

-- ─── Rechten terug zoals ze vóór de DROP stonden ─────────────────────────────
-- Gemeten proacl vóór deze migratie, beide functies:
--   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- Géén `=X`-entry, dus PUBLIC-execute was ingetrokken. Zonder onderstaande
-- REVOKE zou een kale CREATE dat recht teruggeven en `anon` toegang tot het
-- retrieval-pad verlenen.
REVOKE ALL ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.match_chunks(halfvec, text, integer, text[], timestamptz, text, double precision, double precision, double precision, text[], text[], text[], text[], boolean, uuid, uuid) IS
  'Hybride retrieval (vector + bm25, RRF 60.0 + recency). p_owner_user_id = wiens mail mag meedoen (rag_owner_scope_ids). p_caller_user_id = wie stelt de vraag (confluence_allowed_spaces) — twee losse begrippen, nooit hergebruiken. Confluence-chunks worden gefilterd op de spaces die de AANROEPER mag lezen; leeg = geen enkele Confluence-treffer (fail-closed).';

COMMENT ON FUNCTION public.match_chunks_for_entity(text, text, halfvec, text, integer, integer, text[], timestamptz, double precision, double precision, double precision, integer, integer, text[], text[], uuid, uuid) IS
  'Entity-aware retrieval met 1-hop graph-expansie. Zelfde parameter-scheiding als match_chunks: p_owner_user_id = mail-eigendom, p_caller_user_id = Confluence-space-ACL.';

-- ─── RLS: auth.uid() in plaats van de letterlijke NULL ───────────────────────
-- Migratie 20260905140600 zette hier `confluence_allowed_spaces(NULL::uuid)`.
-- Daarmee viel elke browser-aanroeper op de org-baseline terug, wie hij ook was:
-- niemand zag MT, ook Jelle niet. Deze twee policies en de RPC-wijziging
-- hierboven MOETEN in dezelfde migratie: anders zijn het browser-pad en het
-- chat-pad het oneens over wie de aanroeper is, en dat verschil blijft maanden
-- onopgemerkt.
DROP POLICY IF EXISTS chunks_authenticated_read ON public.chunks;
CREATE POLICY chunks_authenticated_read ON public.chunks
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin_or_higher())
    AND (owner_user_id IS NULL OR owner_user_id = (SELECT auth.uid()))
    -- Derde tak: Confluence-chunks hebben bewust owner_user_id IS NULL
    -- (org-breed) en glippen dus door de owner-conditie. Ze horen op SPACE
    -- gefilterd te worden, niet op eigenaar.
    AND (source <> 'confluence' OR source_id IN (
          SELECT p.page_id FROM public.confluence_pages p
           WHERE p.is_archived = false
             AND p.space_key = ANY (public.confluence_allowed_spaces((SELECT auth.uid())))
        ))
  );

DROP POLICY IF EXISTS confluence_pages_read ON public.confluence_pages;
CREATE POLICY confluence_pages_read ON public.confluence_pages
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin_or_higher())
    AND space_key = ANY (public.confluence_allowed_spaces((SELECT auth.uid())))
  );
