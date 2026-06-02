-- =============================================================================
-- RAG v2 — Fase 0: meetbaarheid herstellen (quality-loop weer aan)
-- Toegepast live 2026-06-02 via MCP-migraties:
--   rag_outcome_logging_decision_time_2026_06_02
--   rag_outcome_proposal_trigger_2026_06_02
--   log_rag_outcome_vector_score_avg_2026_06_02
--   rag_chunk_signals_aggregate(_fix_generated)_2026_06_02
--   rag_chunker_staleness_guard_2026_06_02
-- Dit bestand = geconsolideerde, re-appliable eindstaat (borging in repo).
--
-- ACHTERGROND (geverifieerd live, corrigeert de eerdere diagnose):
--   * autodraft_decisions is NIET dood — het is de convergence-point voor zowel de
--     reply-flow (submit_autodraft_decision) als de action-card-flow
--     (submit_action_decision bridget 'accept' hierheen).
--   * De oude trigger gatete op execution_status='done'; de meeste decisions zijn
--     'skipped' (executor no-op want Jelle handelde de mail al af in Outlook). Een
--     'skipped' send/ignore/amend is WEL een echte beslissing -> die gooiden we weg.
--   * Fix: log op het decision-moment (action gezet + bundle resolvet), niet op
--     execution. + outcome-trigger op agent_proposals. + avg_top_similarity = echte
--     cosine. + rag_chunk_signals gevuld. + chunker-staleness-guard.
-- =============================================================================

-- 1) Eén-outcome-per-decision afdwingen (idempotency). log_search_feedback schrijft
--    source_id=NULL -> partial index sluit die uit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_outcomes_source_decision
  ON rag_outcomes(source_type, source_id) WHERE source_id IS NOT NULL;

-- 2) log_rag_outcome: avg_top_similarity = echte cosine (vector_score) i.p.v. combined.
CREATE OR REPLACE FUNCTION public.log_rag_outcome(
  p_source_type text, p_source_id uuid, p_decision_action text, p_chunks_used jsonb,
  p_retrieval_strategy text DEFAULT 'match_all_sources'::text,
  p_retrieval_params jsonb DEFAULT '{}'::jsonb,
  p_tokens_input integer DEFAULT NULL::integer, p_tokens_output integer DEFAULT NULL::integer,
  p_outcome text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_avg_sim numeric(5,4); v_total int;
BEGIN
  v_total := jsonb_array_length(coalesce(p_chunks_used, '[]'::jsonb));
  IF v_total > 0 THEN
    SELECT round(avg(COALESCE((c->>'vector_score')::numeric, (c->>'similarity')::numeric))::numeric, 4)
      INTO v_avg_sim FROM jsonb_array_elements(p_chunks_used) c;
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
END $function$;

-- 3) Reply/draft-pad: log op decision-moment (action send/amend/ignore/spam).
CREATE OR REPLACE FUNCTION public.log_autodraft_rag_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mail autodraft_mails%ROWTYPE; v_chunks jsonb; v_outcome text;
  v_existing_id uuid; v_bundle_id uuid;
BEGIN
  v_outcome := CASE NEW.action
    WHEN 'send' THEN 'accept' WHEN 'amend' THEN 'amend'
    WHEN 'ignore' THEN 'reject' WHEN 'spam' THEN 'reject' ELSE NULL END;
  IF v_outcome IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_existing_id FROM rag_outcomes
   WHERE source_type='autodraft' AND source_id=NEW.id LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id=NEW.mail_id ORDER BY scanned_at DESC LIMIT 1;
  IF NOT FOUND OR v_mail.rag_context IS NULL THEN RETURN NEW; END IF;
  v_chunks := v_mail.rag_context -> 'matches';
  IF v_chunks IS NULL OR jsonb_typeof(v_chunks) <> 'array' OR jsonb_array_length(v_chunks)=0 THEN RETURN NEW; END IF;

  v_bundle_id := NULL;
  IF v_mail.rag_context ? 'bundle_id' THEN
    BEGIN v_bundle_id := (v_mail.rag_context ->> 'bundle_id')::uuid;
    EXCEPTION WHEN others THEN v_bundle_id := NULL; END;
  END IF;

  PERFORM log_rag_outcome('autodraft', NEW.id, NEW.action, v_chunks,
    COALESCE(v_mail.rag_context ->> 'retrieval_strategy', 'context-build/draft_reply'),
    COALESCE(v_mail.rag_context -> 'retrieval_params', '{}'::jsonb), NULL, NULL, v_outcome);

  IF v_bundle_id IS NOT NULL THEN
    UPDATE rag_outcomes SET context_bundle_id = v_bundle_id
     WHERE source_type='autodraft' AND source_id=NEW.id AND context_bundle_id IS NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO agent_runs (agent_name, run_type, status, started_at, completed_at, summary, errors, stats)
  VALUES ('rag-outcome-trigger','db_trigger','warning', now(), now(),
          'log_autodraft_rag_outcome failed for decision '||NEW.id::text,
          jsonb_build_array(jsonb_build_object('message', SQLERRM)),
          jsonb_build_object('decision_id', NEW.id, 'mail_id', NEW.mail_id));
  RETURN NEW;
END $function$;

-- 4) Action-card-pad: amend/reject (accept bridget al naar autodraft_decisions).
CREATE OR REPLACE FUNCTION public.log_action_card_rag_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mail autodraft_mails%ROWTYPE; v_chunks jsonb; v_existing_id uuid; v_bundle_id uuid;
BEGIN
  IF NEW.outcome IS NULL OR NEW.outcome NOT IN ('amend','reject') THEN RETURN NEW; END IF;
  SELECT id INTO v_existing_id FROM rag_outcomes
   WHERE source_type='autodraft_action' AND source_id=NEW.id LIMIT 1;
  IF v_existing_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id=NEW.mail_id ORDER BY scanned_at DESC LIMIT 1;
  IF NOT FOUND OR v_mail.rag_context IS NULL THEN RETURN NEW; END IF;
  v_chunks := v_mail.rag_context -> 'matches';
  IF v_chunks IS NULL OR jsonb_typeof(v_chunks) <> 'array' OR jsonb_array_length(v_chunks)=0 THEN RETURN NEW; END IF;
  v_bundle_id := NULL;
  IF v_mail.rag_context ? 'bundle_id' THEN
    BEGIN v_bundle_id := (v_mail.rag_context ->> 'bundle_id')::uuid; EXCEPTION WHEN others THEN v_bundle_id := NULL; END;
  END IF;
  PERFORM log_rag_outcome('autodraft_action', NEW.id, NEW.action_slug, v_chunks,
    COALESCE(v_mail.rag_context ->> 'retrieval_strategy', 'context-build/classify_mail_action'),
    COALESCE(v_mail.rag_context -> 'retrieval_params', '{}'::jsonb), NULL, NULL, NEW.outcome);
  IF v_bundle_id IS NOT NULL THEN
    UPDATE rag_outcomes SET context_bundle_id = v_bundle_id
     WHERE source_type='autodraft_action' AND source_id=NEW.id AND context_bundle_id IS NULL;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO agent_runs (agent_name, run_type, status, started_at, completed_at, summary, errors, stats)
  VALUES ('rag-outcome-trigger','db_trigger','warning', now(), now(),
          'log_action_card_rag_outcome failed for decision '||NEW.id::text,
          jsonb_build_array(jsonb_build_object('message', SQLERRM)),
          jsonb_build_object('decision_id', NEW.id));
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS autodraft_action_decisions_log_rag_outcome ON autodraft_action_decisions;
CREATE TRIGGER autodraft_action_decisions_log_rag_outcome
AFTER INSERT OR UPDATE OF outcome ON autodraft_action_decisions
FOR EACH ROW EXECUTE FUNCTION log_action_card_rag_outcome();

-- 5) Reusable helper + agent_proposals-outcome-trigger.
CREATE OR REPLACE FUNCTION public.log_rag_outcome_from_bundle(
  p_source_type text, p_source_id uuid, p_decision_action text, p_bundle_id uuid, p_outcome text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_b context_bundles%ROWTYPE; v_chunks jsonb; v_avg numeric; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM rag_outcomes WHERE source_type=p_source_type AND source_id=p_source_id LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE rag_outcomes SET outcome=p_outcome, outcome_at=now(),
           decision_action=COALESCE(p_decision_action, decision_action)
     WHERE id=v_id AND (outcome IS NULL OR outcome='pending');
    RETURN v_id;
  END IF;
  IF p_bundle_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_b FROM context_bundles WHERE bundle_id=p_bundle_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_chunks := COALESCE(v_b.related_chunks, '[]'::jsonb);
  SELECT round(avg(COALESCE((c->>'vector_score')::numeric, (c->>'similarity')::numeric))::numeric,4)
    INTO v_avg FROM jsonb_array_elements(v_chunks) c;
  INSERT INTO rag_outcomes (source_type, source_id, decision_action, bundle_id, context_bundle_id,
    chunks_used, total_chunks, avg_top_similarity, retrieval_strategy, retrieval_params, outcome, outcome_at)
  VALUES (p_source_type, p_source_id, p_decision_action, p_bundle_id, p_bundle_id,
    v_chunks, COALESCE(jsonb_array_length(v_chunks),0), v_avg,
    COALESCE(v_b.retrieval_meta->>'strategy','context-build/'||COALESCE(v_b.intent,'?')),
    COALESCE(v_b.retrieval_meta,'{}'::jsonb), p_outcome, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.log_proposal_rag_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_outcome text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_outcome := CASE NEW.status
    WHEN 'rejected' THEN 'reject' WHEN 'dismissed' THEN 'reject'
    WHEN 'amended' THEN 'amend' WHEN 'accepted' THEN 'accept'
    WHEN 'executed' THEN CASE WHEN NEW.amendment IS NOT NULL AND length(trim(NEW.amendment))>0 THEN 'amend' ELSE 'accept' END
    ELSE NULL END;
  IF v_outcome IS NULL THEN RETURN NEW; END IF;
  PERFORM log_rag_outcome_from_bundle(COALESCE(NEW.agent_name,'agent-proposal'), NEW.id, NEW.status, NEW.context_bundle_id, v_outcome);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO agent_runs (agent_name, run_type, status, started_at, completed_at, summary, errors, stats)
  VALUES ('rag-outcome-trigger','db_trigger','warning', now(), now(),
          'log_proposal_rag_outcome failed for proposal '||NEW.id::text,
          jsonb_build_array(jsonb_build_object('message', SQLERRM)),
          jsonb_build_object('proposal_id', NEW.id));
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS agent_proposals_log_rag_outcome ON agent_proposals;
CREATE TRIGGER agent_proposals_log_rag_outcome
AFTER UPDATE OF status ON agent_proposals
FOR EACH ROW EXECUTE FUNCTION log_proposal_rag_outcome();

-- 6) rag_chunk_signals aggregaat (acceptance_rate is GENERATED -> niet in INSERT).
CREATE OR REPLACE FUNCTION public.refresh_rag_chunk_signals()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  DELETE FROM rag_chunk_signals;
  WITH expanded AS (
    SELECT (c->>'chunk_id')::uuid AS chunk_id, o.outcome, COALESCE(o.outcome_at, o.created_at) AS at
    FROM rag_outcomes o, jsonb_array_elements(o.chunks_used) c
    WHERE o.outcome IN ('accept','amend','reject')
      AND c->>'chunk_id' IS NOT NULL AND length(c->>'chunk_id') = 36
  ),
  agg AS (
    SELECT chunk_id, count(*) AS times_retrieved,
      count(*) FILTER (WHERE outcome='accept') AS acc,
      count(*) FILTER (WHERE outcome='amend')  AS amd,
      count(*) FILTER (WHERE outcome='reject') AS rej,
      max(at) AS last_retrieved_at, max(at) FILTER (WHERE outcome='accept') AS last_acc
    FROM expanded GROUP BY chunk_id
  )
  INSERT INTO rag_chunk_signals
    (chunk_id, times_retrieved, times_in_accepted, times_in_amended, times_in_rejected,
     last_retrieved_at, last_acceptance_at, updated_at)
  SELECT chunk_id, times_retrieved, acc, amd, rej, last_retrieved_at, last_acc, now() FROM agg;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;

-- 7) Chunker-staleness-guard (vangt stille chunker-outages, P0-1).
CREATE OR REPLACE FUNCTION public.rag_pipeline_staleness_check()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_last_chunk timestamptz; v_age_min numeric; v_pending boolean; v_is_stale boolean; v_finding_id uuid;
BEGIN
  SELECT max(created_at) INTO v_last_chunk FROM chunks;
  v_age_min := EXTRACT(EPOCH FROM (now() - v_last_chunk)) / 60.0;
  SELECT EXISTS (
    SELECT 1 FROM mail_messages m
     WHERE m.received_at > now() - interval '3 hours'
       AND COALESCE(m.is_deleted, false) = false
       AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source='mail' AND c.source_id = m.id)
  ) INTO v_pending;
  v_is_stale := (v_age_min > 30) AND v_pending;
  IF v_is_stale THEN
    IF NOT EXISTS (SELECT 1 FROM security_findings
       WHERE affected_object='chunker' AND scan_type='rag_pipeline_guard'
         AND status='open' AND found_at > now() - interval '6 hours') THEN
      INSERT INTO security_findings (scan_type, severity, category, title, detail, affected_object, status)
      VALUES ('rag_pipeline_guard','high','pipeline_staleness',
        'Chunker stil >30 min terwijl er ongechunkte mail wacht',
        format('Laatste chunk %s min geleden (%s). Ongechunkte mail aanwezig. Check chunker-cron (jobid 18) + verify_jwt:false + edge-logs.',
               round(v_age_min)::text, COALESCE(v_last_chunk::text,'NULL')),
        'chunker','open') RETURNING id INTO v_finding_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('is_stale', v_is_stale, 'last_chunk_at', v_last_chunk,
    'age_minutes', round(v_age_min,1), 'pending_unchunked_mail', v_pending, 'finding_created', v_finding_id);
END $function$;

-- 8) Cron-jobs (idempotent via cron.schedule upsert-by-name).
SELECT cron.schedule('rag-chunk-signals-refresh', '20 3 * * *',  $$ SELECT public.refresh_rag_chunk_signals(); $$);
SELECT cron.schedule('rag-chunker-staleness-guard', '*/15 6-22 * * *', $$ SELECT public.rag_pipeline_staleness_check(); $$);

-- 9) Eenmalige backfill (idempotent — NOT EXISTS / pending-guards).
DO $bf_autodraft$
DECLARE r record; v_mail autodraft_mails%ROWTYPE; v_chunks jsonb; v_bundle_id uuid; v_outcome text;
BEGIN
  FOR r IN SELECT d.id, d.action, d.mail_id FROM autodraft_decisions d
     WHERE d.action IN ('send','amend','ignore','spam')
       AND NOT EXISTS (SELECT 1 FROM rag_outcomes o WHERE o.source_type='autodraft' AND o.source_id=d.id)
  LOOP
    v_outcome := CASE r.action WHEN 'send' THEN 'accept' WHEN 'amend' THEN 'amend' WHEN 'ignore' THEN 'reject' WHEN 'spam' THEN 'reject' END;
    SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id=r.mail_id ORDER BY scanned_at DESC LIMIT 1;
    IF NOT FOUND OR v_mail.rag_context IS NULL THEN CONTINUE; END IF;
    v_chunks := v_mail.rag_context -> 'matches';
    IF v_chunks IS NULL OR jsonb_typeof(v_chunks)<>'array' OR jsonb_array_length(v_chunks)=0 THEN CONTINUE; END IF;
    v_bundle_id := NULL;
    IF v_mail.rag_context ? 'bundle_id' THEN BEGIN v_bundle_id := (v_mail.rag_context->>'bundle_id')::uuid; EXCEPTION WHEN others THEN v_bundle_id:=NULL; END; END IF;
    PERFORM log_rag_outcome('autodraft', r.id, r.action, v_chunks,
      COALESCE(v_mail.rag_context->>'retrieval_strategy','context-build/draft_reply'),
      COALESCE(v_mail.rag_context->'retrieval_params','{}'::jsonb), NULL, NULL, v_outcome);
    IF v_bundle_id IS NOT NULL THEN
      UPDATE rag_outcomes SET context_bundle_id=v_bundle_id WHERE source_type='autodraft' AND source_id=r.id AND context_bundle_id IS NULL;
    END IF;
  END LOOP;
END $bf_autodraft$;

DO $bf_prop$
DECLARE r record; v_outcome text;
BEGIN
  FOR r IN SELECT p.id, p.agent_name, p.status, p.amendment, p.context_bundle_id FROM agent_proposals p
     WHERE p.status IN ('executed','rejected','dismissed','accepted','amended')
       AND (p.context_bundle_id IS NOT NULL OR EXISTS (SELECT 1 FROM rag_outcomes o WHERE o.source_id=p.id))
  LOOP
    v_outcome := CASE r.status WHEN 'rejected' THEN 'reject' WHEN 'dismissed' THEN 'reject'
      WHEN 'amended' THEN 'amend' WHEN 'accepted' THEN 'accept'
      WHEN 'executed' THEN CASE WHEN r.amendment IS NOT NULL AND length(trim(r.amendment))>0 THEN 'amend' ELSE 'accept' END END;
    PERFORM log_rag_outcome_from_bundle(COALESCE(r.agent_name,'agent-proposal'), r.id, r.status, r.context_bundle_id, v_outcome);
  END LOOP;
END $bf_prop$;

-- Recompute bestaande avg_top_similarity naar cosine + vul chunk-signals.
WITH recomputed AS (
  SELECT o.id, round(avg(COALESCE((c->>'vector_score')::numeric,(c->>'similarity')::numeric))::numeric,4) AS avg_sim
  FROM rag_outcomes o, jsonb_array_elements(o.chunks_used) c
  WHERE o.chunks_used IS NOT NULL AND jsonb_typeof(o.chunks_used)='array' AND jsonb_array_length(o.chunks_used)>0
  GROUP BY o.id)
UPDATE rag_outcomes o SET avg_top_similarity = r.avg_sim FROM recomputed r WHERE o.id = r.id;

SELECT public.refresh_rag_chunk_signals();
