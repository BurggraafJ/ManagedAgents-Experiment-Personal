-- =============================================================================
-- R.3 — Chunks-tabel + indexes (vector + FTS + entity)
-- =============================================================================
-- Eenheid van indexing wordt CHUNK, niet truth-of-source record. Truth-of-source
-- blijft eigenaar; chunks zijn afgeleide laag.
--
-- Per chunk:
--   - content              (naakte tekst)
--   - content_with_context (prefix + content — wat we embedden)
--   - embedding            halfvec(3072) text-embedding-3-large
--   - fts_vector           tsvector voor BM25/keyword retrieval
--   - entity_ids           denormalized contact/company/deal IDs
--   - metadata             source-specifieke jsonb
--
-- Adaptive chunking per source-type (zie chunker-router edge function):
--   mail-thread, mail-message, meeting-macro, meeting-topic, meeting-salient,
--   deal-master, engagement, jira, document
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.chunks (
  -- Identificatie
  chunk_id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  source                text          NOT NULL,    -- 'mail' | 'engagement' | 'jira' | 'deal' | 'company' | 'contact' | 'event' | 'meeting' | 'lesson' | 'finding'
  source_id             text          NOT NULL,    -- de id in de truth-of-source tabel
  source_subtype        text,                       -- 'phone_call' | 'mt_meeting' | 'thread' | 'message' | etc.
  chunk_type            text          NOT NULL,    -- 'thread' | 'message' | 'macro' | 'topic' | 'salient' | 'master' | 'engagement' | 'document'
  parent_chunk_id       uuid          REFERENCES chunks(chunk_id) ON DELETE CASCADE,
  sequence              integer       NOT NULL DEFAULT 0,

  -- Content
  content               text          NOT NULL,
  content_with_context  text          NOT NULL,    -- prefix + content (gegenereerd door GPT-5-nano)

  -- Embedding (text-embedding-3-large, 3072d, halfvec voor HNSW)
  embedding             halfvec(3072),
  embedded_at           timestamptz,
  embedding_model       text,
  embedding_input_hash  text,                       -- sha256(content_with_context)

  -- FTS / BM25 retrieval
  fts_vector            tsvector,

  -- Tijd-anchor
  occurred_at           timestamptz   NOT NULL,

  -- Entity-koppelingen (R.5 vult dit later via entity_resolution)
  entity_ids            text[]        DEFAULT '{}',
  primary_entity_id     text,

  -- Voor saillante zinnen (chunk_type='salient')
  speaker               text,
  fact_type             text          CHECK (fact_type IN ('commitment','date','price','name','rejection','agreement','question',NULL)),
  timestamp_in_source   numeric,

  -- Voor topic-segmenten (chunk_type='topic')
  topic_title           text,
  topic_speakers        text[],

  -- Source-specifieke metadata
  metadata              jsonb         DEFAULT '{}'::jsonb,

  -- Audit
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chunks_source_id        ON chunks(source, source_id);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_type       ON chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_chunks_parent           ON chunks(parent_chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunks_occurred         ON chunks(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_primary_entity   ON chunks(primary_entity_id);
CREATE INDEX IF NOT EXISTS idx_chunks_entity_ids_gin   ON chunks USING GIN(entity_ids);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_gin          ON chunks USING GIN(fts_vector);
CREATE INDEX IF NOT EXISTS idx_chunks_input_hash       ON chunks(embedding_input_hash);

-- HNSW vector index — alleen aanmaken als embedding NOT NULL (na backfill)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw   ON chunks USING hnsw(embedding halfvec_cosine_ops) WITH (m=16, ef_construction=64);

-- Trigger: update fts_vector automatisch bij insert/update content
CREATE OR REPLACE FUNCTION chunks_fts_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.fts_vector := to_tsvector('dutch',
    coalesce(NEW.content, '') || ' ' || coalesce(NEW.content_with_context, ''));
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chunks_fts ON chunks;
CREATE TRIGGER trg_chunks_fts
  BEFORE INSERT OR UPDATE OF content, content_with_context
  ON chunks FOR EACH ROW EXECUTE FUNCTION chunks_fts_update();

-- Permissions
GRANT SELECT ON chunks TO authenticated;
GRANT ALL ON chunks TO service_role;

COMMENT ON TABLE chunks IS 'R.3 — Adaptive chunking voor RAG. Eenheid van indexing. text-embedding-3-large + halfvec.';
