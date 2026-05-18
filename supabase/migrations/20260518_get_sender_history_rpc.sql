-- =====================================================================
-- get_sender_history RPC + supporting indexes
-- =====================================================================
-- Doel: cross-conversation history per afzender voor de Postvak-Tijdlijn
-- modal (dashboard SenderTimeline.jsx, V9.0+).
--
-- Vervangt de oude prop-merging in `useAutoDraft.js` die gecapt was op
-- `mail_messages` laatste 500 wereldwijd — bij een drukke inbox zorgde
-- die cap voor magere historie ("werkt meestal niet"). De RPC trekt
-- targeted alle relevante rijen, clustert per conversation_id, en
-- includeert ook uitgaande mails naar dezelfde persoon (to/cc).
--
-- Logica:
--  - Inkomend  : mail_messages.from_email = p_from_email
--  - Uitgaand  : mail_messages.is_from_me = true AND p_from_email
--                voorkomt in to_recipients of cc_recipients (jsonb ILIKE
--                op de quoted-vorm voorkomt substring-false-positives)
--  - Cluster   : per conversation_id, laatste mail = top-row +
--                thread_count / incoming_count / outgoing_count
--  - Exclude   : optionele p_exclude_conversation_id voor "huidige thread
--                niet meerekenen" use-case
--  - Sort      : laatste mail desc
--  - Cap       : 200 threads
--
-- Schrijver: dashboard-refresh skill (handmatig via Claude-sessie)
-- Lezer    : dashboard SenderTimeline.jsx
-- =====================================================================

-- 1. Indexen — partial om klein te blijven (98% van rijen heeft is_deleted=false)
--
-- Note: GEEN `CONCURRENTLY` zodat de migration via `supabase db push` kan
-- draaien (CLI wrapt alles in een transaction; CONCURRENTLY werkt niet in
-- transactions). Bij een mail_messages-tabel van <100k rijen is de
-- write-lock-window tijdens index-build sub-second tot enkele seconden —
-- acceptabel. Bij groei naar miljoenen rijen: split index-creates in een
-- aparte migration die via Management API draait (geen transaction-wrap).
CREATE INDEX IF NOT EXISTS idx_mail_messages_from_email_active
  ON public.mail_messages (from_email, received_at DESC)
  WHERE is_deleted = false;

COMMENT ON INDEX public.idx_mail_messages_from_email_active IS
  'Partial index voor get_sender_history en andere sender-aggregaties. '
  'Sluit soft-deleted rijen uit (is_deleted=false dekt 98%+ van de tabel).';

CREATE INDEX IF NOT EXISTS idx_mail_messages_from_me_active
  ON public.mail_messages (received_at DESC)
  WHERE is_from_me = true AND is_deleted = false;

COMMENT ON INDEX public.idx_mail_messages_from_me_active IS
  'Partial index voor uitgaande-mail-tak van get_sender_history. '
  'Beperkt seq-scan tot Jelle''s verzonden mails (~5-10% van inbox-volume).';

-- 2. De RPC zelf
-- Let op: mail_messages.id en .conversation_id zijn TEXT (Outlook native
-- ID-format = lange Base64-strings), niet uuid. Daarom is de RPC-signature
-- en RETURN-shape ook text-based.
CREATE OR REPLACE FUNCTION public.get_sender_history(
  p_from_email text,
  p_exclude_conversation_id text DEFAULT NULL
)
RETURNS TABLE (
  conversation_id        text,
  latest_mail_id         text,
  latest_received_at     timestamptz,
  latest_subject         text,
  latest_body_preview    text,
  latest_from_email      text,
  latest_from_name       text,
  latest_is_from_me      boolean,
  latest_has_attachments boolean,
  latest_flag_status     text,
  thread_count           integer,
  incoming_count         integer,
  outgoing_count         integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH relevant AS (
    -- Tak A: inkomende mails van deze afzender
    SELECT m.id,
           m.conversation_id,
           m.received_at,
           m.subject,
           m.body_preview,
           m.from_email,
           m.from_name,
           m.is_from_me,
           m.has_attachments,
           m.flag_status
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.from_email = p_from_email
      AND (
        p_exclude_conversation_id IS NULL
        OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id
      )

    UNION ALL

    -- Tak B: uitgaande mails waar deze persoon ontvanger was
    SELECT m.id,
           m.conversation_id,
           m.received_at,
           m.subject,
           m.body_preview,
           m.from_email,
           m.from_name,
           m.is_from_me,
           m.has_attachments,
           m.flag_status
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.is_from_me = true
      AND (
        m.to_recipients::text ILIKE '%"' || p_from_email || '"%'
        OR m.cc_recipients::text ILIKE '%"' || p_from_email || '"%'
      )
      AND (
        p_exclude_conversation_id IS NULL
        OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id
      )
  ),
  threads AS (
    SELECT r.conversation_id,
           count(*)::int                              AS thread_count,
           count(*) FILTER (WHERE NOT r.is_from_me)::int AS incoming_count,
           count(*) FILTER (WHERE r.is_from_me)::int     AS outgoing_count,
           max(r.received_at)                         AS thread_latest_at
    FROM relevant r
    WHERE r.conversation_id IS NOT NULL
    GROUP BY r.conversation_id
  ),
  top_row AS (
    SELECT DISTINCT ON (r.conversation_id)
           r.conversation_id,
           r.id           AS latest_mail_id,
           r.received_at  AS latest_received_at,
           r.subject      AS latest_subject,
           r.body_preview AS latest_body_preview,
           r.from_email   AS latest_from_email,
           r.from_name    AS latest_from_name,
           r.is_from_me   AS latest_is_from_me,
           r.has_attachments AS latest_has_attachments,
           r.flag_status  AS latest_flag_status
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
         t.thread_count,
         t.incoming_count,
         t.outgoing_count
  FROM threads t
  JOIN top_row tr ON tr.conversation_id = t.conversation_id
  ORDER BY t.thread_latest_at DESC
  LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_sender_history(text, text) IS
  'Cross-conversation history per afzender voor Postvak-Tijdlijn-modal. '
  'Returnt threads (clustered op conversation_id) waar p_from_email voorkomt '
  'als afzender OF als ontvanger van uitgaande mail (to/cc). Sorteert op '
  'laatste-mail-desc, cap 200 threads. p_exclude_conversation_id filtert de '
  'huidige thread eruit. SECURITY INVOKER + LANGUAGE sql STABLE. '
  'Gebruiker: dashboard SenderTimeline.jsx (V9.0+, 2026-05-18).';

-- 3. Toegang — dashboard auth via authenticated JWT (RLS Pattern A op mail_messages)
GRANT EXECUTE ON FUNCTION public.get_sender_history(text, text) TO authenticated;
