-- =====================================================================
-- get_sender_events RPC
-- =====================================================================
-- Doel: kalender-events waarin deze persoon voorkomt (als organisator OF
-- als attendee). Aanvulling op get_sender_history (mails) zodat de
-- Postvak-Tijdlijn-modal niet alleen mailcontact toont maar ook echte
-- meetings uit Outlook-agenda.
--
-- Sortering: start_time desc. Lookback default 730 dagen (~2 jaar).
-- Cap: 100 events. Skipt cancelled + deleted events.
--
-- Schrijver: dashboard-refresh skill (handmatig via Claude-sessie)
-- Lezer    : dashboard SenderTimeline.jsx (V9.3+)
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_calendar_attendees_email_active
  ON public.calendar_attendees (email, calendar_event_id);

COMMENT ON INDEX public.idx_calendar_attendees_email_active IS
  'Email-lookup voor get_sender_events. Combineert email + event-id zodat de '
  'attendee-existsucheck per event O(log n) is.';

CREATE INDEX IF NOT EXISTS idx_calendar_events_organizer_email
  ON public.calendar_events (organizer_email, start_time DESC)
  WHERE is_deleted = false AND is_cancelled = false;

COMMENT ON INDEX public.idx_calendar_events_organizer_email IS
  'Organizer-tak van get_sender_events. Partial: alleen actieve events.';

CREATE OR REPLACE FUNCTION public.get_sender_events(
  p_from_email     text,
  p_lookback_days  int DEFAULT 730
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
  was_organized_by_them boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH relevant AS (
    -- Tak A: persoon was organisator
    SELECT e.id
    FROM public.calendar_events e
    WHERE e.is_deleted = false
      AND e.is_cancelled = false
      AND e.organizer_email = p_from_email
      AND e.start_time >= (now() - (p_lookback_days || ' days')::interval)

    UNION

    -- Tak B: persoon was attendee
    SELECT e.id
    FROM public.calendar_events e
    JOIN public.calendar_attendees a ON a.calendar_event_id = e.id
    WHERE e.is_deleted = false
      AND e.is_cancelled = false
      AND a.email = p_from_email
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
         (e.organizer_email = p_from_email)         AS was_organized_by_them
  FROM public.calendar_events e
  WHERE e.id IN (SELECT id FROM relevant)
  ORDER BY e.start_time DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_sender_events(text, int) IS
  'Calendar-events waarbij p_from_email voorkomt als organisator OF attendee. '
  'Lookback in dagen (default 730 = 2 jaar). Cap 100. Skipt cancelled + deleted. '
  'Sort start_time desc. SECURITY INVOKER + LANGUAGE sql STABLE. '
  'Gebruiker: dashboard SenderTimeline.jsx (V9.3+, 2026-05-18).';

GRANT EXECUTE ON FUNCTION public.get_sender_events(text, int) TO authenticated;
