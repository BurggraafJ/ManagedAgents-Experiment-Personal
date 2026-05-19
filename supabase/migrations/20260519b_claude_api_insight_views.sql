-- =============================================================================
-- 20260519b_claude_api_insight_views.sql
-- =============================================================================
-- F.12 — Aanvullende views voor diepere inzichten in claude_api_calls.
-- Zie Confluence: Project — Claude-call Observability (450101261) v9.
--
-- Idempotent — alle views met CREATE OR REPLACE.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cost per dag (30d) — voor trend-sparkline
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_cost_by_day_30d AS
WITH days AS (
  SELECT generate_series(
    (now() AT TIME ZONE 'Europe/Amsterdam')::date - interval '29 days',
    (now() AT TIME ZONE 'Europe/Amsterdam')::date,
    '1 day'::interval
  )::date AS day
)
SELECT
  d.day,
  COALESCE(COUNT(c.id), 0)                                        AS calls,
  COALESCE(SUM(c.input_tokens), 0)                                AS input_tokens,
  COALESCE(SUM(c.cache_read_input_tokens), 0)                     AS cache_read_tokens,
  COALESCE(SUM(c.cache_creation_input_tokens), 0)                 AS cache_creation_tokens,
  COALESCE(SUM(c.output_tokens), 0)                               AS output_tokens,
  COALESCE(ROUND(SUM(c.cost_usd)::numeric, 4), 0)                 AS cost_usd
FROM days d
LEFT JOIN public.claude_api_calls c
  ON (c.created_at AT TIME ZONE 'Europe/Amsterdam')::date = d.day
GROUP BY d.day
ORDER BY d.day;

COMMENT ON VIEW public.claude_api_cost_by_day_30d IS
  'Cost + tokens per dag laatste 30 dagen (NL-tijdzone). Dagen zonder calls = 0-rij. Bron voor sparkline.';

-- -----------------------------------------------------------------------------
-- 2. Cost per uur-van-dag (laatste 24u) — voor timing-patroon
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_cost_by_hour_24h AS
WITH hours AS (
  SELECT generate_series(
    date_trunc('hour', now() AT TIME ZONE 'Europe/Amsterdam') - interval '23 hours',
    date_trunc('hour', now() AT TIME ZONE 'Europe/Amsterdam'),
    '1 hour'::interval
  ) AS hr
)
SELECT
  h.hr,
  COALESCE(COUNT(c.id), 0)                                        AS calls,
  COALESCE(ROUND(SUM(c.cost_usd)::numeric, 4), 0)                 AS cost_usd
FROM hours h
LEFT JOIN public.claude_api_calls c
  ON date_trunc('hour', c.created_at AT TIME ZONE 'Europe/Amsterdam') = h.hr
GROUP BY h.hr
ORDER BY h.hr;

COMMENT ON VIEW public.claude_api_cost_by_hour_24h IS
  'Cost + calls per uur laatste 24u (NL-tijdzone). Voor wanneer-zijn-pieken patroon.';

-- -----------------------------------------------------------------------------
-- 3. Top duurste prompt-patterns (7d) — herhalende prompts vinden
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_top_prompts_7d AS
SELECT
  prompt_hash,
  COALESCE(skill_name, source_edge_function, 'unknown')           AS attribution,
  COUNT(*)                                                         AS n_calls,
  ROUND(SUM(cost_usd)::numeric, 4)                                AS cost_usd_7d,
  ROUND(AVG(cost_usd)::numeric, 6)                                AS avg_cost_per_call,
  SUM(input_tokens + cache_read_input_tokens + cache_creation_input_tokens)
                                                                  AS total_input_tokens,
  SUM(output_tokens)                                              AS total_output_tokens,
  MIN(created_at)                                                 AS first_seen,
  MAX(created_at)                                                 AS last_seen,
  (ARRAY_AGG(prompt_preview ORDER BY created_at DESC))[1]         AS sample_prompt_preview
FROM public.claude_api_calls
WHERE created_at >= now() - interval '7 days'
  AND prompt_hash IS NOT NULL
GROUP BY prompt_hash, attribution
HAVING COUNT(*) >= 2  -- alleen patronen die >1x voorkomen zijn interessant
ORDER BY cost_usd_7d DESC NULLS LAST
LIMIT 50;

COMMENT ON VIEW public.claude_api_top_prompts_7d IS
  'Top 50 duurste prompt-patterns (>= 2 herhalingen, laatste 7d). Vindt prompts die het meest geld kosten — kandidaten voor caching of prompt-engineering.';

-- -----------------------------------------------------------------------------
-- 4. Top duurste runs (7d) — join met agent_runs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_top_runs_7d AS
SELECT
  c.run_id,
  a.agent_name,
  a.status                                                        AS run_status,
  a.summary                                                       AS run_summary,
  COUNT(c.id)                                                     AS n_calls,
  ROUND(SUM(c.cost_usd)::numeric, 4)                              AS cost_usd,
  SUM(c.input_tokens + c.cache_read_input_tokens + c.cache_creation_input_tokens) AS input_tokens,
  SUM(c.output_tokens)                                            AS output_tokens,
  COUNT(DISTINCT c.model)                                         AS models_used,
  MIN(c.created_at)                                               AS first_call,
  MAX(c.created_at)                                               AS last_call,
  a.started_at,
  a.completed_at
FROM public.claude_api_calls c
LEFT JOIN public.agent_runs a ON a.id = c.run_id
WHERE c.created_at >= now() - interval '7 days'
  AND c.run_id IS NOT NULL
GROUP BY c.run_id, a.agent_name, a.status, a.summary, a.started_at, a.completed_at
ORDER BY cost_usd DESC NULLS LAST
LIMIT 25;

COMMENT ON VIEW public.claude_api_top_runs_7d IS
  'Top 25 duurste runs (laatste 7d) met agent_runs context. Klik door naar specifieke run voor context.';

-- -----------------------------------------------------------------------------
-- 5. Burn-rate / projectie naar einde maand
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_burn_rate AS
WITH today_local AS (
  SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date AS today_dt
),
month_start AS (
  SELECT date_trunc('month', t.today_dt::timestamp)::date AS mtd_start FROM today_local t
),
month_end AS (
  SELECT (date_trunc('month', t.today_dt::timestamp) + interval '1 month - 1 day')::date AS mtd_end FROM today_local t
),
mtd AS (
  SELECT
    COALESCE(SUM(c.cost_usd), 0)::numeric            AS cost_mtd,
    COALESCE(COUNT(c.id), 0)                          AS calls_mtd
  FROM public.claude_api_calls c, today_local t, month_start m
  WHERE (c.created_at AT TIME ZONE 'Europe/Amsterdam')::date >= m.mtd_start
    AND (c.created_at AT TIME ZONE 'Europe/Amsterdam')::date <= t.today_dt
),
last_7d AS (
  SELECT
    COALESCE(SUM(c.cost_usd), 0)::numeric / 7.0      AS daily_avg_7d
  FROM public.claude_api_calls c
  WHERE c.created_at >= now() - interval '7 days'
),
last_24h AS (
  SELECT
    COALESCE(SUM(c.cost_usd), 0)::numeric            AS cost_24h,
    COALESCE(COUNT(c.id), 0)                          AS calls_24h
  FROM public.claude_api_calls c
  WHERE c.created_at >= now() - interval '24 hours'
)
SELECT
  m.mtd_start,
  e.mtd_end,
  t.today_dt,
  (t.today_dt - m.mtd_start + 1)                          AS days_elapsed,
  (e.mtd_end - m.mtd_start + 1)                           AS days_total_month,
  ROUND(mtd.cost_mtd, 4)                                  AS cost_mtd,
  mtd.calls_mtd,
  ROUND(last_7d.daily_avg_7d, 4)                          AS daily_avg_last_7d,
  ROUND((last_7d.daily_avg_7d * (e.mtd_end - m.mtd_start + 1))::numeric, 4)
                                                          AS projected_month_total,
  ROUND(last_24h.cost_24h, 4)                             AS cost_24h,
  last_24h.calls_24h
FROM today_local t, month_start m, month_end e, mtd, last_7d, last_24h;

COMMENT ON VIEW public.claude_api_burn_rate IS
  'Burn-rate dashboard: MTD spend + projection naar einde maand (op basis van 7d daily avg) + laatste 24u snapshot.';

-- -----------------------------------------------------------------------------
-- 6. Cohort vergelijking: vandaag vs gisteren vs vorige-zelfde-dag
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_cohort_compare AS
WITH d_today AS (
  SELECT (now() AT TIME ZONE 'Europe/Amsterdam')::date AS d
),
buckets AS (
  SELECT 'today'::text AS bucket, d_today.d AS d FROM d_today
  UNION ALL
  SELECT 'yesterday',                d_today.d - 1                  FROM d_today
  UNION ALL
  SELECT 'week_ago_same_weekday',    d_today.d - 7                  FROM d_today
)
SELECT
  b.bucket,
  b.d                                                          AS as_of_date,
  COALESCE(COUNT(c.id), 0)                                     AS calls,
  ROUND(COALESCE(SUM(c.cost_usd), 0)::numeric, 4)              AS cost_usd,
  COALESCE(SUM(c.output_tokens), 0)                            AS output_tokens
FROM buckets b
LEFT JOIN public.claude_api_calls c
  ON (c.created_at AT TIME ZONE 'Europe/Amsterdam')::date = b.d
GROUP BY b.bucket, b.d
ORDER BY CASE b.bucket WHEN 'today' THEN 1 WHEN 'yesterday' THEN 2 ELSE 3 END;

COMMENT ON VIEW public.claude_api_cohort_compare IS
  'Vandaag vs gisteren vs zelfde dag vorige week — voor delta-detectie.';

-- -----------------------------------------------------------------------------
-- 7. Cache-efficiency per skill/edge-function (7d)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_cache_efficiency_7d AS
SELECT
  COALESCE(skill_name, source_edge_function, 'unknown')         AS attribution,
  source,
  COUNT(*)                                                       AS calls,
  SUM(input_tokens)                                              AS fresh_input,
  SUM(cache_read_input_tokens)                                   AS cache_read,
  SUM(cache_creation_input_tokens)                               AS cache_create,
  CASE
    WHEN SUM(input_tokens + cache_read_input_tokens) > 0
      THEN ROUND(
        (SUM(cache_read_input_tokens)::numeric / SUM(input_tokens + cache_read_input_tokens)::numeric) * 100,
        2)
    ELSE 0
  END                                                            AS cache_hit_pct,
  ROUND(SUM(cost_usd)::numeric, 4)                               AS cost_usd_7d
FROM public.claude_api_calls
WHERE created_at >= now() - interval '7 days'
GROUP BY attribution, source
ORDER BY cost_usd_7d DESC NULLS LAST;

COMMENT ON VIEW public.claude_api_cache_efficiency_7d IS
  'Cache-hit% per skill/edge-function. <50% = caching werkt slecht voor die skill (kandidaat voor stable-prefix-redesign).';

-- -----------------------------------------------------------------------------
-- 8. Model-mix (7d) — voor donut/breakdown
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.claude_api_model_mix_7d AS
SELECT
  model,
  COUNT(*)                                                       AS calls,
  ROUND(SUM(cost_usd)::numeric, 4)                               AS cost_usd_7d,
  ROUND(
    (COUNT(*)::numeric / SUM(COUNT(*)) OVER ())::numeric * 100,
    2)                                                           AS pct_of_calls,
  ROUND(
    COALESCE(SUM(cost_usd) / NULLIF(SUM(SUM(cost_usd)) OVER (), 0), 0)::numeric * 100,
    2)                                                           AS pct_of_cost
FROM public.claude_api_calls
WHERE created_at >= now() - interval '7 days'
GROUP BY model
ORDER BY cost_usd_7d DESC NULLS LAST;

COMMENT ON VIEW public.claude_api_model_mix_7d IS
  'Welk model wordt het meest gebruikt + welk model neemt welk percentage van cost.';
