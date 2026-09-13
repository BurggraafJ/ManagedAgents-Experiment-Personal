-- =============================================================================
-- Spoor 07 item 7 — DOC-11 en DOC-12 meten wat ze beweren            (v1.157)
-- =============================================================================
-- `agent_docs_staleness_check()` (item 4, migratie 20260908210000) draait DOC-9
-- t/m DOC-12 op cron met *exact* de SQL van `scripts/agent_docs_audit.cjs`. Die
-- afspraak blijft: deze migratie verandert alleen die twee controles, en het
-- script krijgt in dezelfde PR dezelfde twee queries. Twee kopieën die elk hun
-- eigen versie van "weekronde" verzinnen zijn erger dan één poort minder.
--
-- ── DOC-11 · joinen op jobname verloor de historie ───────────────────────────
-- De eerste versie joinde `cron.job_run_details` op `cron.job` via `jobname`.
-- `rag-eval-weekly` is verwijderd en opnieuw aangemaakt: de huidige jobid 56
-- heeft twee vuringen, de verweesde jobid 42 negen (2026-06-15 … 2026-08-31),
-- waarvan twee binnen het venster van 30 dagen. Een verweesde jobid staat niet
-- meer in `cron.job`, dus de join gooide die vuringen weg. Gemeten 2026-09-13:
-- de oude vorm keek naar **2** vuringen, deze naar **4**. De controle beweerde
-- 30 dagen te dekken en dekte er één — dezelfde faalvorm die dit spoor bij
-- `rag_pipeline_staleness_check()` vond: een guard die niet aantoonbaar kan
-- alarmeren over de periode die hij claimt.
--
-- De reparatie joint helemaal niet meer. `cron.job_run_details` draagt het
-- commando zélf, en dat commando bevat het label waarmee de runrij hoort te
-- ontstaan (`'label','weekly-full'` voor jobid 56, `'label','cron-weekly'` voor
-- 42). Daaruit volgt zowel welke vuringen weekrondes zijn als welke runrij erbij
-- hoort — er is niets meer om te verwezen. De weekselectie is letterlijk die van
-- DOC-10 (`label like 'weekly%' or label = 'cron-weekly'`), zodat beide controles
-- hetzelfde "weekronde" bedoelen; hernoemt iemand het cron-label, dan bewegen ze
-- samen en valt het gat op bij DOC-10.
--
-- De koppeling runrij↔vuring is bovendien stríkter geworden: `r.label = w.label`
-- in plaats van `r.label like 'weekly%'`. De oorspronkelijke zorg — een sessie
-- die toevallig in hetzelfde venster iets anders draait maakt de controle stil
-- groen — is daarmee kleiner, niet groter.
--
-- ── DOC-12 · infra-uitval is geen schuld ─────────────────────────────────────
-- DOC-12 telt items die in de laatste drie afgeronde `rook-p0`-rondes élke keer
-- rood waren. Een mislukte HTTP-call telde daarin mee als "rood", terwijl de
-- vraag dan nooit bij het model is geweest (zelfde les als `G1 telt een 502 als
-- stilte`). Gemeten 2026-09-13 op suite `full`, waarvan de weekronde van die
-- ochtend 135 × `openai_429` opliep: zonder filter **126** blijvend rode items,
-- met filter **82**. Vierenveertig items zouden als schuld zijn geboekt voor een
-- OpenAI-storing.
--
-- Uitgesloten: `status=5xx` (gateway/runtime) en `provider_error` (een 200 met
-- `ok:false` van een upstream-dienst). Bewust NIET uitgesloten: `budget_wall`
-- (200) en `message_required` (400) — dat zijn echte fouten van de keten en van
-- de bank, die hóren rood te staan.
--
-- Tweede arm, nieuw: een geclaimde datum die niet meer klopt. Stond het item ná
-- `rood sinds <datum>` nog een keer groen in een afgeronde ronde, dan is de regel
-- verouderd en telt hij als "zonder geldige datum". Zonder die arm is de
-- conventie een eenmalige handeling; met die arm blijft hij waar. De vergelijking
-- gaat op dagniveau, want de regel draagt een datum en geen tijdstip.
--
-- ── Beide: de noemer staat er nu bij ─────────────────────────────────────────
-- `1 vuring zonder runrij` en `1 van 4` zijn niet hetzelfde bericht, en `0/0` is
-- geen groen maar een onthouding. Elk van de twee controles rapporteert daarom
-- ook waar hij naar keek: het aantal weekvuringen in het venster, respectievelijk
-- het aantal items met drie geldige runs. Valt een hele ronde om door een
-- storing, dan leest DOC-12 `0/0 · 0 items` in plaats van stil groen.
--
-- Idempotent: CREATE OR REPLACE FUNCTION (zelfde signatuur, dus `proacl` blijft
-- staan — een DROP + kale CREATE zou anon weer execute geven). De REVOKE/GRANT
-- staan er alleen voor de zekerheid opnieuw in; ze zijn no-ops op de bestaande
-- rechten `postgres=X/postgres | service_role=X/postgres`.
--
-- Bron: /workspace/security/maestro-agent-architecture/07-continuous-improvement/
--       RESEARCH.md §5 · IMPLEMENT-NOTES.md §8.5c (de verweesde jobid) + §10
-- =============================================================================

CREATE OR REPLACE FUNCTION public.agent_docs_staleness_check(p_stale_days integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_days          int := greatest(coalesce(p_stale_days, 8), 0);
  v_doc9_n        int;
  v_doc9_ids      text;
  v_doc10_age     int;
  v_doc10_last    text;
  v_doc11_n       int;
  v_doc11_totaal  int;
  v_doc11_dagen   text;
  v_doc12_zonder  int;
  v_doc12_totaal  int;
  v_doc12_pop     int;
  v_doc12_ids     text;
  v_audit_age     int;
  v_audit_last    text;
  v_kandidaten    jsonb := '[]'::jsonb;
  v_geschreven    jsonb;
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
  -- Geen join op cron.job: die verliest elke vuring van een verwijderde en opnieuw
  -- aangemaakte job (zie kop). Het label komt uit het commando van de vuring zelf,
  -- en de runrij moet precies dát label dragen.
  WITH v AS (
    SELECT d.start_time,
           substring(d.command FROM '''label''[[:space:]]*,[[:space:]]*''([^'']+)''') AS label
      FROM cron.job_run_details d
     WHERE d.command LIKE '%/functions/v1/rag-eval-cron%'
       AND d.start_time > now() - interval '30 days'
  ), w AS (
    SELECT * FROM v WHERE label LIKE 'weekly%' OR label = 'cron-weekly'
  ), z AS (
    SELECT w.start_time
      FROM w
     WHERE NOT EXISTS (SELECT 1 FROM public.rag_eval_runs r
                        WHERE r.label = w.label
                          AND r.created_at BETWEEN w.start_time AND w.start_time + interval '6 hours')
  )
  SELECT (SELECT count(*) FROM z),
         (SELECT count(*) FROM w),
         (SELECT coalesce(string_agg(to_char(start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || 'Z', ', ' ORDER BY start_time), '-') FROM z)
    INTO v_doc11_n, v_doc11_totaal, v_doc11_dagen;

  -- ── DOC-12 · blijvend rood zonder besluit (poort P8) ──────────────────────
  -- Drempel 3 runs: run-op-run-ruis is ±2 items, dus één rode run zegt niets
  -- over "blijvend". Infra-uitval telt niet mee als rood (zie kop), en een
  -- datum waar ná die dag nog een groene ronde op staat telt als geen datum.
  WITH r AS (
    SELECT id FROM public.rag_eval_runs
     WHERE suite = 'rook-p0' AND status = 'done'
     ORDER BY created_at DESC LIMIT 3
  ), g AS (
    SELECT res.question_id, res.signal_hit
      FROM public.rag_eval_results res
     WHERE res.run_id IN (SELECT id FROM r)
       AND res.assert_detail::text !~ 'rag-chat_failed status=5'
       AND res.assert_detail::text NOT LIKE '%provider_error%'
  ), f AS (
    SELECT question_id, count(*) n_runs, count(*) FILTER (WHERE signal_hit IS false) n_fail
      FROM g GROUP BY 1
  ), b AS (
    SELECT q.id, q.notes
      FROM f JOIN public.rag_eval_questions q ON q.id = f.question_id
     WHERE f.n_fail = f.n_runs AND f.n_runs = 3
  )
  SELECT (SELECT count(*) FILTER (
            WHERE b.notes !~ '^rood sinds [0-9]{4}-[0-9]{2}-[0-9]{2}' OR b.notes IS NULL
               OR EXISTS (SELECT 1 FROM public.rag_eval_results gr
                            JOIN public.rag_eval_runs gg ON gg.id = gr.run_id
                           WHERE gr.question_id = b.id AND gr.signal_hit AND gg.status = 'done'
                             AND gg.created_at::date > substring(b.notes FROM '^rood sinds ([0-9-]{10})')::date))
            FROM b),
         (SELECT count(*) FROM b),
         (SELECT count(*) FROM f WHERE n_runs = 3),
         (SELECT coalesce(string_agg(id, ' ' ORDER BY id), '-') FROM b)
    INTO v_doc12_zonder, v_doc12_totaal, v_doc12_pop, v_doc12_ids;

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
      'title', format('%s van %s weekvuringen zonder runrij (30 d)', v_doc11_n, v_doc11_totaal),
      'detail', format(
        'DOC-11 (poort P6, niet blokkerend). %s van de %s weekvuringen in dit venster leverde geen '
        'rag_eval_runs-rij met het label uit het cron-commando, binnen 6 uur: %s. pg_cron meldt alleen '
        'dat de SQL lukte; of de edge er een run van maakte staat nergens. Dit is de enige controle die '
        'zo''n stille mislukking vindt. Kijk in cron.job_run_details naast rag_eval_runs, en in de logs '
        'van rag-eval-cron. Let op: de vuringen worden op hun commando geselecteerd, niet via een join '
        'op cron.job — een verwijderde en opnieuw aangemaakte job hield anders zijn historie buiten de telling.',
        v_doc11_n, v_doc11_totaal, left(v_doc11_dagen, 300))));
  END IF;

  IF v_doc12_zonder > 0 THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-12', 'sev', 'medium',
      'title', format('%s van %s blijvend rode evalitems zonder geldige "rood sinds"', v_doc12_zonder, v_doc12_totaal),
      'detail', format(
        'DOC-12 (poort P8, niet blokkerend). %s van %s item(s) waren in de laatste 3 afgeronde '
        'rook-p0-runs elke keer rood zonder een geldige notes-regel: %s. Gemeten over %s item(s) met drie '
        'geldige runs (infra-uitval — 5xx en provider_error — telt niet als rood). Ongeldig is: geen regel '
        'die begint met "rood sinds JJJJ-MM-DD", of een datum waar ná die dag nog een groene ronde op staat. '
        'Blijvend rood zonder datum is schuld die niemand meer telt: zet datum, oorzaak, groen-voorwaarde en '
        'eigenaar in docs/agent/vragenbank/questions/*.jsonl en laad met scripts/agent_eval_load.cjs, dan '
        'wordt het een besluit in plaats van ruis.',
        v_doc12_zonder, v_doc12_totaal, left(v_doc12_ids, 300), v_doc12_pop)));
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
    'doc11', jsonb_build_object('vuringen_zonder_runrij_30d', v_doc11_n,
                                'weekvuringen_30d', v_doc11_totaal,
                                'zonder_runrij_op', left(v_doc11_dagen, 300)),
    'doc12', jsonb_build_object('zonder_datum', v_doc12_zonder,
                                'blijvend_rood', v_doc12_totaal,
                                'items_met_3_geldige_runs', v_doc12_pop,
                                'ids', left(v_doc12_ids, 300)),
    'audit', jsonb_build_object('leeftijd_dagen', v_audit_age, 'laatste', v_audit_last),
    'kandidaten', jsonb_array_length(v_kandidaten),
    'findings', v_geschreven);
END $function$;

COMMENT ON FUNCTION public.agent_docs_staleness_check(integer) IS
  'Spoor 07 item 4 (+ item 7) — dagelijks via cron agent-docs-guard. Vijf controles met exact de SQL van scripts/agent_docs_audit.cjs: DOC-9 (bankitem zonder source_hash, high), DOC-10 (weekronde ouder dan p_stale_days), DOC-11 (weekvuring zonder runrij, 30 d — geselecteerd op het commando van de vuring, NIET via een join op cron.job: die verliest de historie van een opnieuw aangemaakte job), DOC-12 (blijvend rood zonder geldige "rood sinds <datum>" — infra-uitval telt niet als rood, en een datum met een groene ronde erna is verouderd) en het auditrapport onder Confluence 445841410 — die vier medium. Beide cadanscontroles rapporteren hun noemer, zodat 0/0 als onthouding leesbaar is en niet als groen. Schrijft security_findings (scan_type docs_guard, category docs_drift, affected_object docs/agent:<code>), rapport-only, dedup zolang er een open rij voor dezelfde controle staat. p_stale_days verlagen forceert de twee cadanscontroles rood: zo bewijst poort P9 de INSERT zonder productiedata aan te raken.';

-- ── Rechten ──────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE laat `proacl` staan (gemeten vóór deze migratie:
-- `postgres=X/postgres | service_role=X/postgres`). Deze twee regels zijn dus
-- no-ops; ze staan er omdat een latere DROP + kale CREATE anon stil execute zou
-- teruggeven, en dan is dit de regel die je wilt vinden.
REVOKE ALL ON FUNCTION public.agent_docs_staleness_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_docs_staleness_check(integer) TO service_role;
