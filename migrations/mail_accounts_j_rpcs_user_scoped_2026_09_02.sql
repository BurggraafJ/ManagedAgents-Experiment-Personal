-- =============================================================================
-- mail_accounts J — mail-RPC's user_id-bewust
-- MAIL-PIPELINE.md §3.8 / §3.9 stap 7   ·   2026-09-02
-- =============================================================================
-- Elke RPC uit §3.8 krijgt een `p_user_id uuid default null` ACHTERAAN, zodat
-- bestaande callers (positioneel én via PostgREST met named params) ongewijzigd
-- blijven werken. De default is de huidige org-mailbox voor een service-role-
-- caller; expliciet meegeven scoopt op één mailbox.
--
-- Twee scope-helpers, uit migratie H:
--   * mail_scope_user_ids()     — voor SECURITY INVOKER: NULL bij een browser-
--     JWT, want RLS op mail_messages doet daar het werk (admin-inzage blijft
--     zoals ze is, zie MAIL-PIPELINE.md §4 open vraag 2).
--   * mail_definer_scope_ids()  — voor SECURITY DEFINER: daar geldt geen RLS,
--     dus een ingelogde caller wordt op zichzelf gescoopt. Dat is een
--     AANSCHERPING: vandaag levert elke definer-RPC hieronder alle mailboxen op
--     aan elke ingelogde gebruiker. Met één mailbox (Jelle = eigenaar = org)
--     verandert er niets.
--
-- CREATE OR REPLACE kan geen parameter toevoegen (dat maakt een tweede
-- overload, en twee overloads met defaults geven "function is not unique").
-- Daarom: DROP + CREATE, met de ACL's er expliciet weer op.
--
-- find_similar_sent_mails staat NIET in dit bestand: die kreeg p_user_id al in
-- migratie B en filtert via rag_owner_scope_ids().
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. get_sender_history — SECURITY INVOKER
-- -----------------------------------------------------------------------------
drop function if exists public.get_sender_history(text, text);

create function public.get_sender_history(
  p_from_email text,
  p_exclude_conversation_id text default null,
  p_user_id uuid default null
)
returns table(conversation_id text, latest_mail_id text, latest_received_at timestamp with time zone,
              latest_subject text, latest_body_preview text, latest_from_email text, latest_from_name text,
              latest_is_from_me boolean, latest_has_attachments boolean, latest_flag_status text,
              latest_is_calendar_invite boolean, thread_count integer, incoming_count integer,
              outgoing_count integer, thread_first_at timestamp with time zone,
              thread_latest_at timestamp with time zone)
language sql
stable
set search_path to 'public'
as $function$
  WITH relevant_conv AS (
    SELECT m.conversation_id FROM public.mail_messages m
    WHERE m.is_deleted = false AND m.conversation_id IS NOT NULL
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND (lower(m.from_email) = lower(p_from_email)
           OR (m.is_from_me = true AND m.to_recipients::text ILIKE '%"' || lower(p_from_email) || '"%')
           OR (m.is_from_me = true AND m.cc_recipients::text ILIKE '%"' || lower(p_from_email) || '"%'))
  ),
  relevant AS (
    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.conversation_id IN (SELECT conversation_id FROM relevant_conv)
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND (p_exclude_conversation_id IS NULL OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)
  ),
  threads AS (
    SELECT r.conversation_id, count(*)::int AS thread_count,
           count(*) FILTER (WHERE NOT r.is_from_me)::int AS incoming_count,
           count(*) FILTER (WHERE r.is_from_me)::int     AS outgoing_count,
           min(r.received_at) AS thread_first_at, max(r.received_at) AS thread_latest_at
    FROM relevant r WHERE r.conversation_id IS NOT NULL GROUP BY r.conversation_id
  ),
  top_row AS (
    SELECT DISTINCT ON (r.conversation_id)
           r.conversation_id, r.id AS latest_mail_id, r.received_at AS latest_received_at,
           r.subject AS latest_subject, r.body_preview AS latest_body_preview,
           r.from_email AS latest_from_email, r.from_name AS latest_from_name,
           r.is_from_me AS latest_is_from_me, r.has_attachments AS latest_has_attachments,
           r.flag_status AS latest_flag_status, r.is_calendar_invite AS latest_is_calendar_invite
    FROM relevant r WHERE r.conversation_id IS NOT NULL
    ORDER BY r.conversation_id, r.received_at DESC
  )
  SELECT t.conversation_id, tr.latest_mail_id, tr.latest_received_at, tr.latest_subject,
         tr.latest_body_preview, tr.latest_from_email, tr.latest_from_name,
         tr.latest_is_from_me, tr.latest_has_attachments, tr.latest_flag_status,
         tr.latest_is_calendar_invite,
         t.thread_count, t.incoming_count, t.outgoing_count,
         t.thread_first_at, t.thread_latest_at
  FROM threads t JOIN top_row tr ON tr.conversation_id = t.conversation_id
  ORDER BY t.thread_latest_at DESC LIMIT 200;
$function$;

revoke all on function public.get_sender_history(text, text, uuid) from public;
grant execute on function public.get_sender_history(text, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. get_company_mails — SECURITY INVOKER
-- -----------------------------------------------------------------------------
drop function if exists public.get_company_mails(text, text);

create function public.get_company_mails(
  p_hubspot_company_id text,
  p_exclude_conversation_id text default null,
  p_user_id uuid default null
)
returns table(conversation_id text, latest_mail_id text, latest_received_at timestamp with time zone,
              latest_subject text, latest_body_preview text, latest_from_email text, latest_from_name text,
              latest_is_from_me boolean, latest_has_attachments boolean, latest_flag_status text,
              latest_is_calendar_invite boolean, thread_count integer, incoming_count integer,
              outgoing_count integer, attribution_emails text[], latest_via_email text,
              thread_first_at timestamp with time zone, thread_latest_at timestamp with time zone)
language sql
stable
set search_path to 'public'
as $function$
  WITH company_domains AS (
    SELECT lower(NULLIF(trim(domain), '')) AS domain FROM public.hubspot_companies
    WHERE company_id = p_hubspot_company_id AND domain IS NOT NULL AND length(trim(domain)) >= 4
    UNION
    SELECT domain FROM public.hubspot_company_aliases WHERE company_id = p_hubspot_company_id
  ),
  company_emails AS (
    SELECT lower(c.email) AS email FROM public.hubspot_contacts c
    WHERE c.is_archived = false AND c.email IS NOT NULL
      AND c.associated_company_id = p_hubspot_company_id
  ),
  relevant_conv AS (
    SELECT m.conversation_id FROM public.mail_messages m
    WHERE m.is_deleted = false AND m.conversation_id IS NOT NULL
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND lower(m.from_email) IN (SELECT email FROM company_emails)
    UNION
    SELECT m.conversation_id FROM public.mail_messages m
    WHERE m.is_deleted = false AND m.is_from_me = true AND m.conversation_id IS NOT NULL
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND EXISTS (SELECT 1 FROM company_emails ce WHERE m.to_recipients::text ILIKE '%"' || ce.email || '"%' OR m.cc_recipients::text ILIKE '%"' || ce.email || '"%')
    UNION
    SELECT m.conversation_id FROM public.mail_messages m
    CROSS JOIN company_domains cd
    WHERE m.is_deleted = false AND m.conversation_id IS NOT NULL
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND cd.domain IS NOT NULL
      AND (lower(m.from_email) LIKE '%@' || cd.domain
           OR m.to_recipients::text ILIKE '%@' || cd.domain || '%'
           OR m.cc_recipients::text ILIKE '%@' || cd.domain || '%')
  ),
  relevant AS (
    SELECT m.id, m.conversation_id, m.received_at, m.subject, m.body_preview,
           m.from_email, m.from_name, m.is_from_me, m.has_attachments,
           m.flag_status, m.is_calendar_invite,
           CASE
             WHEN lower(m.from_email) IN (SELECT email FROM company_emails) THEN lower(m.from_email)
             WHEN EXISTS (SELECT 1 FROM company_domains cd WHERE cd.domain IS NOT NULL AND lower(m.from_email) LIKE '%@' || cd.domain) THEN lower(m.from_email)
             WHEN m.is_from_me THEN 'outbound:from-me'
             ELSE 'thread-leg'
           END AS via_email
    FROM public.mail_messages m
    WHERE m.is_deleted = false
      AND m.conversation_id IN (SELECT conversation_id FROM relevant_conv)
      AND m.is_calendar_invite = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_scope_user_ids(p_user_id)))
      AND COALESCE(m.subject, '') !~* '^(Accepted|Declined|Tentative|Geaccepteerd|Afgewezen|Voorlopig|Geweigerd|Canceled|Cancelled|Geannuleerd|Updated|Verplaatst|Gewijzigd)[:\s]'
      AND (p_exclude_conversation_id IS NULL OR m.conversation_id IS DISTINCT FROM p_exclude_conversation_id)
  ),
  threads AS (
    SELECT r.conversation_id, count(*)::int AS thread_count,
           count(*) FILTER (WHERE NOT r.is_from_me)::int AS incoming_count,
           count(*) FILTER (WHERE r.is_from_me)::int     AS outgoing_count,
           array_agg(DISTINCT r.via_email) FILTER (WHERE r.via_email IS NOT NULL) AS attribution_emails,
           min(r.received_at) AS thread_first_at, max(r.received_at) AS thread_latest_at
    FROM relevant r WHERE r.conversation_id IS NOT NULL GROUP BY r.conversation_id
  ),
  top_row AS (
    SELECT DISTINCT ON (r.conversation_id)
           r.conversation_id, r.id AS latest_mail_id, r.received_at AS latest_received_at,
           r.subject AS latest_subject, r.body_preview AS latest_body_preview,
           r.from_email AS latest_from_email, r.from_name AS latest_from_name,
           r.is_from_me AS latest_is_from_me, r.has_attachments AS latest_has_attachments,
           r.flag_status AS latest_flag_status, r.is_calendar_invite AS latest_is_calendar_invite,
           r.via_email AS latest_via_email
    FROM relevant r WHERE r.conversation_id IS NOT NULL
    ORDER BY r.conversation_id, r.received_at DESC
  )
  SELECT t.conversation_id, tr.latest_mail_id, tr.latest_received_at, tr.latest_subject,
         tr.latest_body_preview, tr.latest_from_email, tr.latest_from_name,
         tr.latest_is_from_me, tr.latest_has_attachments, tr.latest_flag_status,
         tr.latest_is_calendar_invite,
         t.thread_count, t.incoming_count, t.outgoing_count,
         t.attribution_emails, tr.latest_via_email,
         t.thread_first_at, t.thread_latest_at
  FROM threads t JOIN top_row tr ON tr.conversation_id = t.conversation_id
  ORDER BY t.thread_latest_at DESC LIMIT 200;
$function$;

revoke all on function public.get_company_mails(text, text, uuid) from public;
grant execute on function public.get_company_mails(text, text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. get_thread_messages — SECURITY DEFINER
-- -----------------------------------------------------------------------------
-- Had geen enkele user-filter: de subject+domein-tak matcht mails op inhoud, en
-- die zou bij mailbox #2 dwars door beide postvakken heen zoeken.
drop function if exists public.get_thread_messages(text, text, text, timestamp with time zone);

create function public.get_thread_messages(
  p_conversation_id text,
  p_subject text default null,
  p_match_email text default null,
  p_anchor_date timestamp with time zone default null,
  p_user_id uuid default null
)
returns table(id text, received_at timestamp with time zone, from_email text, from_name text,
              subject text, body_preview text, body_html text, body_text text, body_truncated boolean,
              has_attachments boolean, is_from_me boolean, folder_path text, is_deleted boolean)
language sql
security definer
set search_path to 'public'
as $function$
  with q as (
    select
      lower(trim(regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(p_subject, ''), '^((re|fw|fwd|aw|antw|vs)\s*:\s*)+', '', 'i'),
          '\[[^\]]*\]', '', 'g'),
        '\s+', ' ', 'g'))) as norm,
      nullif(lower(split_part(coalesce(p_match_email, ''), '@', 2)), '') as dom
  )
  select
    m.id, m.received_at, m.from_email, m.from_name,
    m.subject, m.body_preview, m.body_html, m.body_text,
    m.body_truncated, m.has_attachments, m.is_from_me,
    m.folder_path, m.is_deleted
  from public.mail_messages m, q
  where
    public.mail_row_in_scope(m.user_id, (select public.mail_definer_scope_ids(p_user_id)))
    and (
      m.conversation_id = p_conversation_id
      or (
        q.dom is not null
        and q.norm <> ''
        and (lower(m.from_email) like '%@' || q.dom or lower(m.to_recipients::text) like '%@' || q.dom || '%')
        and lower(trim(regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(m.subject, ''), '^((re|fw|fwd|aw|antw|vs)\s*:\s*)+', '', 'i'),
            '\[[^\]]*\]', '', 'g'),
          '\s+', ' ', 'g'))) = q.norm
      )
    )
  order by m.received_at asc;
$function$;

comment on function public.get_thread_messages(text, text, text, timestamp with time zone, uuid) is
  'Thread-weergave Postvak. Matcht op conversation_id OF (correspondent-domein + genormaliseerd onderwerp gelijk). Incl. is_deleted. p_anchor_date wordt genegeerd (kept for backwards-compat). 2026-05-28: tijdvenster verwijderd om false-positive ruis te voorkomen. 2026-09-02: p_user_id — default de ingelogde user, service-role de org-mailbox.';

revoke all on function public.get_thread_messages(text, text, text, timestamp with time zone, uuid) from public;
grant execute on function public.get_thread_messages(text, text, text, timestamp with time zone, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. get_thread_context — SECURITY INVOKER, had al `m.user_id = auth.uid()`
-- -----------------------------------------------------------------------------
-- Die harde auth.uid()-filter betekende dat een service-role-caller (elke agent)
-- altijd nul rijen kreeg. Nu: browser krijgt exact hetzelfde als voorheen,
-- service-role krijgt de org-mailbox.
drop function if exists public.get_thread_context(text, text, integer);

create function public.get_thread_context(
  p_conversation_id text,
  p_exclude_mail_id text default null,
  p_limit integer default 8,
  p_user_id uuid default null
)
returns table(mail_id text, thread_position integer, is_from_me boolean, from_name text, from_email text,
              sent_at timestamp with time zone, received_at timestamp with time zone, subject text,
              body_preview text, speech_act text, summary_one_line text, sentiment text)
language sql
stable
set search_path to 'public'
as $function$
  SELECT
    m.id, m.thread_position, m.is_from_me,
    m.from_name, m.from_email,
    m.sent_at, m.received_at, m.subject,
    LEFT(COALESCE(m.body_preview, m.body_text, ''), 800),
    e.speech_act, e.summary_one_line, e.sentiment
  FROM public.mail_messages m
  LEFT JOIN public.mail_enrichment e ON e.mail_id = m.id
  WHERE public.mail_row_in_scope(m.user_id, (SELECT public.mail_definer_scope_ids(p_user_id)))
    AND m.conversation_id = p_conversation_id
    AND m.is_deleted = false
    AND (p_exclude_mail_id IS NULL OR m.id <> p_exclude_mail_id)
  ORDER BY COALESCE(m.received_at, m.sent_at) DESC NULLS LAST
  LIMIT p_limit;
$function$;

revoke all on function public.get_thread_context(text, text, integer, uuid) from public;
grant execute on function public.get_thread_context(text, text, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. detect_mail_completion — SECURITY DEFINER
-- -----------------------------------------------------------------------------
drop function if exists public.detect_mail_completion(integer, real, boolean);

create function public.detect_mail_completion(
  p_lookback_days integer default 14,
  p_min_similarity real default 0.5,
  p_apply boolean default true,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
DECLARE
  v_candidates int := 0;
  v_applied int := 0;
  v_examples jsonb;
  v_scope uuid[];
BEGIN
  perform public.assert_can_manage_dashboard();
  v_scope := public.mail_definer_scope_ids(p_user_id);

  -- Vind voor elke open taak (eventueel) een outgoing mail die de taak voltooit:
  --   - is_from_me=true, gestuurd ná task.created_at, binnen lookback
  --   - match op contact_email OF fuzzy match op subject vs task title
  --   - de mail moet uit dezelfde mailbox komen als de taak-eigenaar
  --   - beste (hoogste similarity) per taak wint
  CREATE TEMP TABLE _tmp_mail_completion ON COMMIT DROP AS
    SELECT DISTINCT ON (t.id)
           t.id        AS task_id,
           t.title     AS task_title,
           m.id        AS mail_id,
           m.subject   AS mail_subject,
           m.received_at,
           m.to_recipients,
           greatest(
             similarity(coalesce(t.title, ''), coalesce(m.subject, '')),
             0.0::real
           ) AS sim_score
      FROM public.tasks t
      JOIN public.mail_messages m
        ON m.is_from_me = true
       AND m.received_at > t.created_at
       AND m.received_at > now() - (p_lookback_days || ' days')::interval
       AND public.mail_row_in_scope(m.user_id, v_scope)
       AND (t.user_id IS NULL OR t.user_id = m.user_id)
       AND (
         (t.contact_email IS NOT NULL
           AND m.to_recipients::text ILIKE '%' || t.contact_email || '%')
         OR similarity(coalesce(t.title, ''), coalesce(m.subject, '')) >= p_min_similarity
       )
     WHERE t.status = 'open'
       AND coalesce(t.completion_candidate, false) = false
       AND t.created_at > now() - (p_lookback_days || ' days')::interval
     ORDER BY t.id, sim_score DESC NULLS LAST, m.received_at DESC;

  SELECT count(*) INTO v_candidates FROM _tmp_mail_completion;

  IF p_apply AND v_candidates > 0 THEN
    UPDATE public.tasks t
       SET completion_candidate  = true,
           completion_evidence   = 'Mail "' || left(coalesce(c.mail_subject, ''), 80)
                                   || '" verzonden op '
                                   || to_char(c.received_at, 'DD mon HH24:MI'),
           completion_detected_at = now(),
           completion_source      = 'mail'
      FROM _tmp_mail_completion c
     WHERE t.id = c.task_id;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  END IF;

  -- Sample voor diagnostiek
  SELECT jsonb_agg(jsonb_build_object(
    'task_id',     task_id,
    'task_title',  left(task_title, 60),
    'mail_subject', left(mail_subject, 60),
    'sim_score',   round(sim_score::numeric, 3)
  )) INTO v_examples
  FROM (SELECT * FROM _tmp_mail_completion LIMIT 5) s;

  RETURN jsonb_build_object(
    'candidates',     v_candidates,
    'applied',        v_applied,
    'lookback_days',  p_lookback_days,
    'min_similarity', p_min_similarity,
    'mailbox_scope',  to_jsonb(v_scope),
    'examples',       coalesce(v_examples, '[]'::jsonb)
  );
END;
$function$;

comment on function public.detect_mail_completion(integer, real, boolean, uuid) is
  'Scant tasks (status=open) tegen mail_messages (is_from_me=true, ná task.created_at) binnen één mailbox. Bij match op contact_email of fuzzy subject-overlap: zet completion_candidate + completion_source=mail. Jelle bevestigt in UI.';

revoke all on function public.detect_mail_completion(integer, real, boolean, uuid) from public;
grant execute on function public.detect_mail_completion(integer, real, boolean, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. analytics_uncontacted_since — SECURITY DEFINER, service_role-only
-- -----------------------------------------------------------------------------
drop function if exists public.analytics_uncontacted_since(integer);

create function public.analytics_uncontacted_since(
  p_days integer default 60,
  p_user_id uuid default null
)
returns table(company_name text, domain text, dealname text, stage_label text,
              last_mail_at timestamp with time zone, days_silent integer, scanned_total integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  WITH active_cb AS (
    SELECT DISTINCT ON (c.company_id)
      c.company_id, c.name AS company_name, lower(c.domain) AS domain,
      d.dealname, analytics_stage_label(d.pipeline_id, d.dealstage) AS stage_label
    FROM hubspot_deals d
    CROSS JOIN LATERAL unnest(d.associated_company_ids) AS ac(cid)
    JOIN hubspot_companies c ON c.company_id = ac.cid
    WHERE d.pipeline_id = '2299277539' AND d.is_archived = false
      AND d.dealstage IN ('3504527569','3136444618','5052825799','5184563446')
      AND c.domain IS NOT NULL
    ORDER BY c.company_id, d.hs_lastmodifieddate DESC NULLS LAST
  ), last_contact AS (
    SELECT a.domain, max(GREATEST(coalesce(m.received_at, '-infinity'), coalesce(m.sent_at, '-infinity'))) AS last_mail_at
    FROM (SELECT DISTINCT domain FROM active_cb) a
    JOIN mail_messages m ON (m.from_domain = a.domain AND NOT m.is_from_me)
      OR (m.is_from_me AND m.to_recipients::text ILIKE '%@' || a.domain || '%')
    WHERE m.is_deleted = false
      AND public.mail_row_in_scope(m.user_id, (SELECT public.mail_definer_scope_ids(p_user_id)))
    GROUP BY a.domain
  )
  SELECT a.company_name, a.domain, a.dealname, a.stage_label,
         lc.last_mail_at,
         CASE WHEN lc.last_mail_at IS NULL THEN NULL ELSE (now()::date - lc.last_mail_at::date) END AS days_silent,
         (SELECT count(*)::int FROM active_cb) AS scanned_total
  FROM active_cb a
  LEFT JOIN last_contact lc ON lc.domain = a.domain
  WHERE lc.last_mail_at IS NULL OR lc.last_mail_at < now() - make_interval(days => p_days)
  ORDER BY lc.last_mail_at ASC NULLS FIRST;
$function$;

-- Deze RPC was en blijft service_role-only. `revoke from public` haalt de
-- ALTER DEFAULT PRIVILEGES-grant aan `authenticated` er NIET af, dus expliciet.
revoke all on function public.analytics_uncontacted_since(integer, uuid) from public;
revoke all on function public.analytics_uncontacted_since(integer, uuid) from anon, authenticated;
grant execute on function public.analytics_uncontacted_since(integer, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 7. resolve_action_from_metadata — SECURITY INVOKER
-- -----------------------------------------------------------------------------
drop function if exists public.resolve_action_from_metadata(text, integer);

create function public.resolve_action_from_metadata(
  p_mail_id text,
  p_max_results integer default 3,
  p_user_id uuid default null
)
returns table(rank integer, action_slug text, category text, display_name text, confidence numeric,
              tier text, autopilot_ok boolean, reasoning text, metadata_match jsonb)
language plpgsql
stable
set search_path to 'public'
as $function$
DECLARE
  v_enr public.mail_enrichment%ROWTYPE;
  v_mail public.mail_messages%ROWTYPE;
BEGIN
  -- De mail moet in scope liggen: anders routeert mailbox A op de metadata van
  -- een mail uit mailbox B zodra iemand het id kent.
  SELECT * INTO v_mail FROM public.mail_messages mm
   WHERE mm.id = p_mail_id
     AND public.mail_row_in_scope(mm.user_id, public.mail_scope_user_ids(p_user_id));
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_enr FROM public.mail_enrichment WHERE mail_id = p_mail_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      a.slug, a.category, a.display_name, a.match_gate,
      a.autopilot_eligible, a.autopilot_enabled,
      a.autopilot_min_conf, a.oneclick_min_conf,
      CASE WHEN a.speech_act_triggers = '{}' THEN 0.0
           WHEN v_enr.speech_act = ANY(a.speech_act_triggers) THEN 1.0
           ELSE -0.5 END AS s_speech,
      CASE WHEN a.topic_triggers = '{}' THEN 0.0
           WHEN v_enr.topics && a.topic_triggers THEN 1.0
           ELSE -0.3 END AS s_topic,
      CASE WHEN a.lifecycle_triggers = '{}' THEN 0.0
           WHEN v_enr.party_lifecycle_at_moment = ANY(a.lifecycle_triggers) THEN 1.0
           ELSE -0.2 END AS s_lifecycle,
      CASE WHEN a.party_type_triggers = '{}' THEN 0.0
           WHEN v_enr.party_type = ANY(a.party_type_triggers) THEN 1.0
           ELSE -0.3 END AS s_party,
      CASE WHEN a.cycle_stage_triggers = '{}' THEN 0.0
           WHEN v_enr.cycle_stage_signal = ANY(a.cycle_stage_triggers) THEN 1.0
           ELSE -0.1 END AS s_cycle,
      CASE WHEN a.sentiment_triggers = '{}' THEN 0.0
           WHEN v_enr.sentiment = ANY(a.sentiment_triggers) THEN 0.5
           ELSE -0.2 END AS s_sentiment,
      -- v3.1 werkstroom-G: intent-as. Lege intent_triggers = neutraal (0),
      -- zodat bestaande acties ongewijzigd scoren; alleen schedule.* leunt erop.
      CASE WHEN a.intent_triggers = '{}' THEN 0.0
           WHEN v_enr.intent_object = ANY(a.intent_triggers) THEN 1.0
           ELSE -0.3 END AS s_intent,
      jsonb_build_object(
        'speech_act',  CASE WHEN v_enr.speech_act = ANY(a.speech_act_triggers) THEN v_enr.speech_act ELSE NULL END,
        'topics',      CASE WHEN v_enr.topics && a.topic_triggers
                            THEN to_jsonb(ARRAY(SELECT unnest(v_enr.topics) INTERSECT SELECT unnest(a.topic_triggers))) ELSE NULL END,
        'party_type',  CASE WHEN v_enr.party_type = ANY(a.party_type_triggers) THEN v_enr.party_type ELSE NULL END,
        'lifecycle',   CASE WHEN v_enr.party_lifecycle_at_moment = ANY(a.lifecycle_triggers) THEN v_enr.party_lifecycle_at_moment ELSE NULL END,
        'cycle_stage', CASE WHEN v_enr.cycle_stage_signal = ANY(a.cycle_stage_triggers) THEN v_enr.cycle_stage_signal ELSE NULL END,
        'sentiment',   CASE WHEN v_enr.sentiment = ANY(a.sentiment_triggers) THEN v_enr.sentiment ELSE NULL END,
        'intent_object', CASE WHEN v_enr.intent_object = ANY(a.intent_triggers) THEN v_enr.intent_object ELSE NULL END
      ) AS match_detail
    FROM public.autodraft_actions a
    WHERE a.enabled = true
  ),
  weighted AS (
    SELECT s.*,
      GREATEST(0.0, LEAST(1.0,
        (s_speech * 0.30) + (s_topic * 0.25) + (s_lifecycle * 0.15) +
        (s_party * 0.15) + (s_cycle * 0.10) + (s_sentiment * 0.05) +
        (s_intent * 0.30)
      )) AS conf
    FROM scored s
  ),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY conf DESC, slug) AS rnk
    FROM weighted
    WHERE conf > 0.0
      AND ( match_gate = 'soft'
            OR (match_gate = 'topic'          AND s_topic > 0)
            OR (match_gate = 'party'          AND s_party > 0)
            OR (match_gate = 'topic_or_party' AND (s_topic > 0 OR s_party > 0))
            OR (match_gate = 'intent'         AND s_intent > 0) )
  )
  SELECT
    r.rnk::int,
    r.slug,
    r.category,
    r.display_name,
    ROUND(r.conf, 3),
    CASE
      WHEN r.conf >= r.autopilot_min_conf AND r.autopilot_eligible AND r.autopilot_enabled THEN 'autopilot'
      WHEN r.conf >= r.oneclick_min_conf THEN 'one-click'
      ELSE 'reasoned'
    END,
    (r.conf >= r.autopilot_min_conf AND r.autopilot_eligible AND r.autopilot_enabled),
    format('metadata-router: speech_act=%s, intent=%s, topics=%s, party=%s, lifecycle=%s, conf=%s',
      COALESCE(v_enr.speech_act, '?'),
      COALESCE(v_enr.intent_object, '?'),
      COALESCE(array_to_string(v_enr.topics, ','), '?'),
      COALESCE(v_enr.party_type, '?'),
      COALESCE(v_enr.party_lifecycle_at_moment, '?'),
      ROUND(r.conf, 2)::text),
    r.match_detail
  FROM ranked r
  WHERE r.rnk <= p_max_results
  ORDER BY r.rnk;
END;
$function$;

revoke all on function public.resolve_action_from_metadata(text, integer, uuid) from public;
grant execute on function public.resolve_action_from_metadata(text, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. get_recent_actions_for_sender — SECURITY DEFINER
-- -----------------------------------------------------------------------------
drop function if exists public.get_recent_actions_for_sender(text, integer);

create function public.get_recent_actions_for_sender(
  p_from_email text,
  p_limit integer default 5,
  p_user_id uuid default null
)
returns table(action_slug text, decided_at timestamp with time zone, was_suggested boolean,
              outcome text, payload jsonb, mail_subject text, mail_folder_path text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  WITH norm AS (
    SELECT LOWER(TRIM(p_from_email)) AS email,
           split_part(LOWER(TRIM(p_from_email)), '@', 2) AS domain
  )
  SELECT
    d.action_slug,
    d.decided_at,
    d.was_suggested,
    d.outcome,
    d.payload,
    m.subject       AS mail_subject,
    m.folder_path   AS mail_folder_path
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  CROSS  JOIN norm n
  WHERE  d.mail_id    IS NOT NULL
    AND  d.outcome    IS NOT NULL
    AND  public.mail_row_in_scope(m.user_id, (SELECT public.mail_definer_scope_ids(p_user_id)))
    AND  (
           LOWER(m.from_email) = n.email
        OR (n.domain <> '' AND LOWER(m.from_domain) = n.domain)
         )
  ORDER  BY d.decided_at DESC NULLS LAST
  LIMIT  GREATEST(p_limit, 1);
$function$;

comment on function public.get_recent_actions_for_sender(text, integer, uuid) is
  'AutoDraft v2 Fase 2b classifier-helper. Top-N meest recente acties die Jelle (of historisch=manual via Fase 0 backfill) ondernam voor deze afzender, binnen één mailbox. Match op exact-email of from_domain.';

revoke all on function public.get_recent_actions_for_sender(text, integer, uuid) from public;
grant execute on function public.get_recent_actions_for_sender(text, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. get_recent_actions_by_folder_pattern — SECURITY DEFINER
-- -----------------------------------------------------------------------------
drop function if exists public.get_recent_actions_by_folder_pattern(text, integer);

create function public.get_recent_actions_by_folder_pattern(
  p_pattern text,
  p_limit integer default 5,
  p_user_id uuid default null
)
returns table(action_slug text, decided_at timestamp with time zone, outcome text, payload jsonb,
              mail_subject text, mail_folder_path text, from_email text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT
    d.action_slug,
    d.decided_at,
    d.outcome,
    d.payload,
    m.subject       AS mail_subject,
    m.folder_path   AS mail_folder_path,
    m.from_email
  FROM   public.autodraft_action_decisions d
  JOIN   public.mail_messages              m  ON m.id = d.mail_id
  WHERE  d.mail_id    IS NOT NULL
    AND  d.outcome    IS NOT NULL
    AND  m.folder_path ILIKE p_pattern
    AND  public.mail_row_in_scope(m.user_id, (SELECT public.mail_definer_scope_ids(p_user_id)))
  ORDER  BY d.decided_at DESC NULLS LAST
  LIMIT  GREATEST(p_limit, 1);
$function$;

comment on function public.get_recent_actions_by_folder_pattern(text, integer, uuid) is
  'AutoDraft v2 Fase 2b classifier-helper. Top-N meest recente acties voor mails in folder-tree dat ILIKE matched, binnen één mailbox — foldernamen zijn niet uniek over mailboxen.';

revoke all on function public.get_recent_actions_by_folder_pattern(text, integer, uuid) from public;
grant execute on function public.get_recent_actions_by_folder_pattern(text, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 10. get_action_distribution_for_domain — SECURITY DEFINER
-- -----------------------------------------------------------------------------
drop function if exists public.get_action_distribution_for_domain(text);

create function public.get_action_distribution_for_domain(
  p_domain text,
  p_user_id uuid default null
)
returns table(action_slug text, n bigint, pct numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  WITH norm AS (SELECT LOWER(TRIM(p_domain)) AS d),
       counts AS (
         SELECT d.action_slug, count(*)::bigint AS n
         FROM   public.autodraft_action_decisions d
         JOIN   public.mail_messages              m  ON m.id = d.mail_id
         CROSS  JOIN norm n
         WHERE  d.mail_id    IS NOT NULL
           AND  d.outcome    IS NOT NULL
           AND  LOWER(m.from_domain) = n.d
           AND  public.mail_row_in_scope(m.user_id, (SELECT public.mail_definer_scope_ids(p_user_id)))
         GROUP  BY d.action_slug
       ),
       total AS (SELECT SUM(n)::numeric AS total FROM counts)
  SELECT
    c.action_slug,
    c.n,
    CASE WHEN t.total > 0 THEN ROUND( (c.n::numeric / t.total) * 100, 1) ELSE 0 END AS pct
  FROM   counts c
  CROSS  JOIN total t
  ORDER  BY c.n DESC
  LIMIT  10;
$function$;

comment on function public.get_action_distribution_for_domain(text, uuid) is
  'AutoDraft v2 Fase 2b classifier-helper. % distributie van action_slug voor alle mails van dit domein binnen één mailbox. Voor "usually gets X" signaal in prompt.';

revoke all on function public.get_action_distribution_for_domain(text, uuid) from public;
grant execute on function public.get_action_distribution_for_domain(text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. get_mail_kb_matches — owner-filter op de mail-chunk (§5 punt 4)
-- -----------------------------------------------------------------------------
drop function if exists public.get_mail_kb_matches(text, boolean, integer);

create function public.get_mail_kb_matches(
  p_mail_id text,
  p_refresh boolean default false,
  p_top integer default 5,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
-- 'extensions' erbij t.o.v. de vorige versie: het halfvec-type staat op prod in
-- `public` maar op Dev in `extensions` (deelkopie), en de DECLARE hieronder
-- wordt bij CREATE al geresolved. Met beide schema's werkt het op allebei.
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
declare
  v_emb halfvec(3072);
  v_matches jsonb;
  v_stored jsonb;
  v_stored_at timestamptz;
  v_scope uuid[];
begin
  perform require_dashboard_auth();
  v_scope := public.mail_definer_scope_ids(p_user_id);

  -- 1) Cache-pad: opgeslagen matches teruggeven tenzij refresh gevraagd.
  select kb_matches, kb_matches_at into v_stored, v_stored_at
  from autodraft_mails am
  where am.mail_id = p_mail_id
    and public.mail_row_in_scope(am.user_id, v_scope)
  order by am.scanned_at desc nulls last limit 1;

  if not p_refresh and v_stored is not null then
    return jsonb_build_object('ok', true, 'source', 'stored',
      'computed_at', v_stored_at, 'matches', v_stored);
  end if;

  -- 2) Embedding van de mail zelf (chunker indexeert elke mail als chunk).
  --    Owner-filter: zonder deze regel leest mailbox A de embedding van een
  --    mail-chunk van mailbox B zodra ze het mail-id kent.
  select c.embedding into v_emb
  from chunks c
  where c.source = 'mail' and c.source_id = p_mail_id and c.embedding is not null
    and public.mail_row_in_scope(c.owner_user_id, v_scope)
  order by (c.chunk_type = 'message') desc, c.sequence nulls first
  limit 1;

  if v_emb is null then
    -- Mail nog niet gechunkt (chunker-cron loopt async) — geen harde fout.
    return jsonb_build_object('ok', false, 'reason', 'not_chunked',
      'matches', coalesce(v_stored, '[]'::jsonb));
  end if;

  -- 3) Match tegen gevalideerde/gepubliceerde kennisbank-artikelen.
  select coalesce(jsonb_agg(m order by m.score desc), '[]'::jsonb)
  into v_matches
  from (
    select a.id, a.article_no, a.title, a.summary, a.kb_category,
           a.article_type, a.audience,
           round((1 - (a.embedding <=> v_emb))::numeric, 3) as score
    from kb_articles a
    where a.embedding is not null
      and a.status in ('gevalideerd', 'gepubliceerd')
    order by a.embedding <=> v_emb
    limit greatest(1, least(coalesce(p_top, 5), 10))
  ) m;

  -- 4) Cachen op de autodraft-rij (indien aanwezig; pseudo-pending mails
  --    hebben nog geen rij — dan alleen live teruggeven).
  update autodraft_mails am
  set kb_matches = v_matches, kb_matches_at = now()
  where am.mail_id = p_mail_id
    and public.mail_row_in_scope(am.user_id, v_scope);

  return jsonb_build_object('ok', true, 'source', 'live',
    'computed_at', now(), 'matches', v_matches);
end;
$function$;

revoke all on function public.get_mail_kb_matches(text, boolean, integer, uuid) from public;
grant execute on function public.get_mail_kb_matches(text, boolean, integer, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 12. resolve_party_at_moment — own_domains uit de registry (§5 punt 3)
-- -----------------------------------------------------------------------------
-- Signature blijft gelijk: de eigenaar volgt uit de mail-rij zelf, niet uit een
-- parameter. 'legal-mind.nl' blijft de fallback zolang een mailbox geen
-- own_domains heeft staan — anders zou een lege registry-rij elke eigen mail
-- opeens als 'extern' classificeren.
create or replace function public.resolve_party_at_moment(p_mail_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
DECLARE
  v_mail RECORD;
  v_own_domains text[];
  v_klant_subtype text;
  v_external jsonb;
  v_classification text;
  v_party_type text;
  v_company_id text;
  v_deal_id text;
  v_contact_id text;
  v_lifecycle_at text;
  v_lifecycle_now text;
  v_first_seen timestamptz;
  v_relationship_age int;
  v_historical_inference boolean := false;
  v_source text;
BEGIN
  SELECT id, from_email, from_domain, received_at, is_from_me, user_id, is_calendar_invite, subject
    INTO v_mail FROM public.mail_messages WHERE id = p_mail_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'mail_not_found'); END IF;

  -- Calendar-invite shortcut (pre-filter pakt eigenlijk al, dit is defensief)
  IF v_mail.is_calendar_invite THEN
    RETURN jsonb_build_object(
      'party_type', 'onbekend', 'source', 'calendar_invite_skip',
      'party_lifecycle_at_moment', NULL, 'party_lifecycle_now', NULL,
      'related_company_id', NULL, 'related_deal_id', NULL, 'related_contact_id', NULL,
      'relationship_age_days', NULL, 'historical_inference', false
    );
  END IF;

  -- Eigen domeinen van DEZE mailbox uit de registry.
  SELECT a.own_domains INTO v_own_domains
    FROM public.mail_accounts a WHERE a.user_id = v_mail.user_id LIMIT 1;
  IF v_own_domains IS NULL OR cardinality(v_own_domains) = 0 THEN
    v_own_domains := ARRAY['legal-mind.nl']::text[];
  END IF;

  -- Step 1: OWN-DOMAIN check FIRST — een eigen domein is altijd intern,
  -- ongeacht wie de afzender is (Jelle of collega)
  IF lower(v_mail.from_domain) = ANY (ARRAY(SELECT lower(d) FROM unnest(v_own_domains) d)) THEN
    v_party_type := 'intern';
    v_source := 'own_domain';
  END IF;

  -- Step 2: HubSpot klant-resolver (alleen als nog geen party_type)
  IF v_party_type IS NULL THEN
    v_klant_subtype := public.resolve_klant_subtype(v_mail.from_email);
    IF v_klant_subtype IS NOT NULL THEN
      v_party_type := CASE v_klant_subtype
        WHEN 'klant_customer_base'    THEN 'customer'
        WHEN 'klant_pilot'            THEN 'pilot'
        WHEN 'klant_sales_lead'       THEN 'sales_lead'
        WHEN 'klant_sales_opvolging'  THEN 'sales_opvolging'
        ELSE NULL
      END;
      v_source := 'hubspot_pipeline';
    END IF;
  END IF;

  -- Step 3: external_party_directory met DOMAIN (niet email — BUG B fix)
  IF v_party_type IS NULL THEN
    v_external := public.classify_external_party(v_mail.from_domain);
    v_classification := v_external->>'classification';
    v_party_type := CASE v_classification
      WHEN 'vendor'     THEN 'vendor'
      WHEN 'partner'    THEN 'partner'
      WHEN 'community'  THEN 'partner'
      WHEN 'recruiter'  THEN 'recruitment'
      WHEN 'press'      THEN 'press'
      WHEN 'spam'       THEN 'spam'
      WHEN 'internal'   THEN 'intern'
      ELSE NULL
    END;
    IF v_party_type IS NOT NULL THEN v_source := 'external_party_directory'; END IF;
  END IF;

  -- Step 4: Sent-by-me fallback (alleen als nog niets — voor mails van de
  -- mailbox-eigenaar naar onbekende domeinen die we toch als "intern" willen markeren)
  IF v_party_type IS NULL AND v_mail.is_from_me THEN
    v_party_type := 'intern';
    v_source := 'sent_by_me';
  END IF;

  -- Step 5: entity_resolution lookups voor FK's
  SELECT er.entity_id::text INTO v_company_id
    FROM public.entity_resolution er
   WHERE er.alias_type='email_domain' AND er.entity_type='company'
     AND lower(er.alias_value) = lower(v_mail.from_domain)
   LIMIT 1;

  SELECT er.entity_id::text INTO v_contact_id
    FROM public.entity_resolution er
   WHERE er.alias_type='email' AND er.entity_type='contact'
     AND lower(er.alias_value) = lower(v_mail.from_email)
   LIMIT 1;

  IF v_company_id IS NOT NULL THEN
    SELECT d.deal_id INTO v_deal_id
      FROM public.hubspot_deals d
     WHERE NOT d.is_archived AND v_company_id = ANY(d.associated_company_ids)
     ORDER BY d.hs_lastmodifieddate DESC LIMIT 1;
  END IF;

  -- Step 6: Lifecycle uit tijdmachine
  IF v_company_id IS NOT NULL THEN
    SELECT lcl.stage INTO v_lifecycle_at
      FROM public.mail_party_lifecycle_log lcl
     WHERE lcl.user_id = v_mail.user_id AND lcl.company_id = v_company_id
       AND lcl.valid_from <= v_mail.received_at
       AND (lcl.valid_to IS NULL OR lcl.valid_to > v_mail.received_at)
     ORDER BY lcl.valid_from DESC LIMIT 1;

    SELECT lcl.stage INTO v_lifecycle_now
      FROM public.mail_party_lifecycle_log lcl
     WHERE lcl.user_id = v_mail.user_id AND lcl.company_id = v_company_id
       AND lcl.valid_to IS NULL
     ORDER BY lcl.valid_from DESC LIMIT 1;

    IF v_lifecycle_at IS NULL AND v_party_type IN ('customer','pilot','sales_lead','sales_opvolging') THEN
      v_lifecycle_at := CASE v_party_type
        WHEN 'customer'         THEN 'active'
        WHEN 'pilot'            THEN 'trial'
        WHEN 'sales_lead'       THEN 'prospect'
        WHEN 'sales_opvolging'  THEN 'prospect'
        ELSE NULL END;
      v_historical_inference := true;
    END IF;
    IF v_lifecycle_now IS NULL THEN v_lifecycle_now := v_lifecycle_at; END IF;

    SELECT MIN(received_at) INTO v_first_seen
      FROM public.mail_messages
     WHERE user_id = v_mail.user_id AND from_domain = v_mail.from_domain;
    IF v_first_seen IS NOT NULL THEN
      v_relationship_age := EXTRACT(DAY FROM v_mail.received_at - v_first_seen)::int;
    END IF;
  END IF;

  -- Step 7: Final fallback
  IF v_party_type IS NULL THEN
    v_party_type := 'onbekend';
    v_source := 'fallback';
  END IF;

  RETURN jsonb_build_object(
    'party_type', v_party_type,
    'party_lifecycle_at_moment', v_lifecycle_at,
    'party_lifecycle_now', v_lifecycle_now,
    'related_company_id', v_company_id,
    'related_deal_id', v_deal_id,
    'related_contact_id', v_contact_id,
    'relationship_age_days', v_relationship_age,
    'historical_inference', v_historical_inference,
    'source', v_source
  );
END $function$;

comment on function public.resolve_party_at_moment(text) is
  'Identity-resolver v3 (2026-09-02): own-domain komt uit mail_accounts.own_domains van de mailbox waar de mail in zit, met legal-mind.nl als fallback. v2 (2026-05-28): classify_external_party krijgt from_domain i.p.v. het volledige adres; own-domain check vóór de HubSpot-lookup.';

commit;

notify pgrst, 'reload schema';
