-- =============================================================================
-- agent-eval — kolommen + laadpad voor de vragenbank
-- =============================================================================
-- Deze bank breidt de BESTAANDE tabel public.rag_eval_questions uit; er komt geen
-- tweede evaltabel bij. De 50 items die er sinds 2026-06-11 in staan (E*/A*/G*/N*/
-- R*/S*/T*/DR*/K*/RFO) blijven ongemoeid — met name de 12 met is_core = true, want
-- die dragen de doorlopende trendlijn sinds 2026-06-04.
--
-- NIET uitvoeren zonder de implement-sessie: dit bestand is het ontwerp, niet de
-- migratie. Zet het bij uitvoering onder supabase/migrations/ met een datumprefix.
--
-- Volgorde: 1) kolommen  2) index  3) laden  4) controle
-- =============================================================================

-- ── 1. Kolommen ──────────────────────────────────────────────────────────────
-- lane: wat vandaag impliciet is (qtype='analytical' → rag-chat, anders context-build)
-- wordt expliciet. Zonder dit veld kan de runner niet weten welke assert-set geldt.
ALTER TABLE public.rag_eval_questions
  ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'retrieval'
    CHECK (lane IN ('retrieval', 'chat')),
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT 'jelle'
    CHECK (persona IN ('jelle', 'collega_beperkt', 'cron', 'anon')),
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ground_truth_status text NOT NULL DEFAULT 'todo'
    CHECK (ground_truth_status IN ('verified', 'assumed', 'todo')),
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Bestaande rijen krijgen de juiste lane op basis van wat de runner vandaag al doet.
UPDATE public.rag_eval_questions
   SET lane = CASE WHEN qtype = 'analytical' THEN 'chat' ELSE 'retrieval' END
 WHERE lane = 'retrieval' AND qtype = 'analytical';

-- Bestaande rijen hebben een dimension maar geen category; vul die eenmalig.
UPDATE public.rag_eval_questions SET category = coalesce(category, dimension);

CREATE INDEX IF NOT EXISTS idx_rag_eval_questions_lane_cat
  ON public.rag_eval_questions (lane, category) WHERE is_active;

-- ── 2. Resultaten: velden die de nieuwe asserts nodig hebben ─────────────────
ALTER TABLE public.rag_eval_results
  ADD COLUMN IF NOT EXISTS lane text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS persona text,
  ADD COLUMN IF NOT EXISTS latency_ms int,
  ADD COLUMN IF NOT EXISTS cost_usd numeric,
  ADD COLUMN IF NOT EXISTS coverage_reason text,
  ADD COLUMN IF NOT EXISTS artifact_type text,
  ADD COLUMN IF NOT EXISTS tools_used jsonb,
  ADD COLUMN IF NOT EXISTS quality_scores jsonb;   -- {grounding, dekking, bruikbaarheid, vorm, zuinigheid}

-- Per-categorie rapportage. Dit is het stuurgetal, niet het totaal.
CREATE OR REPLACE VIEW public.v_agent_eval_by_category AS
SELECT r.run_id,
       coalesce(res.category, 'onbekend')                            AS category,
       count(*)                                                      AS n,
       count(*) FILTER (WHERE res.signal_hit)                        AS pass,
       round(100.0 * count(*) FILTER (WHERE res.signal_hit)
             / nullif(count(*) FILTER (WHERE res.signal_hit IS NOT NULL), 0), 1) AS pass_pct,
       round(avg(res.answer_correctness)::numeric, 3)                AS avg_correctness,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY res.latency_ms)  AS p50_latency_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY res.latency_ms)  AS p95_latency_ms,
       round(sum(res.cost_usd)::numeric, 4)                          AS cost_usd
  FROM public.rag_eval_results res
  JOIN public.rag_eval_runs r ON r.id = res.run_id
 GROUP BY r.run_id, res.category;

-- ── 3. Laden ─────────────────────────────────────────────────────────────────
-- De JSONL wordt geladen door scripts/agent_eval_load.cjs (te bouwen):
--   1. lees questions/*.jsonl
--   2. vervang {{PLACEHOLDERS}} uit placeholders.local.json  (NIET gecommit)
--   3. valideer tegen schema.json
--   4. upsert per id
--
-- Waarom een script en geen INSERT-migratie: de vraagteksten bevatten na vervanging
-- klantnamen. Die horen niet in een migratiebestand in een PUBLIC repo — dat is
-- precies wat er in 20260611_vragenbak_w0_analytical_eval_items.sql wél is gebeurd
-- (zie AGENT-REBUILD-RESEARCH.md §9, risico R7).
--
-- De upsert-vorm die het script gebruikt:
--
--   INSERT INTO public.rag_eval_questions
--     (id, question, dimension, category, lane, persona, history, depth, intent,
--      skill, qtype, is_core, is_active, expected_answer, expect_signal,
--      ground_truth_status, asserts, options, tags, notes)
--   VALUES (...)
--   ON CONFLICT (id) DO UPDATE SET
--     question            = EXCLUDED.question,
--     category            = EXCLUDED.category,
--     lane                = EXCLUDED.lane,
--     persona             = EXCLUDED.persona,
--     history             = EXCLUDED.history,
--     expected_answer     = EXCLUDED.expected_answer,
--     expect_signal       = EXCLUDED.expect_signal,
--     ground_truth_status = EXCLUDED.ground_truth_status,
--     asserts             = EXCLUDED.asserts,
--     options             = EXCLUDED.options,
--     tags                = EXCLUDED.tags,
--     notes               = EXCLUDED.notes,
--     updated_at          = now()
--   WHERE public.rag_eval_questions.is_core = false;   -- kern-12 nooit overschrijven
--
-- Die WHERE is geen detail: de kern-12 draagt de trendlijn sinds 2026-06-04.
-- Eén herformulering en de reeks is waardeloos.

-- ── 4. Controle na het laden ─────────────────────────────────────────────────
-- SELECT lane, count(*) FROM rag_eval_questions WHERE is_active GROUP BY lane;
-- SELECT category, count(*) FROM rag_eval_questions WHERE is_active GROUP BY category ORDER BY 2 DESC;
-- SELECT count(*) FROM rag_eval_questions WHERE is_core;             -- moet 12 blijven
-- SELECT id FROM rag_eval_questions WHERE question LIKE '%{{%';      -- moet leeg zijn
--
-- Die laatste is de belangrijkste: een niet-vervangen placeholder maakt een item
-- stilzwijgend onzinnig, en een onzinnig item dat rood staat kost een uur zoeken.
