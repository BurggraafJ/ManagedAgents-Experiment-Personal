-- =============================================================================
-- Eval cheap models + hard OpenAI spend caps                         (v1.213)
-- =============================================================================
-- Judge → gpt-5-nano; eval-pad rewrite/rerank → gpt-5-nano; hard spend gate
-- €2,50/run + €25/maand. Research: EVAL-CHEAP-MODELS-SPEND-CAP-RESEARCH.md.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.
-- =============================================================================

-- ── 1. Kolommen op rag_eval_runs ────────────────────────────────────────────
ALTER TABLE public.rag_eval_runs
  ADD COLUMN IF NOT EXISTS preflight_estimate_usd numeric,
  ADD COLUMN IF NOT EXISTS preflight_estimate_eur numeric,
  ADD COLUMN IF NOT EXISTS spend_ok_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS judge_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS abort_reason text;

COMMENT ON COLUMN public.rag_eval_runs.preflight_estimate_usd IS 'Geschatte kosten vóór de run start (spend gate). NULL = legacy run.';
COMMENT ON COLUMN public.rag_eval_runs.preflight_estimate_eur IS 'preflight_estimate_usd / usd_per_eur (of 1.0). Vergeleken met spend_cap_run_eur.';
COMMENT ON COLUMN public.rag_eval_runs.spend_ok_applied IS 'true als een spend_ok_token is gebruikt om de per-run cap te overschrijden.';
COMMENT ON COLUMN public.rag_eval_runs.judge_cost_usd IS 'Som judge-kosten uit envelope_compact.judge_usage × PRICE_PER_M. Gevuld bij finish.';
COMMENT ON COLUMN public.rag_eval_runs.abort_reason IS 'spend_cap_run | spend_cap_month | openai_credits | null. Gevuld als status = aborted_spend.';

-- Status: voeg aborted_spend toe aan de check constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_runs_status_check') THEN
    ALTER TABLE public.rag_eval_runs DROP CONSTRAINT rag_eval_runs_status_check;
  END IF;
  ALTER TABLE public.rag_eval_runs ADD CONSTRAINT rag_eval_runs_status_check
    CHECK (status IN ('queued', 'running', 'done', 'failed', 'invalid_persona', 'aborted_spend'));
END $$;

-- ── 2. agent_config keys voor spend gate ────────────────────────────────────
INSERT INTO public.agent_config (agent_name, config_key, config_value) VALUES
  ('rag-eval-cron', 'spend_cap_run_eur',   '2.5'::jsonb),
  ('rag-eval-cron', 'spend_cap_month_eur',  '25'::jsonb),
  ('rag-eval-cron', 'spend_ok_token',       'null'::jsonb),
  ('rag-eval-cron', 'judge_model',          '"gpt-5-nano"'::jsonb),
  ('rag-eval-cron', 'eval_rewrite_model',   '"gpt-5-nano"'::jsonb),
  ('rag-eval-cron', 'eval_rerank_model',    '"gpt-5-nano"'::jsonb),
  ('rag-eval-cron', 'cost_per_item_usd',    '{"chat":0.025,"retrieval":0.002,"agentic":0.06,"judge":0.00005}'::jsonb)
ON CONFLICT (agent_name, config_key) DO NOTHING;

-- ── 3. View: maandverbruik eval-OpenAI ──────────────────────────────────────
CREATE OR REPLACE VIEW public.v_rag_eval_spend_month
WITH (security_invoker = on) AS
SELECT
  date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam') AS month_start,
  count(*) AS n_runs,
  coalesce(sum(
    CASE
      WHEN status = 'running'
        THEN greatest(coalesce(cost_usd_total, 0) + coalesce(judge_cost_usd, 0),
                      coalesce(preflight_estimate_usd, 0))
      ELSE coalesce(cost_usd_total, 0) + coalesce(judge_cost_usd, 0)
    END
  ), 0) AS spent_usd
FROM public.rag_eval_runs
WHERE status IN ('done', 'running', 'failed')
  AND started_at >= date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam');

COMMENT ON VIEW public.v_rag_eval_spend_month IS 'Maandverbruik eval-OpenAI in USD. Running runs tellen mee met max(actuals, preflight). Basis voor de €25 maandcap.';
REVOKE ALL ON public.v_rag_eval_spend_month FROM anon;
GRANT SELECT ON public.v_rag_eval_spend_month TO authenticated, service_role;

-- ── 4. RPC: spend gate ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_spend_gate(
  p_estimate_usd numeric,
  p_force_ok boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_spent_usd    numeric;
  v_cap_run_eur  numeric;
  v_cap_month    numeric;
  v_usd_per_eur  numeric;
  v_estimate_eur numeric;
  v_spent_eur    numeric;
  v_token        jsonb;
  v_token_ok     boolean := false;
  v_reason       text;
BEGIN
  -- Caps uit agent_config
  SELECT coalesce((config_value #>> '{}')::numeric, 2.5) INTO v_cap_run_eur
    FROM agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'spend_cap_run_eur';
  IF v_cap_run_eur IS NULL THEN v_cap_run_eur := 2.5; END IF;

  SELECT coalesce((config_value #>> '{}')::numeric, 25) INTO v_cap_month
    FROM agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'spend_cap_month_eur';
  IF v_cap_month IS NULL THEN v_cap_month := 25; END IF;

  -- Koers
  SELECT waarde INTO v_usd_per_eur
    FROM public.dash_parameters WHERE sleutel = 'model_budget_usd_per_eur';
  IF v_usd_per_eur IS NULL OR v_usd_per_eur <= 0 THEN v_usd_per_eur := 1.0; END IF;

  v_estimate_eur := p_estimate_usd / v_usd_per_eur;

  -- Maandverbruik
  SELECT coalesce(spent_usd, 0) INTO v_spent_usd FROM v_rag_eval_spend_month;
  IF v_spent_usd IS NULL THEN v_spent_usd := 0; END IF;
  v_spent_eur := v_spent_usd / v_usd_per_eur;

  -- Maandcap (hard, token helpt niet)
  IF v_estimate_eur > (v_cap_month - v_spent_eur) THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'spend_cap_month',
      'spent_month_usd', round(v_spent_usd, 2), 'spent_month_eur', round(v_spent_eur, 2),
      'cap_month_eur', v_cap_month,
      'estimate_usd', round(p_estimate_usd, 4), 'estimate_eur', round(v_estimate_eur, 4),
      'usd_per_eur', v_usd_per_eur, 'need_ok', false);
  END IF;

  -- Per-run cap
  IF v_estimate_eur > v_cap_run_eur THEN
    -- Check spend_ok_token
    SELECT config_value INTO v_token
      FROM agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'spend_ok_token';
    IF v_token IS NOT NULL AND v_token <> 'null'::jsonb THEN
      IF (v_token->>'until') IS NOT NULL
         AND (v_token->>'until')::timestamptz > now()
         AND coalesce((v_token->>'max_eur')::numeric, 0) >= v_estimate_eur THEN
        v_token_ok := true;
      END IF;
    END IF;

    IF NOT v_token_ok AND NOT p_force_ok THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'spend_cap_run',
        'spent_month_usd', round(v_spent_usd, 2), 'spent_month_eur', round(v_spent_eur, 2),
        'cap_run_eur', v_cap_run_eur, 'cap_month_eur', v_cap_month,
        'estimate_usd', round(p_estimate_usd, 4), 'estimate_eur', round(v_estimate_eur, 4),
        'usd_per_eur', v_usd_per_eur, 'need_ok', true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'reason', null,
    'spent_month_usd', round(v_spent_usd, 2), 'spent_month_eur', round(v_spent_eur, 2),
    'cap_run_eur', v_cap_run_eur, 'cap_month_eur', v_cap_month,
    'estimate_usd', round(p_estimate_usd, 4), 'estimate_eur', round(v_estimate_eur, 4),
    'usd_per_eur', v_usd_per_eur, 'need_ok', false,
    'spend_ok_applied', v_token_ok);
END $function$;

COMMENT ON FUNCTION public.rag_eval_spend_gate(numeric, boolean) IS 'Spend gate voor eval-runs. Controleert per-run cap (€2,50) en maandcap (€25). Token spend_ok_token in agent_config kan de per-run cap overschrijden. Maandcap is hard. Retourneert {ok, reason, spent_month_*, estimate_*, need_ok}.';

REVOKE ALL ON FUNCTION public.rag_eval_spend_gate(numeric, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rag_eval_spend_gate(numeric, boolean) TO service_role;

-- ── 5. Update rag_eval_start_run — spend gate + dynamic judge_model ─────────
CREATE OR REPLACE FUNCTION public.rag_eval_start_run(p_label text, p_suite text DEFAULT 'custom', p_params jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_run   uuid;
  v_busy  uuid;
  v_n     int;
  v_ids   text[];
  v_cmp   uuid;
  v_estimate_usd numeric;
  v_estimate_eur numeric;
  v_gate  jsonb;
  v_rates jsonb;
  v_usd_per_eur numeric;
  v_judge_model text;
  v_n_chat int;
  v_n_retrieval int;
BEGIN
  IF p_suite IS NULL OR p_suite NOT IN ('legacy71', 'rook-p0', 'chat-lane', 'full', 'acl', 'custom') THEN
    RAISE EXCEPTION 'rag_eval_start_run: unknown suite %', p_suite;
  END IF;

  SELECT id INTO v_busy FROM rag_eval_runs
   WHERE status = 'running' AND coalesce(last_activity_at, started_at, created_at) > now() - interval '10 minutes'
   ORDER BY created_at DESC LIMIT 1;
  IF v_busy IS NOT NULL AND coalesce((p_params->>'force')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'rag_eval_run_already_running: %', v_busy;
  END IF;

  IF p_params ? 'compare_to' AND length(p_params->>'compare_to') > 0 THEN
    IF (p_params->>'compare_to') ~ '^[0-9a-f-]{36}$' THEN
      v_cmp := (p_params->>'compare_to')::uuid;
    ELSE
      SELECT id INTO v_cmp FROM rag_eval_runs WHERE label = p_params->>'compare_to' AND status = 'done' ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  IF p_params ? 'ids' THEN
    SELECT array_agg(x) INTO v_ids FROM jsonb_array_elements_text(p_params->'ids') x;
  END IF;

  -- Judge model uit params of agent_config (niet hardcoded)
  v_judge_model := coalesce(
    p_params->>'judge_model',
    (SELECT config_value #>> '{}' FROM agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'judge_model'),
    'gpt-5-nano'
  );

  -- Preflight: tel items per lane
  SELECT
    count(*) FILTER (WHERE q.lane = 'chat'),
    count(*) FILTER (WHERE q.lane = 'retrieval')
    INTO v_n_chat, v_n_retrieval
    FROM rag_eval_questions q
   WHERE q.is_active
     AND CASE p_suite
           WHEN 'legacy71'  THEN NOT rag_eval_is_bank_id(q.id)
           WHEN 'rook-p0'   THEN rag_eval_is_bank_id(q.id) AND 'p0' = ANY (q.tags)
           WHEN 'chat-lane' THEN rag_eval_is_bank_id(q.id) AND q.lane = 'chat'
           WHEN 'acl'       THEN ('acl' = ANY (q.tags) OR q.category = 'wiki-acl')
           ELSE true
         END
     AND (v_ids IS NULL OR q.id = ANY (v_ids))
     AND (NOT (p_params ? 'only_tag') OR (p_params->>'only_tag') = ANY (q.tags))
     AND (NOT (p_params ? 'lane')     OR q.lane = p_params->>'lane')
     AND (NOT (p_params ? 'category') OR q.category = p_params->>'category')
     AND (NOT (p_params ? 'persona')  OR q.persona = p_params->>'persona');

  -- Kostenschatting uit agent_config rates
  SELECT coalesce(config_value, '{"chat":0.025,"retrieval":0.002,"judge":0.00005}'::jsonb)
    INTO v_rates
    FROM agent_config WHERE agent_name = 'rag-eval-cron' AND config_key = 'cost_per_item_usd';
  IF v_rates IS NULL THEN v_rates := '{"chat":0.025,"retrieval":0.002,"judge":0.00005}'::jsonb; END IF;

  v_estimate_usd :=
      v_n_chat * coalesce((v_rates->>'chat')::numeric, 0.025)
    + v_n_retrieval * coalesce((v_rates->>'retrieval')::numeric, 0.002)
    + (v_n_chat + v_n_retrieval) * coalesce((v_rates->>'judge')::numeric, 0.00005);

  SELECT waarde INTO v_usd_per_eur
    FROM public.dash_parameters WHERE sleutel = 'model_budget_usd_per_eur';
  IF v_usd_per_eur IS NULL OR v_usd_per_eur <= 0 THEN v_usd_per_eur := 1.0; END IF;
  v_estimate_eur := v_estimate_usd / v_usd_per_eur;

  -- Spend gate
  v_gate := rag_eval_spend_gate(v_estimate_usd);
  IF (v_gate->>'ok')::boolean IS NOT TRUE THEN
    INSERT INTO rag_eval_runs (label, suite, params, status, started_at, finished_at, last_activity_at,
                               context_build_version, judge_model, answer_model, n_questions, notes, runner_version,
                               preflight_estimate_usd, preflight_estimate_eur, abort_reason,
                               spend_ok_applied)
    VALUES (p_label, p_suite, coalesce(p_params, '{}'::jsonb), 'aborted_spend', now(), now(), now(),
            'live', v_judge_model, 'live', coalesce(v_n_chat + v_n_retrieval, 0),
            format('spend gate: %s (est €%s, cap €%s, month €%s/%s)',
                   v_gate->>'reason', round(v_estimate_eur, 2),
                   v_gate->>'cap_run_eur', v_gate->>'spent_month_eur', v_gate->>'cap_month_eur'),
            coalesce(p_params->>'runner_version', 'v3.0'),
            v_estimate_usd, v_estimate_eur, v_gate->>'reason', false)
    RETURNING id INTO v_run;
    RAISE EXCEPTION 'rag_eval_spend_cap_%: run=% est_eur=% reason=%',
      v_gate->>'reason', v_run, round(v_estimate_eur, 2), v_gate->>'reason';
  END IF;

  INSERT INTO rag_eval_runs (label, suite, params, status, started_at, last_activity_at, compare_to,
                             context_build_version, judge_model, answer_model, n_questions, notes, runner_version,
                             preflight_estimate_usd, preflight_estimate_eur,
                             spend_ok_applied)
  VALUES (p_label, p_suite, coalesce(p_params, '{}'::jsonb), 'running', now(), now(), v_cmp,
          'live', v_judge_model, 'live', 0, 'v3.0 running', coalesce(p_params->>'runner_version', 'v3.0'),
          v_estimate_usd, v_estimate_eur,
          coalesce((v_gate->>'spend_ok_applied')::boolean, false))
  RETURNING id INTO v_run;

  INSERT INTO rag_eval_run_items (run_id, question_id)
  SELECT v_run, q.id
    FROM rag_eval_questions q
   WHERE q.is_active
     AND CASE p_suite
           WHEN 'legacy71'  THEN NOT rag_eval_is_bank_id(q.id)
           WHEN 'rook-p0'   THEN rag_eval_is_bank_id(q.id) AND 'p0' = ANY (q.tags)
           WHEN 'chat-lane' THEN rag_eval_is_bank_id(q.id) AND q.lane = 'chat'
           WHEN 'acl'       THEN ('acl' = ANY (q.tags) OR q.category = 'wiki-acl')
           ELSE true
         END
     AND (v_ids IS NULL OR q.id = ANY (v_ids))
     AND (NOT (p_params ? 'only_tag') OR (p_params->>'only_tag') = ANY (q.tags))
     AND (NOT (p_params ? 'lane')     OR q.lane = p_params->>'lane')
     AND (NOT (p_params ? 'category') OR q.category = p_params->>'category')
     AND (NOT (p_params ? 'persona')  OR q.persona = p_params->>'persona');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE rag_eval_runs SET n_questions = v_n WHERE id = v_run;
  IF v_n = 0 THEN
    UPDATE rag_eval_runs SET status = 'failed', finished_at = now(), notes = 'v3.0: selectie leeg' WHERE id = v_run;
  END IF;
  RETURN v_run;
END $function$;

COMMENT ON FUNCTION public.rag_eval_start_run(text, text, jsonb) IS 'Spoor 01 — maakt een run en materialiseert de itemselectie in rag_eval_run_items. Spend gate: schat kosten, controleert €2,50/run + €25/maand; boven cap → status aborted_spend + exception. judge_model uit params of agent_config (niet hardcoded). Suites: legacy71 | rook-p0 | chat-lane | full | acl | custom.';

-- ── 6. Update rag_eval_finish_if_done — judge_cost_usd ──────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_finish_if_done(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_remaining int;
  v_run rag_eval_runs%ROWTYPE;
  v_n int; v_hit int; v_asserted int; v_pending int; v_cost numeric; v_p50 int; v_p95 int;
  v_f numeric; v_r numeric; v_p numeric; v_ac numeric; v_scored int;
  v_judge_cost numeric;
BEGIN
  SELECT * INTO v_run FROM rag_eval_runs WHERE id = p_run_id;
  IF v_run.id IS NULL THEN RETURN false; END IF;

  UPDATE rag_eval_run_items ri SET state = 'done'
   WHERE ri.run_id = p_run_id AND ri.state <> 'done'
     AND EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id);

  INSERT INTO rag_eval_results (run_id, question_id, question, dimension, intent, lane, category, persona, signal_hit, assert_detail, hop, attempt, judge_notes)
  SELECT p_run_id, q.id, left(q.question, 2000), q.dimension, q.intent, q.lane, q.category, q.persona, false,
         format('FAIL hop_lost(attempts=%s)', ri.attempt), ri.hop, ri.attempt, 'v3.0: item na 3 verloren hops opgegeven'
    FROM rag_eval_run_items ri JOIN rag_eval_questions q ON q.id = ri.question_id
   WHERE ri.run_id = p_run_id AND ri.state = 'claimed' AND ri.attempt >= 3 AND ri.claimed_at < now() - interval '8 minutes'
     AND NOT EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id);
  UPDATE rag_eval_run_items ri SET state = 'done'
   WHERE ri.run_id = p_run_id AND ri.state <> 'done'
     AND EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id);

  SELECT count(*) INTO v_remaining FROM rag_eval_run_items WHERE run_id = p_run_id AND state <> 'done';
  UPDATE rag_eval_runs SET last_activity_at = now() WHERE id = p_run_id;
  IF v_remaining > 0 THEN RETURN false; END IF;
  IF v_run.status IN ('done', 'failed', 'invalid_persona', 'aborted_spend') THEN RETURN true; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE signal_hit IS TRUE),
         count(*) FILTER (WHERE signal_hit IS NOT NULL),
         count(*) FILTER (WHERE rag_eval_item_state(signal_hit, pending_asserts) = 'pending'),
         round(sum(cost_usd)::numeric, 4),
         percentile_disc(0.5)  WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE lane = 'chat'),
         percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE lane = 'chat'),
         avg(faithfulness) FILTER (WHERE faithfulness IS NOT NULL AND answer_relevance IS NOT NULL AND context_precision IS NOT NULL),
         avg(answer_relevance) FILTER (WHERE faithfulness IS NOT NULL AND answer_relevance IS NOT NULL AND context_precision IS NOT NULL),
         avg(context_precision) FILTER (WHERE faithfulness IS NOT NULL AND answer_relevance IS NOT NULL AND context_precision IS NOT NULL),
         avg(answer_correctness),
         count(*) FILTER (WHERE faithfulness IS NOT NULL AND answer_relevance IS NOT NULL AND context_precision IS NOT NULL)
    INTO v_n, v_hit, v_asserted, v_pending, v_cost, v_p50, v_p95, v_f, v_r, v_p, v_ac, v_scored
    FROM rag_eval_results WHERE run_id = p_run_id;

  -- Judge cost: sum over envelope_compact.judge_usage tokens × PRICE_PER_M
  -- gpt-5-nano: $0.05/M in, $0.40/M out; gpt-5.6-luna: $0.20/M in, $1.20/M out
  SELECT round(sum(
    CASE (envelope_compact->'judge_usage'->>'model')
      WHEN 'gpt-5-nano'   THEN coalesce((envelope_compact->'judge_usage'->>'in')::numeric, 0) * 0.05 / 1e6
                                + coalesce((envelope_compact->'judge_usage'->>'out')::numeric, 0) * 0.40 / 1e6
      WHEN 'gpt-5.6-luna' THEN coalesce((envelope_compact->'judge_usage'->>'in')::numeric, 0) * 0.20 / 1e6
                                + coalesce((envelope_compact->'judge_usage'->>'out')::numeric, 0) * 1.20 / 1e6
      ELSE coalesce((envelope_compact->'judge_usage'->>'in')::numeric, 0) * 0.20 / 1e6
           + coalesce((envelope_compact->'judge_usage'->>'out')::numeric, 0) * 1.20 / 1e6
    END
  )::numeric, 6) INTO v_judge_cost
  FROM rag_eval_results
  WHERE run_id = p_run_id AND envelope_compact ? 'judge_usage' AND envelope_compact->'judge_usage' IS NOT NULL;

  UPDATE rag_eval_runs
     SET status = 'done', finished_at = now(), last_activity_at = now(),
         n_questions = v_n, n_asserted = v_asserted, n_pending = v_pending,
         signal_pass_rate = CASE WHEN v_asserted > 0 THEN round(v_hit::numeric / v_asserted, 3) END,
         avg_faithfulness = round(v_f, 3), avg_answer_relevance = round(v_r, 3), avg_context_precision = round(v_p, 3),
         avg_answer_correctness = round(v_ac, 3),
         cost_usd_total = coalesce(v_cost, 0) + coalesce(v_judge_cost, 0),
         judge_cost_usd = v_judge_cost,
         p50_latency_ms = v_p50, p95_latency_ms = v_p95,
         notes = format('v3.0 done, %s/%s judged, %s/%s asserts pass, %s pending, judge $%s', v_scored, v_n, v_hit, v_asserted, v_pending, coalesce(round(v_judge_cost, 4), 0))
   WHERE id = p_run_id;

  BEGIN
    UPDATE rag_eval_runs SET gates = rag_eval_compare(p_run_id, compare_to) WHERE id = p_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE rag_eval_runs SET gates = jsonb_build_object('error', SQLERRM) WHERE id = p_run_id;
  END;
  RETURN true;
END $function$;

COMMENT ON FUNCTION public.rag_eval_finish_if_done(uuid) IS 'Spoor 01 — markeert items met een resultaatrij done, geeft na 3 verloren hops een expliciete FAIL hop_lost, en rondt de run af zodra niets meer open staat: aggregaten, cost_usd_total (incl. judge_cost_usd), p50/p95 (chat-lane), status done, gates = rag_eval_compare(run, compare_to). Retourneert true als de run af is.';

-- ── 7. Update v_agent_eval_runs — toon spend-kolommen ───────────────────────
-- CREATE OR REPLACE VIEW kan kolommen niet herordenen/hernoemen → drop eerst.
DROP VIEW IF EXISTS public.v_agent_eval_runs;

CREATE OR REPLACE VIEW public.v_agent_eval_runs
WITH (security_invoker = on) AS
SELECT r.id,
       r.label,
       r.suite,
       r.status,
       r.runner_version,
       r.created_at,
       r.started_at,
       r.finished_at,
       extract(epoch FROM (r.finished_at - r.started_at))::int                    AS duration_s,
       r.n_questions,
       s.n_results,
       s.pass,
       s.fail,
       s.pending,
       r.signal_pass_rate,
       r.avg_answer_correctness,
       r.cost_usd_total,
       r.judge_cost_usd,
       r.preflight_estimate_usd,
       r.preflight_estimate_eur,
       r.spend_ok_applied,
       r.abort_reason,
       r.p50_latency_ms,
       r.p95_latency_ms,
       (r.persona_check->>'ok')::boolean                                          AS persona_ok,
       r.gates->'G1'->>'status'                                                   AS g1,
       r.gates->'G4'->>'status'                                                   AS g4,
       s.n_identity_unreliable,
       r.compare_to
  FROM public.rag_eval_runs r
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n_results,
           count(*) FILTER (WHERE public.rag_eval_item_state(x.signal_hit, x.pending_asserts) = 'pass')::int    AS pass,
           count(*) FILTER (WHERE public.rag_eval_item_state(x.signal_hit, x.pending_asserts) = 'fail')::int    AS fail,
           count(*) FILTER (WHERE public.rag_eval_item_state(x.signal_hit, x.pending_asserts) = 'pending')::int AS pending,
           count(*) FILTER (WHERE coalesce(x.lane, q.lane) = 'chat' AND coalesce(x.persona, q.persona) <> 'cron' AND x.caller_identified IS FALSE)::int AS n_identity_unreliable
      FROM public.rag_eval_results x
      LEFT JOIN public.rag_eval_questions q ON q.id = x.question_id
     WHERE x.run_id = r.id
  ) s ON true
 ORDER BY r.created_at DESC;

COMMENT ON VIEW public.v_agent_eval_runs IS 'Spoor 01 — runs met status, suite, tellingen, kosten (incl. judge + preflight), spend gate, latency, persona-check en de blokkerende poorten G1/G4 uit gates.';

-- ── 8. Rechten ──────────────────────────────────────────────────────────────
-- start_run en finish_if_done are already granted to service_role from the original migration.
-- spend_gate is granted above.

-- ── 9. Registreren ──────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260915200000', 'eval_cheap_models_spend_cap')
ON CONFLICT (version) DO NOTHING;
