-- =====================================================================
-- strip_concepts_infra_drop_2026_09_02.sql
-- =====================================================================
-- Infra-kant van de concept-strip v1.135 (PR #37 haalde de app-kant weg).
-- Verwijdert het DB-oppervlak van Kilometerregistratie, Road Notes
-- (sales-on-road) en LinkedIn.
--
-- Volgorde is dwingend (zie /workspace/security/STRIP-CONCEPTS.md §4c):
--   1. schedules uit + weg   — anders vuurt kilometerregistratie op de 2e
--   2. dependents herschrijven — agent_outputs_v1_view draagt óók
--      daily-admin / auto-draft / taken / jellemind. NOOIT CASCADE.
--   3. pas dan droppen
--   4. secrets_inventory-rij opruimen
--
-- Vault-secret `skill:global:google_maps_api_key` blijft staan: alleen de
-- inventaris-rij gaat weg, het secret zelf trekt Jelle handmatig in.
--
-- Data-backup van km_distances + km_location_aliases (71 + 9 rijen):
--   /workspace/security/km-backup.sql
--
-- Idempotent: alles is `if exists` / `create or replace`.
-- =====================================================================

begin;

-- =====================================================================
-- 1. Schedules eerst uit, dan weg
-- =====================================================================

update agent_schedules
   set enabled = false
 where agent_name in ('kilometerregistratie','linkedin-connect',
                      'sales-on-road','legal-ai-linkedin-draft');

delete from agent_schedules
 where agent_name in ('kilometerregistratie','linkedin-connect',
                      'sales-on-road','legal-ai-linkedin-draft');

-- =====================================================================
-- 2a. agent_outputs_v1_view — zonder de sales-on-road UNION-tak
-- =====================================================================
-- security_invoker=on blijft staan (RLS van de lezer, niet van de owner).
-- create or replace behoudt grants; drop+create zou ze weggooien.

create or replace view public.agent_outputs_v1_view
with (security_invoker = on) as
 SELECT 'daily-admin'::text AS agent_name,
    'agent_proposals'::text AS output_table,
    ap.id::text AS output_id,
    ap.status AS state,
    COALESCE(ap.subject, ap.summary) AS subject,
    ap.created_at,
    COALESCE(ap.reviewed_at, ap.created_at) AS last_state_at,
    ap.reviewed_at,
    EXTRACT(epoch FROM now() - ap.created_at) / 86400.0 AS age_days
   FROM agent_proposals ap
UNION ALL
 SELECT 'auto-draft'::text AS agent_name,
    'autodraft_mails'::text AS output_table,
    am.id::text AS output_id,
    am.status AS state,
    am.subject,
    COALESCE(am.scanned_at, am.received_at) AS created_at,
    am.updated_at AS last_state_at,
        CASE
            WHEN am.status = ANY (ARRAY['sent'::text, 'ignored'::text, 'amended'::text]) THEN am.updated_at
            ELSE NULL::timestamp with time zone
        END AS reviewed_at,
    EXTRACT(epoch FROM now() - COALESCE(am.scanned_at, am.received_at)) / 86400.0 AS age_days
   FROM autodraft_mails am
UNION ALL
 SELECT 'taken'::text AS agent_name,
    'tasks'::text AS output_table,
    t.id::text AS output_id,
    t.status AS state,
    t.title AS subject,
    t.created_at,
    t.updated_at AS last_state_at,
    t.completed_at AS reviewed_at,
    EXTRACT(epoch FROM now() - t.created_at) / 86400.0 AS age_days
   FROM tasks t
UNION ALL
 SELECT 'jellemind'::text AS agent_name,
    'jellemind_lesson_proposals'::text AS output_table,
    jlp.id::text AS output_id,
    jlp.status AS state,
    "left"(jlp.lesson_text, 200) AS subject,
    jlp.created_at,
    COALESCE(jlp.reviewed_at, jlp.created_at) AS last_state_at,
    jlp.reviewed_at,
    EXTRACT(epoch FROM now() - jlp.created_at) / 86400.0 AS age_days
   FROM jellemind_lesson_proposals jlp;

comment on view public.agent_outputs_v1_view is
  'Verenigd overzicht van agent outputs voor dashboard. sales-followups branch verwijderd 2026-05-20 (gemerged in taken-skill, output naar tasks tabel). sales-on-road branch verwijderd 2026-09-02 (concept gestript, v1.135).';

-- =====================================================================
-- 2b. harvest_and_cluster_jellemind() — zonder sales_on_road-signaal
-- =====================================================================
-- Bron 1e ("note_rewritten" uit sales_on_road_events) vervalt; die tabel
-- bestaat na stap 3 niet meer. De sleutel `harvest.note_rewritten` valt
-- daarmee uit de return-jsonb.

create or replace function public.harvest_and_cluster_jellemind(p_window_hours integer DEFAULT 24, p_max_signals_first_run integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_window_start timestamptz := now() - (p_window_hours || ' hours')::interval;
  v_inserted_autodraft int := 0;
  v_inserted_proposal int := 0;
  v_inserted_feedback int := 0;
  v_inserted_task int := 0;
  v_total_unprocessed int;
  v_candidates jsonb;
  v_n_unique_classes int := 0;
  v_n_clusters_min3 int := 0;
  v_result jsonb;
BEGIN
  perform public.assert_can_manage_dashboard();
  -- =========================================================================
  -- PASS 1 -- HARVEST
  -- =========================================================================

  -- 1a. Mail-amendments from autodraft_decisions
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'autodraft_amended',
      'auto-draft',
      'autodraft_decisions',
      d.id::text,
      d.source_draft_body,
      d.final_body,
      left(coalesce(
        nullif(d.amend_instructions, ''),
        case
          when length(d.final_body) < 0.7 * length(d.source_draft_body) then 'Jelle verkortte de tekst.'
          when length(d.final_body) > 1.4 * length(d.source_draft_body) then 'Jelle breidde de tekst uit.'
          else 'Jelle paste mail-tekst aan.'
        end
      ), 120),
      d.decided_at
    FROM autodraft_decisions d
    WHERE d.action = 'amend'
      AND d.decided_at >= v_window_start
      AND d.source_draft_body IS NOT NULL
      AND d.final_body IS NOT NULL
      AND d.source_draft_body <> d.final_body
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_autodraft FROM ins;

  -- 1b. Proposal-amendments from agent_proposals
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'proposal_amended',
      coalesce(p.agent_name, 'unknown'),
      'agent_proposals',
      p.id::text,
      coalesce(p.summary, '') || E'\n' || coalesce(p.proposal::text, ''),
      p.amendment,
      left('Jelle paste voorstel aan ('|| coalesce(p.agent_name,'agent') ||').', 120),
      p.reviewed_at
    FROM agent_proposals p
    WHERE p.status = 'amended'
      AND p.reviewed_at >= v_window_start
      AND p.amendment IS NOT NULL
      AND length(p.amendment) > 0
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_proposal FROM ins;

  -- 1c. Direct feedback from agent_feedback
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'direct_feedback',
      coalesce(f.source, 'unknown'),
      'agent_feedback',
      f.id::text,
      NULL,
      f.feedback_text,
      left(f.feedback_text, 120),
      f.created_at
    FROM agent_feedback f
    WHERE f.status = 'unprocessed'
      AND f.created_at >= v_window_start
      AND f.feedback_text IS NOT NULL
      AND length(f.feedback_text) > 0
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_feedback FROM ins;

  -- Mark harvested feedback as processed
  UPDATE agent_feedback
     SET status = 'processed', processed_at = now()
   WHERE status = 'unprocessed'
     AND created_at >= v_window_start
     AND feedback_text IS NOT NULL;

  -- 1d. Task-edits (where Jelle edited after AI processing)
  WITH ins AS (
    INSERT INTO jellemind_signals (
      signal_type, agent_name, source_table, source_id,
      before_text, after_text, delta_summary, occurred_at
    )
    SELECT
      'task_edited',
      'task-organizer',
      'tasks',
      t.id::text,
      coalesce(t.ai_reasoning, ''),
      '[user edited project/priority/deadline after AI assignment]',
      'Jelle paste taak aan na AI-keuze.',
      t.updated_at
    FROM tasks t
    WHERE t.ai_processed = true
      AND t.ai_last_review IS NOT NULL
      AND t.updated_at > t.ai_last_review + interval '5 minutes'
      AND t.updated_at >= v_window_start
    ON CONFLICT (signal_type, source_table, source_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted_task FROM ins;

  -- 1e. (vervallen 2026-09-02) sales-on-road note rewrites -- concept gestript in v1.135.

  -- =========================================================================
  -- PASS 2 -- CLUSTER (rule-based)
  -- =========================================================================

  -- Hard cap: if too many unprocessed signals, only take top 200 most recent
  SELECT count(*) INTO v_total_unprocessed
    FROM jellemind_signals
   WHERE processed = false
     AND harvested_at >= now() - interval '14 days';

  -- Build candidates per rule class
  WITH workset AS (
    SELECT
      id,
      signal_type,
      agent_name,
      coalesce(before_text,'') AS before_text,
      coalesce(after_text,'') AS after_text,
      coalesce(delta_summary,'') AS delta_summary,
      occurred_at
    FROM jellemind_signals
    WHERE processed = false
      AND harvested_at >= now() - interval '14 days'
    ORDER BY occurred_at DESC
    LIMIT p_max_signals_first_run
  ),
  classified AS (
    SELECT
      w.*,
      ARRAY(
        SELECT cls FROM (VALUES
          (
            'pronoun_je_vs_u',
            (w.before_text ~ '\m[Uu]\M' OR w.before_text ~ '\m[Uu]w\M')
              AND (w.after_text ~ '\m[Jj]e\M' OR w.after_text ~ '\m[Jj]ouw\M')
            OR
            (w.before_text ~ '\m[Jj]e\M' OR w.before_text ~ '\m[Jj]ouw\M')
              AND (w.after_text ~ '\m[Uu]\M' OR w.after_text ~ '\m[Uu]w\M')
          ),
          (
            'length_shorter',
            length(w.after_text) > 0
              AND length(w.before_text) > 0
              AND length(w.after_text) < 0.7 * length(w.before_text)
          ),
          (
            'length_longer',
            length(w.after_text) > 0
              AND length(w.before_text) > 0
              AND length(w.after_text) > 1.4 * length(w.before_text)
          ),
          (
            'formal_to_casual',
            (w.before_text ~* '\m(geachte|hooggeachte|met vriendelijke groet)\M')
              AND (w.after_text ~* '\m(hoi|hey|hallo|groet|groetjes)\M')
          ),
          (
            'casual_to_formal',
            (w.before_text ~* '\m(hoi|hey|hallo|groetjes)\M')
              AND (w.after_text ~* '\m(geachte|met vriendelijke groet|hartelijke groet)\M')
          ),
          (
            'deadline_added',
            w.after_text ~ '\m[0-9]{1,2}[-/][0-9]{1,2}'
              AND w.before_text !~ '\m[0-9]{1,2}[-/][0-9]{1,2}'
          )
        ) AS t(cls, hit)
        WHERE t.hit
      ) AS rule_classes
    FROM workset w
  ),
  exploded AS (
    -- One row per (signal, rule_class)
    SELECT c.id, c.signal_type, c.agent_name, c.before_text, c.after_text, c.delta_summary, c.occurred_at,
           unnest(c.rule_classes) AS rule_class
    FROM classified c
    WHERE array_length(c.rule_classes, 1) IS NOT NULL
    UNION ALL
    -- Signals without any rule class get 'unclassified'
    SELECT c.id, c.signal_type, c.agent_name, c.before_text, c.after_text, c.delta_summary, c.occurred_at,
           'unclassified' AS rule_class
    FROM classified c
    WHERE array_length(c.rule_classes, 1) IS NULL
  ),
  grouped AS (
    SELECT
      rule_class,
      count(*) AS n_signals,
      array_agg(DISTINCT agent_name) AS agent_names,
      array_agg(id ORDER BY occurred_at DESC) AS signal_ids,
      array_agg(
        DISTINCT left(
          coalesce(nullif(delta_summary,''), left(coalesce(after_text, before_text), 100)),
          120
        )
      ) FILTER (WHERE delta_summary IS NOT NULL OR after_text IS NOT NULL OR before_text IS NOT NULL) AS evidence_fragments,
      min(occurred_at) AS first_at,
      max(occurred_at) AS last_at
    FROM exploded
    WHERE rule_class <> 'unclassified'
    GROUP BY rule_class
  )
  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'rule_class', rule_class,
        'n_signals', n_signals,
        'agent_names', to_jsonb(agent_names),
        'signal_ids', to_jsonb(signal_ids),
        'evidence_fragments', to_jsonb(evidence_fragments[1:5]),
        'first_at', first_at,
        'last_at', last_at
      )
      ORDER BY n_signals DESC, last_at DESC
    ), '[]'::jsonb),
    count(*) FILTER (WHERE n_signals >= 3),
    count(*)
  INTO v_candidates, v_n_clusters_min3, v_n_unique_classes
  FROM grouped;

  -- =========================================================================
  -- BUILD RESULT
  -- =========================================================================

  v_result := jsonb_build_object(
    'harvest', jsonb_build_object(
      'autodraft_amended', v_inserted_autodraft,
      'proposal_amended', v_inserted_proposal,
      'direct_feedback', v_inserted_feedback,
      'task_edited', v_inserted_task,
      'total_new_signals',
        v_inserted_autodraft + v_inserted_proposal + v_inserted_feedback +
        v_inserted_task
    ),
    'cluster', jsonb_build_object(
      'unprocessed_signals_in_window', v_total_unprocessed,
      'unique_rule_classes', coalesce(v_n_unique_classes, 0),
      'clusters_with_min_3', coalesce(v_n_clusters_min3, 0)
    ),
    'candidates', v_candidates,
    'window', jsonb_build_object(
      'harvest_from', v_window_start,
      'harvest_to', now()
    )
  );

  RETURN v_result;
END;
$function$;

-- =====================================================================
-- 3. Pas nu droppen — geen CASCADE, de dependents zijn hierboven weg
-- =====================================================================

drop function if exists public.submit_km_trip(date, text, text, text, numeric, text);
drop function if exists public.submit_sales_on_road_note(text);

drop view if exists public.km_distances_lookup;

drop table if exists public.km_trips_inbox,
                     public.km_trips,
                     public.km_distances,
                     public.km_location_aliases,
                     public.km_distance_cache,
                     public.linkedin_activity_log,
                     public.linkedin_targets,
                     public.linkedin_strategy,
                     public.linkedin_progress,
                     public.legal_ai_linkedin_posts,
                     public.sales_on_road_inbox,
                     public.sales_on_road_events;

drop function if exists public.km_distances_set_updated_at();

-- =====================================================================
-- 4. secrets_inventory — google_maps_api_key was km-only
-- =====================================================================
-- used_by = {km-distance-lookup, "kilometerregistratie skill"}; beide weg.
-- Het Vault-secret skill:global:google_maps_api_key blijft bestaan.

delete from secrets_inventory
 where key_name = 'google_maps_api_key'
   and used_by <@ array['km-distance-lookup','kilometerregistratie skill'];

commit;
