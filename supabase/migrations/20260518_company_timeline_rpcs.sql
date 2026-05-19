-- =====================================================================
-- Company-tijdlijn RPCs — Stap 2 + 2.1
-- =====================================================================
-- Drie nieuwe RPC's voor de Company-tijdlijn op de Zoekpagina:
--
-- 1) get_company_mails(p_hubspot_company_id text, p_exclude_conv_id text)
--    Mails van OF naar enige contactpersoon van die company. Clustert per
--    conversation_id + attribution_emails-array (welke contacten van de
--    company waren betrokken) + latest_via_email (wie schreef de laatste).
--
-- 2) get_company_events(p_hubspot_company_id text, p_lookback_days int)
--    Events waar enige company-contact organizer was of in attendees zat.
--    + attribution_emails per event.
--
-- 3) get_company_notes(p_hubspot_company_id text, p_lookback_days int)
--    HubSpot NOTE-engagements direct gekoppeld aan deze company. Notes
--    zitten meestal op company-level (94% van 614 notes), niet op contact.
--
-- Plus indexen voor performance.
--
-- Schrijver: dashboard-refresh (handmatig)
-- Lezer    : dashboard CompanyTimelineView.jsx (V9.8+)
-- =====================================================================

-- Indexen
CREATE INDEX IF NOT EXISTS idx_hubspot_contacts_company_active
  ON public.hubspot_contacts (associated_company_id)
  WHERE is_archived = false AND associated_company_id IS NOT NULL;

COMMENT ON INDEX public.idx_hubspot_contacts_company_active IS
  'Snel emails per company opzoeken voor get_company_mails/events.';

CREATE INDEX IF NOT EXISTS idx_hubspot_engagements_company_ids_gin
  ON public.hubspot_engagements USING GIN (associated_company_ids);

COMMENT ON INDEX public.idx_hubspot_engagements_company_ids_gin IS
  'GIN voor get_company_notes — array-containment op associated_company_ids.';

-- =====================================================================
-- RPC 1: get_company_mails
-- =====================================================================
DROP FUNCTION IF EXISTS public.get_company_mails(text, text);

CREATE OR REPLACE FUNCTION public.get_company_mails(
  p_hubspot_company_id text,
  p_exclude_conversation_id text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id            text,
  latest_mail_id             text,
  latest_received_at         timestamptz,
  latest_subject             text,
  latest_body_preview        text,
  latest_from_email          text,
  latest_from_name           text,
  latest_is_from_me          boolean,
  latest_has_attachments     boolean,
  latest_flag_status         text,
  latest_is_calendar_invite  boolean,
  thread_count               integer,
  incoming_count             integer,
  outgoing_count             integer,
  attribution_emails         text[],
  latest_via_email           text
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH company_emails AS (
    SELECT lower(c.email) AS email
    FROM public.hubspot_contacts c
    WHERE c.is_archived = false
      AND c.email IS NOT NULL
      AND c.associated_company_id = p_hubspot_company_id
  ),
  relevant AS (
    -- Inkomende mails van iemand van deze company
    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite,
           lower(m.from_email) AS via_email
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND lower(m.from_email) IN (SELECT email FROM company_emails)
      AND (p_exclude_conversation_id IS NULL
           OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)

    UNION ALL

    -- Uitgaande mails naar iemand van deze company (jsonb ILIKE per email)
    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite,
           ce.email AS via_email
    FROM public.mail_messages m
    CROSS JOIN LATERAL (
      SELECT email FROM company_emails
      WHERE m.to_recipients::text ILIKE '%"' || email || '"%'
         OR m.cc_recipients::text ILIKE '%"' || email || '"%'
      LIMIT 1
    ) ce
    WHERE m.is_deleted = false
      AND m.is_from_me = true
      AND (p_exclude_conversation_id IS NULL
           OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)
  ),
  threads AS (
    SELECT r.conversation_id,
           count(*)::int                                  AS thread_count,
           count(*) FILTER (WHERE NOT r.is_from_me)::int  AS incoming_count,
           count(*) FILTER (WHERE r.is_from_me)::int      AS outgoing_count,
           array_agg(DISTINCT r.via_email)
             FILTER (WHERE r.via_email IS NOT NULL)       AS attribution_emails,
           max(r.received_at)                             AS thread_latest_at
    FROM relevant r
    WHERE r.conversation_id IS NOT NULL
    GROUP BY r.conversation_id
  ),
  top_row AS (
    SELECT DISTINCT ON (r.conversation_id)
           r.conversation_id,
           r.id                  AS latest_mail_id,
           r.received_at         AS latest_received_at,
           r.subject             AS latest_subject,
           r.body_preview        AS latest_body_preview,
           r.from_email          AS latest_from_email,
           r.from_name           AS latest_from_name,
           r.is_from_me          AS latest_is_from_me,
           r.has_attachments     AS latest_has_attachments,
           r.flag_status         AS latest_flag_status,
           r.is_calendar_invite  AS latest_is_calendar_invite,
           r.via_email           AS latest_via_email
    FROM relevant r
    WHERE r.conversation_id IS NOT NULL
    ORDER BY r.conversation_id, r.received_at DESC
  )
  SELECT t.conversation_id,
         tr.latest_mail_id, tr.latest_received_at, tr.latest_subject,
         tr.latest_body_preview, tr.latest_from_email, tr.latest_from_name,
         tr.latest_is_from_me, tr.latest_has_attachments, tr.latest_flag_status,
         tr.latest_is_calendar_invite,
         t.thread_count, t.incoming_count, t.outgoing_count,
         t.attribution_emails, tr.latest_via_email
  FROM threads t
  JOIN top_row tr ON tr.conversation_id = t.conversation_id
  ORDER BY t.thread_latest_at DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_company_mails(text, text) IS
  'Mails van/naar enige contactpersoon van een HubSpot-company. '
  'Clustert per conversation_id, + attribution_emails (alle contacten van '
  'de company in deze thread) + latest_via_email. Cap 200 threads. '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.get_company_mails(text, text) TO authenticated;

-- =====================================================================
-- RPC 2: get_company_events
-- =====================================================================
DROP FUNCTION IF EXISTS public.get_company_events(text, int);

CREATE OR REPLACE FUNCTION public.get_company_events(
  p_hubspot_company_id text,
  p_lookback_days int DEFAULT 730
)
RETURNS TABLE (
  event_id              uuid,
  graph_id              text,
  subject               text,
  body_preview          text,
  start_time            timestamptz,
  end_time              timestamptz,
  is_all_day            boolean,
  location_text         text,
  online_meeting_url    text,
  organizer_email       text,
  organizer_name        text,
  is_organizer          boolean,
  response_status       text,
  attendees_count       integer,
  has_fireflies         boolean,
  fireflies_meeting_id  uuid,
  was_organized_by_them boolean,
  attribution_emails    text[]
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH company_emails AS (
    SELECT lower(email) AS email
    FROM public.hubspot_contacts
    WHERE is_archived = false
      AND email IS NOT NULL
      AND associated_company_id = p_hubspot_company_id
  ),
  relevant AS (
    -- Organizer-tak
    SELECT e.id, lower(e.organizer_email) AS via_email
    FROM public.calendar_events e
    WHERE e.is_deleted = false
      AND e.is_cancelled = false
      AND lower(e.organizer_email) IN (SELECT email FROM company_emails)
      AND e.start_time >= (now() - (p_lookback_days || ' days')::interval)
    UNION
    -- Attendee-tak
    SELECT e.id, lower(a.email) AS via_email
    FROM public.calendar_events e
    JOIN public.calendar_attendees a ON a.calendar_event_id = e.id
    WHERE e.is_deleted = false
      AND e.is_cancelled = false
      AND lower(a.email) IN (SELECT email FROM company_emails)
      AND e.start_time >= (now() - (p_lookback_days || ' days')::interval)
  )
  SELECT e.id                                       AS event_id,
         e.graph_id,
         e.subject,
         e.body_preview,
         e.start_time,
         e.end_time,
         e.is_all_day,
         e.location_text,
         e.online_meeting_url,
         e.organizer_email,
         e.organizer_name,
         e.is_organizer,
         e.response_status,
         (SELECT count(*)::int FROM public.calendar_attendees a
          WHERE a.calendar_event_id = e.id)         AS attendees_count,
         (e.fireflies_meeting_id IS NOT NULL)       AS has_fireflies,
         e.fireflies_meeting_id,
         (lower(e.organizer_email) IN (SELECT email FROM company_emails))
                                                    AS was_organized_by_them,
         (SELECT array_agg(DISTINCT r.via_email)
          FROM relevant r WHERE r.id = e.id)        AS attribution_emails
  FROM public.calendar_events e
  WHERE e.id IN (SELECT DISTINCT id FROM relevant)
  ORDER BY e.start_time DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_company_events(text, int) IS
  'Calendar-events waarbij enige company-contact organizer of attendee was. '
  '+ attribution_emails per event. Lookback default 730d, cap 100. '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.get_company_events(text, int) TO authenticated;

-- =====================================================================
-- RPC 3: get_company_notes
-- =====================================================================
DROP FUNCTION IF EXISTS public.get_company_notes(text, int);

CREATE OR REPLACE FUNCTION public.get_company_notes(
  p_hubspot_company_id text,
  p_lookback_days int DEFAULT 730
)
RETURNS TABLE (
  engagement_id           text,
  engagement_type         text,
  subject                 text,
  body_text               text,
  body_truncated          boolean,
  hs_timestamp            timestamptz,
  hubspot_owner_id        text,
  associated_contact_ids  text[],
  associated_deal_ids     text[]
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT e.id,
         e.engagement_type,
         e.subject,
         e.body_text,
         e.body_truncated,
         e.hs_timestamp,
         e.hubspot_owner_id,
         e.associated_contact_ids,
         e.associated_deal_ids
  FROM public.hubspot_engagements e
  WHERE e.is_archived = false
    AND lower(e.engagement_type) = 'note'
    AND e.associated_company_ids @> ARRAY[p_hubspot_company_id]
    AND e.hs_timestamp >= (now() - (p_lookback_days || ' days')::interval)
  ORDER BY e.hs_timestamp DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_company_notes(text, int) IS
  'HubSpot NOTE-engagements direct gekoppeld aan een company. Lookback 730d, '
  'cap 100. 94% van notes leeft op company-level (vs slechts 6% direct op '
  'contact) — daarom is company-route de hoofdbron. '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.get_company_notes(text, int) TO authenticated;
