-- =============================================================================
-- Spoor 01 — evalverkeer uit de gezondheidsmeting                     (v1.147)
-- =============================================================================
-- Gemeten (RESEARCH.md M7): 86 van de 88 chatvragen van de laatste 30 dagen waren
-- testverkeer (stream=false). Een rookronde schrijft 36 rijen in rag_chat_query_log,
-- een volledige ronde 352 — en de `negatief`-items produceren opzettelijk lege
-- antwoorden. Zonder label meten v_agent_chat_health, v_agent_chat_by_route,
-- v_agent_chat_coverage en agent_chat_health_check() dus de evalronde in plaats
-- van de gebruiker, en het leeg-alarm (> 25 %) vuurt op de bank.
--
-- rag-chat v5.7 zet body.eval_run_id (alleen een uuid) in
-- rag_chat_query_log.meta.eval_run_id. Deze migratie voegt aan de vier lezers
-- `AND NOT (meta ? 'eval_run_id')` toe. Verder byte-gelijk aan 20260905182000.
-- Terugval zonder rag-chat te raken zou `stream = false` zijn (DECISIONS D01-5);
-- niet gekozen: een echte gebruiker met stream:false zou dan óók verdwijnen.
-- =============================================================================

-- ── 1. Dagcijfers ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_chat_health AS
SELECT
  date_trunc('day', asked_at)::date                                            AS dag,
  count(*)                                                                     AS vragen,
  count(*) FILTER (WHERE meta ? 'answer_empty')                                AS gemeten,
  count(*) FILTER (WHERE (meta->>'answer_empty')::boolean)                     AS leeg,
  round(100.0 * count(*) FILTER (WHERE (meta->>'answer_empty')::boolean)
        / nullif(count(*) FILTER (WHERE meta ? 'answer_empty'), 0), 1)         AS leeg_pct,
  count(*) FILTER (WHERE (meta->>'answer_empty')::boolean
                     AND coalesce(meta->>'coverage_reason', 'not_tracked') = 'not_tracked')
                                                                               AS leeg_zonder_reden,
  count(*) FILTER (WHERE (meta->>'vector_timed_out')::boolean)                 AS retrieval_timeouts,
  count(*) FILTER (WHERE (meta->>'retrieval_retry')::boolean)                  AS retries,
  count(*) FILTER (WHERE (meta->>'retry_gained')::int > 0)                     AS retries_geslaagd,
  round(sum(est_cost_usd)::numeric, 4)                                         AS kosten_usd,
  round(avg(est_cost_usd)::numeric, 5)                                         AS kosten_per_vraag,
  count(*) FILTER (WHERE est_cost_usd IS NULL)                                 AS zonder_kostenregel,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)                      AS p50_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)                     AS p95_ms,
  count(*) FILTER (WHERE error IS NOT NULL)                                    AS fouten
FROM public.rag_chat_query_log
WHERE NOT (meta ? 'eval_run_id')
GROUP BY 1
ORDER BY 1 DESC;

COMMENT ON VIEW public.v_agent_chat_health IS
  'WP3 — dagcijfers van de chat: hoeveel antwoorden stonden op geen enkele bron, hoeveel daarvan zonder reden (dat hoort 0 te zijn), wat kostte het en hoe lang duurde het. `gemeten` < `vragen` betekent dat er rijen van vóór rag-chat v5.6 in zitten, die dragen answer_empty niet. Sinds v1.147 zonder evalverkeer (meta.eval_run_id).';

-- ── 2. Per route, laatste 30 dagen ───────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_chat_by_route AS
SELECT
  route,
  count(*)                                                                     AS vragen,
  count(*) FILTER (WHERE (meta->>'answer_empty')::boolean)                     AS leeg,
  round(100.0 * count(*) FILTER (WHERE (meta->>'answer_empty')::boolean)
        / nullif(count(*) FILTER (WHERE meta ? 'answer_empty'), 0), 1)         AS leeg_pct,
  meta->>'context_build_intent'                                                AS recept,
  round(avg((meta->>'vector_fetch_ms')::int))                                  AS retrieval_ms_gem,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY (meta->>'vector_fetch_ms')::int) AS retrieval_ms_p95,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)                      AS p50_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)                     AS p95_ms,
  round(avg(est_cost_usd)::numeric, 5)                                         AS kosten_per_vraag,
  round(sum(est_cost_usd)::numeric, 4)                                         AS kosten_usd,
  sum((meta->'usage'->>'openai_embed_tokens')::int)                            AS embed_tokens,
  sum((meta->'usage'->>'cohere_searches')::int)                                AS cohere_calls,
  sum((meta->'usage'->>'grok_in')::int)                                        AS grok_in_tokens,
  sum((meta->'usage'->>'grok_out')::int)                                       AS grok_out_tokens
FROM public.rag_chat_query_log
WHERE asked_at > now() - interval '30 days'
  AND NOT (meta ? 'eval_run_id')
GROUP BY route, meta->>'context_build_intent'
ORDER BY vragen DESC;

COMMENT ON VIEW public.v_agent_chat_by_route IS
  'WP3 — kosten en latency per route én per retrieval-recept over 30 dagen, met de tokens per leverancier eronder. Tarieven zijn beleid en kunnen veranderen; de tokens zijn het feit, dus kosten zijn hiermee altijd herrekenbaar. Sinds v1.147 zonder evalverkeer.';

-- ── 3. Waarom was het leeg ───────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_chat_coverage AS
SELECT
  coalesce(meta->>'coverage_reason', '(geen reden vastgelegd)')                AS reden,
  count(*)                                                                     AS runs,
  count(*) FILTER (WHERE (meta->>'answer_empty')::boolean)                     AS waarvan_leeg,
  min(asked_at)                                                                AS eerst,
  max(asked_at)                                                                AS laatst
FROM public.rag_chat_query_log
WHERE asked_at > now() - interval '30 days'
  AND NOT (meta ? 'eval_run_id')
  AND (meta ? 'coverage_reason' OR (meta->>'answer_empty')::boolean)
GROUP BY 1
ORDER BY runs DESC;

COMMENT ON VIEW public.v_agent_chat_coverage IS
  'WP3/WP2 — verdeling van coverage.reason over 30 dagen. timeout = de klok, truly_empty = de index, below_threshold = de drempel, acl_filtered = de rechten. Vier heel verschillende problemen die vóór v5.6 allemaal "0 fragmenten" heetten. Sinds v1.147 zonder evalverkeer.';

-- ── 4. Het alarm ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agent_chat_health_check()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n            int;
  v_measured     int;
  v_empty        int;
  v_silent       int;
  v_pct          numeric;
  v_finding      uuid;
  v_reasons      jsonb;
BEGIN
  PERFORM public.assert_can_manage_dashboard();

  SELECT count(*),
         count(*) FILTER (WHERE meta ? 'answer_empty'),
         count(*) FILTER (WHERE (meta->>'answer_empty')::boolean),
         count(*) FILTER (WHERE (meta->>'answer_empty')::boolean
                            AND coalesce(meta->>'coverage_reason','not_tracked') = 'not_tracked')
    INTO v_n, v_measured, v_empty, v_silent
    FROM rag_chat_query_log
   WHERE asked_at > now() - interval '24 hours'
     AND NOT (meta ? 'eval_run_id');

  v_pct := round(100.0 * v_empty / nullif(v_measured, 0), 1);

  SELECT jsonb_object_agg(coalesce(meta->>'coverage_reason','(geen)'), n)
    INTO v_reasons
    FROM (SELECT meta->>'coverage_reason' AS m, count(*) n, meta
            FROM rag_chat_query_log
           WHERE asked_at > now() - interval '24 hours' AND meta ? 'coverage_reason'
             AND NOT (meta ? 'eval_run_id')
           GROUP BY meta->>'coverage_reason', meta) s;

  -- (a) stille leegte — altijd melden, ongeacht volume.
  IF v_silent > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM security_findings
                    WHERE affected_object='rag-chat' AND scan_type='agent_chat_guard'
                      AND category='silent_empty' AND status='open'
                      AND found_at > now() - interval '12 hours') THEN
      INSERT INTO security_findings (scan_type, severity, category, title, detail, affected_object, status)
      VALUES ('agent_chat_guard', 'high', 'silent_empty',
        format('%s chat-antwoord(en) zonder bron én zonder reden', v_silent),
        format('In de laatste 24 uur gaven %s van de %s gemeten runs een antwoord zonder enige bron, waarbij coverage_reason ontbrak of not_tracked was. Sinds rag-chat v5.6 hoort elke lege uitkomst een reden te dragen (timeout|acl_filtered|below_threshold|truly_empty). Ontbreekt hij, dan is de keten context-build -> rag-chat -> log ergens gebroken. Kijk in v_agent_chat_coverage en in meta.vector_error.', v_silent, v_measured),
        'rag-chat', 'open')
      RETURNING id INTO v_finding;
    END IF;
  END IF;

  -- (b) het percentage loopt op.
  IF v_measured >= 8 AND v_pct > 25.0 THEN
    IF NOT EXISTS (SELECT 1 FROM security_findings
                    WHERE affected_object='rag-chat' AND scan_type='agent_chat_guard'
                      AND category='empty_answer_ratio' AND status='open'
                      AND found_at > now() - interval '12 hours') THEN
      INSERT INTO security_findings (scan_type, severity, category, title, detail, affected_object, status)
      VALUES ('agent_chat_guard', 'medium', 'empty_answer_ratio',
        format('Chat geeft %s%% antwoorden zonder bron (24 u)', v_pct),
        format('%s van de %s gemeten runs stond op geen enkele bron. Nulmeting 2026-09-05: 11,8%%; drempel 25%%. Verdeling van de redenen: %s. Bij vooral "timeout": kijk naar het recept (context_intents.search_fast) en naar v_agent_chat_by_route.retrieval_ms_p95.',
               v_empty, v_measured, coalesce(v_reasons::text, '{}')),
        'rag-chat', 'open')
      RETURNING id INTO v_finding;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'runs_24h', v_n, 'measured', v_measured, 'empty', v_empty,
    'empty_pct', v_pct, 'silent_empty', v_silent,
    'reasons', coalesce(v_reasons, '{}'::jsonb), 'finding_created', v_finding);
END $function$;

COMMENT ON FUNCTION public.agent_chat_health_check() IS
  'WP3 — alarm op de chat. Meldt in security_findings (a) elk leeg antwoord zonder reden (high, G1-schending) en (b) een lege-antwoordratio boven 25%% over minimaal 8 runs (medium). Dedup: 12 uur per categorie. Sinds v1.147 zonder evalverkeer (meta.eval_run_id).';

REVOKE ALL ON FUNCTION public.agent_chat_health_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_chat_health_check() TO authenticated, service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906130000', 'agent_chat_health_exclude_eval')
ON CONFLICT (version) DO NOTHING;
