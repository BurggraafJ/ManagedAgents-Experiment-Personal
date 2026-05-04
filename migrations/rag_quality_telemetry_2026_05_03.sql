-- =============================================================================
-- R.2 / R.7 — RAG Quality Telemetry Tables
-- =============================================================================
-- Bevat:
--   1. rag_quality_baselines  — A/B-meting met/zonder rag_context
--   2. rag_outcomes           — per draft welke chunks werden gebruikt + uitkomst
--   3. rag_chunk_signals      — aggregeerd: per chunk hoe vaak nuttig vs ruis
--
-- Doel: meten of upgrade naar text-embedding-3-large + halfvec(3072) +
-- contextual augmentation daadwerkelijk acceptance-rate verhoogt.
-- =============================================================================

-- 1. Baseline measurements voor mini-A/B (R.2)
CREATE TABLE IF NOT EXISTS public.rag_quality_baselines (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_run_id     text NOT NULL,
  autodraft_mail_id     uuid REFERENCES autodraft_mails(id) ON DELETE CASCADE,
  variant               text NOT NULL CHECK (variant IN (
                          'with_rag', 'without_rag',
                          'with_chunks', 'with_hybrid', 'with_full_quality'
                        )),
  draft_body            text,
  draft_subject         text,
  rag_context_snapshot  jsonb,
  token_input           integer,
  token_output          integer,
  latency_ms            integer,
  reviewer_decision     text CHECK (reviewer_decision IN ('accept','reject','amend',NULL)),
  reviewer_notes        text,
  reviewer_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_baselines_run     ON rag_quality_baselines(experiment_run_id, variant);
CREATE INDEX IF NOT EXISTS idx_rag_baselines_mail    ON rag_quality_baselines(autodraft_mail_id);
CREATE INDEX IF NOT EXISTS idx_rag_baselines_created ON rag_quality_baselines(created_at DESC);

-- 2. rag_outcomes — per draft/decision welke chunks meegingen
CREATE TABLE IF NOT EXISTS public.rag_outcomes (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type           text NOT NULL,             -- 'autodraft' | 'sales-on-road' | etc.
  source_id             uuid NOT NULL,             -- autodraft_decisions.id, sales_on_road_events.id, ...
  decision_action       text,                       -- 'send' | 'amend' | 'ignore' | 'accept' | etc.
  bundle_id             uuid,                       -- toekomst: context_bundles ref
  chunks_used           jsonb,                      -- [{chunk_id, source, similarity}, ...]
  total_chunks          integer DEFAULT 0,
  avg_top_similarity    numeric(5,4),
  retrieval_strategy    text,                       -- 'match_all_sources' | 'match_chunks_v1' | etc.
  retrieval_params      jsonb,                      -- {top_k, min_similarity, recency_weight, mmr_lambda}
  tokens_input          integer,
  tokens_output         integer,
  cost_usd              numeric(10,6),
  outcome               text CHECK (outcome IN ('accept','amend','reject','timeout','error',NULL)),
  outcome_at            timestamptz,
  outcome_notes         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_outcomes_source       ON rag_outcomes(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_rag_outcomes_outcome      ON rag_outcomes(outcome, outcome_at DESC);
CREATE INDEX IF NOT EXISTS idx_rag_outcomes_strategy     ON rag_outcomes(retrieval_strategy);
CREATE INDEX IF NOT EXISTS idx_rag_outcomes_bundle       ON rag_outcomes(bundle_id);
CREATE INDEX IF NOT EXISTS idx_rag_outcomes_chunks_gin   ON rag_outcomes USING GIN(chunks_used);

-- 3. rag_chunk_signals — aggregeerd per chunk over tijd
-- (refresht via trigger of cron job; voor nu read-only voor analytics)
CREATE TABLE IF NOT EXISTS public.rag_chunk_signals (
  chunk_id                uuid PRIMARY KEY,         -- ref naar chunks.chunk_id (R.3)
  times_retrieved         integer NOT NULL DEFAULT 0,
  times_in_accepted       integer NOT NULL DEFAULT 0,
  times_in_amended        integer NOT NULL DEFAULT 0,
  times_in_rejected       integer NOT NULL DEFAULT 0,
  acceptance_rate         numeric(5,4) GENERATED ALWAYS AS (
    CASE WHEN times_retrieved > 0
      THEN times_in_accepted::numeric / times_retrieved
      ELSE NULL
    END
  ) STORED,
  last_retrieved_at       timestamptz,
  last_acceptance_at      timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunk_signals_acceptance ON rag_chunk_signals(acceptance_rate DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chunk_signals_retrieved  ON rag_chunk_signals(times_retrieved DESC);

-- =============================================================================
-- Helper RPC: log_rag_outcome — door auto-draft skill / dashboard aangeroepen
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_rag_outcome(
  p_source_type        text,
  p_source_id          uuid,
  p_decision_action    text,
  p_chunks_used        jsonb,
  p_retrieval_strategy text DEFAULT 'match_all_sources',
  p_retrieval_params   jsonb DEFAULT '{}'::jsonb,
  p_tokens_input       integer DEFAULT NULL,
  p_tokens_output      integer DEFAULT NULL,
  p_outcome            text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_avg_sim numeric(5,4);
  v_total int;
BEGIN
  v_total := jsonb_array_length(coalesce(p_chunks_used, '[]'::jsonb));

  -- Bereken avg top-similarity uit chunks_used
  IF v_total > 0 THEN
    SELECT round(avg((c->>'similarity')::numeric)::numeric, 4) INTO v_avg_sim
      FROM jsonb_array_elements(p_chunks_used) c;
  END IF;

  INSERT INTO rag_outcomes (
    source_type, source_id, decision_action, chunks_used, total_chunks,
    avg_top_similarity, retrieval_strategy, retrieval_params,
    tokens_input, tokens_output, outcome, outcome_at
  ) VALUES (
    p_source_type, p_source_id, p_decision_action, p_chunks_used, v_total,
    v_avg_sim, p_retrieval_strategy, p_retrieval_params,
    p_tokens_input, p_tokens_output, p_outcome,
    CASE WHEN p_outcome IS NOT NULL THEN now() END
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_rag_outcome(
  text, uuid, text, jsonb, text, jsonb, integer, integer, text
) TO authenticated, service_role;
