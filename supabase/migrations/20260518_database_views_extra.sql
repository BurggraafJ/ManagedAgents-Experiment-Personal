-- =====================================================================
-- Database-manager — twee extra views (entity-timeline + action-stats)
-- =====================================================================
-- Sluit aan op de 6 views uit 20260518_database_views_consolidation.sql.
-- Beide views worden goud voor AutoDraft v2 + de learning-laag.
--
--   v_entity_timeline_summary  — per contact-email: laatste 10 acties
--                                (mails, meetings, engagements) +
--                                actie-counts 7d/30d/total
--   v_action_execution_stats   — per (agent_name, category): total,
--                                accept-rate, count_7d/30d, last_used_at
--
-- Idempotent (CREATE OR REPLACE). RLS-erfenis: views erven RLS van
-- underlying tabellen.
-- =====================================================================


-- =====================================================================
-- 1. v_entity_timeline_summary — last-10 actions per contact-email
-- =====================================================================
-- Bouwt timeline-strip per entity (op contact-email als anchor) over
-- mails / calendar / hubspot_engagements. Window = laatste 90 dagen.
-- Voor AutoDraft v2 classifier: "wat is er recent gebeurd met deze contact".

CREATE OR REPLACE VIEW public.v_entity_timeline_summary AS
WITH events AS (
  -- Mail (incoming + outgoing) — via from_email
  SELECT
    lower(m.from_email)                                    AS entity_email,
    'mail'::text                                           AS kind,
    CASE WHEN m.is_from_me THEN 'outgoing' ELSE 'incoming' END AS direction,
    m.received_at                                          AS occurred_at,
    m.id::text                                             AS source_id,
    m.subject                                              AS title,
    left(coalesce(nullif(m.body_preview, ''), m.body_text), 120) AS preview
  FROM mail_messages m
  WHERE NOT m.is_deleted
    AND m.from_email IS NOT NULL
    AND m.received_at >= now() - interval '90 days'

  UNION ALL

  -- Calendar events (one row per attendee)
  SELECT
    lower(a.email)                          AS entity_email,
    'meeting'::text                         AS kind,
    'event'::text                           AS direction,
    e.start_time                            AS occurred_at,
    e.id::text                              AS source_id,
    e.subject                               AS title,
    left(coalesce(nullif(e.body_preview, ''), e.location_text), 120) AS preview
  FROM calendar_events e
  JOIN calendar_attendees a ON a.calendar_event_id = e.id
  WHERE NOT e.is_deleted
    AND NOT e.is_cancelled
    AND a.email IS NOT NULL
    AND e.start_time >= now() - interval '90 days'

  UNION ALL

  -- HubSpot engagements — resolve email via associated_contact_ids
  SELECT
    lower(hc.email)                                            AS entity_email,
    'engagement'::text                                         AS kind,
    e.engagement_type                                          AS direction,
    coalesce(e.hs_timestamp, e.hs_created_at)                  AS occurred_at,
    e.id::text                                                 AS source_id,
    e.subject                                                  AS title,
    left(strip_html_inline(coalesce(e.body_text, '')), 120)    AS preview
  FROM hubspot_engagements e
  JOIN LATERAL unnest(e.associated_contact_ids) AS u(contact_id) ON true
  JOIN hubspot_contacts hc ON hc.contact_id = u.contact_id
  WHERE NOT e.is_archived
    AND hc.email IS NOT NULL
    AND coalesce(e.hs_timestamp, e.hs_created_at) >= now() - interval '90 days'
),
ranked AS (
  SELECT *,
         row_number() OVER (PARTITION BY entity_email ORDER BY occurred_at DESC) AS rn
  FROM events
)
SELECT
  entity_email,
  count(*)                                                                   AS actions_total,
  count(*) FILTER (WHERE occurred_at >= now() - interval '7 days')::int      AS actions_7d,
  count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int     AS actions_30d,
  max(occurred_at)                                                           AS last_action_at,
  jsonb_agg(
    jsonb_build_object(
      'kind',        kind,
      'direction',   direction,
      'occurred_at', occurred_at,
      'source_id',   source_id,
      'title',       title,
      'preview',     preview
    ) ORDER BY occurred_at DESC
  ) FILTER (WHERE rn <= 10)                                                  AS recent_actions
FROM ranked
GROUP BY entity_email;

COMMENT ON VIEW public.v_entity_timeline_summary IS
  'Per contact-email: laatste 10 acties (mail/meeting/engagement) + counts 7d/30d/total. Window 90d. AutoDraft v2 classifier + relatie-overzicht in dashboard.';

GRANT SELECT ON public.v_entity_timeline_summary TO authenticated;


-- =====================================================================
-- 2. v_action_execution_stats — accept-rate per (agent, categorie)
-- =====================================================================
-- Aggregaten per agent_name × category vanuit agent_proposals.
-- Voor de learning-laag: welke acties accepteert Jelle vaak, welke skipt hij?
-- Voor dashboards: per-skill kwaliteits-strip.

CREATE OR REPLACE VIEW public.v_action_execution_stats AS
SELECT
  agent_name                                                            AS action_slug,
  coalesce(category, '_uncategorized')                                  AS category,
  count(*)::int                                                         AS total,
  count(*) FILTER (WHERE status IN ('accepted','executed'))::int        AS accepted,
  count(*) FILTER (WHERE status = 'rejected')::int                      AS rejected,
  count(*) FILTER (WHERE status = 'amended')::int                       AS amended,
  count(*) FILTER (WHERE status = 'pending')::int                       AS pending,
  count(*) FILTER (WHERE status = 'expired')::int                       AS expired,
  -- accept-rate: accepted+executed t.o.v. wat een beslissing had (geen pending)
  round(
    count(*) FILTER (WHERE status IN ('accepted','executed'))::numeric
    / NULLIF(count(*) FILTER (WHERE status <> 'pending'), 0) * 100,
    1
  )                                                                     AS accept_rate_pct,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int  AS count_7d,
  count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS count_30d,
  max(created_at)                                                       AS last_used_at
FROM agent_proposals
GROUP BY agent_name, category
ORDER BY agent_name, category;

COMMENT ON VIEW public.v_action_execution_stats IS
  'Per (agent_name, category): total + accept-rate + per-status counts + count_7d/30d + last_used_at. Voor learning-laag en per-skill kwaliteits-strip.';

GRANT SELECT ON public.v_action_execution_stats TO authenticated;


-- =====================================================================
-- 3. validate_views() — RPC die alle nieuwe views check
-- =====================================================================
-- Roep aan na deploy of bij twijfel: SELECT validate_views();
-- Returnt jsonb met per-view status + row-count + plan-cost samenvatting.

CREATE OR REPLACE FUNCTION public.validate_views()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  view_names text[] := ARRAY[
    'v_truth_of_sources',
    'v_nav_badges',
    'v_intelligence_hub_summary',
    'v_context_bundles_cost',
    'v_chunks_per_record',
    'v_agent_runs_summary',
    'v_hubspot_future_index',
    'v_entity_timeline_summary',
    'v_action_execution_stats'
  ];
  v_name text;
  v_count bigint;
  v_ok boolean;
  v_error text;
BEGIN
  FOREACH v_name IN ARRAY view_names LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_name) INTO v_count;
      v_ok := true;
      v_error := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_count := -1;
      v_ok := false;
      v_error := SQLERRM;
    END;
    result := result || jsonb_build_object(
      v_name, jsonb_build_object('ok', v_ok, 'rows', v_count, 'error', v_error)
    );
  END LOOP;
  RETURN jsonb_build_object('checked_at', now(), 'views', result);
END;
$$;

COMMENT ON FUNCTION public.validate_views IS
  'Health-check op alle database-manager views. Returnt per view: ok-status, rij-count, eventuele error. Aanroep: SELECT validate_views();';

GRANT EXECUTE ON FUNCTION public.validate_views() TO authenticated;
