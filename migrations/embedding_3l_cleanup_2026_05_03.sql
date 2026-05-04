-- =============================================================================
-- B.2 — CLEANUP: drop legacy embedding (vector(1536)) en rename embedding_3l → embedding
-- =============================================================================
-- VOORWAARDE: ALLE 9 tabellen moeten 100% backfilled zijn (count(embedding_3l IS NULL) = 0)
-- voordat deze migration draait. Verifieer met:
--
--   SELECT 'mail_messages' AS tbl, count(*) FILTER (WHERE embedding_3l IS NULL) AS pending
--     FROM mail_messages WHERE NOT is_deleted
--   UNION ALL ... (alle 9 tabellen)
--
-- Wat dit doet:
--   1. Drop oude HNSW indexes op vector(1536) embedding
--   2. Drop oude kolommen: embedding, embedded_at, embedding_input_hash
--   3. Rename: embedding_3l → embedding, embedded_at_3l → embedded_at, embedding_input_hash_3l → embedding_input_hash
--   4. Recreate HNSW index op gerenamede embedding (halfvec_cosine_ops)
--   5. Drop oude match_all_sources, herbouw met halfvec(3072) query parameter
--
-- Resultaat: één set kolommen, één set indexes, één set RPC's. Schoon.
-- =============================================================================

BEGIN;

-- Stap 1+2+3: drop legacy + rename per tabel via DO-block
DO $$
DECLARE
  tbl text;
  tbls text[] := ARRAY[
    'mail_messages',
    'hubspot_engagements',
    'hubspot_deals',
    'hubspot_companies',
    'hubspot_contacts',
    'jira_issues',
    'fireflies_meetings',
    'calendar_events',
    'jellemind_lessons'
  ];
  old_idx_pattern text[];
  idx_name text;
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    -- 1. Drop oude HNSW indexes (variabele namen — ophalen uit pg_indexes)
    FOR idx_name IN
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = tbl
         AND indexname NOT LIKE '%_3l_%'
         AND indexdef ILIKE '%hnsw%embedding%'
    LOOP
      EXECUTE format('DROP INDEX IF EXISTS public.%I;', idx_name);
    END LOOP;

    -- 2. Drop legacy embedding kolommen (alleen als ze bestaan)
    EXECUTE format(
      'ALTER TABLE public.%I
         DROP COLUMN IF EXISTS embedding,
         DROP COLUMN IF EXISTS embedded_at,
         DROP COLUMN IF EXISTS embedding_input_hash;',
      tbl
    );

    -- 3. Rename de _3l kolommen naar de canonieke namen
    EXECUTE format(
      'ALTER TABLE public.%I RENAME COLUMN embedding_3l TO embedding;',
      tbl
    );
    EXECUTE format(
      'ALTER TABLE public.%I RENAME COLUMN embedded_at_3l TO embedded_at;',
      tbl
    );
    EXECUTE format(
      'ALTER TABLE public.%I RENAME COLUMN embedding_input_hash_3l TO embedding_input_hash;',
      tbl
    );

    -- 4. Drop de _3l-named index (heet nog idx_<tbl>_embedding_3l_hnsw)
    EXECUTE format(
      'DROP INDEX IF EXISTS public.%I;',
      'idx_' || tbl || '_embedding_3l_hnsw'
    );

    -- 4b. Maak de canonieke index (halfvec_cosine_ops, m=16, ef_construction=64)
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON public.%I USING hnsw (embedding halfvec_cosine_ops)
         WITH (m = 16, ef_construction = 64);',
      'idx_' || tbl || '_embedding_hnsw',
      tbl
    );
  END LOOP;
END $$;

-- =============================================================================
-- Stap 5: match_all_sources met halfvec(3072) query parameter
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_all_sources(
  vector, integer, text[], timestamptz, text, text, text, text, text, double precision
);
DROP FUNCTION IF EXISTS public.match_all_sources(
  halfvec, integer, text[], timestamptz, text, text, text, text, text, double precision
);

CREATE OR REPLACE FUNCTION public.match_all_sources(
  query_embedding         halfvec(3072),
  top_k                   integer DEFAULT 5,
  filter_sources          text[] DEFAULT NULL,
  filter_after            timestamptz DEFAULT NULL,
  filter_from_domain      text DEFAULT NULL,
  filter_engagement_type  text DEFAULT NULL,
  filter_owner_id         text DEFAULT NULL,
  filter_company_id       text DEFAULT NULL,
  filter_project_key      text DEFAULT NULL,
  min_similarity          double precision DEFAULT 0.3
) RETURNS TABLE(
  source       text,
  id           text,
  subject      text,
  preview      text,
  occurred_at  timestamptz,
  from_label   text,
  meta         jsonb,
  similarity   double precision
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  WITH mail_hits AS (
    SELECT 'mail'::text AS source, m.id::text AS id,
      m.subject,
      left(strip_html_inline(coalesce(nullif(m.body_preview, ''), m.body_text)), 240) AS preview,
      m.received_at AS occurred_at,
      coalesce(m.from_name, m.from_email) AS from_label,
      jsonb_build_object(
        'folder_path', m.folder_path, 'is_from_me', m.is_from_me,
        'from_domain', m.from_domain, 'has_attachments', m.has_attachments,
        'conversation_id', m.conversation_id
      ) AS meta,
      1 - (m.embedding <=> query_embedding) AS similarity
    FROM mail_messages m
    WHERE m.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'mail' = ANY(filter_sources))
      AND (filter_after IS NULL OR m.received_at >= filter_after)
      AND (filter_from_domain IS NULL OR m.from_domain = filter_from_domain)
      AND m.is_deleted = false
    ORDER BY m.embedding <=> query_embedding LIMIT top_k * 5
  ),
  eng_hits AS (
    SELECT 'engagement'::text, e.id::text,
      e.subject, left(strip_html_inline(e.body_text), 240) AS preview,
      coalesce(e.hs_timestamp, e.hs_created_at) AS occurred_at,
      e.hubspot_owner_id AS from_label,
      jsonb_build_object('engagement_type', e.engagement_type,
        'companies', e.associated_company_ids, 'contacts', e.associated_contact_ids,
        'deals', e.associated_deal_ids) AS meta,
      1 - (e.embedding <=> query_embedding) AS similarity
    FROM hubspot_engagements e
    WHERE e.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'engagement' = ANY(filter_sources))
      AND (filter_after IS NULL OR coalesce(e.hs_timestamp, e.hs_created_at) >= filter_after)
      AND (filter_engagement_type IS NULL OR e.engagement_type = filter_engagement_type)
      AND e.is_archived = false
    ORDER BY e.embedding <=> query_embedding LIMIT top_k * 5
  ),
  jira_hits AS (
    SELECT 'jira'::text, j.issue_key::text,
      j.summary, left(strip_html_inline(j.description), 240) AS preview,
      j.jira_updated_at AS occurred_at,
      j.assignee_name AS from_label,
      jsonb_build_object('project_key', j.project_key, 'status', j.status,
        'priority', j.priority, 'issue_type', j.issue_type, 'labels', j.labels) AS meta,
      1 - (j.embedding <=> query_embedding) AS similarity
    FROM jira_issues j
    WHERE j.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'jira' = ANY(filter_sources))
      AND (filter_after IS NULL OR j.jira_updated_at >= filter_after)
      AND (filter_project_key IS NULL OR j.project_key = filter_project_key)
    ORDER BY j.embedding <=> query_embedding LIMIT top_k * 5
  ),
  deal_hits AS (
    SELECT 'deal'::text, d.deal_id::text,
      d.dealname AS subject,
      left(coalesce((d.properties->>'description')::text, ''), 240) AS preview,
      d.hs_lastmodifieddate AS occurred_at,
      d.hubspot_owner_id AS from_label,
      jsonb_build_object('stage', d.dealstage, 'amount', d.amount,
        'pipeline_id', d.pipeline_id, 'dealtype', d.dealtype) AS meta,
      1 - (d.embedding <=> query_embedding) AS similarity
    FROM hubspot_deals d
    WHERE d.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'deal' = ANY(filter_sources))
      AND (filter_after IS NULL OR d.hs_lastmodifieddate >= filter_after)
      AND (filter_owner_id IS NULL OR d.hubspot_owner_id = filter_owner_id)
      AND d.is_archived = false
    ORDER BY d.embedding <=> query_embedding LIMIT top_k * 5
  ),
  comp_hits AS (
    SELECT 'company'::text, c.company_id::text,
      c.name AS subject,
      left(coalesce((c.properties->>'description')::text, ''), 240) AS preview,
      c.hs_lastmodifieddate AS occurred_at,
      c.industry AS from_label,
      jsonb_build_object('domain', c.properties->>'domain', 'industry', c.industry,
        'lifecycle_stage', c.properties->>'lifecyclestage') AS meta,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM hubspot_companies c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'company' = ANY(filter_sources))
      AND (filter_after IS NULL OR c.hs_lastmodifieddate >= filter_after)
      AND (filter_company_id IS NULL OR c.company_id = filter_company_id)
    ORDER BY c.embedding <=> query_embedding LIMIT top_k * 5
  ),
  cont_hits AS (
    SELECT 'contact'::text, ct.contact_id::text,
      coalesce(nullif(trim(coalesce(ct.firstname,'')||' '||coalesce(ct.lastname,'')),''), ct.email) AS subject,
      left(coalesce(ct.jobtitle, ''), 240) AS preview,
      ct.hs_lastmodifieddate AS occurred_at,
      ct.email AS from_label,
      jsonb_build_object('jobtitle', ct.jobtitle, 'company', ct.properties->>'company') AS meta,
      1 - (ct.embedding <=> query_embedding) AS similarity
    FROM hubspot_contacts ct
    WHERE ct.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'contact' = ANY(filter_sources))
      AND (filter_after IS NULL OR ct.hs_lastmodifieddate >= filter_after)
    ORDER BY ct.embedding <=> query_embedding LIMIT top_k * 5
  ),
  meet_hits AS (
    SELECT 'meeting'::text, m.id::text,
      m.title AS subject,
      left(coalesce(m.summary_text, m.transcript_text, ''), 240) AS preview,
      m.date_time AS occurred_at,
      m.organizer_email AS from_label,
      jsonb_build_object('fireflies_id', m.fireflies_id, 'attendees', m.attendees) AS meta,
      1 - (m.embedding <=> query_embedding) AS similarity
    FROM fireflies_meetings m
    WHERE m.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'meeting' = ANY(filter_sources))
      AND (filter_after IS NULL OR m.date_time >= filter_after)
    ORDER BY m.embedding <=> query_embedding LIMIT top_k * 5
  ),
  evt_hits AS (
    SELECT 'event'::text, e.id::text,
      e.subject,
      left(coalesce(strip_html_inline(e.body_text), e.body_preview, ''), 240) AS preview,
      e.start_time AS occurred_at,
      e.organizer_email AS from_label,
      jsonb_build_object('location', e.location_text, 'categories', e.categories,
        'graph_id', e.graph_id) AS meta,
      1 - (e.embedding <=> query_embedding) AS similarity
    FROM calendar_events e
    WHERE e.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'event' = ANY(filter_sources))
      AND (filter_after IS NULL OR e.start_time >= filter_after)
      AND e.is_cancelled = false
    ORDER BY e.embedding <=> query_embedding LIMIT top_k * 5
  )
  SELECT * FROM (
    SELECT * FROM mail_hits
    UNION ALL SELECT * FROM eng_hits
    UNION ALL SELECT * FROM jira_hits
    UNION ALL SELECT * FROM deal_hits
    UNION ALL SELECT * FROM comp_hits
    UNION ALL SELECT * FROM cont_hits
    UNION ALL SELECT * FROM meet_hits
    UNION ALL SELECT * FROM evt_hits
  ) hits
  WHERE similarity >= min_similarity
  ORDER BY similarity DESC
  LIMIT top_k;
$function$;

-- =============================================================================
-- Stap 6: match_jellemind_lessons updaten naar halfvec
-- =============================================================================

DROP FUNCTION IF EXISTS public.match_jellemind_lessons(vector, integer, double precision, text);

CREATE OR REPLACE FUNCTION public.match_jellemind_lessons(
  query_embedding   halfvec(3072),
  top_k             integer DEFAULT 5,
  min_similarity    double precision DEFAULT 0.5,
  applies_to_filter text DEFAULT NULL
) RETURNS TABLE(
  id              uuid,
  lesson_text     text,
  applies_to      text[],
  evidence_summary text,
  mind_scope      text,
  similarity      double precision
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    l.id,
    l.lesson_text,
    l.applies_to,
    l.evidence_summary,
    l.mind_scope,
    1 - (l.embedding <=> query_embedding) AS similarity
  FROM jellemind_lessons l
  WHERE l.embedding IS NOT NULL
    AND l.active = true
    AND (applies_to_filter IS NULL OR applies_to_filter = ANY(l.applies_to))
    AND (1 - (l.embedding <=> query_embedding)) >= min_similarity
  ORDER BY l.embedding <=> query_embedding
  LIMIT top_k;
$function$;

COMMIT;

-- =============================================================================
-- Smoke test (los uitvoeren na commit):
--   SELECT count(*) FROM mail_messages WHERE embedding IS NOT NULL;
--   -- Should still return same count as embedding_3l NOT NULL was vóór migration
--
--   -- Test match_all_sources met dummy halfvec
--   WITH probe AS (
--     SELECT embedding FROM mail_messages
--      WHERE embedding IS NOT NULL ORDER BY received_at DESC LIMIT 1
--   )
--   SELECT source, subject, similarity::numeric(5,4)
--     FROM match_all_sources((SELECT embedding FROM probe), 5);
--   -- Verwacht: top1 = same row, similarity 1.0000
-- =============================================================================
