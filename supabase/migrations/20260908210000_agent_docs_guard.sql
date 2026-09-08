-- =============================================================================
-- Spoor 07 item 4 — de docs-poort krijgt een tweede been: cron        (v1.157)
-- =============================================================================
-- Wat dit doet, in één alinea. `scripts/agent_docs_audit.cjs` (item 1, PR #66)
-- draait DOC-1 … DOC-12, maar de vijf `[db]`-controles slaat hij zichtbaar over
-- zodra er geen management-token is — en dat is precies de situatie in CI en in
-- elke sessie die niet toevallig vandaag draait. Deze migratie zet DOC-9 t/m
-- DOC-12 plus "auditrapport ouder dan 8 dagen" óók in de database, op cron, met
-- exact dezelfde SQL als het script. Rapport-only: hij schrijft `security_findings`
-- en repareert niets.
--
-- Volgorde is niet omkeerbaar en staat zo in EVAL-GATES §3: eerst de twee CHECK's
-- verbreden, dan pas de functie die erin schrijft. Andersom faalt de INSERT
-- **stil** — de guard "draait" dan, meldt in `cron.job_run_details` een fout die
-- niemand leest, en de bewaking bestaat alleen op papier.
--
-- ⚠ Zelfde bug, tweede vondst. Bij het meten voor deze migratie bleek
--   `rag_pipeline_staleness_check()` (de P0-borging uit CLAUDE.md, migratie
--   20260602194144) nóóit een rij te hebben kunnen schrijven: zijn
--   scan_type `rag_pipeline_guard` en category `pipeline_staleness` stonden in
--   geen van beide CHECK's. Gemeten op 2026-09-08 in `cron.job_run_details`:
--   jobid 39 gooide op 2026-09-06 zestien keer
--   `violates check constraint "security_findings_category_check"`, de laatste om
--   20:00Z — ná de verbreding van 19:00Z (migratie 20260906190000), die alleen de
--   chatguards kende. Beide waarden gaan hier alsnog mee. Zonder die twee regels
--   blijft de chunker-guard blaffen in een dichte kamer.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD (superset, dus geen bestaande rij
-- kan falen), CREATE OR REPLACE FUNCTION, cron.schedule (upsert-by-name).
--
-- Bron: /workspace/security/maestro-agent-architecture/07-continuous-improvement/
--       RESEARCH.md §3 item 4 · EVAL-GATES.md §2 (DOC-9 … DOC-12) + §3 (poort P9)
-- =============================================================================

-- ── 1. De twee CHECK's verbreden ─────────────────────────────────────────────
-- Superset van wat er stond. `docs_drift` / `docs_guard` zijn nieuw voor deze
-- guard; `pipeline_staleness` / `rag_pipeline_guard` repareren de stille
-- terugrol van rag_pipeline_staleness_check() (zie kop).
ALTER TABLE public.security_findings DROP CONSTRAINT IF EXISTS security_findings_scan_type_check;
ALTER TABLE public.security_findings ADD CONSTRAINT security_findings_scan_type_check
  CHECK (scan_type = ANY (ARRAY['daily_monitor', 'weekly_scan', 'manual',
                                'agent_chat_guard', 'agent_chat_runs_guard',
                                'rag_pipeline_guard', 'docs_guard']));
COMMENT ON CONSTRAINT security_findings_scan_type_check ON public.security_findings IS
  'Drie security-monitor-scans + de guards: agent_chat_guard / agent_chat_runs_guard (spoor 02), rag_pipeline_guard (chunker-P0, 20260602194144) en docs_guard (spoor 07 item 4). Verbreed 2026-09-06 (chatguards) en 2026-09-08 (rag_pipeline_guard alsnog + docs_guard).';

ALTER TABLE public.security_findings DROP CONSTRAINT IF EXISTS security_findings_category_check;
ALTER TABLE public.security_findings ADD CONSTRAINT security_findings_category_check
  CHECK (category = ANY (ARRAY['rls', 'secrets', 'auth', 'code', 'config', 'network',
                               'silent_empty', 'empty_answer_ratio', 'hop_lost', 'run_stuck',
                               'pipeline_staleness', 'docs_drift']));
COMMENT ON CONSTRAINT security_findings_category_check ON public.security_findings IS
  'Zes security-monitor-categorieën + de alarmen van de guards: silent_empty / empty_answer_ratio (agent_chat_health_check, v1.146), hop_lost / run_stuck (agent_chat_runs_watchdog, v1.149), pipeline_staleness (rag_pipeline_staleness_check, v1.140 — kon tot 2026-09-08 niets schrijven) en docs_drift (agent_docs_staleness_check, spoor 07 item 4). Nieuwe alarmsoort? Eerst de CHECK, dan de INSERT, dan een geïnjecteerde testrij.';

-- ── 2. De guard ──────────────────────────────────────────────────────────────
-- Vijf controles, één rij per gebroken controle. De SQL is letterlijk die van
-- `scripts/agent_docs_audit.cjs` (DOC-9 … DOC-12) — twee kopieën die elk hun
-- eigen versie van "weekronde" verzinnen zijn erger dan één poort minder.
--
-- Dedup wijkt bewust af van de chatguards. Die draaien elke minuut / elk kwartier
-- en onderdrukken op een tijdvenster (6 u, 12 u). Deze draait één keer per dag;
-- een tijdvenster zou dan elke dag een nieuwe open rij opleveren voor hetzelfde
-- probleem. Hier geldt: zolang er een **open** rij is voor dezelfde controle komt
-- er geen tweede bij. Sluit iemand hem terwijl het probleem er nog is, dan staat
-- hij er morgen weer — dat is de bedoeling (EVAL-GATES §3: status blijft `open`
-- tot iemand hem sluit).
--
-- `p_stale_days` is de drempel voor de twee cadanscontroles (DOC-10 en het
-- auditrapport); 8 is de waarde uit EVAL-GATES P5. Een lagere waarde forceert die
-- twee rood en is daarmee het bewijsmiddel voor poort P9: hij loopt door dezelfde
-- INSERT, met dezelfde scan_type en category, zonder één productierij aan te raken.
CREATE OR REPLACE FUNCTION public.agent_docs_staleness_check(p_stale_days integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days         int := greatest(coalesce(p_stale_days, 8), 0);
  v_doc9_n       int;
  v_doc9_ids     text;
  v_doc10_age    int;
  v_doc10_last   text;
  v_doc11_n      int;
  v_doc12_zonder int;
  v_doc12_totaal int;
  v_audit_age    int;
  v_audit_last   text;
  v_kandidaten   jsonb := '[]'::jsonb;
  v_geschreven   jsonb;
BEGIN
  PERFORM public.assert_can_manage_dashboard();

  -- ── DOC-9 · bankitem in prod dat niet uit git komt (poort P3, blokkerend) ──
  SELECT count(*), coalesce(string_agg(id, ' ' ORDER BY id), '-')
    INTO v_doc9_n, v_doc9_ids
    FROM public.rag_eval_questions
   WHERE bank_version IS NOT NULL AND source_hash IS NULL;

  -- ── DOC-10 · leeft de weekcadans nog? (poort P5) ──────────────────────────
  SELECT coalesce(extract(day FROM now() - max(created_at))::int, 999),
         coalesce(max(created_at)::date::text, 'nooit')
    INTO v_doc10_age, v_doc10_last
    FROM public.rag_eval_runs
   WHERE status = 'done' AND (label LIKE 'weekly%' OR label = 'cron-weekly');

  -- ── DOC-11 · cron vuurde, maar er kwam geen runrij (poort P6) ─────────────
  -- pg_cron meldt alleen dat de SQL lukte, niet dat de edge er een run van maakte.
  -- De runrij moet HET LABEL VAN DEZE CRON dragen, anders is de controle stil
  -- groen zodra een sessie in hetzelfde venster iets anders draaide — exact wat
  -- er in de nacht van 2026-09-06 02:30Z gebeurde.
  SELECT count(*)
    INTO v_doc11_n
    FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = 'rag-eval-weekly'
     AND d.start_time > now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM public.rag_eval_runs r
                      WHERE r.label LIKE 'weekly%'
                        AND r.created_at BETWEEN d.start_time AND d.start_time + interval '6 hours');

  -- ── DOC-12 · blijvend rood zonder besluit (poort P8) ──────────────────────
  -- Drempel 3 runs: run-op-run-ruis is ±2 items, dus één rode run zegt niets
  -- over "blijvend".
  WITH r AS (SELECT id FROM public.rag_eval_runs
              WHERE suite = 'rook-p0' AND status = 'done'
              ORDER BY created_at DESC LIMIT 3),
       f AS (SELECT res.question_id, count(*) n_runs,
                    count(*) FILTER (WHERE res.signal_hit IS false) n_fail
               FROM public.rag_eval_results res
              WHERE res.run_id IN (SELECT id FROM r)
              GROUP BY 1)
  SELECT count(*) FILTER (WHERE q.notes !~ '^rood sinds [0-9]{4}-[0-9]{2}-[0-9]{2}' OR q.notes IS NULL),
         count(*)
    INTO v_doc12_zonder, v_doc12_totaal
    FROM f JOIN public.rag_eval_questions q ON q.id = f.question_id
   WHERE f.n_fail = f.n_runs AND f.n_runs = 3;

  -- ── Auditrapport · staat er nog een verse ronde onder 445841410? ──────────
  -- Bron is de Confluence-spiegel, niet Confluence zelf: de guard mag geen
  -- netwerk nodig hebben. Valt `confluence-sync-etl` om, dan meldt hij dat als
  -- een oud rapport — dat is een ruwe maar eerlijke uitslag: we kúnnen dan geen
  -- vers rapport zien.
  SELECT coalesce(extract(day FROM now() - max(confluence_updated_at))::int, 999),
         coalesce(max(confluence_updated_at)::date::text, 'nooit')
    INTO v_audit_age, v_audit_last
    FROM public.confluence_pages
   WHERE parent_id = '445841410' AND coalesce(is_archived, false) = false;

  -- ── De kandidaten ─────────────────────────────────────────────────────────
  IF v_doc9_n > 0 THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-9', 'sev', 'high',
      'title', format('%s evalbank-item(s) in prod zonder source_hash', v_doc9_n),
      'detail', format(
        'DOC-9 (poort P3, blokkerend). %s item(s) hebben bank_version maar geen source_hash: %s. '
        'Prod loopt dus vóór git: die items zijn rechtstreeks in rag_eval_questions gezet en staan '
        'niet in docs/agent/vragenbank/questions/*.jsonl. Herstel: item in de juiste jsonl zetten, '
        '`node scripts/agent_eval_load.cjs` draaien, controleren met `--check` (exit 0).',
        v_doc9_n, left(v_doc9_ids, 300))));
  END IF;

  IF v_doc10_age > v_days THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-10', 'sev', 'medium',
      'title', format('Geen weekronde in %s dagen', v_doc10_age),
      'detail', format(
        'DOC-10 (poort P5, niet blokkerend). Laatste afgeronde weekronde: %s (%s dagen; drempel %s). '
        'Zonder weekronde is er geen trend en meet spoor 07 zijn eigen cadans niet meer. '
        'Kijk naar cron rag-eval-weekly (zondag 02:30Z) en naar rag-eval-pump: die pompt alleen '
        'tussen 04:00 en 21:59 UTC, dus een ronde die daarbuiten omvalt blijft uren staan.',
        v_doc10_last, v_doc10_age, v_days)));
  END IF;

  IF v_doc11_n > 0 THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-11', 'sev', 'medium',
      'title', format('%s cronvuring(en) van rag-eval-weekly zonder runrij (30 d)', v_doc11_n),
      'detail', format(
        'DOC-11 (poort P6, niet blokkerend). %s keer vuurde cron rag-eval-weekly zonder dat er binnen '
        '6 uur een rag_eval_runs-rij met label weekly%% ontstond. pg_cron meldt alleen dat de SQL lukte; '
        'of de edge er een run van maakte staat nergens. Dit is de enige controle die zo''n stille '
        'mislukking vindt. Kijk in cron.job_run_details naast rag_eval_runs, en in de logs van rag-eval-cron.',
        v_doc11_n)));
  END IF;

  IF v_doc12_zonder > 0 THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-12', 'sev', 'medium',
      'title', format('%s van %s blijvend rode evalitems zonder "rood sinds"', v_doc12_zonder, v_doc12_totaal),
      'detail', format(
        'DOC-12 (poort P8, niet blokkerend). %s item(s) waren in de laatste 3 afgeronde rook-p0-runs '
        'elke keer rood, zonder een notes-regel die begint met "rood sinds JJJJ-MM-DD". Blijvend rood '
        'zonder datum is schuld die niemand meer telt: zet de datum en de reden in '
        'rag_eval_questions.notes, dan wordt het een besluit in plaats van ruis.',
        v_doc12_zonder)));
  END IF;

  IF v_audit_age > v_days THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:auditrapport', 'sev', 'medium',
      'title', format('Documentatie-auditrapport is %s dagen oud', v_audit_age),
      'detail', format(
        'Laatste pagina onder Operations / Documentation audits (Confluence 445841410): %s '
        '(%s dagen; drempel %s). documentation-monitor hoort daar wekelijks één sub-pagina te '
        'schrijven. Blijft die uit, dan draait de wekelijkse driftscan niet — of hij draait wel '
        'en kan niet posten. Gemeten via de spiegel public.confluence_pages, dus een omgevallen '
        'confluence-sync-etl geeft hier dezelfde uitslag.',
        v_audit_last, v_audit_age, v_days)));
  END IF;

  -- ── Schrijven, met dedup op de open rij van dezelfde controle ─────────────
  WITH k AS (
    SELECT * FROM jsonb_to_recordset(v_kandidaten) AS x(obj text, sev text, title text, detail text)
  ), ins AS (
    INSERT INTO public.security_findings
      (scan_type, severity, category, title, detail, affected_object, status)
    SELECT 'docs_guard', k.sev, 'docs_drift', k.title, k.detail, k.obj, 'open'
      FROM k
     WHERE NOT EXISTS (SELECT 1 FROM public.security_findings f
                        WHERE f.scan_type = 'docs_guard'
                          AND f.category = 'docs_drift'
                          AND f.affected_object = k.obj
                          AND f.status = 'open')
    RETURNING id, affected_object, severity
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'object', affected_object, 'severity', severity)),
                  '[]'::jsonb)
    INTO v_geschreven
    FROM ins;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'stale_days', v_days,
    'doc9',  jsonb_build_object('zonder_source_hash', v_doc9_n, 'ids', left(v_doc9_ids, 300)),
    'doc10', jsonb_build_object('leeftijd_dagen', v_doc10_age, 'laatste', v_doc10_last),
    'doc11', jsonb_build_object('vuringen_zonder_runrij_30d', v_doc11_n),
    'doc12', jsonb_build_object('zonder_datum', v_doc12_zonder, 'blijvend_rood', v_doc12_totaal),
    'audit', jsonb_build_object('leeftijd_dagen', v_audit_age, 'laatste', v_audit_last),
    'kandidaten', jsonb_array_length(v_kandidaten),
    'findings', v_geschreven);
END $function$;

COMMENT ON FUNCTION public.agent_docs_staleness_check(integer) IS
  'Spoor 07 item 4 — dagelijks via cron agent-docs-guard. Vijf controles met exact de SQL van scripts/agent_docs_audit.cjs: DOC-9 (bankitem zonder source_hash, high), DOC-10 (weekronde ouder dan p_stale_days), DOC-11 (cronvuring rag-eval-weekly zonder runrij, 30 d), DOC-12 (blijvend rood zonder "rood sinds <datum>") en het auditrapport onder Confluence 445841410 — die vier medium. Schrijft security_findings (scan_type docs_guard, category docs_drift, affected_object docs/agent:<code>), rapport-only, dedup zolang er een open rij voor dezelfde controle staat. p_stale_days verlagen forceert de twee cadanscontroles rood: zo bewijst poort P9 de INSERT zonder productiedata aan te raken.';

-- ── 3. Rechten ───────────────────────────────────────────────────────────────
-- Een kale CREATE FUNCTION geeft PUBLIC execute; deze guard schrijft in
-- security_findings en is cron-only, dus expliciet intrekken en alleen
-- service_role toestaan. De interne assert_can_manage_dashboard() blijft de
-- tweede sluiting.
REVOKE ALL ON FUNCTION public.agent_docs_staleness_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_docs_staleness_check(integer) TO service_role;

-- ── 4. Cron ──────────────────────────────────────────────────────────────────
-- Dagelijks 06:40 UTC (08:40 NL): na het nachtelijke evalvenster, vóór de werkdag.
-- De WHERE EXISTS is geen kopie van de vijf controles — dat zou dezelfde logica
-- twee keer zijn — maar de vraag of er überhaupt een bank te bewaken valt. Op een
-- lege of verse database is elke controle vacuüm en zou de guard onzin melden.
SELECT cron.schedule('agent-docs-guard', '40 6 * * *', $cmd$
  SELECT public.agent_docs_staleness_check()
   WHERE EXISTS (SELECT 1 FROM public.rag_eval_questions WHERE bank_version IS NOT NULL);
$cmd$);
