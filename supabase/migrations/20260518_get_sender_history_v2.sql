-- =====================================================================
-- get_sender_history v2 — adds latest_is_calendar_invite
-- =====================================================================
-- Reden: SenderTimeline UI wil agenda-invites visueel apart tonen
-- (rechts-uitgelijnde kaart + blauwe badge). Een extra veld in de
-- RETURNS TABLE is goedkoper dan een N+1-query per thread.
--
-- RETURNS TABLE-shape wijzigt → DROP + CREATE noodzakelijk
-- (CREATE OR REPLACE FUNCTION accepteert geen RETURN-shape-change).
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_sender_history(text, text);

CREATE OR REPLACE FUNCTION public.get_sender_history(
  p_from_email text,
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
  outgoing_count             integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH relevant AS (
    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.from_email = p_from_email
      AND (p_exclude_conversation_id IS NULL
           OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)

    UNION ALL

    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.is_from_me = true
      AND (m.to_recipients::text ILIKE '%"' || p_from_email || '"%'
           OR m.cc_recipients::text ILIKE '%"' || p_from_email || '"%')
      AND (p_exclude_conversation_id IS NULL
           OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)
  ),
  threads AS (
    SELECT r.conversation_id,
           count(*)::int                                 AS thread_count,
           count(*) FILTER (WHERE NOT r.is_from_me)::int AS incoming_count,
           count(*) FILTER (WHERE r.is_from_me)::int     AS outgoing_count,
           max(r.received_at)                            AS thread_latest_at
    FROM relevant r
    WHERE r.conversation_id IS NOT NULL
    GROUP BY r.conversation_id
  ),
  top_row AS (
    SELECT DISTINCT ON (r.conversation_id)
           r.conversation_id,
           r.id                   AS latest_mail_id,
           r.received_at          AS latest_received_at,
           r.subject              AS latest_subject,
           r.body_preview         AS latest_body_preview,
           r.from_email           AS latest_from_email,
           r.from_name            AS latest_from_name,
           r.is_from_me           AS latest_is_from_me,
           r.has_attachments      AS latest_has_attachments,
           r.flag_status          AS latest_flag_status,
           r.is_calendar_invite   AS latest_is_calendar_invite
    FROM relevant r
    WHERE r.conversation_id IS NOT NULL
    ORDER BY r.conversation_id, r.received_at DESC
  )
  SELECT t.conversation_id,
         tr.latest_mail_id,
         tr.latest_received_at,
         tr.latest_subject,
         tr.latest_body_preview,
         tr.latest_from_email,
         tr.latest_from_name,
         tr.latest_is_from_me,
         tr.latest_has_attachments,
         tr.latest_flag_status,
         tr.latest_is_calendar_invite,
         t.thread_count,
         t.incoming_count,
         t.outgoing_count
  FROM threads t
  JOIN top_row tr ON tr.conversation_id = t.conversation_id
  ORDER BY t.thread_latest_at DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_sender_history(text, text) IS
  'V2 (2026-05-18b): + latest_is_calendar_invite. Cross-conversation history per '
  'afzender voor Postvak-Tijdlijn-modal. Threads clustered op conversation_id, '
  'incl. uitgaande mails (to/cc), cap 200. SECURITY INVOKER + LANGUAGE sql STABLE. '
  'Gebruiker: dashboard SenderTimeline.jsx.';

GRANT EXECUTE ON FUNCTION public.get_sender_history(text, text) TO authenticated;
