-- =============================================================================
-- 20260519_claude_api_loops.sql
-- =============================================================================
-- F.11 — Loop-detectie view voor claude_api_calls.
--
-- Detecteert prompts die binnen een uur >5 keer terugkomen — vibe-coding-vangnet
-- tegen runaway-skill-loops. Wordt door een (later toe te voegen) Edge Function
-- gechecked die Slack-alert plaatst bij rijen.
--
-- Zie Confluence: Project — Claude-call Observability (450101261).
-- Idempotent: veilig om opnieuw te draaien.
-- =============================================================================

CREATE OR REPLACE VIEW public.claude_api_loops_1h AS
SELECT
  prompt_hash,
  COALESCE(skill_name, source_edge_function, 'unknown') AS attribution,
  COUNT(*)                              AS n_calls,
  ROUND(SUM(cost_usd)::numeric, 4)      AS cost_usd_1h,
  SUM(input_tokens)                     AS input_tokens,
  SUM(cache_read_input_tokens)          AS cached_tokens,
  SUM(output_tokens)                    AS output_tokens,
  MIN(created_at)                       AS first_seen,
  MAX(created_at)                       AS last_seen,
  -- prompt_preview van een willekeurige sample voor context — alle dupes
  -- hebben (per definitie) dezelfde hash dus dezelfde preview.
  (ARRAY_AGG(prompt_preview))[1]        AS sample_prompt_preview
FROM public.claude_api_calls
WHERE created_at >= now() - interval '1 hour'
  AND prompt_hash IS NOT NULL
GROUP BY prompt_hash, attribution
HAVING COUNT(*) > 5
ORDER BY n_calls DESC, cost_usd_1h DESC NULLS LAST;

COMMENT ON VIEW public.claude_api_loops_1h IS
  'Detecteert identieke prompts (zelfde prompt_hash) die binnen 1 uur >5 keer voorkomen. '
  'Vangnet tegen runaway-loops. Wordt door Slack-alert-Edge-Function gechecked. '
  'Zie Confluence project 450101261.';

-- -----------------------------------------------------------------------------
-- Toon ook 24h variant — minder gevoelig, voor langzamere loops
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.claude_api_loops_24h AS
SELECT
  prompt_hash,
  COALESCE(skill_name, source_edge_function, 'unknown') AS attribution,
  COUNT(*)                              AS n_calls,
  ROUND(SUM(cost_usd)::numeric, 4)      AS cost_usd_24h,
  MIN(created_at)                       AS first_seen,
  MAX(created_at)                       AS last_seen,
  (ARRAY_AGG(prompt_preview))[1]        AS sample_prompt_preview
FROM public.claude_api_calls
WHERE created_at >= now() - interval '24 hours'
  AND prompt_hash IS NOT NULL
GROUP BY prompt_hash, attribution
HAVING COUNT(*) > 20
ORDER BY n_calls DESC;

COMMENT ON VIEW public.claude_api_loops_24h IS
  'Bredere loop-detectie: prompts die binnen 24u >20 keer voorkomen. '
  'Vangt langzamere loops (bv. dagelijkse skill die per ongeluk N×draait).';

-- -----------------------------------------------------------------------------
-- RLS — views erven van onderliggende claude_api_calls (owner-only).
-- Geen aparte policies nodig.
-- -----------------------------------------------------------------------------
