-- AutoDraft v3.0 — Fase 1+3+4+5: Router RPC + Briefing + Style + Cross-system
--
-- 1. resolve_action_from_metadata — deterministische action-router op basis
--    van mail_enrichment + autodraft_actions triggers. Skill roept dit aan
--    vóór Sonnet. Output: top-3 matches met confidence + tier + reasoning.
--
-- 2. get_inbox_briefing — dagstand voor Maestro home InboxBriefingCard.
--
-- 3. get_style_examples — laatste N verzonden mails van Jelle in (party,
--    lifecycle, topic)-cluster voor few-shot in Sonnet-prompt.
--
-- 4. get_thread_context — alle mails in conversation_id voor thread-aware
--    drafting. Beperkt tot recente N mails om token-budget te respecteren.
--
-- 5. get_cross_system_context — open Jira-issues + HubSpot deal-stage +
--    meeting-historie als one-block context voor draft.
--
-- 6. v_action_prior_per_cluster — Bayesian-stats per (party_type, lifecycle,
--    topic, speech_act, action_slug). Wordt input voor classifier-prompt.
--
-- 7. submit_action_decision update — accepteert nu `tier` + `metadata_match`
--    velden + zet undo_until bij autopilot.
--
-- IDEMPOTENT.

BEGIN;

-- ============================================================================
-- 1. RPC: resolve_action_from_metadata
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_action_from_metadata(
  p_mail_id text,
  p_max_results int DEFAULT 3
)
RETURNS TABLE (
  rank int,
  action_slug text,
  category text,
  display_name text,
  confidence numeric,
  tier text,
  autopilot_ok boolean,
  reasoning text,
  metadata_match jsonb
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_enr public.mail_enrichment%ROWTYPE;
  v_mail public.mail_messages%ROWTYPE;
BEGIN
  -- Mail + enrichment ophalen
  SELECT * INTO v_mail FROM public.mail_messages WHERE id = p_mail_id;
  IF NOT FOUND THEN
    RETURN;  -- mail bestaat niet
  END IF;

  SELECT * INTO v_enr FROM public.mail_enrichment WHERE mail_id = p_mail_id;
  IF NOT FOUND THEN
    RETURN;  -- geen enrichment = Sonnet aan zet (NULL = fallback)
  END IF;

  -- Per enabled action: score op trigger-match
  RETURN QUERY
  WITH scored AS (
    SELECT
      a.slug,
      a.category,
      a.display_name,
      a.autopilot_eligible,
      a.autopilot_enabled,
      a.autopilot_min_conf,
      a.oneclick_min_conf,
      -- Score per trigger-dimensie (0..1 elk)
      CASE WHEN a.speech_act_triggers = '{}' THEN 0.0
           WHEN v_enr.speech_act = ANY(a.speech_act_triggers) THEN 1.0
           ELSE -0.5  -- expliciete mismatch
      END AS s_speech,
      CASE WHEN a.topic_triggers = '{}' THEN 0.0
           WHEN v_enr.topics && a.topic_triggers THEN 1.0
           ELSE -0.3
      END AS s_topic,
      CASE WHEN a.lifecycle_triggers = '{}' THEN 0.0
           WHEN v_enr.party_lifecycle_at_moment = ANY(a.lifecycle_triggers) THEN 1.0
           ELSE -0.2
      END AS s_lifecycle,
      CASE WHEN a.party_type_triggers = '{}' THEN 0.0
           WHEN v_enr.party_type = ANY(a.party_type_triggers) THEN 1.0
           ELSE -0.3
      END AS s_party,
      CASE WHEN a.cycle_stage_triggers = '{}' THEN 0.0
           WHEN v_enr.cycle_stage_signal = ANY(a.cycle_stage_triggers) THEN 1.0
           ELSE -0.1
      END AS s_cycle,
      CASE WHEN a.sentiment_triggers = '{}' THEN 0.0
           WHEN v_enr.sentiment = ANY(a.sentiment_triggers) THEN 0.5
           ELSE -0.2
      END AS s_sentiment,
      jsonb_build_object(
        'speech_act',  CASE WHEN v_enr.speech_act = ANY(a.speech_act_triggers) THEN v_enr.speech_act ELSE NULL END,
        'topics',      CASE WHEN v_enr.topics && a.topic_triggers
                            THEN to_jsonb(ARRAY(SELECT unnest(v_enr.topics) INTERSECT SELECT unnest(a.topic_triggers))) ELSE NULL END,
        'party_type',  CASE WHEN v_enr.party_type = ANY(a.party_type_triggers) THEN v_enr.party_type ELSE NULL END,
        'lifecycle',   CASE WHEN v_enr.party_lifecycle_at_moment = ANY(a.lifecycle_triggers) THEN v_enr.party_lifecycle_at_moment ELSE NULL END,
        'cycle_stage', CASE WHEN v_enr.cycle_stage_signal = ANY(a.cycle_stage_triggers) THEN v_enr.cycle_stage_signal ELSE NULL END,
        'sentiment',   CASE WHEN v_enr.sentiment = ANY(a.sentiment_triggers) THEN v_enr.sentiment ELSE NULL END
      ) AS match_detail
    FROM public.autodraft_actions a
    WHERE a.enabled = true
  ),
  weighted AS (
    SELECT
      s.*,
      -- Weighted confidence (0..1). Speech_act + topic zijn primaire signalen.
      GREATEST(0.0, LEAST(1.0,
        (s_speech * 0.30) + (s_topic * 0.25) + (s_lifecycle * 0.15) +
        (s_party * 0.15) + (s_cycle * 0.10) + (s_sentiment * 0.05)
      )) AS conf
    FROM scored s
  ),
  ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (ORDER BY conf DESC, slug) AS rnk
    FROM weighted
    WHERE conf > 0.0
  )
  SELECT
    r.rnk::int AS rank,
    r.slug AS action_slug,
    r.category,
    r.display_name,
    ROUND(r.conf, 3) AS confidence,
    CASE
      WHEN r.conf >= r.autopilot_min_conf AND r.autopilot_eligible AND r.autopilot_enabled
        THEN 'autopilot'
      WHEN r.conf >= r.oneclick_min_conf
        THEN 'one-click'
      ELSE 'reasoned'
    END AS tier,
    (r.conf >= r.autopilot_min_conf AND r.autopilot_eligible AND r.autopilot_enabled) AS autopilot_ok,
    format('metadata-router: speech_act=%s, topics=%s, party=%s, lifecycle=%s, conf=%s',
      COALESCE(v_enr.speech_act, '?'),
      COALESCE(array_to_string(v_enr.topics, ','), '?'),
      COALESCE(v_enr.party_type, '?'),
      COALESCE(v_enr.party_lifecycle_at_moment, '?'),
      ROUND(r.conf, 2)::text
    ) AS reasoning,
    r.match_detail AS metadata_match
  FROM ranked r
  WHERE r.rnk <= p_max_results
  ORDER BY r.rnk;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_action_from_metadata(text, int) TO authenticated;

COMMENT ON FUNCTION public.resolve_action_from_metadata(text, int) IS
  'AutoDraft v3 metadata-router. Leest mail_enrichment voor mail_id en matcht tegen autodraft_actions triggers. Geeft top-N matches met confidence + tier + autopilot-eligibility terug. NULL als geen enrichment (Sonnet aan zet).';


-- ============================================================================
-- 2. RPC: get_inbox_briefing  (Maestro home dagstand)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_inbox_briefing(
  p_lookback_hours int DEFAULT 24,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_since timestamptz := now() - make_interval(hours => p_lookback_hours);
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error','no_user');
  END IF;

  WITH window_decisions AS (
    SELECT d.*
    FROM public.autodraft_action_decisions d
    WHERE d.user_id = v_user_id
      AND d.decided_at >= v_since
  ),
  tier_counts AS (
    SELECT
      COUNT(*) FILTER (WHERE tier = 'autopilot' AND outcome = 'autopilot') AS autopilot_done,
      COUNT(*) FILTER (WHERE tier = 'one-click' AND was_suggested = true AND outcome IS NULL) AS oneclick_waiting,
      COUNT(*) FILTER (WHERE tier = 'reasoned'  AND was_suggested = true AND outcome IS NULL) AS reasoned_waiting,
      COUNT(*) FILTER (WHERE outcome IN ('accept','amend')) AS user_acted
    FROM window_decisions
  ),
  hot_signals AS (
    -- Hot signal = mail in window with declared churn OR negative sentiment from customer
    SELECT
      m.id              AS mail_id,
      m.conversation_id,
      m.from_email,
      m.from_name,
      m.subject,
      m.received_at,
      e.party_type,
      e.party_lifecycle_at_moment,
      e.sentiment,
      e.cycle_stage_signal,
      e.signal_type,
      e.summary_one_line,
      e.topics,
      CASE
        WHEN e.cycle_stage_signal = 'churn_signal' AND e.signal_type = 'declared' THEN 'declared_churn'
        WHEN e.cycle_stage_signal = 'price_objection' AND e.signal_type = 'declared' THEN 'price_objection'
        WHEN e.sentiment IN ('negative','escalated') AND e.party_type IN ('customer','partner') THEN 'customer_negative'
        WHEN e.urgency = 'high' AND e.asks_response = true THEN 'urgent_request'
        ELSE NULL
      END AS signal_label
    FROM public.mail_messages m
    JOIN public.mail_enrichment e ON e.mail_id = m.id
    WHERE m.user_id = v_user_id
      AND m.received_at >= v_since
      AND m.is_deleted = false
      AND m.is_from_me = false
      AND (
        (e.cycle_stage_signal IN ('churn_signal','price_objection') AND e.signal_type = 'declared')
        OR (e.sentiment IN ('negative','escalated') AND e.party_type IN ('customer','partner'))
        OR (e.urgency = 'high' AND e.asks_response = true)
      )
    ORDER BY m.received_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'window_hours', p_lookback_hours,
    'since', v_since,
    'now', now(),
    'tier_counts', (SELECT to_jsonb(tier_counts.*) FROM tier_counts),
    'hot_signals', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'mail_id', h.mail_id,
        'conversation_id', h.conversation_id,
        'signal_label', h.signal_label,
        'from_email', h.from_email,
        'from_name', h.from_name,
        'subject', h.subject,
        'received_at', h.received_at,
        'party_type', h.party_type,
        'lifecycle', h.party_lifecycle_at_moment,
        'sentiment', h.sentiment,
        'cycle_stage', h.cycle_stage_signal,
        'summary', h.summary_one_line,
        'topics', h.topics
      ) ORDER BY h.received_at DESC) FROM hot_signals h),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_briefing(int, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_inbox_briefing(int, uuid) IS
  'Dagstand voor Maestro home InboxBriefingCard. Telt autopilot-uitgevoerd / one-click-wachtend / reasoned-wachtend in window + top 5 hot signals (declared churn / negative klant / urgent request).';


-- ============================================================================
-- 3. RPC: get_style_examples  (few-shot voor reply-prompt)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_style_examples(
  p_party_type text DEFAULT NULL,
  p_lifecycle text DEFAULT NULL,
  p_topic text DEFAULT NULL,
  p_company_id text DEFAULT NULL,
  p_limit int DEFAULT 5,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  mail_id text,
  subject text,
  sent_at timestamptz,
  to_party text,
  body_text text,
  party_type text,
  lifecycle text,
  topics text[]
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH cfg AS (
    SELECT COALESCE(p_user_id, auth.uid()) AS uid
  ),
  candidates AS (
    SELECT
      m.id,
      m.subject,
      m.sent_at,
      COALESCE(m.to_recipients->0->>'address', '') AS to_party,
      LEFT(COALESCE(m.body_text, ''), 1500) AS body_text,
      e.party_type,
      e.party_lifecycle_at_moment AS lifecycle,
      e.topics,
      -- Score op cluster-match (party+lifecycle+topic = 3, 2-of-3 = 2, 1 = 1)
      (CASE WHEN p_party_type IS NULL OR e.party_type = p_party_type THEN 1 ELSE 0 END
       + CASE WHEN p_lifecycle IS NULL OR e.party_lifecycle_at_moment = p_lifecycle THEN 1 ELSE 0 END
       + CASE WHEN p_topic IS NULL OR p_topic = ANY(e.topics) THEN 1 ELSE 0 END
       + CASE WHEN p_company_id IS NULL OR e.related_company_id = p_company_id THEN 2 ELSE 0 END
      ) AS cluster_score
    FROM public.mail_messages m
    JOIN public.mail_enrichment e ON e.mail_id = m.id
    WHERE m.user_id = (SELECT uid FROM cfg)
      AND m.is_from_me = true
      AND m.is_deleted = false
      AND m.body_text IS NOT NULL
      AND length(m.body_text) BETWEEN 50 AND 4000  -- exclude one-liners + zeer lange
      AND m.sent_at IS NOT NULL
      AND m.sent_at > now() - interval '12 months'
  )
  SELECT id, subject, sent_at, to_party, body_text, party_type, lifecycle, topics
  FROM candidates
  WHERE cluster_score > 0
  ORDER BY cluster_score DESC, sent_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_style_examples(text, text, text, text, int, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_style_examples(text, text, text, text, int, uuid) IS
  'Few-shot pool voor reply-drafting. Haalt laatste N verzonden mails van Jelle in dezelfde (party_type, lifecycle, topic, company)-cluster op. Bedoeld als style-richtlijn in Sonnet-prompt, niet als template.';


-- ============================================================================
-- 4. RPC: get_thread_context  (hele conversation_id voor classifier)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_thread_context(
  p_conversation_id text,
  p_exclude_mail_id text DEFAULT NULL,
  p_limit int DEFAULT 8
)
RETURNS TABLE (
  mail_id text,
  thread_position int,
  is_from_me boolean,
  from_name text,
  from_email text,
  sent_at timestamptz,
  received_at timestamptz,
  subject text,
  body_preview text,
  speech_act text,
  summary_one_line text,
  sentiment text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    m.id,
    m.thread_position,
    m.is_from_me,
    m.from_name,
    m.from_email,
    m.sent_at,
    m.received_at,
    m.subject,
    LEFT(COALESCE(m.body_preview, m.body_text, ''), 800) AS body_preview,
    e.speech_act,
    e.summary_one_line,
    e.sentiment
  FROM public.mail_messages m
  LEFT JOIN public.mail_enrichment e ON e.mail_id = m.id
  WHERE m.user_id = auth.uid()
    AND m.conversation_id = p_conversation_id
    AND m.is_deleted = false
    AND (p_exclude_mail_id IS NULL OR m.id <> p_exclude_mail_id)
  ORDER BY COALESCE(m.received_at, m.sent_at) DESC NULLS LAST
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_thread_context(text, text, int) TO authenticated;

COMMENT ON FUNCTION public.get_thread_context(text, text, int) IS
  'Thread-context voor classifier. Geeft alle mails in conversation_id (max N, default 8), met enrichment-summary per mail. Optionele exclude voor de huidige mail. Hard cap 800 chars per body om token-budget te respecteren.';


-- ============================================================================
-- 5. RPC: get_cross_system_context  (Jira + HubSpot + meetings als one-block)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cross_system_context(
  p_company_id text,
  p_lookback_days int DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => p_lookback_days);
  v_company jsonb;
  v_open_deals jsonb;
  v_jira_issues jsonb;
  v_recent_meetings jsonb;
  v_engagement_count int;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('error','no_company_id');
  END IF;

  -- Company-info
  SELECT to_jsonb(c.*) - 'raw' INTO v_company
  FROM public.hubspot_companies c
  WHERE c.company_id = p_company_id
  LIMIT 1;

  -- Open deals
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'deal_id', d.deal_id,
    'name', d.dealname,
    'stage', d.dealstage,
    'pipeline_id', d.pipeline_id,
    'amount', d.amount,
    'close_date', d.closedate,
    'last_modified', d.hs_lastmodifieddate
  ) ORDER BY d.hs_lastmodifieddate DESC), '[]'::jsonb)
  INTO v_open_deals
  FROM public.hubspot_deals d
  WHERE NOT d.is_archived
    AND p_company_id = ANY(d.associated_company_ids);

  -- Open Jira-issues — kijk via summary/description naar company-naam
  -- (alleen als hubspot_companies.name beschikbaar — best effort)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'key', j.issue_key,
    'summary', j.summary,
    'status', j.status,
    'priority', j.priority,
    'updated', j.jira_updated_at,
    'days_open', EXTRACT(DAY FROM (now() - j.jira_created_at))::int
  ) ORDER BY j.jira_updated_at DESC), '[]'::jsonb)
  INTO v_jira_issues
  FROM public.jira_issues j
  WHERE j.status_category != 'Done'
    AND j.is_deleted = false
    AND j.jira_updated_at >= v_since
    AND (
      j.summary ILIKE '%' || COALESCE(v_company->>'name', '___nope___') || '%'
      OR j.description ILIKE '%' || COALESCE(v_company->>'name', '___nope___') || '%'
    )
  LIMIT 5;

  -- Recente meetings — Fireflies via meeting_briefings of fireflies_meetings
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'title', f.title,
    'date', f.date_time,
    'duration_min', f.duration_min,
    'summary', LEFT(COALESCE(f.summary_text, ''), 300)
  ) ORDER BY f.date_time DESC), '[]'::jsonb)
  INTO v_recent_meetings
  FROM public.fireflies_meetings f
  WHERE f.date_time >= v_since
    AND (
      f.title ILIKE '%' || COALESCE(v_company->>'name', '___nope___') || '%'
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(f.attendees) att
        WHERE att->>'email' ILIKE '%@' || COALESCE(v_company->>'domain', '___nope___')
      )
    )
  LIMIT 3;

  -- HubSpot engagement count laatste 90d
  SELECT COUNT(*) INTO v_engagement_count
  FROM public.hubspot_engagements e
  WHERE p_company_id = ANY(e.associated_company_ids)
    AND e.hs_timestamp >= v_since;

  RETURN jsonb_build_object(
    'company',            COALESCE(v_company, 'null'::jsonb),
    'open_deals',         v_open_deals,
    'open_jira_issues',   v_jira_issues,
    'recent_meetings',    v_recent_meetings,
    'engagement_count_90d', v_engagement_count,
    'window_days',        p_lookback_days
  );
EXCEPTION WHEN OTHERS THEN
  -- Best-effort: bij fouten in optionele bronnen leeg-block terug ipv crash
  RETURN jsonb_build_object(
    'company', COALESCE(v_company, 'null'::jsonb),
    'open_deals', COALESCE(v_open_deals, '[]'::jsonb),
    'open_jira_issues', COALESCE(v_jira_issues, '[]'::jsonb),
    'recent_meetings', COALESCE(v_recent_meetings, '[]'::jsonb),
    'engagement_count_90d', COALESCE(v_engagement_count, 0),
    'error', SQLERRM
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cross_system_context(text, int) TO authenticated;

COMMENT ON FUNCTION public.get_cross_system_context(text, int) IS
  'Cross-system context-block voor drafting. Bundelt company-info + open HubSpot deals + open Jira-issues + recente Fireflies-meetings + engagement-count. Best-effort: faalt zacht bij missende bronnen.';


-- ============================================================================
-- 6. View: v_action_prior_per_cluster  (Bayesian-prior aggregate)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_action_prior_per_cluster AS
WITH cluster_data AS (
  SELECT
    e.party_type,
    e.party_lifecycle_at_moment AS lifecycle,
    (SELECT t FROM unnest(e.topics) t LIMIT 1) AS primary_topic,
    e.speech_act,
    d.action_slug,
    d.outcome,
    d.user_id
  FROM public.autodraft_action_decisions d
  JOIN public.mail_enrichment e ON e.mail_id = d.mail_id
  WHERE d.decided_at >= now() - interval '90 days'
    AND d.outcome IN ('accept','amend','autopilot','manual')
)
SELECT
  party_type,
  lifecycle,
  primary_topic,
  speech_act,
  action_slug,
  user_id,
  COUNT(*) AS accept_count,
  ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER (
    PARTITION BY party_type, lifecycle, primary_topic, speech_act, user_id
  ), 3) AS share_in_cluster
FROM cluster_data
WHERE party_type IS NOT NULL
GROUP BY party_type, lifecycle, primary_topic, speech_act, action_slug, user_id;

GRANT SELECT ON public.v_action_prior_per_cluster TO authenticated;

COMMENT ON VIEW public.v_action_prior_per_cluster IS
  'Bayesian-prior per (party_type, lifecycle, primary_topic, speech_act, action_slug) — laatste 90d. Wordt input voor classifier-prompt: Sonnet ziet "in vergelijkbare gevallen koos je 73% slug X". Geen JelleMind-koppeling — alleen stats.';


-- ============================================================================
-- 7. RPC: get_action_calibration_stats  (voor /postvak/instellingen kalibratie)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_action_calibration_stats(
  p_lookback_days int DEFAULT 30,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  action_slug text,
  category text,
  display_name text,
  tier text,
  suggested int,
  accepted int,
  amended int,
  rejected int,
  autopilot_done int,
  undo_count int,
  acceptance_rate numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH cfg AS (
    SELECT
      COALESCE(p_user_id, auth.uid()) AS uid,
      now() - make_interval(days => p_lookback_days) AS since
  ),
  agg AS (
    SELECT
      d.action_slug,
      d.tier,
      COUNT(*) FILTER (WHERE d.was_suggested) AS sugg,
      COUNT(*) FILTER (WHERE d.outcome = 'accept') AS acc,
      COUNT(*) FILTER (WHERE d.outcome = 'amend') AS amd,
      COUNT(*) FILTER (WHERE d.outcome = 'reject') AS rej,
      COUNT(*) FILTER (WHERE d.outcome = 'autopilot') AS ap_done,
      COUNT(*) FILTER (WHERE d.outcome = 'autopilot' AND d.execution_result->>'undone' = 'true') AS ap_undone
    FROM public.autodraft_action_decisions d
    JOIN cfg ON d.user_id = cfg.uid AND d.decided_at >= cfg.since
    GROUP BY d.action_slug, d.tier
  )
  SELECT
    a.action_slug,
    cat.category,
    cat.display_name,
    a.tier,
    a.sugg::int,
    a.acc::int,
    a.amd::int,
    a.rej::int,
    a.ap_done::int,
    a.ap_undone::int,
    CASE WHEN a.sugg > 0 THEN ROUND((a.acc + a.amd)::numeric / a.sugg, 3) ELSE NULL END AS acceptance_rate
  FROM agg a
  LEFT JOIN public.autodraft_actions cat ON cat.slug = a.action_slug
  ORDER BY a.tier NULLS LAST, a.sugg DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_action_calibration_stats(int, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_action_calibration_stats(int, uuid) IS
  'Calibration-stats voor /postvak/instellingen/kalibratie. Toont per (action_slug, tier) suggested/accepted/amended/rejected counts + acceptance-rate. Lookback default 30d. Voor handmatige threshold-tuning.';


-- ============================================================================
-- 8. RPC: undo_autopilot_decision  (24u undo-window)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.undo_autopilot_decision(
  p_decision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.autodraft_action_decisions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.autodraft_action_decisions
  WHERE id = p_decision_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'error','not_found');
  END IF;

  IF v_row.outcome != 'autopilot' THEN
    RETURN jsonb_build_object('ok',false,'error','not_autopilot');
  END IF;

  IF v_row.undo_until IS NULL OR v_row.undo_until < now() THEN
    RETURN jsonb_build_object('ok',false,'error','undo_window_expired');
  END IF;

  -- Markeer undone — auto-draft-execute pakt op via manual_run_requested_at
  UPDATE public.autodraft_action_decisions
  SET execution_result = COALESCE(execution_result, '{}'::jsonb) ||
                          jsonb_build_object('undone', true, 'undone_at', now()),
      updated_at = now()
  WHERE id = p_decision_id;

  RETURN jsonb_build_object('ok', true, 'decision_id', p_decision_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.undo_autopilot_decision(uuid) TO authenticated;

COMMENT ON FUNCTION public.undo_autopilot_decision(uuid) IS
  'Markeert autopilot-decision als undone binnen 24u window. auto-draft-execute pakt vlag op om Outlook-actie terug te draaien.';

COMMIT;
