-- =====================================================================
-- Database views consolidation — 2026-05-18
-- =====================================================================
-- Consolideert 6 zware client-side aggregaties in dashboard-hooks naar
-- views in Postgres. Resultaat: 60+ minder queries per minuut tijdens
-- normaal dashboard-gebruik + eenvoudiger hooks.
--
-- Zes nieuwe views (+ 1 materialized):
--   1. v_truth_of_sources          → 32 queries in useTruthOfSources → 1
--   2. v_nav_badges                → 8 queries in useNavBadges → 1
--   3. v_intelligence_hub_summary  → 5 queries in useIntelligenceHub → 1
--   4. v_context_bundles_cost      → per-dag token & cost aggregatie
--   5. v_chunks_per_record         → per-record chunks count
--   6. v_agent_runs_summary        → per-agent latest + week stats
--   7. v_hubspot_future_index      → MATERIALIZED — email→contact+company+deals
--
-- Idempotent (CREATE OR REPLACE). Grants aan authenticated.
-- RLS-erfenis: alle views erven RLS van underlying tabellen.
--
-- Toelichting + voor/na impact + frontend-refactor stappen:
--   ~/.claude/skills/database-manager/references/snippets-vs-views.md
--   ~/.claude/skills/database-manager/references/views.md §7
-- =====================================================================


-- =====================================================================
-- 1. v_truth_of_sources — alle truth-of-source counters in één view
-- =====================================================================
-- Bron: useTruthOfSources.js — was 32 queries per 30s poll. Eén view-read
-- vervangt 6 source-groups (mail / hubspot / jira / fireflies / calendar
-- / contactpersonen) elk met counts, embedded, last_sync, errors, byType.
--
-- Embedded-counts komen NIET hier — die zitten in v_chunks_per_record (5).

CREATE OR REPLACE VIEW public.v_truth_of_sources AS
WITH
mail_sync AS (
  SELECT
    coalesce(sum(total_messages_synced), 0)::bigint AS total_synced,
    max(last_delta_at)                              AS last_delta,
    count(*) FILTER (WHERE last_error IS NOT NULL)::int AS error_count,
    count(*)::int                                   AS folders_tracked
  FROM mail_sync_state
),
mail_backfill AS (
  SELECT
    count(*) FILTER (WHERE status = 'done')::int    AS done_buckets,
    count(*) FILTER (WHERE status = 'empty')::int   AS empty_buckets,
    count(*) FILTER (WHERE status = 'pending')::int AS pending_buckets,
    count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_buckets,
    count(*) FILTER (WHERE status = 'error')::int   AS error_buckets,
    count(*)::int                                   AS total_buckets
  FROM mail_backfill_state
)
SELECT
  'mail'::text                                            AS source,
  (SELECT count(*) FROM mail_messages WHERE NOT is_deleted)::bigint AS total,
  ms.last_delta                                           AS last_sync,
  ms.error_count,
  jsonb_build_object(
    'folders_tracked',     ms.folders_tracked,
    'backfill', jsonb_build_object(
      'total',       mb.total_buckets,
      'done',        mb.done_buckets,
      'empty',       mb.empty_buckets,
      'pending',     mb.pending_buckets,
      'in_progress', mb.in_progress_buckets,
      'error',       mb.error_buckets,
      'percent_complete', CASE WHEN mb.total_buckets > 0
                           THEN round((mb.done_buckets + mb.empty_buckets) * 100.0 / mb.total_buckets)
                           ELSE 0 END
    )
  ) AS extra
FROM mail_sync ms, mail_backfill mb

UNION ALL

SELECT
  'hubspot',
  (SELECT count(*) FROM hubspot_deals      WHERE NOT is_archived)
  + (SELECT count(*) FROM hubspot_companies WHERE NOT is_archived)
  + (SELECT count(*) FROM hubspot_contacts  WHERE NOT is_archived)
  + (SELECT count(*) FROM hubspot_engagements WHERE NOT is_archived),
  (SELECT last_delta_sync FROM hubspot_sync_state WHERE id = 1),
  (SELECT count(*) FILTER (WHERE last_error IS NOT NULL)::int FROM hubspot_engagements_sync_state),
  jsonb_build_object(
    'deals',       (SELECT count(*) FROM hubspot_deals      WHERE NOT is_archived),
    'companies',   (SELECT count(*) FROM hubspot_companies  WHERE NOT is_archived),
    'contacts',    (SELECT count(*) FROM hubspot_contacts   WHERE NOT is_archived),
    'engagements', (SELECT count(*) FROM hubspot_engagements WHERE NOT is_archived),
    'engagements_by_type',
      (SELECT jsonb_object_agg(engagement_type, n) FROM
         (SELECT engagement_type, count(*) n FROM hubspot_engagements
            WHERE NOT is_archived AND engagement_type IS NOT NULL
            GROUP BY engagement_type) t)
  )

UNION ALL

SELECT
  'jira',
  (SELECT count(*) FROM jira_issues WHERE NOT is_deleted),
  (SELECT last_delta_sync FROM jira_sync_state WHERE id = 1),
  0,
  jsonb_build_object(
    'issues',   (SELECT count(*) FROM jira_issues WHERE NOT is_deleted),
    'projects', (SELECT count(*) FROM jira_projects)
  )

UNION ALL

SELECT
  'fireflies',
  (SELECT count(*) FROM fireflies_meetings),
  (SELECT last_delta_sync_at FROM fireflies_sync_state WHERE id = 1),
  0,
  jsonb_build_object(
    'meetings',          (SELECT count(*) FROM fireflies_meetings),
    'action_items_total', (SELECT count(*) FROM fireflies_action_items),
    'jelle_open',
       (SELECT count(*) FROM fireflies_action_items
          WHERE is_for_jelle AND processed_at IS NULL),
    'jelle_total',
       (SELECT count(*) FROM fireflies_action_items WHERE is_for_jelle)
  )

UNION ALL

SELECT
  'calendar',
  (SELECT count(*) FROM calendar_events WHERE NOT is_deleted),
  (SELECT last_delta_sync_at FROM calendar_sync_state WHERE id = 1),
  0,
  jsonb_build_object(
    'events',               (SELECT count(*) FROM calendar_events WHERE NOT is_deleted),
    'active',               (SELECT count(*) FROM calendar_events
                              WHERE NOT is_deleted AND NOT is_cancelled),
    'attendees',            (SELECT count(*) FROM calendar_attendees),
    'linked_to_fireflies',  (SELECT count(*) FROM calendar_events
                              WHERE NOT is_deleted AND fireflies_meeting_id IS NOT NULL)
  )

UNION ALL

SELECT
  'contactpersonen',
  (SELECT count(*) FROM contactpersonen WHERE NOT is_deleted),
  (SELECT max(last_delta_sync) FROM contactpersonen_sync_state),
  (SELECT count(*) FILTER (WHERE last_error IS NOT NULL)::int FROM contactpersonen_sync_state),
  jsonb_build_object(
    'contacts',  (SELECT count(*) FROM contactpersonen WHERE NOT is_deleted),
    'firms',     (SELECT count(*) FROM firms WHERE NOT is_deleted),
    'unlinked',  (SELECT count(*) FROM contactpersonen
                   WHERE NOT is_deleted AND firm_id IS NULL),
    'by_type',
      (SELECT jsonb_object_agg(contact_type, n) FROM
         (SELECT contact_type, count(*) n FROM contactpersonen
            WHERE NOT is_deleted AND contact_type IS NOT NULL
            GROUP BY contact_type) t)
  )
;

COMMENT ON VIEW public.v_truth_of_sources IS
  'Per truth-of-source één rij met total + last_sync + error_count + extra (jsonb met breakdowns). Vervangt 32 queries in useTruthOfSources.js. Snapshot bevat live counts en delta-sync timestamps. Schrijver: geen (read-only). Lezer: dashboard NowView Database-strip + agent-manager health-check.';

GRANT SELECT ON public.v_truth_of_sources TO authenticated;
-- Geen anon-grant: bevat exacte rij-counts die als reconnaissance kunnen dienen.


-- =====================================================================
-- 2. v_nav_badges — alle sidebar-counts in één view
-- =====================================================================
-- Vervangt 8 queries in useNavBadges.js. Sidebar polt élke 2 min;
-- realtime listeners op de 8 source-tabellen triggeren refetch.

CREATE OR REPLACE VIEW public.v_nav_badges AS
SELECT
  (SELECT count(*) FROM agent_proposals
     WHERE agent_name = 'daily-admin' AND status IN ('pending','amended'))::int
     AS admin_pending,
  (SELECT count(*) FROM sales_on_road_events
     WHERE status = 'needs_review')::int
     AS sales_needs_review,
  (SELECT count(*) FROM agent_chat_messages
     WHERE status = 'pending' AND author = 'user')::int
     AS chat_pending,
  (SELECT count(*) FROM tasks
     WHERE status IN ('open','snoozed','blocked'))::int
     AS tasks_open,
  (SELECT count(*) FROM autodraft_category_proposals
     WHERE status = 'pending')::int
     AS autodraft_category_pending,
  (SELECT count(*) FROM autodraft_lesson_proposals
     WHERE status = 'pending')::int
     AS autodraft_lesson_pending,
  (SELECT count(*) FROM security_findings
     WHERE status = 'open' AND severity IN ('critical','high'))::int
     AS security_critical_high,
  (SELECT count(*) FROM autodraft_mails
     WHERE status = 'pending')::int
     AS autodraft_mails_pending,
  now()::timestamptz AS checked_at
;

COMMENT ON VIEW public.v_nav_badges IS
  'Eén-rij view met alle sidebar-badge counts. Vervangt 8 queries in useNavBadges.js. Lezer: App.jsx sidebar.';

GRANT SELECT ON public.v_nav_badges TO authenticated;


-- =====================================================================
-- 3. v_intelligence_hub_summary — RAG-hub aggregaten in één view
-- =====================================================================
-- Vervangt 5 queries + client-side aggregaties in useIntelligenceHub.js.
-- De cost-stats zitten in v_context_bundles_cost (volgende view).

CREATE OR REPLACE VIEW public.v_intelligence_hub_summary AS
SELECT
  (SELECT jsonb_agg(jsonb_build_object('source', source, 'total', n)
                    ORDER BY n DESC)
     FROM (SELECT source, count(*) AS n FROM chunks GROUP BY source) s
  ) AS chunks_per_source,
  (SELECT count(*) FROM chunks)::bigint AS chunks_total,
  (SELECT jsonb_build_object(
     'total', count(*),
     'by_outcome', jsonb_object_agg(coalesce(outcome, 'pending'), n),
     'avg_chunks', round(avg(total_chunks)::numeric, 2)
   )
   FROM (SELECT outcome, total_chunks, 1 AS n FROM rag_outcomes) o
  ) AS outcomes_summary,
  (SELECT count(*) FROM v_entity_edges_full)::bigint AS edges_count,
  (SELECT count(*) FROM entity_resolution)::bigint AS resolutions_count,
  now()::timestamptz AS checked_at
;

COMMENT ON VIEW public.v_intelligence_hub_summary IS
  'Aggregaten voor Intelligence Hub view. Vervangt 5 queries in useIntelligenceHub.js. Lezer: IntelligenceHubView.';

GRANT SELECT ON public.v_intelligence_hub_summary TO authenticated;


-- =====================================================================
-- 4. v_context_bundles_cost — per-dag token & cost aggregatie
-- =====================================================================
-- Vervangt 2000-row scan + client-side reduce in useIntelligenceHub.js.
-- Cost-rate is hier DB-bewaakt; aanpassen via migration ipv React-redeploy.

CREATE OR REPLACE VIEW public.v_context_bundles_cost AS
SELECT
  date_trunc('day', created_at)::date AS day,
  intent,
  audience,
  count(*)::int                       AS calls,
  sum(tokens_used)::bigint            AS tokens,
  -- text-embedding-3-large: $0.13 per 1M tokens, EUR ≈ $ × 0.93
  round((sum(tokens_used) * 0.13 / 1000000.0 * 0.93)::numeric, 4) AS eur_cost,
  round(avg(build_ms)::numeric, 0)::int AS avg_build_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY build_ms)::int AS p95_build_ms,
  count(*) FILTER (WHERE total_chunks = 0)::int AS zero_chunk_calls,
  count(*) FILTER (WHERE avg_top_similarity < 0.5)::int AS low_similarity_calls
FROM context_bundles
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, intent
;

COMMENT ON VIEW public.v_context_bundles_cost IS
  'Per-dag x intent x audience: token-cost, build-ms, kwaliteit-signalen. Cost-rate text-embedding-3-large: $0.13/1M tokens × EUR-conversie 0.93. Pas hier aan bij prijs-wijziging — niet in React.';

GRANT SELECT ON public.v_context_bundles_cost TO authenticated;


-- =====================================================================
-- 5. v_chunks_per_record — per-record embedding telling
-- =====================================================================
-- Eén view voor "hoeveel chunks heeft dit deal/mail/contact". Vervangt N
-- separate count-queries in dashboard-kaarten. Geïndexeerd via chunks-tabel's
-- bestaande (source, source_id) btree-index.

CREATE OR REPLACE VIEW public.v_chunks_per_record AS
SELECT
  source,
  source_id,
  count(*)::int                                                    AS chunk_count,
  count(*) FILTER (WHERE chunk_type = 'primary')::int              AS primary_chunks,
  count(*) FILTER (WHERE chunk_type = 'detail')::int               AS detail_chunks,
  count(*) FILTER (WHERE chunk_type = 'fact')::int                 AS fact_chunks,
  max(embedded_at)                                                 AS last_embedded,
  array_agg(DISTINCT fact_type) FILTER (WHERE fact_type IS NOT NULL) AS fact_types,
  array_agg(DISTINCT primary_entity_id) FILTER (WHERE primary_entity_id IS NOT NULL) AS entity_ids
FROM chunks
GROUP BY source, source_id
;

COMMENT ON VIEW public.v_chunks_per_record IS
  'Per (source, source_id) totaalbeeld van chunks. Vervangt losse count-queries in dashboard record-kaarten. Voor batch-lookups: gebruik .in("source_id", [...]).';

GRANT SELECT ON public.v_chunks_per_record TO authenticated;


-- =====================================================================
-- 6. v_agent_runs_summary — per agent latest + week stats
-- =====================================================================
-- Vervangt deel van useAgents.js client-side derive. Latest run + 7d/14d
-- counters + huidige schedule, allemaal pre-aggregated.

CREATE OR REPLACE VIEW public.v_agent_runs_summary AS
WITH latest AS (
  SELECT DISTINCT ON (agent_name)
    agent_name, status, summary, stats, errors,
    started_at, completed_at,
    extract(epoch FROM (completed_at - started_at))::int AS duration_s
  FROM agent_runs
  ORDER BY agent_name, started_at DESC
),
counts AS (
  SELECT
    agent_name,
    count(*) FILTER (WHERE started_at >= date_trunc('week', now()))::int
      AS week_runs,
    count(*) FILTER (
      WHERE started_at >= date_trunc('week', now()) - interval '7 days'
        AND started_at <  date_trunc('week', now())
    )::int AS last_week_runs,
    count(*) FILTER (WHERE started_at >= now() - interval '14 days' AND status = 'success')::int
      AS success_14d,
    count(*) FILTER (WHERE started_at >= now() - interval '14 days' AND status = 'error')::int
      AS error_14d,
    count(*) FILTER (WHERE started_at >= now() - interval '14 days' AND status = 'warning')::int
      AS warning_14d
  FROM agent_runs
  WHERE started_at >= now() - interval '14 days'
  GROUP BY agent_name
)
SELECT
  s.agent_name,
  s.display_name,
  s.cron_expression,
  s.enabled,
  s.is_running,
  s.tier,
  s.show_in_overview,
  s.last_run_at,
  s.next_run_at,
  s.manual_run_requested_at,
  l.status      AS last_status,
  l.summary     AS last_summary,
  l.stats       AS last_stats,
  l.errors      AS last_errors,
  l.started_at  AS last_started_at,
  l.completed_at AS last_completed_at,
  l.duration_s  AS last_duration_s,
  coalesce(c.week_runs, 0)      AS week_runs,
  coalesce(c.last_week_runs, 0) AS last_week_runs,
  coalesce(c.success_14d, 0)    AS success_14d,
  coalesce(c.error_14d, 0)      AS error_14d,
  coalesce(c.warning_14d, 0)    AS warning_14d
FROM agent_schedules s
LEFT JOIN latest l ON l.agent_name = s.agent_name
LEFT JOIN counts c ON c.agent_name = s.agent_name
ORDER BY s.tier NULLS LAST, s.agent_name
;

COMMENT ON VIEW public.v_agent_runs_summary IS
  'Per agent: schedule + laatste run + 14d success/error/warning counts. Vervangt deel van deriveAgentsState in useAgents.js. Lezer: dashboard NowView + Health-pagina + agent-manager.';

GRANT SELECT ON public.v_agent_runs_summary TO authenticated;


-- =====================================================================
-- 7. v_hubspot_future_index — MATERIALIZED — email→contact+company+deals
-- =====================================================================
-- Vervangt 5 queries-per-email in useHubspotFutureIndex.js (Daily Admin
-- Toekomst-tab). Wordt elke 15 min ververst via cron na hubspot-sync.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.v_hubspot_future_index AS
SELECT
  lower(c.email)                                AS email_key,
  split_part(lower(c.email), '@', 2)            AS domain_key,
  c.contact_id,
  c.firstname,
  c.lastname,
  c.jobtitle,
  c.lifecyclestage                              AS contact_lifecycle,
  comp.company_id,
  comp.name                                     AS company_name,
  comp.domain                                   AS company_domain,
  comp.industry,
  comp.num_employees,
  comp.lifecyclestage                           AS company_lifecycle,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'deal_id',      d.deal_id,
      'dealname',     d.dealname,
      'dealstage',    d.dealstage,
      'pipeline_id',  d.pipeline_id,
      'amount',       d.amount,
      'closedate',    d.closedate,
      'kennismaking_datum',
        (SELECT kennismaking_datum FROM hubspot_deal_property_cache
           WHERE deal_id = d.deal_id)
    ) ORDER BY d.hs_lastmodifieddate DESC)
    FROM hubspot_deals d
    WHERE NOT d.is_archived
      AND (c.contact_id = ANY(d.associated_contact_ids)
           OR (comp.company_id IS NOT NULL AND comp.company_id = ANY(d.associated_company_ids)))
  )                                             AS deals
FROM hubspot_contacts c
LEFT JOIN hubspot_companies comp ON comp.company_id = c.associated_company_id
WHERE NOT c.is_archived
  AND c.email IS NOT NULL
;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v_hubspot_future_index_email_key
  ON public.v_hubspot_future_index (email_key)
  WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v_hubspot_future_index_domain_key
  ON public.v_hubspot_future_index (domain_key)
  WHERE domain_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_v_hubspot_future_index_company_id
  ON public.v_hubspot_future_index (company_id)
  WHERE company_id IS NOT NULL;

COMMENT ON MATERIALIZED VIEW public.v_hubspot_future_index IS
  'Email → contact + company + deals lookup voor Daily Admin Toekomst-tab. MATERIALIZED, refresh elke 15 min na hubspot-sync. Vervangt 5 queries per email in useHubspotFutureIndex.js.';

GRANT SELECT ON public.v_hubspot_future_index TO authenticated;


-- =====================================================================
-- 7b. Refresh-cron voor v_hubspot_future_index (idempotent)
-- =====================================================================
-- 5 min na hubspot-sync (cron quarter-marks) ververs de materialized view.
-- CONCURRENTLY zodat queries niet blokkeren.

DO $$
BEGIN
  -- Verwijder oude job als hij bestaat (idempotent re-run)
  PERFORM cron.unschedule(jobname)
    FROM cron.job
   WHERE jobname = 'refresh-hubspot-future-index';

  -- Plan opnieuw
  PERFORM cron.schedule(
    'refresh-hubspot-future-index',
    '5,20,35,50 * * * *',
    $cron$
      REFRESH MATERIALIZED VIEW CONCURRENTLY public.v_hubspot_future_index;
    $cron$
  );
END $$;


-- =====================================================================
-- Validatie — draai dit handmatig na deploy
-- =====================================================================
--
-- 1. Plan-check (mag niet uitvallen):
--    EXPLAIN ANALYZE SELECT * FROM v_truth_of_sources;
--    EXPLAIN ANALYZE SELECT * FROM v_nav_badges;
--    EXPLAIN ANALYZE SELECT * FROM v_intelligence_hub_summary;
--    EXPLAIN ANALYZE SELECT * FROM v_context_bundles_cost LIMIT 10;
--    EXPLAIN ANALYZE SELECT * FROM v_chunks_per_record WHERE source='mail' LIMIT 5;
--    EXPLAIN ANALYZE SELECT * FROM v_agent_runs_summary;
--    EXPLAIN ANALYZE SELECT * FROM v_hubspot_future_index WHERE email_key = 'test@example.com';
--
-- 2. Eerste populatie van materialized view:
--    REFRESH MATERIALIZED VIEW public.v_hubspot_future_index;
--
-- 3. Permissie-check:
--    SET ROLE authenticated;  -- als je dat kan; anders dashboard openen
--    SELECT * FROM v_truth_of_sources;  -- mag werken
--    RESET ROLE;
--
-- 4. Frontend refactor pas mergen NA validatie + na pull-rag-rpcs.sh
--    snapshot in dezelfde PR.
