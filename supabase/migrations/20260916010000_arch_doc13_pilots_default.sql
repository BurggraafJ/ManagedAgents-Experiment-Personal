-- =============================================================================
-- Architecture close-out 2026-09-16 — DOC-13 + HubSpot pilots-default (v1.221)
-- =============================================================================
-- 1) DOC-13: "weekronde gedraaid maar grotendeels niet doorgekomen"
--    DOC-10 is groen zodra er een afgeronde weekronde-rij is. Op 2026-09-13 was
--    die ronde voor 31 % onbruikbaar (openai_429 / provider_error) terwijl
--    DOC-10 stil groen bleef. DOC-13 waarschuwt als de jongste weekronde ≥ 25 %
--    infra-falen heeft én ≥ 50 resultaatrijen. Zelfde infra-definitie als DOC-12
--    (5xx + provider_error). Niet-blokkerend (WAARSCH), rapport-only.
--    Exact dezelfde SQL staat in scripts/agent_docs_audit.cjs.
--
-- 2) analytics_active_pilots: ASK-JELLE 03 #1 default — dode Sales-stage
--    '1-pitters in proefperiode (zonder ovk)' (dealstage 4841337018) gaf stil
--    nul. pilot = Customer Base Proeftijd alleen. Geen businessfeiten verzonnen.
-- =============================================================================

CREATE OR REPLACE FUNCTION analytics_active_pilots()
RETURNS TABLE (bron text, company_name text, dealname text, stage_label text, closedate date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'customer_base'::text AS bron,
         c.name, d.dealname, analytics_stage_label(d.pipeline_id, d.dealstage), d.closedate::date
  FROM hubspot_deals d
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(d.associated_company_ids) LIMIT 1
  ) c ON true
  WHERE d.pipeline_id = '2299277539' AND d.is_archived = false AND d.dealstage = '3504527569'
  ORDER BY 4 NULLS LAST;
$$;

COMMENT ON FUNCTION analytics_active_pilots() IS
  'Lopende pilots = Customer Base stage Proeftijd (3504527569). Sales-stage 4841337018 verwijderd (ASK-JELLE 03 #1 default 2026-09-16: stage bestond niet meer, arm gaf stil nul).';

REVOKE ALL ON FUNCTION analytics_active_pilots() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics_active_pilots() TO service_role;

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
  v_doc13_fail    int;
  v_doc13_n       int;
  v_doc13_infra   int;
  v_doc13_label   text;
  v_audit_age     int;
  v_audit_last    text;
  v_kandidaten    jsonb := '[]'::jsonb;
  v_geschreven    jsonb;
BEGIN
  PERFORM public.assert_can_manage_dashboard();

  SELECT count(*), coalesce(string_agg(id, ' ' ORDER BY id), '-')
    INTO v_doc9_n, v_doc9_ids
    FROM public.rag_eval_questions
   WHERE bank_version IS NOT NULL AND source_hash IS NULL;

  SELECT coalesce(extract(day FROM now() - max(created_at))::int, 999),
         coalesce(max(created_at)::date::text, 'nooit')
    INTO v_doc10_age, v_doc10_last
    FROM public.rag_eval_runs
   WHERE status = 'done' AND (label LIKE 'weekly%' OR label = 'cron-weekly');

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

  -- ── DOC-13 · weekronde grotendeels infra-falen (poort P5b) ────────────────
  WITH latest AS (
    SELECT id, label, created_at
      FROM public.rag_eval_runs
     WHERE status = 'done' AND (label LIKE 'weekly%' OR label = 'cron-weekly')
     ORDER BY created_at DESC LIMIT 1
  ), s AS (
    SELECT count(*)::int AS n,
           count(*) FILTER (
             WHERE res.assert_detail::text ~ 'rag-chat_failed status=5'
                OR res.assert_detail::text LIKE '%provider_error%'
           )::int AS n_infra
      FROM public.rag_eval_results res
     WHERE res.run_id = (SELECT id FROM latest)
  )
  SELECT CASE
           WHEN coalesce((SELECT n FROM s), 0) < 50 THEN 0
           WHEN (SELECT n_infra FROM s)::float / nullif((SELECT n FROM s), 0) >= 0.25 THEN 1
           ELSE 0
         END,
         coalesce((SELECT n FROM s), 0),
         coalesce((SELECT n_infra FROM s), 0),
         coalesce((SELECT label || ' · ' || created_at::date::text FROM latest), 'geen weekronde')
    INTO v_doc13_fail, v_doc13_n, v_doc13_infra, v_doc13_label;

  SELECT coalesce(extract(day FROM now() - max(confluence_updated_at))::int, 999),
         coalesce(max(confluence_updated_at)::date::text, 'nooit')
    INTO v_audit_age, v_audit_last
    FROM public.confluence_pages
   WHERE parent_id = '445841410' AND coalesce(is_archived, false) = false;

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

  IF v_doc13_fail > 0 THEN
    v_kandidaten := v_kandidaten || jsonb_build_array(jsonb_build_object(
      'obj', 'docs/agent:DOC-13', 'sev', 'medium',
      'title', format('Weekronde grotendeels infra-falen (%s/%s)', v_doc13_infra, v_doc13_n),
      'detail', format(
        'DOC-13 (poort P5b, niet blokkerend). Jongste weekronde %s: %s van %s resultaatrijen zijn '
        'infra-falen (5xx of provider_error, drempel 25 %% bij ≥ 50 rijen). DOC-10 blijft groen omdat er '
        'wél een runrij is — deze controle voorkomt dat een creditstoring als "cadans OK" wordt gelezen. '
        'Herstel: OpenAI-credits / upstream; conclusies uit die ronde niet als bankschuld boeken.',
        v_doc13_label, v_doc13_infra, v_doc13_n)));
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
    'doc13', jsonb_build_object('fail', v_doc13_fail,
                                'n', v_doc13_n,
                                'n_infra', v_doc13_infra,
                                'label', v_doc13_label),
    'audit', jsonb_build_object('leeftijd_dagen', v_audit_age, 'laatste', v_audit_last),
    'kandidaten', jsonb_array_length(v_kandidaten),
    'findings', v_geschreven);
END $function$;

COMMENT ON FUNCTION public.agent_docs_staleness_check(integer) IS
  'Spoor 07 item 4 (+ item 7 + DOC-13) — dagelijks via cron agent-docs-guard. Controles met exact de SQL van scripts/agent_docs_audit.cjs: DOC-9 (bankitem zonder source_hash, high), DOC-10 (weekronde ouder dan p_stale_days), DOC-11 (weekvuring zonder runrij, 30 d), DOC-12 (blijvend rood zonder geldige "rood sinds"), DOC-13 (jongste weekronde ≥25 % infra-falen bij ≥50 rijen — DOC-10 blijft groen bij een onbruikbare ronde), plus auditrapport onder Confluence 445841410. Schrijft security_findings (scan_type docs_guard), rapport-only, dedup op open rij.';

REVOKE ALL ON FUNCTION public.agent_docs_staleness_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_docs_staleness_check(integer) TO service_role;
