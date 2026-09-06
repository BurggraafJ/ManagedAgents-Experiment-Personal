-- =============================================================================
-- Spoor 02 — Langlopende runs: een vraag wordt een run                (v1.149)
-- =============================================================================
-- Wat dit doet, in één alinea. Een chatvraag wordt een rij in agent_chat_runs
-- met een toestandsmachine (queued → planning → researching → composing → done,
-- plus failed | cancelled | needs_input), een budget per effort-niveau
-- ({tool_calls, wall_ms, usd, hops_max}) en een stappenlog. De zware lus-toestand
-- (OpenAI-berichten, evidence, retrieval-matches, klaargezette compose-prompt)
-- staat in een aparte, service-only tabel agent_chat_run_state, zodat de run-rij
-- klein blijft en veilig door realtime past (postgres_changes-payload ≤ 1 MB;
-- daarboven vallen velden > 64 B stil weg). rag-chat v6.0 is de enige motor:
-- één hop = één edge-invocatie die de run vooruitduwt en via een lease-token
-- (hop_lease) als enige mag schrijven. De browser volgt de eigen rij via
-- createRealtimeChannel('agent-run') (I2); de RLS op de publicatie is owner-only.
--
-- Gemeten aanleiding (RESEARCH.md §1–§2, 2026-09-06): 25 % van de agentic runs
-- in 90 dagen eindigde op de tool-cap van 10 (niet op de klok); 0 van 797 calls
-- haalde ooit 150 s, maar de gateway kapt élke niet-streamende call op 150 s af
-- (504); een gesloten tab verloor vraag én antwoord omdat het antwoord nergens
-- op de server stond. Plan = pro (400 s wall-clock); hop ≤ 170 s.
--
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS / DO-blokken;
-- de agent_config-rijen worden alleen ingevoegd als ze ontbreken (tunen zonder
-- redeploy mag nooit door een re-run worden teruggedraaid). Dry-run als
-- `begin; …; rollback;` via de Management API vóór de echte toepassing.
--
-- Bron: /workspace/security/maestro-agent-architecture/02-long-running-runs/
--       RESEARCH.md §3.1–§3.4 · EVAL-GATES.md T1/T3/T4/T6 · ASK-JELLE.md (defaults)
-- =============================================================================

-- ── 1. De run-rij ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_chat_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid,                                  -- rag_chat_sessions.id; null voor eval/smoke/api
  owner_id        uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- null = service/cron: voor niemand zichtbaar
  caller_user_id  uuid,                                  -- Confluence-ACL-as (p_caller_user_id); = owner_id vanuit de browser
  origin          text NOT NULL DEFAULT 'api' CHECK (origin IN ('browser', 'eval', 'smoke', 'api')),
  eval_run_id     uuid,                                  -- rag_eval_runs.id: evalverkeer, door de gezondheidsview apart geteld
  question        text NOT NULL,                         -- ≤ 2000 tekens (de motor knipt, zoals het querylog)
  effort          text NOT NULL DEFAULT 'high' CHECK (effort IN ('low', 'medium', 'high', 'xhigh', 'max')),
  budget          jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {tool_calls, wall_ms, usd, hops_max, source}
  spent           jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {usd, wall_ms, tool_calls, hops, tokens:{openai_in,openai_cached,openai_out,router,grok_in,grok_out,embed}, cohere_calls}
  state           text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'planning', 'researching', 'composing', 'needs_input', 'done', 'failed', 'cancelled')),
  phase_label     text,                                  -- één NL-regel voor de UI
  route           text CHECK (route IS NULL OR route IN ('structured', 'sweep', 'agentic', 'semantic')),
  hop             int  NOT NULL DEFAULT 0,
  hop_lease       uuid,                                  -- fencing-token: alleen de hop met dit token mag schrijven
  hop_claimed_at  timestamptz,
  hops            jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{n, started_at, ended_at, ms, end_reason}] ≤ 40
  steps           jsonb NOT NULL DEFAULT '[]'::jsonb,    -- stripSteps()-vorm ≤ 40 (UI-trace + querylog.meta.steps)
  answer_partial  text,                                  -- alleen tijdens composing (throttled, ~400 ms)
  answer_md       text,
  envelope        jsonb,                                 -- antwoordcontract v1 + additief `budget`-blok; rows ≤ 500
  citations       jsonb,                                 -- ≤ 40
  analytics       jsonb,                                 -- AnalyticsBlock-vorm, rows ≤ 100
  input_request   jsonb,                                 -- {question} als state = needs_input
  input_answer    text,
  error           jsonb,                                 -- {code, message, provider, http_status, hop, stage}
  query_log_id    uuid,                                  -- rag_chat_query_log.id (geschreven bij done/failed)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  deadline_at     timestamptz                            -- created_at + budget.wall_ms + 60 s; de watchdog zet erna failed{budget_wall}
);

CREATE INDEX IF NOT EXISTS idx_agent_chat_runs_owner   ON public.agent_chat_runs (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_chat_runs_open    ON public.agent_chat_runs (updated_at) WHERE state NOT IN ('done', 'failed', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_agent_chat_runs_session ON public.agent_chat_runs (session_id);
CREATE INDEX IF NOT EXISTS idx_agent_chat_runs_created ON public.agent_chat_runs (created_at);

COMMENT ON TABLE public.agent_chat_runs IS
  'Spoor 02 — één rij per chatvraag met toestand (queued→planning→researching→composing→done | failed | cancelled | needs_input), budget per effort, spent per hop, stappenlog en het antwoord zelf. Klein gehouden (< 250 KB) omdat hij in de realtime-publicatie zit; de zware lus-toestand staat in agent_chat_run_state. Alleen de motor (rag-chat, service_role) schrijft toestanden; de browser leest owner-only en schrijft uitsluitend via agent_chat_run_cancel / agent_chat_run_answer_input.';
COMMENT ON COLUMN public.agent_chat_runs.owner_id IS 'auth.uid() van de vrager. NULL (eval/smoke/api via service-key) = voor geen enkele browser zichtbaar. Dit is de RLS-as; caller_user_id is de ACL-as.';
COMMENT ON COLUMN public.agent_chat_runs.caller_user_id IS 'Identiteit voor de Confluence-space-ACL (p_caller_user_id in context-build/match_chunks). Fail-closed: NULL = org-baseline. Nooit hergebruiken als mailbox-as (p_owner_user_id).';
COMMENT ON COLUMN public.agent_chat_runs.budget IS '{tool_calls, wall_ms, usd, hops_max, source}: uit agent_config(rag-chat, run_budgets) per effort; source = body | route | heuristic zegt wie het effort koos.';
COMMENT ON COLUMN public.agent_chat_runs.spent IS 'Per hop opgeteld: usd (één prijstabel over alle leveranciers), wall_ms, tool_calls, hops, tokens per leverancier, cohere_calls. rag_chat_query_log.est_cost_usd = spent.usd.';
COMMENT ON COLUMN public.agent_chat_runs.hop_lease IS 'Fencing-token van de hop die nu mag schrijven (agent_chat_run_claim_hop). Elke UPDATE van de motor eist `hop_lease = <eigen token>`; een verlopen lease (> 5 min) is opnieuw claimbaar.';
COMMENT ON COLUMN public.agent_chat_runs.hops IS 'Per hop {n, started_at, ended_at, ms, end_reason}. end_reason: done | soft_budget | hard_budget | hops_max | beforeunload:<reason> | failed. Poort T6: max(ms) ≤ 170000.';
COMMENT ON COLUMN public.agent_chat_runs.answer_partial IS 'Tussenstand van het antwoord tijdens composing (throttled ~400 ms) voor het typgevoel via realtime; NULL zodra answer_md staat.';
COMMENT ON COLUMN public.agent_chat_runs.envelope IS 'Antwoordcontract v1 (ongewijzigde velden) + additief blok budget {effort, spent, exhausted_by}. coverage.reason blijft de gesloten set van vijf.';
COMMENT ON COLUMN public.agent_chat_runs.error IS '{code: provider_error | hop_lost | budget_wall | internal, message, provider, http_status, hop, stage}. Bij provider_error blijft spent staan en blijft de state-rij bewaard voor resume.';
COMMENT ON COLUMN public.agent_chat_runs.deadline_at IS 'created_at + budget.wall_ms + 60 s (bij needs_input verlengd met de wachttijd). De watchdog zet een run erna op failed{budget_wall}.';

-- ── 2. De zware lus-toestand (service-only, NIET gepubliceerd) ───────────────
CREATE TABLE IF NOT EXISTS public.agent_chat_run_state (
  run_id        uuid PRIMARY KEY REFERENCES public.agent_chat_runs(id) ON DELETE CASCADE,
  history       jsonb,                                   -- gespreks-history uit de body (≤ 10 beurten)
  loop_messages jsonb,                                   -- OpenAI-berichtenlijst van de agent-lus (hervat-punt)
  loop_meta     jsonb,                                   -- {iter, tool_calls, tok_in, tok_cached, tok_out, scanned_total, model}
  evidence      jsonb,                                   -- evidence-rijen van de lus tot nu toe
  trace         jsonb,                                   -- tools_used-trace van de lus tot nu toe
  matches       jsonb,                                   -- semantische matches (ná rerank) voor compose
  dbg           jsonb,                                   -- debug_pipeline (ook: caller_identified voor de evalrunner)
  compose       jsonb,                                   -- alles wat de compose-stap nodig heeft: userMsg, sanitizedHistory, envelope-basis, citations, baseLog, baseUsage
  request       jsonb,                                   -- de oorspronkelijke body-opties (filters, prefs, web_search, top_k)
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agent_chat_run_state IS
  'Spoor 02 — zware tussenstand per run (berichtenlijst van de agent-lus, evidence, matches, klaargezette compose-prompt). Service-only: RLS aan zonder policies, niet in de realtime-publicatie. Een hop hervat hieruit na een verloren hop of een needs_input. Opgeruimd door de watchdog 7 dagen na een terminale toestand (V9).';
COMMENT ON COLUMN public.agent_chat_run_state.loop_messages IS 'De volledige OpenAI messages[] van runAgentic op het moment van pauzeren (hop-grens). De volgende hop gaat hiermee door; de system-prompt staat op index 0.';
COMMENT ON COLUMN public.agent_chat_run_state.compose IS 'Wat de compose-hop nodig heeft zonder de retrieval opnieuw te doen: userMsg, sanitizedHistory, envelope-basis, citations, baseLog, baseUsage, metaPayload-velden. Geschreven zodra de research-stage klaar is.';

-- updated_at bijhouden (zelfde helper als de rest van de database)
DROP TRIGGER IF EXISTS trg_agent_chat_runs_updated_at ON public.agent_chat_runs;
CREATE TRIGGER trg_agent_chat_runs_updated_at
  BEFORE UPDATE ON public.agent_chat_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_agent_chat_run_state_updated_at ON public.agent_chat_run_state;
CREATE TRIGGER trg_agent_chat_run_state_updated_at
  BEFORE UPDATE ON public.agent_chat_run_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS: owner-only lezen op de run-rij; niets voor de browser op de state ─
ALTER TABLE public.agent_chat_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_chat_run_state ENABLE ROW LEVEL SECURITY;   -- geen policies = service-only

DROP POLICY IF EXISTS agent_chat_runs_owner_select ON public.agent_chat_runs;
CREATE POLICY agent_chat_runs_owner_select ON public.agent_chat_runs
  FOR SELECT TO authenticated
  USING ((SELECT public.session_mfa_ok()) AND owner_id = (SELECT auth.uid()));
-- Geen INSERT/UPDATE/DELETE-policy voor authenticated: schrijven doet de motor
-- (service_role) en de twee SECURITY DEFINER-RPC's hieronder. Let op (V8, ASK-JELLE
-- vraag 5): onder Realtime evalueert session_mfa_ok() als true (session_user is daar
-- niet 'authenticator'), dus daar telt alleen de eigenaarscheck — identiek aan
-- tasks/agent_proposals/open_questions vandaag.
REVOKE ALL ON public.agent_chat_runs      FROM anon;
REVOKE ALL ON public.agent_chat_run_state FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.agent_chat_runs      FROM authenticated;
REVOKE ALL ON public.agent_chat_run_state FROM authenticated;

-- ── 4. Realtime-publicatie (idempotent) ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'agent_chat_runs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_chat_runs;
  END IF;
END $$;

-- ── 5. Kolommen op bestaande tabellen ────────────────────────────────────────
ALTER TABLE public.rag_chat_query_log ADD COLUMN IF NOT EXISTS run_id uuid;
CREATE INDEX IF NOT EXISTS idx_rag_chat_query_log_run_id ON public.rag_chat_query_log (run_id);
COMMENT ON COLUMN public.rag_chat_query_log.run_id IS 'Spoor 02 — agent_chat_runs.id van de run die deze logrij schreef. Poort T1: sinds rag-chat v6.0 is dit nooit NULL (ook niet op de compat-paden stream:true/false).';

ALTER TABLE public.claude_api_calls ADD COLUMN IF NOT EXISTS chat_run_id uuid;
CREATE INDEX IF NOT EXISTS idx_claude_api_calls_chat_run_id ON public.claude_api_calls (chat_run_id) WHERE chat_run_id IS NOT NULL;
COMMENT ON COLUMN public.claude_api_calls.chat_run_id IS 'Spoor 02 (V13) — koppeling naar agent_chat_runs.id zodra de Anthropic-wrapper een chatrun kent. Kolom + index hier; de bedrading zit in _shared/anthropic-fetch.ts (spoor 03a). Tot dan NULL.';

-- ── 6. Budgetten en prijzen (Principe 2: tunen zonder redeploy, V5/V6) ───────
-- Startwaarden = RESEARCH §3.4, allemaal AANNAME tot de bankronde ze vervangt.
-- xhigh heeft bewust een kortere wandklok dan high: RO37 ("diep mag duren") zet
-- zelf de grens op 180 s; high (240 s) is de agentic default met ruimte voor hops.
-- watchdog.stall_minutes voedt agent_chat_runs_watchdog() (V2).
INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
SELECT 'rag-chat', 'run_budgets', $j${
  "low":    {"tool_calls": 2,  "wall_ms": 30000,  "usd": 0.05, "hops_max": 2},
  "medium": {"tool_calls": 6,  "wall_ms": 90000,  "usd": 0.15, "hops_max": 3},
  "high":   {"tool_calls": 12, "wall_ms": 240000, "usd": 0.50, "hops_max": 5},
  "xhigh":  {"tool_calls": 20, "wall_ms": 180000, "usd": 1.00, "hops_max": 6},
  "max":    {"tool_calls": 40, "wall_ms": 600000, "usd": 2.00, "hops_max": 10},
  "watchdog": {"stall_minutes": 5},
  "_note": "RESEARCH 02 §3.4 startwaarden (2026-09-06), AANNAME tot de categorieën kosten/robuustheid ze vervangen. Constanten in rag-chat/run.ts zijn de fallback."
}$j$::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM public.agent_config WHERE agent_name = 'rag-chat' AND config_key = 'run_budgets');

INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
SELECT 'rag-chat', 'pricing', $j${
  "grok_in_per_1m": 1.25, "grok_out_per_1m": 2.50,
  "embed_per_1m": 0.13, "cohere_per_search": 0.002,
  "openai": {
    "gpt-5.6-sol":   {"in": 4,    "cached": 0.40,  "out": 20},
    "gpt-5.6-terra": {"in": 2,    "cached": 0.20,  "out": 12},
    "gpt-5.6-luna":  {"in": 0.2,  "cached": 0.02,  "out": 1.2},
    "gpt-5.5":       {"in": 5,    "cached": 0.50,  "out": 30},
    "gpt-5.4-mini":  {"in": 0.75, "cached": 0.075, "out": 4.50}
  },
  "_note": "Lijstprijzen per 1M tokens (OpenAI pricing-pagina + xAI models-pagina, 2026-09-06, S3b stap 1). Dezelfde getallen als de constanten in rag-chat (PRICE_USD, PRICE_PER_M, MINI_USD_*), die de fallback zijn. Verandert een tarief: hier én in de code, met datum."
}$j$::jsonb, false
WHERE NOT EXISTS (SELECT 1 FROM public.agent_config WHERE agent_name = 'rag-chat' AND config_key = 'pricing');

-- ── 7. RPC: hop claimen (service) ────────────────────────────────────────────
-- Atomaire lease. Geen rij terug = een andere hop heeft hem, of de run is
-- terminaal / wacht op input. Een verloren hop (lease > 5 min) is opnieuw claimbaar.
CREATE OR REPLACE FUNCTION public.agent_chat_run_claim_hop(p_run_id uuid)
RETURNS SETOF public.agent_chat_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.agent_chat_runs
     SET hop            = hop + 1,
         hop_lease      = gen_random_uuid(),
         hop_claimed_at = now(),
         started_at     = coalesce(started_at, now()),
         state          = CASE WHEN state = 'queued' THEN 'planning' ELSE state END
   WHERE id = p_run_id
     AND state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
     AND (hop_lease IS NULL OR hop_claimed_at IS NULL OR hop_claimed_at < now() - interval '5 minutes')
  RETURNING *;
END $function$;
COMMENT ON FUNCTION public.agent_chat_run_claim_hop(uuid) IS
  'Spoor 02 — atomaire hop-lease: hop+1, nieuw hop_lease-token, hop_claimed_at = now(), queued → planning. Geen rij = niet claimbaar (andere hop bezig < 5 min, terminaal of needs_input). De hop schrijft daarna alleen met `… AND hop_lease = <token>` (fencing tegen dubbele hops).';

-- ── 8. RPC: annuleren (eigenaar) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.agent_chat_run_cancel(p_run_id uuid)
RETURNS public.agent_chat_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v public.agent_chat_runs;
BEGIN
  SELECT * INTO v FROM public.agent_chat_runs WHERE id = p_run_id;
  -- Bewust één foutmelding voor "bestaat niet" en "niet van jou": het bestaan van
  -- iemands run is zelf informatie.
  IF v.id IS NULL OR v.owner_id IS NULL OR v.owner_id IS DISTINCT FROM auth.uid() OR NOT public.session_mfa_ok() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v.state IN ('done', 'failed', 'cancelled') THEN
    RETURN v;
  END IF;
  UPDATE public.agent_chat_runs
     SET state = 'cancelled', finished_at = now(), hop_lease = NULL, answer_partial = NULL,
         phase_label = 'Geannuleerd'
   WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $function$;
COMMENT ON FUNCTION public.agent_chat_run_cancel(uuid) IS
  'Spoor 02 — de eigenaar (auth.uid() = owner_id, met MFA-sessie) zet een niet-terminale run op cancelled en trekt de hop-lease in; de lopende hop verliest daarmee zijn schrijfrecht. Anders: exception forbidden (ook voor onbekende ids).';

-- ── 9. RPC: antwoord op een verduidelijkingsvraag (eigenaar) ─────────────────
CREATE OR REPLACE FUNCTION public.agent_chat_run_answer_input(p_run_id uuid, p_answer text)
RETURNS public.agent_chat_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v public.agent_chat_runs;
BEGIN
  SELECT * INTO v FROM public.agent_chat_runs WHERE id = p_run_id;
  IF v.id IS NULL OR v.owner_id IS NULL OR v.owner_id IS DISTINCT FROM auth.uid() OR NOT public.session_mfa_ok() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v.state <> 'needs_input' THEN
    RAISE EXCEPTION 'not_waiting_for_input: state is %', v.state USING ERRCODE = '22023';
  END IF;
  IF p_answer IS NULL OR length(trim(p_answer)) = 0 THEN
    RAISE EXCEPTION 'answer_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.agent_chat_runs
     SET state          = 'researching',
         input_answer   = left(p_answer, 2000),
         hop_lease      = NULL,
         hop_claimed_at = NULL,
         phase_label    = 'Antwoord ontvangen — het onderzoek gaat verder',
         -- de wachttijd op de gebruiker telt niet mee in het tijdsbudget
         deadline_at    = CASE WHEN deadline_at IS NULL THEN NULL ELSE deadline_at + (now() - updated_at) END
   WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $function$;
COMMENT ON FUNCTION public.agent_chat_run_answer_input(uuid, text) IS
  'Spoor 02 (V4) — de eigenaar beantwoordt een verduidelijkingsvraag: needs_input → researching, input_answer gezet, lease vrij, deadline verlengd met de wachttijd. De browser roept daarna rag-chat {_run_id, resume:true}. In I1 is er nog geen producent van needs_input (de ask_user-tool hoort bij de toolcatalogus, spoor 03b).';

-- ── 9b. security_findings moet de alarmen van de guards accepteren ───────────
-- Gemeten in de injected-stall-test (2026-09-06 16:01–16:04 UTC): de cron draaide vier keer
-- en rolde vier keer terug op `security_findings_category_check` — de tabel kende alleen
-- rls|secrets|auth|code|config|network en scan_type alleen daily_monitor|weekly_scan|manual.
-- Daardoor kon ook het bestaande alarm agent_chat_health_check() (v1.146: scan_type
-- agent_chat_guard, category silent_empty / empty_answer_ratio) nooit een rij schrijven;
-- zijn INSERT faalt op dezelfde constraints. Beide guards krijgen hier hun waarden; de
-- bestaande zes categorieën en drie scan_types blijven ongewijzigd (superset, idempotent).
ALTER TABLE public.security_findings DROP CONSTRAINT IF EXISTS security_findings_scan_type_check;
ALTER TABLE public.security_findings ADD CONSTRAINT security_findings_scan_type_check
  CHECK (scan_type = ANY (ARRAY['daily_monitor', 'weekly_scan', 'manual', 'agent_chat_guard', 'agent_chat_runs_guard']));
ALTER TABLE public.security_findings DROP CONSTRAINT IF EXISTS security_findings_category_check;
ALTER TABLE public.security_findings ADD CONSTRAINT security_findings_category_check
  CHECK (category = ANY (ARRAY['rls', 'secrets', 'auth', 'code', 'config', 'network', 'silent_empty', 'empty_answer_ratio', 'hop_lost', 'run_stuck']));
COMMENT ON CONSTRAINT security_findings_category_check ON public.security_findings IS
  'Zes security-monitor-categorieën + de alarmen van de chatguards: silent_empty / empty_answer_ratio (agent_chat_health_check, v1.146) en hop_lost / run_stuck (agent_chat_runs_watchdog, v1.149). Verbreed 2026-09-06 (spoor 02): tot dan rolde elk guard-alarm hier stil terug.';

-- ── 10. Watchdog (pg_cron, elke minuut mét WHERE EXISTS) ─────────────────────
CREATE OR REPLACE FUNCTION public.agent_chat_runs_watchdog()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_stall        interval;
  v_hop_lost     int := 0;
  v_budget_wall  int := 0;
  v_state_del    int := 0;
  v_ni_cancel    int := 0;
  v_runs_del     int := 0;
  v_hop_lost_24h int := 0;
  v_stuck        int := 0;
  v_f_lost       uuid;
  v_f_stuck      uuid;
BEGIN
  -- V2: de drempel is tunebaar via agent_config(rag-chat, run_budgets).watchdog.stall_minutes (default 5).
  SELECT coalesce((c.config_value->'watchdog'->>'stall_minutes')::int, 5) * interval '1 minute'
    INTO v_stall
    FROM public.agent_config c
   WHERE c.agent_name = 'rag-chat' AND c.config_key = 'run_budgets';
  v_stall := coalesce(v_stall, interval '5 minutes');

  -- (a) Verloren hop: geen enkele write in v_stall én geen levende lease.
  WITH lost AS (
    UPDATE public.agent_chat_runs
       SET state = 'failed', finished_at = now(), hop_lease = NULL, answer_partial = NULL,
           phase_label = 'Mislukt: de verwerking viel stil (hop verloren)',
           error = jsonb_build_object(
             'code', 'hop_lost', 'hop', hop, 'stage', state,
             'message', format('geen voortgang in %s; de hop is verloren (deploy, herstart of runtime-shutdown). Hervatten kan via resume.', v_stall::text),
             'at', now())
     WHERE state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
       AND updated_at < now() - v_stall
       AND (hop_claimed_at IS NULL OR hop_claimed_at < now() - v_stall)
     RETURNING 1)
  SELECT count(*) INTO v_hop_lost FROM lost;

  -- (b) Deadline verstreken (budget.wall_ms + 60 s).
  WITH dead AS (
    UPDATE public.agent_chat_runs
       SET state = 'failed', finished_at = now(), hop_lease = NULL, answer_partial = NULL,
           phase_label = 'Mislukt: het tijdsbudget is op',
           error = jsonb_build_object(
             'code', 'budget_wall', 'hop', hop, 'stage', state,
             'message', 'deadline_at verstreken (budget.wall_ms + 60 s) zonder terminale toestand',
             'at', now())
     WHERE state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
       AND deadline_at IS NOT NULL AND deadline_at < now()
     RETURNING 1)
  SELECT count(*) INTO v_budget_wall FROM dead;

  -- (c) Bewaartermijnen (V9): state-rijen 7 d na terminaal; runs 90 d; needs_input zonder antwoord 7 d.
  WITH del AS (
    DELETE FROM public.agent_chat_run_state s
     USING public.agent_chat_runs r
     WHERE r.id = s.run_id
       AND r.state IN ('done', 'failed', 'cancelled')
       AND coalesce(r.finished_at, r.updated_at) < now() - interval '7 days'
     RETURNING 1)
  SELECT count(*) INTO v_state_del FROM del;

  WITH ni AS (
    UPDATE public.agent_chat_runs
       SET state = 'cancelled', finished_at = now(), phase_label = 'Geannuleerd: geen antwoord op de verduidelijkingsvraag binnen 7 dagen'
     WHERE state = 'needs_input' AND updated_at < now() - interval '7 days'
     RETURNING 1)
  SELECT count(*) INTO v_ni_cancel FROM ni;

  WITH old AS (
    DELETE FROM public.agent_chat_runs
     WHERE state IN ('done', 'failed', 'cancelled')
       AND created_at < now() - interval '90 days'
     RETURNING 1)
  SELECT count(*) INTO v_runs_del FROM old;

  -- (d) Alarm in security_findings (dedup 12 u, zoals agent_chat_health_check).
  SELECT count(*) INTO v_hop_lost_24h
    FROM public.agent_chat_runs
   WHERE state = 'failed' AND error->>'code' = 'hop_lost' AND finished_at > now() - interval '24 hours';
  IF v_hop_lost_24h > 0 AND NOT EXISTS (
       SELECT 1 FROM public.security_findings
        WHERE affected_object = 'rag-chat' AND scan_type = 'agent_chat_runs_guard'
          AND category = 'hop_lost' AND status = 'open' AND found_at > now() - interval '12 hours') THEN
    INSERT INTO public.security_findings (scan_type, severity, category, title, detail, affected_object, status)
    VALUES ('agent_chat_runs_guard', 'medium', 'hop_lost',
      format('%s chatrun(s) verloren een hop (24 u)', v_hop_lost_24h),
      format('agent_chat_runs_watchdog zette %s run(s) op failed{hop_lost}: geen voortgang in %s en geen levende hop-lease. Oorzaken: edge-deploy midden in een run, runtime-shutdown (beforeunload), of een hop die vastliep. De state-rij is bewaard; resume is mogelijk. Kijk in v_agent_chat_runs_health en hops[].end_reason.', v_hop_lost_24h, v_stall::text),
      'rag-chat', 'open')
    RETURNING id INTO v_f_lost;
  END IF;

  SELECT count(*) INTO v_stuck
    FROM public.agent_chat_runs
   WHERE state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
     AND created_at < now() - interval '30 minutes';
  IF v_stuck > 0 AND NOT EXISTS (
       SELECT 1 FROM public.security_findings
        WHERE affected_object = 'rag-chat' AND scan_type = 'agent_chat_runs_guard'
          AND category = 'run_stuck' AND status = 'open' AND found_at > now() - interval '12 hours') THEN
    INSERT INTO public.security_findings (scan_type, severity, category, title, detail, affected_object, status)
    VALUES ('agent_chat_runs_guard', 'high', 'run_stuck',
      format('%s chatrun(s) langer dan 30 min niet-terminaal', v_stuck),
      format('%s run(s) staan langer dan 30 minuten in een niet-terminale toestand terwijl de watchdog ze niet als hop_lost herkent (er is dus nog een levende lease of recente write). Dat hoort niet: geen budget gaat boven 10 minuten (effort max). Controleer agent_chat_runs waar state niet in (done,failed,cancelled,needs_input).', v_stuck),
      'rag-chat', 'open')
    RETURNING id INTO v_f_stuck;
  END IF;

  RETURN jsonb_build_object(
    'checked_at', now(), 'stall', v_stall::text,
    'hop_lost', v_hop_lost, 'budget_wall', v_budget_wall,
    'state_rows_deleted', v_state_del, 'needs_input_cancelled', v_ni_cancel, 'runs_deleted', v_runs_del,
    'hop_lost_24h', v_hop_lost_24h, 'open_gt_30min', v_stuck,
    'findings', jsonb_strip_nulls(jsonb_build_object('hop_lost', v_f_lost, 'run_stuck', v_f_stuck)));
END $function$;
COMMENT ON FUNCTION public.agent_chat_runs_watchdog() IS
  'Spoor 02 — elke minuut via cron agent-chat-runs-watchdog (WHERE EXISTS, dus gratis als er niets te doen is): (a) niet-terminaal zonder write en zonder levende lease > stall_minutes (default 5, agent_config) → failed{hop_lost}; (b) deadline_at verstreken → failed{budget_wall}; (c) opruimen: state-rijen 7 d na terminaal, runs na 90 d, needs_input zonder antwoord na 7 d → cancelled; (d) security_findings: medium bij ≥ 1 hop_lost per 24 u, high bij een run > 30 min niet-terminaal (dedup 12 u).';

-- ── 11. Gezondheidsview ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_agent_chat_runs_health
WITH (security_invoker = on) AS
SELECT
  date_trunc('day', r.created_at)::date                                           AS dag,
  CASE WHEN r.eval_run_id IS NOT NULL THEN 'eval' ELSE r.origin END               AS verkeer,
  count(*)                                                                        AS runs,
  count(*) FILTER (WHERE r.state = 'done')                                        AS done,
  count(*) FILTER (WHERE r.state = 'failed')                                      AS failed,
  count(*) FILTER (WHERE r.state = 'failed' AND r.error->>'code' = 'hop_lost')       AS hop_lost,
  count(*) FILTER (WHERE r.state = 'failed' AND r.error->>'code' = 'budget_wall')    AS budget_wall,
  count(*) FILTER (WHERE r.state = 'failed' AND r.error->>'code' = 'provider_error') AS provider_error,
  count(*) FILTER (WHERE r.state = 'failed' AND r.error->>'code' = 'internal')       AS internal_error,
  count(*) FILTER (WHERE r.state = 'cancelled')                                   AS cancelled,
  count(*) FILTER (WHERE r.state = 'needs_input')                                 AS needs_input,
  count(*) FILTER (WHERE r.state NOT IN ('done', 'failed', 'cancelled', 'needs_input')) AS open,
  count(*) FILTER (WHERE r.state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
                     AND r.created_at < now() - interval '30 minutes')            AS open_gt_30min,
  percentile_disc(0.5)  WITHIN GROUP (ORDER BY (r.spent->>'wall_ms')::int) FILTER (WHERE r.state = 'done') AS p50_wall_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY (r.spent->>'wall_ms')::int) FILTER (WHERE r.state = 'done') AS p95_wall_ms,
  round(percentile_disc(0.95) WITHIN GROUP (ORDER BY (r.spent->>'wall_ms')::numeric / nullif((r.budget->>'wall_ms')::numeric, 0))
        FILTER (WHERE r.state = 'done'), 3)                                        AS p95_wall_over_budget,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY r.hop)                              AS p50_hops,
  max(r.hop)                                                                      AS max_hops,
  max(hm.max_ms)                                                                  AS max_hop_ms,
  count(*) FILTER (WHERE r.envelope->'budget'->>'exhausted_by' IS NOT NULL)      AS budget_exhausted,
  round(sum((r.spent->>'usd')::numeric), 4)                                       AS kosten_usd,
  round(avg((r.spent->>'usd')::numeric) FILTER (WHERE r.state = 'done'), 5)      AS kosten_per_run,
  count(*) FILTER (WHERE r.state = 'done' AND r.query_log_id IS NULL)             AS done_zonder_querylog
FROM public.agent_chat_runs r
LEFT JOIN LATERAL (SELECT max((h->>'ms')::int) AS max_ms FROM jsonb_array_elements(r.hops) h) hm ON true
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

COMMENT ON VIEW public.v_agent_chat_runs_health IS
  'Spoor 02 — per dag en verkeerssoort (browser | eval | smoke | api): runs, done/failed per foutcode, needs_input, open (> 30 min hoort 0 te zijn), p50/p95 wandtijd en p95 t.o.v. budget.wall_ms (≤ 1,1 = T5), hops p50/max, max hop-ms (T6: ≤ 170000), budget-uitputtingen, kosten (spent.usd) en done-runs zonder querylog-rij (hoort 0 te zijn). security_invoker: een browser ziet alleen eigen runs, service_role alles.';

REVOKE ALL ON public.v_agent_chat_runs_health FROM anon;
GRANT SELECT ON public.v_agent_chat_runs_health TO authenticated, service_role;

-- ── 12. Rechten op de RPC's ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.agent_chat_run_claim_hop(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_chat_runs_watchdog()                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_chat_run_cancel(uuid)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agent_chat_run_answer_input(uuid, text)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_chat_run_claim_hop(uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_chat_runs_watchdog()              TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_chat_run_cancel(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agent_chat_run_answer_input(uuid, text) TO authenticated, service_role;

-- ── 13. Cron: elke minuut, maar alleen als er iets te doen is ────────────────
-- platform.md-regel: WHERE EXISTS, zodat een lege minuut niets kost. De vier
-- takken spiegelen de vier taken van de watchdog (stall, deadline, opruimen, oud).
SELECT cron.schedule('agent-chat-runs-watchdog', '* * * * *', $cmd$
  SELECT public.agent_chat_runs_watchdog()
   WHERE EXISTS (SELECT 1 FROM public.agent_chat_runs
                  WHERE state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
                    AND updated_at < now() - interval '4 minutes')
      OR EXISTS (SELECT 1 FROM public.agent_chat_runs
                  WHERE state NOT IN ('done', 'failed', 'cancelled', 'needs_input')
                    AND deadline_at < now())
      OR EXISTS (SELECT 1 FROM public.agent_chat_run_state s JOIN public.agent_chat_runs r ON r.id = s.run_id
                  WHERE r.state IN ('done', 'failed', 'cancelled')
                    AND coalesce(r.finished_at, r.updated_at) < now() - interval '7 days')
      OR EXISTS (SELECT 1 FROM public.agent_chat_runs
                  WHERE (state = 'needs_input' AND updated_at < now() - interval '7 days')
                     OR (state IN ('done', 'failed', 'cancelled') AND created_at < now() - interval '90 days'));
$cmd$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agent-chat-runs-watchdog');

-- ── 14. Registreren ──────────────────────────────────────────────────────────
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906190000', 'agent_chat_runs')
ON CONFLICT (version) DO NOTHING;
