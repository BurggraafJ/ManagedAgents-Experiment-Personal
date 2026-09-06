-- =============================================================================
-- Spoor 01 — Evalbank + validatiepoort: schema v1                    (v1.147)
-- =============================================================================
-- Wat dit doet, in één alinea. De bestaande evaltabellen (rag_eval_questions /
-- rag_eval_results / rag_eval_runs, sinds 2026-06-04) krijgen de kolommen die de
-- vragenbank (docs/agent/vragenbank/, 364 items) en de runner v3.0 nodig hebben:
-- lane, categorie, persona, history en per-rij latency/kosten/route/bronnen.
-- Daarnaast: een persona-tabel (wie stelt de vraag, met verwachte rechten), een
-- werkvoorraad per run (rag_eval_run_items — DB-geclaimde batches in plaats van
-- een fire-and-forget keten met MAX_CHAIN), drie rapportage-views per categorie
-- en vijf RPC's waarmee de edge function start, claimt, controleert, afrondt en
-- vergelijkt. De poorten G1–G7 (EVAL-GATES.md §2) worden door rag_eval_compare
-- uitgerekend — één implementatie, geen tweede scorer in een script.
--
-- Idempotent: elke stap is IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.
-- De 71 legacy-items worden NIET herschreven (alleen lane/category/persona
-- gevuld waar leeg); de 22 is_core-teksten blijven byte-gelijk — de trendlijn
-- sinds 2026-06-04 hangt eraan.
--
-- Bron: /workspace/security/maestro-agent-architecture/01-eval-validation/
--       RESEARCH.md §3.2 · EVAL-GATES.md §2–3 · docs/agent/vragenbank/load.sql
-- =============================================================================

-- ── 1. rag_eval_questions — de bankkolommen ──────────────────────────────────
ALTER TABLE public.rag_eval_questions
  ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'retrieval',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT 'jelle',
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ground_truth_status text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bank_version text,
  ADD COLUMN IF NOT EXISTS source_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_questions_lane_check') THEN
    ALTER TABLE public.rag_eval_questions ADD CONSTRAINT rag_eval_questions_lane_check
      CHECK (lane IN ('retrieval', 'chat'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_questions_persona_check') THEN
    ALTER TABLE public.rag_eval_questions ADD CONSTRAINT rag_eval_questions_persona_check
      CHECK (persona IN ('jelle', 'collega_beperkt', 'cron', 'anon'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_questions_gts_check') THEN
    ALTER TABLE public.rag_eval_questions ADD CONSTRAINT rag_eval_questions_gts_check
      CHECK (ground_truth_status IN ('verified', 'assumed', 'todo'));
  END IF;
END $$;

-- Backfill van de 71 legacy-items. Geen trigger op deze tabel, dus updated_at
-- blijft staan (gate WP1: max(updated_at) ongewijzigd). De vraagtekst wordt
-- niet aangeraakt.
--   lane     : wat de runner v2.4 impliciet al deed (qtype analytical → rag-chat)
--   category : de oude 'dimension' als categorie-as
--   persona  : 'jelle' (vork V5, DECISIONS 2026-09-06) — legacy-items gaan
--              vanaf v3.0 als gebruiker draaien; de breuk in de reeks is gelabeld
--              (01-baseline = service-key, 01-after = JWT)
UPDATE public.rag_eval_questions
   SET lane = 'chat'
 WHERE qtype = 'analytical' AND lane <> 'chat';
UPDATE public.rag_eval_questions
   SET category = coalesce(category, dimension, 'onbekend')
 WHERE category IS NULL;

CREATE INDEX IF NOT EXISTS idx_rag_eval_questions_lane_cat
  ON public.rag_eval_questions (lane, category) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_rag_eval_questions_tags
  ON public.rag_eval_questions USING gin (tags) WHERE is_active;

COMMENT ON COLUMN public.rag_eval_questions.lane IS 'retrieval = context-build direct (meet ophalen); chat = rag-chat stream:false (meet het hele antwoord). Bepaalt runner en assert-set.';
COMMENT ON COLUMN public.rag_eval_questions.category IS 'Rapportage-as (README §4 van de vragenbank). Legacy-items: = dimension. Pass-rate per categorie is het stuurgetal, nooit één totaal.';
COMMENT ON COLUMN public.rag_eval_questions.persona IS 'Wie stelt de vraag (rag_eval_personas). Bepaalt de JWT waarmee de runner rag-chat aanroept en dus caller_user_id, Confluence-ACL en mailbox-tools. cron = service-key = org_baseline.';
COMMENT ON COLUMN public.rag_eval_questions.history IS 'Voorafgaande beurten [{role,content}] voor multi-turn-items; gaat 1:1 mee als body.history naar rag-chat.';
COMMENT ON COLUMN public.rag_eval_questions.ground_truth_status IS 'verified = tegen de bron gecontroleerd (laag 2 judge draait); assumed = de lacune erkennen is het juiste antwoord (assumption_honesty_rate); todo = nog geen ground truth.';
COMMENT ON COLUMN public.rag_eval_questions.tags IS 'Vrije labels: p0 (rookronde), acl, artefact, placeholder, regressie, duur …';
COMMENT ON COLUMN public.rag_eval_questions.bank_version IS 'Versie van de vragenbank waaruit de rij geladen is (bv. 1.1). NULL = legacy-item (niet via de loader).';
COMMENT ON COLUMN public.rag_eval_questions.source_hash IS 'sha1 van de jsonl-regel op schijf; agent_eval_load.cjs --check vergelijkt DB met schijf.';

-- ── 2. rag_eval_results — velden voor de nieuwe asserts ──────────────────────
ALTER TABLE public.rag_eval_results
  ADD COLUMN IF NOT EXISTS lane text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS persona text,
  ADD COLUMN IF NOT EXISTS latency_ms int,
  ADD COLUMN IF NOT EXISTS cost_usd numeric,
  ADD COLUMN IF NOT EXISTS coverage_reason text,
  ADD COLUMN IF NOT EXISTS artifact_type text,
  ADD COLUMN IF NOT EXISTS tools_used jsonb,
  ADD COLUMN IF NOT EXISTS quality_scores jsonb,
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS caller_identified boolean,
  ADD COLUMN IF NOT EXISTS sources jsonb,
  ADD COLUMN IF NOT EXISTS pending_asserts text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attempt int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS hop int,
  ADD COLUMN IF NOT EXISTS envelope_compact jsonb;

CREATE INDEX IF NOT EXISTS idx_rag_eval_results_run_q ON public.rag_eval_results (run_id, question_id);

COMMENT ON COLUMN public.rag_eval_results.caller_identified IS 'debug_pipeline.caller_identified van rag-chat. Chat-item met persona ≠ cron én false = onbetrouwbaar (ran_as_cron) — telt in v_agent_eval_by_category.n_identity_unreliable.';
COMMENT ON COLUMN public.rag_eval_results.sources IS 'Compact [{type,id,space_key?}] uit envelope.sources (max 40); space_key via join op confluence_pages voor expect_sources_include_space/exclude_space.';
COMMENT ON COLUMN public.rag_eval_results.pending_asserts IS 'Assert-keys die de runner nog niet kan meten (expect_effort_at_least, expect_artifact_type: pdf). Tellen niet als pass en niet als fail.';
COMMENT ON COLUMN public.rag_eval_results.envelope_compact IS 'claim, definition, columns, n_rows, artifacts_available, answer_empty, timing_ms — géén rijen, géén answer_md.';
COMMENT ON COLUMN public.rag_eval_results.coverage_reason IS 'envelope.coverage.reason ?? debug_pipeline.coverage_reason; voor de structured no_data-tool leidt de runner not_tracked af (DECISIONS 2026-09-06).';
COMMENT ON COLUMN public.rag_eval_results.cost_usd IS 'envelope.cost.usd — alle leveranciers van de chatcall zelf; judge-kosten tellen niet mee.';
COMMENT ON COLUMN public.rag_eval_results.latency_ms IS 'Wall-clock van de runner end-to-end (chat) of retrieval_meta.timing_ms.total (retrieval).';
COMMENT ON COLUMN public.rag_eval_results.hop IS 'In welke invocation (hop) van de run dit item liep.';

-- ── 3. rag_eval_runs — status, suite, telemetrie, poorten ────────────────────
ALTER TABLE public.rag_eval_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS suite text,
  ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS n_pending int,
  ADD COLUMN IF NOT EXISTS cost_usd_total numeric,
  ADD COLUMN IF NOT EXISTS p50_latency_ms int,
  ADD COLUMN IF NOT EXISTS p95_latency_ms int,
  ADD COLUMN IF NOT EXISTS persona_check jsonb,
  ADD COLUMN IF NOT EXISTS compare_to uuid,
  ADD COLUMN IF NOT EXISTS gates jsonb,
  ADD COLUMN IF NOT EXISTS runner_version text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_runs_status_check') THEN
    ALTER TABLE public.rag_eval_runs ADD CONSTRAINT rag_eval_runs_status_check
      CHECK (status IN ('queued', 'running', 'done', 'failed', 'invalid_persona'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_runs_suite_check') THEN
    ALTER TABLE public.rag_eval_runs ADD CONSTRAINT rag_eval_runs_suite_check
      CHECK (suite IS NULL OR suite IN ('legacy71', 'rook-p0', 'chat-lane', 'full', 'acl', 'custom'));
  END IF;
END $$;

-- Backfill van bestaande runs: de oude runner schreef 'running...' in notes en
-- overschreef dat bij afronden. Een run die nog 'running...' zegt, is een
-- verloren keten (gezien 17-07) en telt als failed.
UPDATE public.rag_eval_runs
   SET status = CASE WHEN notes LIKE '%running...%' THEN 'failed' ELSE 'done' END
 WHERE status = 'queued' AND created_at < now() - interval '1 minute';
UPDATE public.rag_eval_runs
   SET suite = CASE
                 WHEN label LIKE 'cron-weekly%' OR label LIKE '01-baseline%' OR label LIKE '01-after%' THEN 'legacy71'
                 WHEN label LIKE 'confluence-golden-set%' THEN 'acl'
                 ELSE 'custom'
               END
 WHERE suite IS NULL;
UPDATE public.rag_eval_runs SET started_at = created_at WHERE started_at IS NULL;
-- Oude runs hebben geen finished_at; de laatste resultaatrij is het eerlijkste einde.
UPDATE public.rag_eval_runs r
   SET finished_at = (SELECT max(x.created_at) FROM public.rag_eval_results x WHERE x.run_id = r.id)
 WHERE r.finished_at IS NULL AND r.status = 'done'
   AND EXISTS (SELECT 1 FROM public.rag_eval_results x WHERE x.run_id = r.id);

CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_status ON public.rag_eval_runs (status, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_rag_eval_runs_suite_created ON public.rag_eval_runs (suite, created_at DESC);

COMMENT ON COLUMN public.rag_eval_runs.status IS 'queued | running | done | failed | invalid_persona. invalid_persona = rag_eval_persona_check faalde; identiteitsitems zijn dan niet gedraaid (geen onbetrouwbaar-groen).';
COMMENT ON COLUMN public.rag_eval_runs.suite IS 'legacy71 (de 71 items van vóór de bank) | rook-p0 (36) | chat-lane (352) | full (435) | acl | custom. Bepaalt de itemselectie in rag_eval_start_run en de default vergelijkingsrun.';
COMMENT ON COLUMN public.rag_eval_runs.gates IS 'Uitkomst van rag_eval_compare(deze run, compare_to): G1..G7 elk {status,value,threshold,before,after}. Geen totaalscore — bewust.';
COMMENT ON COLUMN public.rag_eval_runs.persona_check IS 'Uitkomst van rag_eval_persona_check vóór de eerste hop: per persona ok/reden.';
COMMENT ON COLUMN public.rag_eval_runs.last_activity_at IS 'Laatste hop-activiteit; de pomp-cron pakt runs op met status running en last_activity_at ouder dan 3 minuten.';

-- ── 4. rag_eval_personas — wie stelt de vraag ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rag_eval_personas (
  persona             text PRIMARY KEY,
  email               text,
  user_id             uuid,
  must_see_spaces     text[] NOT NULL DEFAULT '{}',
  must_not_see_spaces text[] NOT NULL DEFAULT '{}',
  expect_mail_mirror  boolean NOT NULL DEFAULT false,
  expected_app_role   text,
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rag_eval_personas IS 'Spoor 01 — persona → gebruiker voor de evalrunner. GEEN geheimen: e-mail + user_id + verwachte ACL-scope. De JWT wordt per hop gemint (generate_link + token_hash) en nergens opgeslagen (DECISIONS D01-1). cron = geen user_id = service-key = org_baseline.';
COMMENT ON COLUMN public.rag_eval_personas.must_see_spaces IS 'confluence_allowed_spaces(user_id) moet deze bevatten, anders invalid_persona (positieve preconditie).';
COMMENT ON COLUMN public.rag_eval_personas.must_not_see_spaces IS 'confluence_allowed_spaces(user_id) mag hier niets van bevatten, anders invalid_persona (negatieve preconditie).';
COMMENT ON COLUMN public.rag_eval_personas.expect_mail_mirror IS 'Moet er een mail_accounts-rij zijn (true) of juist niet (false)? Bepaalt of my_mail_search aangeboden hoort te worden.';

ALTER TABLE public.rag_eval_personas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rag_eval_personas_admin_read ON public.rag_eval_personas;
CREATE POLICY rag_eval_personas_admin_read ON public.rag_eval_personas
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_or_higher()));
REVOKE ALL ON public.rag_eval_personas FROM anon;

DROP TRIGGER IF EXISTS trg_rag_eval_personas_updated_at ON public.rag_eval_personas;
CREATE TRIGGER trg_rag_eval_personas_updated_at
  BEFORE UPDATE ON public.rag_eval_personas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed. E-mails zijn geen geheim (staan in _index.md); user_id via auth.users.
-- ON CONFLICT DO NOTHING: latere handmatige wijzigingen (bv. Jay krijgt een
-- Confluence-identiteit) worden door een re-run niet teruggedraaid.
INSERT INTO public.rag_eval_personas (persona, email, user_id, must_see_spaces, must_not_see_spaces, expect_mail_mirror, expected_app_role, is_active, notes)
VALUES
  ('jelle', 'burggraaf@legal-mind.nl',
     (SELECT id FROM auth.users WHERE email = 'burggraaf@legal-mind.nl' LIMIT 1),
     '{MT}', '{}', true, 'owner', true,
     'Eigenaar: Confluence-identiteit, 8 spaces incl. MT, gespiegelde mailbox. Positieve controle (WI05).'),
  ('collega_beperkt', 'alberts@legal-mind.nl',
     (SELECT id FROM auth.users WHERE email = 'alberts@legal-mind.nl' LIMIT 1),
     '{}', '{MT}', false, 'member', true,
     'Collega zonder Confluence-identiteit (fail-closed: 0 spaces) en zonder mailbox. Negatieve controle (WI06, WI40, MA10). Vork V3: identiteitsloos laten.'),
  ('cron', NULL, NULL, '{}', '{MT}', false, NULL, true,
     'Geen JWT: de runner gebruikt de service-key, callerSub() = null, alleen org_baseline-spaces.'),
  ('anon', NULL, NULL, '{}', '{MT}', false, NULL, false,
     'Niet gebruikt in de bank; gereserveerd.')
ON CONFLICT (persona) DO NOTHING;

-- ── 5. rag_eval_run_items — de werkvoorraad per run ──────────────────────────
CREATE TABLE IF NOT EXISTS public.rag_eval_run_items (
  run_id      uuid NOT NULL REFERENCES public.rag_eval_runs (id) ON DELETE CASCADE,
  question_id text NOT NULL,
  state       text NOT NULL DEFAULT 'queued',
  claimed_at  timestamptz,
  hop         int,
  attempt     int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, question_id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_eval_run_items_state_check') THEN
    ALTER TABLE public.rag_eval_run_items ADD CONSTRAINT rag_eval_run_items_state_check
      CHECK (state IN ('queued', 'claimed', 'done'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rag_eval_run_items_state ON public.rag_eval_run_items (run_id, state);
COMMENT ON TABLE public.rag_eval_run_items IS 'Spoor 01 — itemselectie van een run, gematerialiseerd door rag_eval_start_run. Hops claimen hieruit (rag_eval_claim_batch, FOR UPDATE SKIP LOCKED); een verloren hop wordt na 8 min opnieuw claimbaar (max 3 pogingen). Vervangt MAX_CHAIN.';
ALTER TABLE public.rag_eval_run_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rag_eval_run_items_admin_read ON public.rag_eval_run_items;
CREATE POLICY rag_eval_run_items_admin_read ON public.rag_eval_run_items
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_or_higher()));
REVOKE ALL ON public.rag_eval_run_items FROM anon;

-- ── 6. Hulpfuncties ──────────────────────────────────────────────────────────
-- Bank-id = een van de acht bankprefixen; alles daarbuiten is legacy (A/DR/E/G/K/N/R/RFO/S/T).
CREATE OR REPLACE FUNCTION public.rag_eval_is_bank_id(p_id text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_id ~ '^(CA|C|KL|MA|WI|AR|NE|RO)[0-9]{2,3}$'
$$;
COMMENT ON FUNCTION public.rag_eval_is_bank_id(text) IS 'true voor ids van de vragenbank (C/CA/KL/MA/WI/AR/NE/RO + cijfers); false voor de 71 legacy-items.';

-- Pass/fail/pending per resultaatrij — één definitie, door views én compare gebruikt.
CREATE OR REPLACE FUNCTION public.rag_eval_item_state(p_hit boolean, p_pending text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_hit IS TRUE THEN 'pass'
           WHEN p_hit IS FALSE THEN 'fail'
           WHEN cardinality(coalesce(p_pending, '{}')) > 0 THEN 'pending'
           ELSE 'na'
         END
$$;
COMMENT ON FUNCTION public.rag_eval_item_state(boolean, text[]) IS 'pass | fail | pending (alleen niet-meetbare keys) | na (geen asserts). pass_pct = pass/(pass+fail); pending telt nooit mee.';

-- ── 7. Views ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_eval_by_category
WITH (security_invoker = on) AS
SELECT res.run_id,
       coalesce(res.category, q.category, res.dimension, 'onbekend')            AS category,
       count(*)                                                                 AS n,
       count(*) FILTER (WHERE public.rag_eval_item_state(res.signal_hit, res.pending_asserts) = 'pass')    AS pass,
       count(*) FILTER (WHERE public.rag_eval_item_state(res.signal_hit, res.pending_asserts) = 'fail')    AS fail,
       count(*) FILTER (WHERE public.rag_eval_item_state(res.signal_hit, res.pending_asserts) = 'pending') AS pending,
       round(100.0 * count(*) FILTER (WHERE res.signal_hit)
             / nullif(count(*) FILTER (WHERE res.signal_hit IS NOT NULL), 0), 1)  AS pass_pct,
       round(avg(res.answer_correctness)::numeric, 3)                           AS avg_correctness,
       percentile_disc(0.5)  WITHIN GROUP (ORDER BY res.latency_ms)             AS p50_latency_ms,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY res.latency_ms)             AS p95_latency_ms,
       round(sum(res.cost_usd)::numeric, 4)                                     AS cost_usd,
       count(*) FILTER (WHERE coalesce(res.lane, q.lane) = 'chat'
                          AND coalesce(res.persona, q.persona) <> 'cron'
                          AND res.caller_identified IS FALSE)                   AS n_identity_unreliable
  FROM public.rag_eval_results res
  LEFT JOIN public.rag_eval_questions q ON q.id = res.question_id
 GROUP BY res.run_id, coalesce(res.category, q.category, res.dimension, 'onbekend');
COMMENT ON VIEW public.v_agent_eval_by_category IS 'Spoor 01 — per run × categorie: n, pass, fail, pending, pass_pct (noemer pass+fail), correctness, p50/p95 latency, kosten en n_identity_unreliable (chat-items met persona ≠ cron die tóch als cron draaiden — hoort 0 te zijn). Dit is het stuurgetal; er is bewust geen totaal.';

CREATE OR REPLACE VIEW public.v_agent_eval_core_trend
WITH (security_invoker = on) AS
SELECT res.question_id,
       q.lane,
       res.run_id,
       r.label,
       r.suite,
       r.created_at,
       res.signal_hit,
       res.answer_correctness,
       res.caller_identified,
       res.latency_ms,
       res.cost_usd
  FROM public.rag_eval_results res
  JOIN public.rag_eval_questions q ON q.id = res.question_id AND q.is_core
  JOIN public.rag_eval_runs r ON r.id = res.run_id
 ORDER BY res.question_id, r.created_at;
COMMENT ON VIEW public.v_agent_eval_core_trend IS 'Spoor 01 — de 22 is_core-items per run (trendlijn sinds 2026-06-04). Let op de breuk: runs vóór v3.0 draaiden als service-key (persona cron), erna als gebruiker (jelle).';

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
COMMENT ON VIEW public.v_agent_eval_runs IS 'Spoor 01 — runs met status, suite, tellingen, kosten, latency, persona-check en de blokkerende poorten G1/G4 uit gates.';

-- ── 8. RPC: run starten ──────────────────────────────────────────────────────
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
BEGIN
  IF p_suite IS NULL OR p_suite NOT IN ('legacy71', 'rook-p0', 'chat-lane', 'full', 'acl', 'custom') THEN
    RAISE EXCEPTION 'rag_eval_start_run: unknown suite %', p_suite;
  END IF;

  -- Eén run tegelijk (paper §3.5 regel 3, D01-20). Een run zonder activiteit
  -- in 10 minuten is een verloren keten en blokkeert niet.
  SELECT id INTO v_busy FROM rag_eval_runs
   WHERE status = 'running' AND coalesce(last_activity_at, started_at, created_at) > now() - interval '10 minutes'
   ORDER BY created_at DESC LIMIT 1;
  IF v_busy IS NOT NULL AND coalesce((p_params->>'force')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'rag_eval_run_already_running: %', v_busy;
  END IF;

  -- Vergelijkingsrun: uuid of label.
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

  INSERT INTO rag_eval_runs (label, suite, params, status, started_at, last_activity_at, compare_to,
                             context_build_version, judge_model, answer_model, n_questions, notes, runner_version)
  VALUES (p_label, p_suite, coalesce(p_params, '{}'::jsonb), 'running', now(), now(), v_cmp,
          'live', 'gpt-5.5', 'live', 0, 'v3.0 running', coalesce(p_params->>'runner_version', 'v3.0'))
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
COMMENT ON FUNCTION public.rag_eval_start_run(text, text, jsonb) IS 'Spoor 01 — maakt een run en materialiseert de itemselectie in rag_eval_run_items. Weigert (exception rag_eval_run_already_running) als er een run running is met activiteit < 10 min, tenzij params.force. Suites: legacy71 | rook-p0 | chat-lane | full | acl | custom; params: ids[], only_tag, lane, category, persona, compare_to (uuid|label), build_artifacts, force.';

-- ── 9. RPC: batch claimen ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_claim_batch(p_run_id uuid, p_max_items int DEFAULT 3, p_solo boolean DEFAULT false, p_hop int DEFAULT NULL)
RETURNS SETOF public.rag_eval_questions
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_head  record;
  v_cap   int;
  v_ids   text[];
BEGIN
  -- Kopitem: eerst chat, dan retrieval; binnen een lane per persona, zodat een
  -- hop maar één JWT hoeft te minten. Verloren hops (claimed > 8 min) komen na
  -- 8 minuten terug in de voorraad, maximaal 3 pogingen. Een item waarvoor al
  -- een resultaatrij bestaat wordt nooit opnieuw geclaimd.
  SELECT ri.question_id, q.lane, q.persona,
         (q.category = 'kosten' OR coalesce((q.asserts->>'max_latency_ms')::numeric, 0) > 100000) AS solo
    INTO v_head
    FROM rag_eval_run_items ri
    JOIN rag_eval_questions q ON q.id = ri.question_id
   WHERE ri.run_id = p_run_id
     AND (ri.state = 'queued' OR (ri.state = 'claimed' AND ri.claimed_at < now() - interval '8 minutes' AND ri.attempt < 3))
     AND NOT EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id)
   ORDER BY q.lane, q.persona, ri.question_id
   FOR UPDATE OF ri SKIP LOCKED
   LIMIT 1;

  IF v_head IS NULL THEN RETURN; END IF;

  -- Retrieval-items zijn goedkoop en snel (context-build): 16 per hop zoals v2.4.
  -- Chat-items: p_max_items (3). Solo-items (kosten / max_latency_ms > 100 s) altijd alleen.
  v_cap := CASE WHEN p_solo OR v_head.solo THEN 1
                WHEN v_head.lane = 'retrieval' THEN greatest(p_max_items, 16)
                ELSE greatest(p_max_items, 1) END;

  SELECT array_agg(question_id) INTO v_ids FROM (
    SELECT ri.question_id
      FROM rag_eval_run_items ri
      JOIN rag_eval_questions q ON q.id = ri.question_id
     WHERE ri.run_id = p_run_id
       AND (ri.state = 'queued' OR (ri.state = 'claimed' AND ri.claimed_at < now() - interval '8 minutes' AND ri.attempt < 3))
       AND NOT EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id)
       AND q.lane = v_head.lane AND q.persona = v_head.persona
       AND (v_cap = 1 OR NOT (q.category = 'kosten' OR coalesce((q.asserts->>'max_latency_ms')::numeric, 0) > 100000))
       AND (v_cap > 1 OR ri.question_id = v_head.question_id)
     ORDER BY ri.question_id
     FOR UPDATE OF ri SKIP LOCKED
     LIMIT v_cap
  ) s;

  UPDATE rag_eval_run_items
     SET state = 'claimed', claimed_at = now(), hop = p_hop, attempt = attempt + 1
   WHERE run_id = p_run_id AND question_id = ANY (v_ids);
  UPDATE rag_eval_runs SET last_activity_at = now() WHERE id = p_run_id;

  RETURN QUERY SELECT q.* FROM rag_eval_questions q WHERE q.id = ANY (v_ids) ORDER BY q.id;
END $function$;
COMMENT ON FUNCTION public.rag_eval_claim_batch(uuid, int, boolean, int) IS 'Spoor 01 — claimt een homogene batch (zelfde lane + persona) uit rag_eval_run_items: chat max p_max_items (3), retrieval 16, solo-items (categorie kosten of max_latency_ms > 100 s) altijd 1. FOR UPDATE SKIP LOCKED; verloren claims (> 8 min) na max 3 pogingen. Retourneert de vraagrijen.';

-- ── 10. RPC: persona-preconditie ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_persona_check(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_p       record;
  v_spaces  text[];
  v_role    text;
  v_mail    boolean;
  v_ok_all  boolean := true;
  v_ok      boolean;
  v_why     text[];
  v_out     jsonb := '{}'::jsonb;
BEGIN
  FOR v_p IN
    SELECT DISTINCT q.persona AS name, pp.*
      FROM rag_eval_run_items ri
      JOIN rag_eval_questions q ON q.id = ri.question_id
      LEFT JOIN rag_eval_personas pp ON pp.persona = q.persona
     WHERE ri.run_id = p_run_id
  LOOP
    v_why := '{}';
    IF v_p.persona IS NULL OR v_p.is_active IS NOT TRUE THEN
      v_ok := false; v_why := array_append(v_why, 'persona_unknown_or_inactive');
    ELSIF v_p.user_id IS NULL THEN
      -- cron/anon: geen identiteit → org_baseline; die mag geen restricted space bevatten en niet leeg zijn.
      v_spaces := confluence_allowed_spaces(NULL);
      v_ok := NOT (v_spaces && v_p.must_not_see_spaces) AND cardinality(v_spaces) >= 1;
      IF v_spaces && v_p.must_not_see_spaces THEN v_why := array_append(v_why, 'baseline_contains_restricted'); END IF;
      IF cardinality(v_spaces) = 0 THEN v_why := array_append(v_why, 'baseline_empty'); END IF;
    ELSE
      v_spaces := confluence_allowed_spaces(v_p.user_id);
      SELECT app_role INTO v_role FROM user_roles WHERE user_id = v_p.user_id;
      v_mail := EXISTS (SELECT 1 FROM mail_accounts m WHERE m.user_id = v_p.user_id);
      v_ok := true;
      IF NOT (v_spaces @> v_p.must_see_spaces) THEN v_ok := false; v_why := array_append(v_why, 'missing_must_see_space'); END IF;
      IF v_spaces && v_p.must_not_see_spaces THEN v_ok := false; v_why := array_append(v_why, 'sees_restricted_space'); END IF;
      IF v_mail IS DISTINCT FROM v_p.expect_mail_mirror THEN v_ok := false; v_why := array_append(v_why, CASE WHEN v_mail THEN 'unexpected_mail_mirror' ELSE 'mail_mirror_missing' END); END IF;
      IF v_p.expected_app_role IS NOT NULL AND v_role IS DISTINCT FROM v_p.expected_app_role THEN v_ok := false; v_why := array_append(v_why, 'app_role_mismatch'); END IF;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_p.user_id) THEN v_ok := false; v_why := array_append(v_why, 'auth_user_missing'); END IF;
    END IF;
    v_ok_all := v_ok_all AND v_ok;
    v_out := v_out || jsonb_build_object(v_p.name, jsonb_build_object(
      'ok', v_ok, 'reasons', to_jsonb(v_why),
      'has_user', v_p.user_id IS NOT NULL,
      'allowed_spaces', to_jsonb(coalesce(v_spaces, '{}'::text[])),
      'n_spaces', cardinality(coalesce(v_spaces, '{}'::text[])),
      'mail_mirror', CASE WHEN v_p.user_id IS NULL THEN NULL ELSE v_mail END,
      'app_role', CASE WHEN v_p.user_id IS NULL THEN NULL ELSE v_role END));
  END LOOP;

  v_out := jsonb_build_object('ok', v_ok_all, 'checked_at', now(), 'personas', v_out);
  UPDATE rag_eval_runs
     SET persona_check = v_out,
         status = CASE WHEN v_ok_all THEN status ELSE 'invalid_persona' END,
         finished_at = CASE WHEN v_ok_all THEN finished_at ELSE now() END,
         notes = CASE WHEN v_ok_all THEN notes ELSE 'v3.0: persona_precondition_failed' END,
         last_activity_at = now()
   WHERE id = p_run_id;
  RETURN v_out;
END $function$;
COMMENT ON FUNCTION public.rag_eval_persona_check(uuid) IS 'Spoor 01 — preconditie vóór de eerste hop: per persona in de selectie confluence_allowed_spaces(user_id) ⊇ must_see, ∩ must_not_see = ∅, mail_accounts-bestaan = expect_mail_mirror, app_role; cron-baseline zonder restricted space en niet leeg. Faalt één eis → status invalid_persona (G4 rood, geen onbetrouwbaar-groen).';

-- ── 11. RPC: vergelijken (G1–G7) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_compare(p_after uuid, p_before uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_after    rag_eval_runs%ROWTYPE;
  v_before   uuid := p_before;
  v_g        jsonb := '{}'::jsonb;
  -- G1
  v_fails_no_empty int; v_silent_empty int;
  -- G2
  v_core_g2r int; v_core_r2g int; v_core_after numeric; v_core_before numeric; v_core_n_after int; v_core_pass_after int; v_core_pass_before int;
  -- G3
  v_cat_worst numeric; v_cat_worst_name text; v_cat_n int;
  -- G4
  v_acl_n int; v_acl_pass int; v_wi05 text; v_wi06 text; v_persona_ok boolean;
  -- G5
  v_cost_p50_after numeric; v_cost_p50_before numeric; v_over_cost int;
  -- G6
  v_p95_after int; v_p95_before int; v_over_build int; v_over_latency int;
  -- G7
  v_g7_n int; v_g7_pass int;
  -- extra
  v_assumed_n int; v_assumed_ok int; v_g2r jsonb; v_r2g jsonb; v_pending int; v_unrel int; v_cost numeric; v_dur int; v_bycat jsonb;
  v_status text;
BEGIN
  SELECT * INTO v_after FROM rag_eval_runs WHERE id = p_after;
  IF v_after.id IS NULL THEN RAISE EXCEPTION 'rag_eval_compare: run % not found', p_after; END IF;

  IF v_before IS NULL THEN
    v_before := v_after.compare_to;
  END IF;
  IF v_before IS NULL THEN
    SELECT id INTO v_before FROM rag_eval_runs
     WHERE status = 'done' AND suite IS NOT DISTINCT FROM v_after.suite AND id <> p_after
       AND created_at < v_after.created_at
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- Werkset: resultaatrijen van beide runs met de vraagmetadata erbij. DROP+CREATE
  -- in plaats van DELETE: onder service_role weigert de safeupdate-guard een
  -- DELETE zonder WHERE (gezien in 01-rook-first, gates bleef leeg).
  DROP TABLE IF EXISTS _cmp;
  CREATE TEMP TABLE _cmp (
    side text, question_id text, category text, lane text, persona text, is_core boolean, tags text[],
    asserts jsonb, gts text, state text, hit boolean, detail text, correctness numeric,
    latency_ms int, cost_usd numeric, coverage_reason text, caller_identified boolean, answer_empty boolean
  ) ON COMMIT DROP;
  INSERT INTO _cmp
  SELECT CASE WHEN res.run_id = p_after THEN 'after' ELSE 'before' END,
         res.question_id,
         coalesce(res.category, q.category, res.dimension, 'onbekend'),
         coalesce(res.lane, q.lane), coalesce(res.persona, q.persona), coalesce(q.is_core, false), coalesce(q.tags, '{}'),
         coalesce(q.asserts, '{}'::jsonb), q.ground_truth_status,
         rag_eval_item_state(res.signal_hit, res.pending_asserts), res.signal_hit, res.assert_detail, res.answer_correctness,
         res.latency_ms, res.cost_usd, res.coverage_reason, res.caller_identified,
         (res.envelope_compact->>'answer_empty')::boolean
    FROM rag_eval_results res
    LEFT JOIN rag_eval_questions q ON q.id = res.question_id
   WHERE res.run_id = p_after OR (v_before IS NOT NULL AND res.run_id = v_before);

  -- G1 — geen stille leegte (absoluut).
  SELECT count(*) FILTER (WHERE asserts ? 'expect_no_empty' AND hit IS FALSE AND detail LIKE '%no_empty(%'),
         count(*) FILTER (WHERE answer_empty IS TRUE AND coverage_reason IS NULL)
    INTO v_fails_no_empty, v_silent_empty FROM _cmp WHERE side = 'after';
  v_g := v_g || jsonb_build_object('G1', jsonb_build_object(
    'status', CASE WHEN v_fails_no_empty = 0 AND v_silent_empty = 0 THEN 'green' ELSE 'red' END,
    'value', jsonb_build_object('fails_no_empty', v_fails_no_empty, 'silent_empty', v_silent_empty),
    'threshold', 'fails_no_empty = 0 AND silent_empty = 0', 'before', NULL, 'after', v_fails_no_empty + v_silent_empty, 'blocking', true));

  -- G2 — kern-trendlijn (22 is_core).
  -- green_to_red = pass in before (b), fail in after (a).
  SELECT count(*) FILTER (WHERE b.state = 'pass' AND a.state = 'fail'),
         count(*) FILTER (WHERE b.state = 'fail' AND a.state = 'pass'),
         avg(a.correctness), avg(b.correctness), count(a.*), count(*) FILTER (WHERE a.state = 'pass'), count(*) FILTER (WHERE b.state = 'pass')
    INTO v_core_g2r, v_core_r2g, v_core_after, v_core_before, v_core_n_after, v_core_pass_after, v_core_pass_before
    FROM (SELECT * FROM _cmp WHERE side = 'after' AND is_core) a
    LEFT JOIN (SELECT * FROM _cmp WHERE side = 'before' AND is_core) b ON b.question_id = a.question_id;
  IF v_before IS NULL OR v_core_n_after = 0 THEN
    v_g := v_g || jsonb_build_object('G2', jsonb_build_object('status', 'n/a',
      'reason', CASE WHEN v_before IS NULL THEN 'no previous run' ELSE 'no is_core items in run' END,
      'value', jsonb_build_object('core_n', v_core_n_after, 'core_pass', v_core_pass_after, 'avg_correctness', round(v_core_after, 3)),
      'threshold', 'green_to_red_core = 0 AND correctness drop <= 0.10', 'before', NULL, 'after', v_core_pass_after, 'blocking', false));
  ELSE
    v_g := v_g || jsonb_build_object('G2', jsonb_build_object(
      'status', CASE WHEN v_core_g2r = 0 AND coalesce(v_core_before, 0) - coalesce(v_core_after, 0) <= 0.10 THEN 'green' ELSE 'red' END,
      'value', jsonb_build_object('green_to_red_core', v_core_g2r, 'red_to_green_core', v_core_r2g, 'core_n', v_core_n_after,
                                  'avg_correctness_after', round(v_core_after, 3), 'avg_correctness_before', round(v_core_before, 3)),
      'threshold', 'green_to_red_core = 0 AND correctness drop <= 0.10',
      'before', v_core_pass_before, 'after', v_core_pass_after, 'blocking', false));
  END IF;

  -- G3 — per categorie (n ≥ 3 in beide runs): geen daling > 5 pp.
  SELECT min(d.delta), (array_agg(d.category ORDER BY d.delta))[1], count(*)
    INTO v_cat_worst, v_cat_worst_name, v_cat_n
    FROM (
      SELECT a.category,
             round(100.0 * a.pass / nullif(a.pass + a.fail, 0), 1) - round(100.0 * b.pass / nullif(b.pass + b.fail, 0), 1) AS delta
        FROM (SELECT category, count(*) FILTER (WHERE state = 'pass') pass, count(*) FILTER (WHERE state = 'fail') fail, count(*) n FROM _cmp WHERE side = 'after' GROUP BY category) a
        JOIN (SELECT category, count(*) FILTER (WHERE state = 'pass') pass, count(*) FILTER (WHERE state = 'fail') fail, count(*) n FROM _cmp WHERE side = 'before' GROUP BY category) b USING (category)
       WHERE a.n >= 3 AND b.n >= 3
    ) d;
  IF v_before IS NULL OR coalesce(v_cat_n, 0) = 0 THEN
    v_g := v_g || jsonb_build_object('G3', jsonb_build_object('status', 'n/a', 'reason', CASE WHEN v_before IS NULL THEN 'no previous run' ELSE 'no category with n >= 3 in both runs' END,
      'value', NULL, 'threshold', 'min category delta >= -5.0 pp', 'before', NULL, 'after', NULL, 'blocking', false));
  ELSE
    v_g := v_g || jsonb_build_object('G3', jsonb_build_object(
      'status', CASE WHEN coalesce(v_cat_worst, 0) >= -5.0 THEN 'green' ELSE 'red' END,
      'value', jsonb_build_object('worst_delta_pp', v_cat_worst, 'worst_category', v_cat_worst_name, 'categories_compared', v_cat_n),
      'threshold', 'min category delta >= -5.0 pp', 'before', NULL, 'after', v_cat_worst, 'blocking', false));
  END IF;

  -- G4 — ACL op chatniveau, mét positieve controle en geldige persona's.
  SELECT count(*), count(*) FILTER (WHERE state = 'pass') INTO v_acl_n, v_acl_pass FROM _cmp WHERE side = 'after' AND category = 'wiki-acl';
  SELECT state INTO v_wi05 FROM _cmp WHERE side = 'after' AND question_id = 'WI05';
  SELECT state INTO v_wi06 FROM _cmp WHERE side = 'after' AND question_id = 'WI06';
  v_persona_ok := (v_after.persona_check->>'ok')::boolean;
  IF v_acl_n = 0 THEN
    v_g := v_g || jsonb_build_object('G4', jsonb_build_object('status', 'n/a', 'reason', 'no wiki-acl items in run',
      'value', jsonb_build_object('wiki_acl_pass', 0, 'wiki_acl_n', 0, 'WI05', NULL, 'WI06', NULL, 'persona_ok', v_persona_ok),
      'threshold', 'wiki_acl pass = n AND WI05 = pass AND WI06 = pass AND persona_check.ok', 'before', NULL, 'after', NULL, 'blocking', true));
  ELSE
    v_g := v_g || jsonb_build_object('G4', jsonb_build_object(
      'status', CASE WHEN v_acl_pass = v_acl_n AND v_wi05 = 'pass' AND v_wi06 = 'pass' AND v_persona_ok IS TRUE THEN 'green' ELSE 'red' END,
      'reason', CASE WHEN v_after.status = 'invalid_persona' THEN 'persona_precondition_failed'
                     WHEN v_wi05 IS DISTINCT FROM 'pass' THEN 'no positive control (WI05 not pass) — run invalid for G4'
                     WHEN v_wi06 IS DISTINCT FROM 'pass' THEN 'negative control WI06 not pass'
                     WHEN v_acl_pass < v_acl_n THEN 'wiki-acl item(s) red' ELSE NULL END,
      'value', jsonb_build_object('wiki_acl_pass', v_acl_pass, 'wiki_acl_n', v_acl_n, 'WI05', v_wi05, 'WI06', v_wi06, 'persona_ok', v_persona_ok),
      'threshold', 'wiki_acl pass = n AND WI05 = pass AND WI06 = pass AND persona_check.ok', 'before', NULL, 'after', v_acl_pass, 'blocking', true));
  END IF;

  -- G5 — kosten (chat-lane): p50 after ≤ before; geen item boven max_cost_usd.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_usd) INTO v_cost_p50_after FROM _cmp WHERE side = 'after' AND lane = 'chat' AND cost_usd IS NOT NULL;
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cost_usd) INTO v_cost_p50_before FROM _cmp WHERE side = 'before' AND lane = 'chat' AND cost_usd IS NOT NULL;
  SELECT count(*) INTO v_over_cost FROM _cmp WHERE side = 'after' AND asserts ? 'max_cost_usd' AND cost_usd > (asserts->>'max_cost_usd')::numeric;
  IF v_before IS NULL OR v_cost_p50_before IS NULL THEN
    v_g := v_g || jsonb_build_object('G5', jsonb_build_object('status', 'n/a', 'reason', CASE WHEN v_before IS NULL THEN 'no previous run' ELSE 'previous run has no cost data' END,
      'value', jsonb_build_object('p50_cost_usd_after', round(v_cost_p50_after, 4), 'over_cost', v_over_cost),
      'threshold', 'p50 cost <= before AND over_cost = 0', 'before', NULL, 'after', round(v_cost_p50_after, 4), 'blocking', false));
  ELSE
    v_g := v_g || jsonb_build_object('G5', jsonb_build_object(
      'status', CASE WHEN v_cost_p50_after <= v_cost_p50_before AND v_over_cost = 0 THEN 'green' ELSE 'red' END,
      'value', jsonb_build_object('p50_cost_usd_after', round(v_cost_p50_after, 4), 'p50_cost_usd_before', round(v_cost_p50_before, 4), 'over_cost', v_over_cost),
      'threshold', 'p50 cost <= before AND over_cost = 0', 'before', round(v_cost_p50_before, 4), 'after', round(v_cost_p50_after, 4), 'blocking', false));
  END IF;

  -- G6 — latency: p95 after ≤ before (chat-lane); build_ms- en latency-items groen.
  SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) INTO v_p95_after FROM _cmp WHERE side = 'after' AND lane = 'chat' AND latency_ms IS NOT NULL;
  SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) INTO v_p95_before FROM _cmp WHERE side = 'before' AND lane = 'chat' AND latency_ms IS NOT NULL;
  SELECT count(*) FILTER (WHERE asserts ? 'max_build_ms' AND hit IS FALSE AND detail LIKE '%build_ms(%'),
         count(*) FILTER (WHERE asserts ? 'max_latency_ms' AND hit IS FALSE AND detail LIKE '%latency(%')
    INTO v_over_build, v_over_latency FROM _cmp WHERE side = 'after';
  IF v_before IS NULL OR v_p95_before IS NULL THEN
    v_g := v_g || jsonb_build_object('G6', jsonb_build_object('status', 'n/a', 'reason', CASE WHEN v_before IS NULL THEN 'no previous run' ELSE 'previous run has no latency data' END,
      'value', jsonb_build_object('p95_latency_ms_after', v_p95_after, 'over_build_ms', v_over_build, 'over_latency', v_over_latency),
      'threshold', 'p95 <= before AND over_build_ms = 0 AND over_latency = 0', 'before', NULL, 'after', v_p95_after, 'blocking', false));
  ELSE
    v_g := v_g || jsonb_build_object('G6', jsonb_build_object(
      'status', CASE WHEN v_p95_after <= v_p95_before AND v_over_build = 0 AND v_over_latency = 0 THEN 'green' ELSE 'red' END,
      'value', jsonb_build_object('p95_latency_ms_after', v_p95_after, 'p95_latency_ms_before', v_p95_before, 'over_build_ms', v_over_build, 'over_latency', v_over_latency),
      'threshold', 'p95 <= before AND over_build_ms = 0 AND over_latency = 0', 'before', v_p95_before, 'after', v_p95_after, 'blocking', false));
  END IF;

  -- G7 — eerlijkheid: p0-items in negatief + eerlijkheid allemaal pass (pending = niet-pass).
  SELECT count(*), count(*) FILTER (WHERE state = 'pass') INTO v_g7_n, v_g7_pass
    FROM _cmp WHERE side = 'after' AND category IN ('negatief', 'eerlijkheid') AND 'p0' = ANY (tags);
  IF v_g7_n = 0 THEN
    v_g := v_g || jsonb_build_object('G7', jsonb_build_object('status', 'n/a', 'reason', 'no p0 negatief/eerlijkheid items in run',
      'value', jsonb_build_object('pass', 0, 'n', 0), 'threshold', 'pass = n', 'before', NULL, 'after', NULL, 'blocking', false));
  ELSE
    v_g := v_g || jsonb_build_object('G7', jsonb_build_object(
      'status', CASE WHEN v_g7_pass = v_g7_n THEN 'green' ELSE 'red' END,
      'reason', CASE WHEN v_g7_pass < v_g7_n THEN format('%s of %s not pass (pending counts as not-pass)', v_g7_n - v_g7_pass, v_g7_n) ELSE NULL END,
      'value', jsonb_build_object('pass', v_g7_pass, 'n', v_g7_n), 'threshold', 'pass = n', 'before', NULL, 'after', v_g7_pass, 'blocking', false));
  END IF;

  -- Verplichte rapportage naast de poorten.
  SELECT count(*), count(*) FILTER (WHERE state = 'pass') INTO v_assumed_n, v_assumed_ok
    FROM _cmp WHERE side = 'after' AND gts = 'assumed' AND asserts ? 'expect_coverage_reason';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.question_id, 'category', a.category, 'before', b.state, 'after', a.state,
                                              'caller_identified_before', b.caller_identified, 'caller_identified_after', a.caller_identified) ORDER BY a.question_id), '[]'::jsonb)
    INTO v_g2r
    FROM (SELECT * FROM _cmp WHERE side = 'after') a JOIN (SELECT * FROM _cmp WHERE side = 'before') b USING (question_id)
   WHERE b.state = 'pass' AND a.state = 'fail';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.question_id, 'category', a.category) ORDER BY a.question_id), '[]'::jsonb)
    INTO v_r2g
    FROM (SELECT * FROM _cmp WHERE side = 'after') a JOIN (SELECT * FROM _cmp WHERE side = 'before') b USING (question_id)
   WHERE b.state = 'fail' AND a.state = 'pass';
  SELECT count(*) FILTER (WHERE state = 'pending'),
         count(*) FILTER (WHERE lane = 'chat' AND persona <> 'cron' AND caller_identified IS FALSE),
         round(sum(cost_usd)::numeric, 4)
    INTO v_pending, v_unrel, v_cost FROM _cmp WHERE side = 'after';
  v_dur := extract(epoch FROM (coalesce(v_after.finished_at, now()) - coalesce(v_after.started_at, v_after.created_at)))::int;
  SELECT coalesce(jsonb_agg(jsonb_build_object('category', category, 'n', n, 'pass', pass, 'fail', fail, 'pending', pending, 'pass_pct', pass_pct,
                                              'avg_correctness', avg_correctness, 'p50_latency_ms', p50_latency_ms, 'p95_latency_ms', p95_latency_ms,
                                              'cost_usd', cost_usd, 'n_identity_unreliable', n_identity_unreliable) ORDER BY category), '[]'::jsonb)
    INTO v_bycat FROM v_agent_eval_by_category WHERE run_id = p_after;

  RETURN v_g || jsonb_build_object(
    'after_run', p_after, 'before_run', v_before, 'suite', v_after.suite, 'status', v_after.status,
    'assumption_honesty_rate', CASE WHEN v_assumed_n > 0 THEN round(v_assumed_ok::numeric / v_assumed_n, 3) ELSE NULL END,
    'assumed_n', v_assumed_n,
    'green_to_red', v_g2r, 'red_to_green', v_r2g,
    'n_pending', v_pending, 'n_identity_unreliable', v_unrel,
    'cost_usd_total', v_cost, 'duration_s', v_dur,
    'by_category', v_bycat,
    'computed_at', now());
END $function$;
COMMENT ON FUNCTION public.rag_eval_compare(uuid, uuid) IS 'Spoor 01 — rekent G1..G7 uit (EVAL-GATES.md §2) voor run p_after t.o.v. p_before (default: compare_to van de run, anders de laatste done-run met dezelfde suite). Elke poort {status green|red|n/a, value, threshold, before, after, blocking}; plus assumption_honesty_rate, green_to_red[], red_to_green[], n_pending, n_identity_unreliable, cost_usd_total, duration_s, by_category[]. Geen totaalscore.';

-- ── 12. RPC: afronden ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_eval_finish_if_done(p_run_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_remaining int;
  v_run rag_eval_runs%ROWTYPE;
  v_n int; v_hit int; v_asserted int; v_pending int; v_cost numeric; v_p50 int; v_p95 int;
  v_f numeric; v_r numeric; v_p numeric; v_ac numeric; v_scored int;
BEGIN
  SELECT * INTO v_run FROM rag_eval_runs WHERE id = p_run_id;
  IF v_run.id IS NULL THEN RETURN false; END IF;

  -- Items met een resultaatrij zijn klaar.
  UPDATE rag_eval_run_items ri SET state = 'done'
   WHERE ri.run_id = p_run_id AND ri.state <> 'done'
     AND EXISTS (SELECT 1 FROM rag_eval_results r WHERE r.run_id = p_run_id AND r.question_id = ri.question_id);

  -- Uitgeputte items (3 verloren hops): expliciet rood, nooit stil weg.
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
  IF v_run.status IN ('done', 'failed', 'invalid_persona') THEN RETURN true; END IF;

  -- Aggregaten (de oude finalizeRun) + de nieuwe telemetrie.
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

  UPDATE rag_eval_runs
     SET status = 'done', finished_at = now(), last_activity_at = now(),
         n_questions = v_n, n_asserted = v_asserted, n_pending = v_pending,
         signal_pass_rate = CASE WHEN v_asserted > 0 THEN round(v_hit::numeric / v_asserted, 3) END,
         avg_faithfulness = round(v_f, 3), avg_answer_relevance = round(v_r, 3), avg_context_precision = round(v_p, 3),
         avg_answer_correctness = round(v_ac, 3),
         cost_usd_total = v_cost, p50_latency_ms = v_p50, p95_latency_ms = v_p95,
         notes = format('v3.0 done, %s/%s judged, %s/%s asserts pass, %s pending', v_scored, v_n, v_hit, v_asserted, v_pending)
   WHERE id = p_run_id;

  -- Poorten uitrekenen tegen compare_to (of de vorige run met dezelfde suite).
  BEGIN
    UPDATE rag_eval_runs SET gates = rag_eval_compare(p_run_id, compare_to) WHERE id = p_run_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE rag_eval_runs SET gates = jsonb_build_object('error', SQLERRM) WHERE id = p_run_id;
  END;
  RETURN true;
END $function$;
COMMENT ON FUNCTION public.rag_eval_finish_if_done(uuid) IS 'Spoor 01 — markeert items met een resultaatrij done, geeft na 3 verloren hops een expliciete FAIL hop_lost, en rondt de run af zodra niets meer open staat: aggregaten, n_pending, cost_usd_total, p50/p95 (chat-lane), status done, gates = rag_eval_compare(run, compare_to). Retourneert true als de run af is.';

-- ── 13. Rechten: alleen service_role (de edge function en de CLI) ────────────
REVOKE ALL ON FUNCTION public.rag_eval_start_run(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rag_eval_claim_batch(uuid, int, boolean, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rag_eval_persona_check(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rag_eval_compare(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rag_eval_finish_if_done(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rag_eval_start_run(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_claim_batch(uuid, int, boolean, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_persona_check(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_compare(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_finish_if_done(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_is_bank_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rag_eval_item_state(boolean, text[]) TO authenticated, service_role;
REVOKE ALL ON public.v_agent_eval_by_category, public.v_agent_eval_core_trend, public.v_agent_eval_runs FROM anon;
GRANT SELECT ON public.v_agent_eval_by_category, public.v_agent_eval_core_trend, public.v_agent_eval_runs TO authenticated, service_role;

-- ── 14. Registreren ──────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906120000', 'agent_eval_bank_v1')
ON CONFLICT (version) DO NOTHING;
