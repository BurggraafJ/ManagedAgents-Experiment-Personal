-- =====================================================================
-- AutoDraft v2 — Fase 4C: company/contact action-historie voor timelines
-- =====================================================================
-- Voor de Klanten-tab op /zoeken-v2: laat action_decisions zien naast
-- mails/events/notes in de entity-timeline.
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_company_actions(text, int);

CREATE OR REPLACE FUNCTION public.get_company_actions(
  p_hubspot_company_id text,
  p_lookback_days      int DEFAULT 730
)
RETURNS TABLE (
  decision_id          uuid,
  mail_id              text,
  conversation_id      text,
  action_slug          text,
  action_display_name  text,
  category             text,
  payload              jsonb,
  was_suggested        boolean,
  suggested_rank       int,
  outcome              text,
  decided_at           timestamptz,
  executed_at          timestamptz,
  mail_subject         text,
  from_email           text,
  from_name            text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH company_domains AS (
    SELECT er.alias_value AS domain FROM public.entity_resolution er
     WHERE er.entity_type = 'company'
       AND er.entity_id::text = p_hubspot_company_id
       AND er.alias_type      = 'email_domain'
  )
  SELECT d.id, d.mail_id, d.conversation_id, d.action_slug, a.display_name,
         a.category, d.payload, d.was_suggested, d.suggested_rank, d.outcome,
         d.decided_at, d.executed_at, m.subject, m.from_email, m.from_name
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  LEFT JOIN public.autodraft_actions       a  ON a.slug = d.action_slug
  JOIN   company_domains cd ON lower(m.from_domain) = cd.domain
  WHERE  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER  BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT  200;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_actions(text, int) TO service_role, authenticated;

DROP FUNCTION IF EXISTS public.get_sender_actions(text, int);

CREATE OR REPLACE FUNCTION public.get_sender_actions(
  p_from_email     text,
  p_lookback_days  int DEFAULT 730
)
RETURNS TABLE (
  decision_id          uuid,
  mail_id              text,
  conversation_id      text,
  action_slug          text,
  action_display_name  text,
  category             text,
  payload              jsonb,
  was_suggested        boolean,
  suggested_rank       int,
  outcome              text,
  decided_at           timestamptz,
  executed_at          timestamptz,
  mail_subject         text,
  from_email           text,
  from_name            text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.id, d.mail_id, d.conversation_id, d.action_slug, a.display_name,
         a.category, d.payload, d.was_suggested, d.suggested_rank, d.outcome,
         d.decided_at, d.executed_at, m.subject, m.from_email, m.from_name
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  LEFT JOIN public.autodraft_actions       a  ON a.slug = d.action_slug
  WHERE  d.mail_id IS NOT NULL AND d.outcome IS NOT NULL
    AND  lower(m.from_email) = lower(p_from_email)
    AND  COALESCE(d.decided_at, d.created_at) > now() - (p_lookback_days || ' days')::interval
  ORDER  BY COALESCE(d.decided_at, d.created_at) DESC
  LIMIT  100;
$$;

GRANT EXECUTE ON FUNCTION public.get_sender_actions(text, int) TO service_role, authenticated;
