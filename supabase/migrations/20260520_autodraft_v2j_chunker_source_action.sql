-- =====================================================================
-- AutoDraft v2 — Fase 6: chunker source='action' + classify_mail_action recipe
-- =====================================================================

-- 1. View v_autodraft_action_chunk_source — chunker leest hieruit per decision
DROP VIEW IF EXISTS public.v_autodraft_action_chunk_source CASCADE;

CREATE OR REPLACE VIEW public.v_autodraft_action_chunk_source AS
SELECT
  d.id::text         AS decision_id,
  d.mail_id,
  d.conversation_id,
  d.action_slug,
  d.payload,
  d.was_suggested,
  d.suggested_rank,
  d.outcome,
  d.decided_at,
  d.executed_at,
  d.created_at,
  a.category,
  a.display_name,
  a.target_value,
  m.subject,
  m.from_email,
  m.from_domain,
  m.folder_path
FROM   public.autodraft_action_decisions d
LEFT  JOIN public.autodraft_actions     a  ON a.slug = d.action_slug
LEFT  JOIN public.mail_messages         m  ON m.id   = d.mail_id
WHERE  d.outcome IS NOT NULL;

COMMENT ON VIEW public.v_autodraft_action_chunk_source IS
  'AutoDraft v2 Fase 6 — chunker source=action input. Een rij per besloten '
  'action_decision met catalog + mail-context flat gejoined zodat de chunker '
  'in een SELECT alles heeft.';

GRANT SELECT ON public.v_autodraft_action_chunk_source TO service_role, authenticated;

-- 2. fetch_unchunked_source_ids krijgt 'action' branch
CREATE OR REPLACE FUNCTION public.fetch_unchunked_source_ids(p_source text, p_limit integer DEFAULT 10)
RETURNS TABLE(source_id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF p_source = 'mail' THEN
    RETURN QUERY
      SELECT m.id FROM mail_messages m
      WHERE m.is_deleted = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
      ORDER BY m.received_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'engagement' THEN
    RETURN QUERY
      SELECT e.id FROM hubspot_engagements e
      WHERE e.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'engagement' AND c.source_id = e.id)
      ORDER BY COALESCE(e.hs_timestamp, e.hs_created_at) DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'jira' THEN
    RETURN QUERY
      SELECT j.issue_key FROM jira_issues j
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'jira' AND c.source_id = j.issue_key)
      ORDER BY j.jira_updated_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'deal' THEN
    RETURN QUERY
      SELECT d.deal_id FROM hubspot_deals d
      WHERE d.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'deal' AND c.source_id = d.deal_id)
      ORDER BY d.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'company' THEN
    RETURN QUERY
      SELECT co.company_id FROM hubspot_companies co
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'company' AND c.source_id = co.company_id)
      ORDER BY co.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'contact' THEN
    RETURN QUERY
      SELECT con.contact_id FROM hubspot_contacts con
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'contact' AND c.source_id = con.contact_id)
      ORDER BY con.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'meeting' THEN
    RETURN QUERY
      SELECT f.id::text FROM fireflies_meetings f
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'meeting' AND c.source_id = f.id::text)
      ORDER BY f.date_time DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'event' THEN
    RETURN QUERY
      SELECT ev.id::text FROM calendar_events ev
      WHERE ev.is_cancelled = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'event' AND c.source_id = ev.id::text)
      ORDER BY ev.start_time DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'lesson' THEN
    RETURN QUERY
      SELECT l.id::text FROM jellemind_lessons l
      WHERE l.active = true
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'lesson' AND c.source_id = l.id::text)
      ORDER BY l.created_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'action' THEN
    RETURN QUERY
      SELECT d.id::text FROM autodraft_action_decisions d
      WHERE d.outcome IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'action' AND c.source_id = d.id::text)
      ORDER BY COALESCE(d.decided_at, d.created_at) DESC NULLS LAST LIMIT p_limit;

  ELSE
    RAISE EXCEPTION 'unknown_source: %', p_source USING ERRCODE = '22023';
  END IF;
END $function$;

-- 3. context_intents recipe classify_mail_action
INSERT INTO public.context_intents (
  intent, description, default_strategy, default_top_k, default_recency_weight,
  default_recency_decay_days, default_min_similarity, default_max_per_source,
  default_rerank, default_lookback_days, inject_jellemind, jellemind_scopes,
  jellemind_top_k, notes
) VALUES (
  'classify_mail_action',
  'AutoDraft v12 — classifier voor 3 actie-voorstellen per inkomende mail',
  'hybrid', 5, 0.6, 180, 0.45, 3, false, 365, true,
  ARRAY['jelle','skill']::text[], 3,
  'Top-5 vergelijkbare historische action_decisions voor sender/domein. Sources [action,mail]. Hybrid (vector+BM25+RRF). JelleMind voor toon-voorkeuren.'
)
ON CONFLICT (intent) DO UPDATE
  SET description                = EXCLUDED.description,
      default_strategy           = EXCLUDED.default_strategy,
      default_top_k              = EXCLUDED.default_top_k,
      default_recency_decay_days = EXCLUDED.default_recency_decay_days,
      default_min_similarity     = EXCLUDED.default_min_similarity,
      default_max_per_source     = EXCLUDED.default_max_per_source,
      inject_jellemind           = EXCLUDED.inject_jellemind,
      jellemind_scopes           = EXCLUDED.jellemind_scopes,
      jellemind_top_k            = EXCLUDED.jellemind_top_k,
      notes                      = EXCLUDED.notes,
      updated_at                 = now();
