-- =============================================================================
-- 20260518_claude_api_calls.sql
-- =============================================================================
-- Per-Claude-API-call observability als eigen tabel in onze stack — vervangt
-- het eerdere Helicone-proxy-voorstel (zie Confluence 450101261 v3). Werkt voor
-- beide call-paden:
--   1. Edge Functions die via supabase/functions/_shared/anthropic-fetch.ts
--      callen → schrijven inline na elke call.
--   2. Claude Code-sessies (skills via orchestrator) → na elke run parsed een
--      script ~/.claude/projects/<...>/sessions/<uuid>.jsonl en bulk-inserted
--      hier (zie scripts/parse-claude-session.cjs).
--
-- Aansluiting op bestaand fundament:
--   * agent_runs (v1-contract): claude_api_calls.run_id is nullable FK; parser
--     vult deze in zodra de session-uuid → agent_runs-koppeling helder is.
--   * Geen velden op agent_runs zelf — drilldown via JOIN.
--
-- Idempotent: veilig om opnieuw te draaien.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pricing-lookup-tabel — model-prijzen per miljoen tokens
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claude_api_pricing (
  model                              text         PRIMARY KEY,
  input_per_million_usd              numeric(10,4) NOT NULL,
  cache_read_per_million_usd         numeric(10,4) NOT NULL,
  cache_creation_per_million_usd     numeric(10,4) NOT NULL,
  output_per_million_usd             numeric(10,4) NOT NULL,
  effective_from                     timestamptz   NOT NULL DEFAULT now(),
  active                             boolean       NOT NULL DEFAULT true,
  notes                              text          NULL
);

COMMENT ON TABLE  public.claude_api_pricing IS 'Pricing per model voor cost-berekening in claude_api_calls. Update bij Anthropic-pricing-wijziging; zet active=false op oude rij.';
COMMENT ON COLUMN public.claude_api_pricing.cache_read_per_million_usd     IS 'Cache hit (cache_read_input_tokens). Typisch 10% van input.';
COMMENT ON COLUMN public.claude_api_pricing.cache_creation_per_million_usd IS 'Cache write (cache_creation_input_tokens). Typisch 125% van input.';

-- Seed pricing per 2026-05-18 — verifieer bij eerste live-call en update zo nodig.
INSERT INTO public.claude_api_pricing (
  model,                     input_per_million_usd, cache_read_per_million_usd, cache_creation_per_million_usd, output_per_million_usd, notes
) VALUES
  ('claude-opus-4-7',        15.00,  1.50,  18.75,  75.00, 'Opus 4.7 — seed 2026-05-18'),
  ('claude-sonnet-4-6',       3.00,  0.30,   3.75,  15.00, 'Sonnet 4.6 — seed 2026-05-18'),
  ('claude-haiku-4-5',        1.00,  0.10,   1.25,   5.00, 'Haiku 4.5 — seed 2026-05-18')
ON CONFLICT (model) DO NOTHING;

-- -----------------------------------------------------------------------------
-- claude_api_calls — één rij per Anthropic-API-call
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.claude_api_calls (
  id                            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                        uuid         NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,

  -- Herkomst
  source                        text         NOT NULL CHECK (source IN ('claude_code_session','edge_function')),
  source_session_uuid           text         NULL,
  source_edge_function          text         NULL,
  skill_name                    text         NULL,
  agent_name                    text         NULL,

  -- Anthropic-call payload
  model                         text         NOT NULL,
  input_tokens                  integer      NOT NULL DEFAULT 0,
  cache_read_input_tokens       integer      NOT NULL DEFAULT 0,
  cache_creation_input_tokens   integer      NOT NULL DEFAULT 0,
  output_tokens                 integer      NOT NULL DEFAULT 0,

  -- Afgeleid: cost in USD, berekend bij insert via pricing-lookup
  cost_usd                      numeric(12,6) NULL,

  -- Performance + outcome
  latency_ms                    integer      NULL,
  status                        text         NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','error','timeout')),
  error_text                    text         NULL,

  -- Replay/loop-detectie
  message_uuid                  text         NULL,        -- Anthropic message-id, voor dedup parser-runs
  prompt_hash                   text         NULL,        -- sha256(prompt) eerste 16 chars
  prompt_preview                text         NULL,        -- eerste ~500 chars
  response_preview              text         NULL,        -- eerste ~500 chars

  created_at                    timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.claude_api_calls IS 'Per-Claude-API-call telemetrie. Gevuld door (1) anthropic-fetch.ts wrapper in Edge Functions en (2) scripts/parse-claude-session.cjs voor Claude Code-sessies. Zie Confluence 450101261.';
COMMENT ON COLUMN public.claude_api_calls.run_id           IS 'Koppeling naar agent_runs.id. NULL betekent geen koppeling kunnen leggen (bv. ad-hoc dev-sessie).';
COMMENT ON COLUMN public.claude_api_calls.message_uuid     IS 'Anthropic message-id voor dedup — UNIQUE indien NOT NULL.';
COMMENT ON COLUMN public.claude_api_calls.prompt_hash      IS 'sha256(prompt) eerste 16 hex chars — voor loop-detectie via GROUP BY.';

-- Unieke message_uuid (alleen waar bekend) — voorkomt dubbele inserts bij parser-reruns.
CREATE UNIQUE INDEX IF NOT EXISTS uq_claude_api_calls_message_uuid
  ON public.claude_api_calls (message_uuid)
  WHERE message_uuid IS NOT NULL;

-- Primary access patterns
CREATE INDEX IF NOT EXISTS ix_claude_api_calls_run_id_created_at
  ON public.claude_api_calls (run_id, created_at DESC)
  WHERE run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_claude_api_calls_skill_created_at
  ON public.claude_api_calls (skill_name, created_at DESC)
  WHERE skill_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_claude_api_calls_model_created_at
  ON public.claude_api_calls (model, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_claude_api_calls_prompt_hash
  ON public.claude_api_calls (prompt_hash, created_at DESC)
  WHERE prompt_hash IS NOT NULL;

-- -----------------------------------------------------------------------------
-- BEFORE INSERT trigger — cost berekenen uit pricing-tabel
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_claude_api_calls_calc_cost()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  IF NEW.cost_usd IS NOT NULL THEN
    -- Caller heeft expliciet een cost gezet (bv. wrapper deed het al) — respecteer.
    RETURN NEW;
  END IF;

  SELECT input_per_million_usd, cache_read_per_million_usd,
         cache_creation_per_million_usd, output_per_million_usd
    INTO p
    FROM public.claude_api_pricing
   WHERE model = NEW.model AND active = true
   LIMIT 1;

  IF NOT FOUND THEN
    -- Onbekend model — laat cost NULL zodat we het kunnen opsporen via WHERE cost_usd IS NULL.
    RETURN NEW;
  END IF;

  NEW.cost_usd :=
      (NEW.input_tokens                / 1000000.0) * p.input_per_million_usd
    + (NEW.cache_read_input_tokens     / 1000000.0) * p.cache_read_per_million_usd
    + (NEW.cache_creation_input_tokens / 1000000.0) * p.cache_creation_per_million_usd
    + (NEW.output_tokens               / 1000000.0) * p.output_per_million_usd;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_claude_api_calls_calc_cost ON public.claude_api_calls;
CREATE TRIGGER trg_claude_api_calls_calc_cost
  BEFORE INSERT ON public.claude_api_calls
  FOR EACH ROW EXECUTE FUNCTION public.tg_claude_api_calls_calc_cost();

-- -----------------------------------------------------------------------------
-- View: per-skill kosten-aggregaat afgelopen 7d (voor dashboard KPI-cards)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.claude_api_costs_7d AS
SELECT
  COALESCE(skill_name, source_edge_function, 'unknown') AS attribution,
  source,
  model,
  COUNT(*)                                              AS calls,
  SUM(input_tokens)                                     AS input_tokens,
  SUM(cache_read_input_tokens)                          AS cached_input_tokens,
  SUM(output_tokens)                                    AS output_tokens,
  ROUND(SUM(cost_usd)::numeric, 4)                      AS cost_usd_7d,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,
  COUNT(*) FILTER (WHERE status <> 'ok')                AS errors
FROM public.claude_api_calls
WHERE created_at >= now() - interval '7 days'
GROUP BY attribution, source, model
ORDER BY cost_usd_7d DESC NULLS LAST;

COMMENT ON VIEW public.claude_api_costs_7d IS 'Kosten + latency per (skill/edge-function, model) afgelopen 7d. Bron voor Intelligence Hub Observability-tab.';

-- -----------------------------------------------------------------------------
-- RLS — alleen service-role mag schrijven; lezen via dashboard via anon-RLS-pad.
-- -----------------------------------------------------------------------------

ALTER TABLE public.claude_api_calls    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claude_api_pricing  ENABLE ROW LEVEL SECURITY;

-- Lees-policies — owner-only (volgt zelfde pattern als andere telemetrie-tabellen).
DROP POLICY IF EXISTS p_claude_api_calls_select   ON public.claude_api_calls;
CREATE POLICY p_claude_api_calls_select   ON public.claude_api_calls   FOR SELECT TO authenticated USING (public.is_app_owner());

DROP POLICY IF EXISTS p_claude_api_pricing_select ON public.claude_api_pricing;
CREATE POLICY p_claude_api_pricing_select ON public.claude_api_pricing FOR SELECT TO authenticated USING (public.is_app_owner());
