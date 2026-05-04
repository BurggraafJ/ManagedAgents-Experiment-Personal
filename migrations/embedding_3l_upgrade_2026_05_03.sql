-- =============================================================================
-- B.2 — Embedding-model upgrade naar text-embedding-3-large (3072 dim, halfvec)
-- =============================================================================
-- Gegenereerd: 2026-05-03
-- Beslissing: B.2 ✅ in current_architecture.md §8 (was 🟡 geparkeerd, geactiveerd
--             door Jelle 2026-05-03).
--
-- WAT DOET DIT:
-- - Voor 9 embedding-tabellen: nieuwe kolom embedding_3l halfvec(3072) toevoegen
--   + tracking-kolommen + HNSW index op halfvec_cosine_ops.
-- - Oude kolom (embedding vector(1536)) blijft staan tijdens transitie. Pas
--   wanneer mail-embed-v3l alle records heeft her-embed (typisch 1-2 dagen),
--   schakelen we match_all_sources over en droppen we de oude kolom.
--
-- WAAROM HALFVEC:
-- - vector(3072) past niet in HNSW (limiet 2000 dims voor vector).
-- - halfvec(3072) past wel (limiet 4000 dims voor halfvec).
-- - Halfvec is 16-bit float — ~50% geheugen-besparing, marginale kwaliteits-impact.
-- - pgvector 0.7+ ondersteunt halfvec native. Geverifieerd live.
--
-- LEGACY-KOLOM:
-- - embedding vector(1536) blijft staan tot match_all_sources naar embedding_3l
--   is omgezet. Daarna apart DROP-migration in een latere sessie.
-- =============================================================================

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
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    -- Nieuwe kolommen
    EXECUTE format(
      'ALTER TABLE public.%I
         ADD COLUMN IF NOT EXISTS embedding_3l halfvec(3072),
         ADD COLUMN IF NOT EXISTS embedded_at_3l timestamptz,
         ADD COLUMN IF NOT EXISTS embedding_input_hash_3l text;',
      tbl
    );
    -- HNSW index op halfvec_cosine_ops
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I
         ON public.%I USING hnsw (embedding_3l halfvec_cosine_ops)
         WITH (m = 16, ef_construction = 64);',
      'idx_' || tbl || '_embedding_3l_hnsw',
      tbl
    );
  END LOOP;
END $$;

-- Documentatie via column comments
COMMENT ON COLUMN public.mail_messages.embedding_3l        IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.hubspot_engagements.embedding_3l  IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.hubspot_deals.embedding_3l        IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.hubspot_companies.embedding_3l    IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.hubspot_contacts.embedding_3l     IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.jira_issues.embedding_3l          IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.fireflies_meetings.embedding_3l   IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.calendar_events.embedding_3l      IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';
COMMENT ON COLUMN public.jellemind_lessons.embedding_3l    IS 'text-embedding-3-large (3072d halfvec). B.2 upgrade 2026-05-03.';

-- Smoke-test: tel hoeveel records per tabel nog embedded moeten worden
-- (informatief; niet uitgevoerd via migration, gebruik in monitoring):
--
--   SELECT 'mail_messages' AS tbl, count(*) FILTER (WHERE embedding_3l IS NULL) AS pending
--     FROM mail_messages
--   UNION ALL ... etc voor alle 9 tabellen.
