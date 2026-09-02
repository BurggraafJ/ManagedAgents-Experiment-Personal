-- =============================================================================
-- RAG RPC documentation snapshot
-- Gegenereerd: 2026-05-03T14:01:48.047Z
-- Onderdeel van Fase R.1 (Repo-hygiëne) — zie current_architecture.md §7
-- =============================================================================
--
-- DOEL: single source of truth voor RPC-definities die de Intelligence-stack
-- draaiend houden. Eerder leefden deze in Supabase Studio zonder versie-controle.
-- Vanaf nu: edit dit bestand → `supabase db push` (of via Management API).
--
-- BIJWERKEN bij wijziging: edit de relevante CREATE OR REPLACE en commit.
-- Niet opnieuw genereren — dat overschrijft handmatige verbeteringen.
-- =============================================================================


-- =============================================================================
-- match_all_sources
-- =============================================================================

-- args: query_embedding vector, top_k integer, filter_sources text[], filter_after timestamp with time zone, filter_from_domain text, filter_engagement_type text, filter_owner_id text, filter_company_id text, filter_project_key text, min_similarity double precision
CREATE OR REPLACE FUNCTION public.match_all_sources(query_embedding vector, top_k integer DEFAULT 5, filter_sources text[] DEFAULT NULL::text[], filter_after timestamp with time zone DEFAULT NULL::timestamp with time zone, filter_from_domain text DEFAULT NULL::text, filter_engagement_type text DEFAULT NULL::text, filter_owner_id text DEFAULT NULL::text, filter_company_id text DEFAULT NULL::text, filter_project_key text DEFAULT NULL::text, min_similarity double precision DEFAULT 0.3)
 RETURNS TABLE(source text, id text, subject text, preview text, occurred_at timestamp with time zone, from_label text, meta jsonb, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH mail_hits AS (
    SELECT 'mail'::text AS source, m.id::text,
      m.subject,
      left(strip_html_inline(coalesce(nullif(m.body_preview, ''), m.body_text)), 240) AS preview,
      m.received_at AS occurred_at,
      coalesce(m.from_name, m.from_email) AS from_label,
      jsonb_build_object(
        'folder_path', m.folder_path, 'is_from_me', m.is_from_me,
        'from_domain', m.from_domain, 'has_attachments', m.has_attachments,
        'conversation_id', m.conversation_id
      ) AS meta,
      1 - (m.embedding <=> query_embedding) AS similarity
    FROM mail_messages m
    WHERE m.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'mail' = ANY(filter_sources))
      AND (filter_after IS NULL OR m.received_at >= filter_after)
      AND (filter_from_domain IS NULL OR m.from_domain = filter_from_domain)
      AND m.is_deleted = false
    ORDER BY m.embedding <=> query_embedding LIMIT top_k * 5
  ),
  eng_hits AS (
    SELECT 'engagement'::text AS source, e.id::text,
      e.subject, left(strip_html_inline(e.body_text), 240) AS preview,
      coalesce(e.hs_timestamp, e.hs_created_at) AS occurred_at,
      e.hubspot_owner_id AS from_label,
      jsonb_build_object('engagement_type', e.engagement_type,
        'companies', e.associated_company_ids, 'contacts', e.associated_contact_ids,
        'deals', e.associated_deal_ids) AS meta,
      1 - (e.embedding <=> query_embedding) AS similarity
    FROM hubspot_engagements e
    WHERE e.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'engagement' = ANY(filter_sources))
      AND (filter_after IS NULL OR coalesce(e.hs_timestamp, e.hs_created_at) >= filter_after)
      AND (filter_engagement_type IS NULL OR e.engagement_type = filter_engagement_type)
      AND (filter_owner_id IS NULL OR e.hubspot_owner_id = filter_owner_id)
      AND (filter_company_id IS NULL OR filter_company_id = ANY(e.associated_company_ids))
      AND e.is_archived = false
    ORDER BY e.embedding <=> query_embedding LIMIT top_k * 5
  ),
  jira_hits AS (
    SELECT 'jira'::text AS source, j.issue_key::text AS id,
      j.summary AS subject, left(strip_html_inline(j.description), 240) AS preview,
      j.jira_updated_at AS occurred_at, j.assignee_name AS from_label,
      jsonb_build_object('project_key', j.project_key, 'status', j.status,
        'priority', j.priority, 'issue_type', j.issue_type,
        'in_backlog', j.in_backlog, 'in_sprint', j.in_sprint, 'url', j.url) AS meta,
      1 - (j.embedding <=> query_embedding) AS similarity
    FROM jira_issues j
    WHERE j.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'jira' = ANY(filter_sources))
      AND (filter_after IS NULL OR j.jira_updated_at >= filter_after)
      AND (filter_project_key IS NULL OR j.project_key = filter_project_key)
    ORDER BY j.embedding <=> query_embedding LIMIT top_k * 5
  ),
  deal_hits AS (
    SELECT 'deal'::text AS source, d.deal_id::text AS id,
      d.dealname AS subject, coalesce(d.dealstage, d.dealtype) AS preview,
      d.hs_lastmodifieddate AS occurred_at, d.hubspot_owner_id AS from_label,
      jsonb_build_object('pipeline_id', d.pipeline_id, 'stage', d.dealstage,
        'amount', d.amount, 'closedate', d.closedate,
        'companies', d.associated_company_ids, 'contacts', d.associated_contact_ids) AS meta,
      1 - (d.embedding <=> query_embedding) AS similarity
    FROM hubspot_deals d
    WHERE d.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'deal' = ANY(filter_sources))
      AND (filter_after IS NULL OR d.hs_lastmodifieddate >= filter_after)
      AND (filter_owner_id IS NULL OR d.hubspot_owner_id = filter_owner_id)
      AND (filter_company_id IS NULL OR filter_company_id = ANY(d.associated_company_ids))
      AND d.is_archived = false
    ORDER BY d.embedding <=> query_embedding LIMIT top_k * 5
  ),
  company_hits AS (
    SELECT 'company'::text AS source, c.company_id::text AS id,
      c.name AS subject, coalesce(c.industry, c.properties->>'domain') AS preview,
      c.hs_lastmodifieddate AS occurred_at, (c.properties->>'domain')::text AS from_label,
      jsonb_build_object('industry', c.industry, 'domain', c.properties->>'domain',
        'city', c.properties->>'city', 'country', c.properties->>'country') AS meta,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM hubspot_companies c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'company' = ANY(filter_sources))
      AND (filter_after IS NULL OR c.hs_lastmodifieddate >= filter_after)
      AND (filter_company_id IS NULL OR c.company_id = filter_company_id)
    ORDER BY c.embedding <=> query_embedding LIMIT top_k * 5
  ),
  contact_hits AS (
    SELECT 'contact'::text AS source, c.contact_id::text AS id,
      coalesce(nullif(trim(coalesce(c.firstname, '') || ' ' || coalesce(c.lastname, '')), ''), c.email) AS subject,
      c.jobtitle AS preview, c.hs_lastmodifieddate AS occurred_at, c.email AS from_label,
      jsonb_build_object('firstname', c.firstname, 'lastname', c.lastname,
        'email', c.email, 'jobtitle', c.jobtitle,
        'company', c.properties->>'company', 'phone', c.properties->>'phone') AS meta,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM hubspot_contacts c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'contact' = ANY(filter_sources))
      AND (filter_after IS NULL OR c.hs_lastmodifieddate >= filter_after)
    ORDER BY c.embedding <=> query_embedding LIMIT top_k * 5
  ),
  meeting_hits AS (
    SELECT 'meeting'::text AS source, f.fireflies_id::text AS id,
      f.title AS subject,
      left(coalesce(f.summary_text, f.transcript_text), 240) AS preview,
      f.date_time AS occurred_at, f.organizer_email AS from_label,
      jsonb_build_object('duration_min', f.duration_min, 'attendees', f.attendees,
        'meeting_url', f.meeting_url, 'has_action_items', f.action_items IS NOT NULL) AS meta,
      1 - (f.embedding <=> query_embedding) AS similarity
    FROM fireflies_meetings f
    WHERE f.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'meeting' = ANY(filter_sources))
      AND (filter_after IS NULL OR f.date_time >= filter_after)
    ORDER BY f.embedding <=> query_embedding LIMIT top_k * 5
  ),
  event_hits AS (
    SELECT 'event'::text AS source, c.graph_id::text AS id,
      c.subject AS subject,
      left(coalesce(nullif(c.body_preview,''), c.body_text, c.location_text), 240) AS preview,
      c.start_time AS occurred_at, coalesce(c.organizer_email, c.organizer_name) AS from_label,
      jsonb_build_object('end_time', c.end_time, 'is_all_day', c.is_all_day,
        'location', c.location_text, 'is_organizer', c.is_organizer,
        'response_status', c.response_status, 'is_recurring', c.is_recurring,
        'fireflies_meeting_id', c.fireflies_meeting_id) AS meta,
      1 - (c.embedding <=> query_embedding) AS similarity
    FROM calendar_events c
    WHERE c.embedding IS NOT NULL
      AND (filter_sources IS NULL OR 'event' = ANY(filter_sources))
      AND (filter_after IS NULL OR c.start_time >= filter_after)
      AND c.is_cancelled = false
    ORDER BY c.embedding <=> query_embedding LIMIT top_k * 5
  )
  SELECT * FROM mail_hits     WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM eng_hits      WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM jira_hits     WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM deal_hits     WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM company_hits  WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM contact_hits  WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM meeting_hits  WHERE similarity >= min_similarity
  UNION ALL SELECT * FROM event_hits    WHERE similarity >= min_similarity
  ORDER BY similarity DESC
  LIMIT top_k
$function$
;

-- =============================================================================
-- match_chunks: NOT FOUND on 2026_05_03
-- =============================================================================


-- =============================================================================
-- sync_health
-- =============================================================================

-- args: source_name text, max_age_minutes integer
CREATE OR REPLACE FUNCTION public.sync_health(source_name text, max_age_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_sync timestamptz; v_count bigint; v_age_min numeric; v_max integer;
  v_fresh boolean; v_warning text; v_meta jsonb := '{}'::jsonb;
BEGIN
  v_max := COALESCE(max_age_minutes, CASE source_name
    WHEN 'mail'        THEN 30
    WHEN 'engagement'  THEN 120
    WHEN 'jira'        THEN 30
    WHEN 'deal'        THEN 30
    WHEN 'company'     THEN 30
    WHEN 'contact'     THEN 30
    WHEN 'embedding'   THEN 15
    WHEN 'meeting'     THEN 30
    WHEN 'event'       THEN 30
    ELSE 60
  END);

  IF source_name = 'mail' THEN
    SELECT max(synced_at), count(*) INTO v_last_sync, v_count FROM mail_messages;
    v_meta := jsonb_build_object('source_table', 'mail_messages.synced_at');
  ELSIF source_name = 'engagement' THEN
    SELECT max(synced_at), count(*) INTO v_last_sync, v_count FROM hubspot_engagements;
    v_meta := jsonb_build_object('source_table', 'hubspot_engagements.synced_at');
  ELSIF source_name = 'jira' THEN
    SELECT last_delta_sync INTO v_last_sync FROM jira_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM jira_issues;
    v_meta := jsonb_build_object('source_table', 'jira_sync_state.last_delta_sync');
  ELSIF source_name = 'deal' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_deals;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'company' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_companies;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'contact' THEN
    SELECT last_delta_sync INTO v_last_sync FROM hubspot_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM hubspot_contacts;
    v_meta := jsonb_build_object('source_table', 'hubspot_sync_state.last_delta_sync');
  ELSIF source_name = 'meeting' THEN
    SELECT last_delta_sync_at INTO v_last_sync FROM fireflies_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM fireflies_meetings;
    v_meta := jsonb_build_object('source_table', 'fireflies_sync_state.last_delta_sync_at');
  ELSIF source_name = 'event' THEN
    SELECT last_delta_sync_at INTO v_last_sync FROM calendar_sync_state WHERE id = 1;
    SELECT count(*) INTO v_count FROM calendar_events;
    v_meta := jsonb_build_object('source_table', 'calendar_sync_state.last_delta_sync_at');
  ELSIF source_name = 'embedding' THEN
    SELECT max(t) INTO v_last_sync FROM (
      SELECT max(embedded_at) AS t FROM mail_messages
      UNION ALL SELECT max(embedded_at) FROM hubspot_engagements
      UNION ALL SELECT max(embedded_at) FROM jira_issues
      UNION ALL SELECT max(embedded_at) FROM hubspot_deals
      UNION ALL SELECT max(embedded_at) FROM hubspot_companies
      UNION ALL SELECT max(embedded_at) FROM hubspot_contacts
      UNION ALL SELECT max(embedded_at) FROM fireflies_meetings
      UNION ALL SELECT max(embedded_at) FROM calendar_events
    ) sub;
    SELECT
      (SELECT count(*) FROM mail_messages       WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM hubspot_engagements WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM jira_issues         WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM hubspot_deals       WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM hubspot_companies   WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM hubspot_contacts    WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM fireflies_meetings  WHERE embedding IS NOT NULL) +
      (SELECT count(*) FROM calendar_events     WHERE embedding IS NOT NULL)
    INTO v_count;
    v_meta := jsonb_build_object('source_table', 'max(embedded_at) over 8 tabellen');
  ELSE
    RETURN jsonb_build_object('source', source_name, 'is_fresh', false, 'warning', format('unknown_source: %s', source_name));
  END IF;

  IF v_last_sync IS NULL THEN
    v_age_min := NULL; v_fresh := false; v_warning := 'no_sync_yet';
  ELSE
    v_age_min := EXTRACT(EPOCH FROM (now() - v_last_sync)) / 60.0;
    v_fresh := v_age_min <= v_max;
    v_warning := CASE WHEN v_fresh THEN NULL ELSE 'stale' END;
  END IF;

  RETURN jsonb_build_object(
    'source', source_name, 'last_sync_at', v_last_sync,
    'age_minutes', v_age_min, 'max_age_minutes', v_max,
    'is_fresh', v_fresh, 'source_count', v_count,
    'warning', v_warning, 'meta', v_meta, 'checked_at', now()
  );
END;
$function$
;

-- =============================================================================
-- sync_health_all
-- =============================================================================

-- args: 
CREATE OR REPLACE FUNCTION public.sync_health_all()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'mail', sync_health('mail'),
    'engagement', sync_health('engagement'),
    'jira', sync_health('jira'),
    'deal', sync_health('deal'),
    'company', sync_health('company'),
    'contact', sync_health('contact'),
    'meeting', sync_health('meeting'),
    'event', sync_health('event'),
    'embedding', sync_health('embedding'),
    'all_fresh', (
      (sync_health('mail')->>'is_fresh')::boolean AND
      (sync_health('engagement')->>'is_fresh')::boolean AND
      (sync_health('jira')->>'is_fresh')::boolean AND
      (sync_health('deal')->>'is_fresh')::boolean AND
      (sync_health('company')->>'is_fresh')::boolean AND
      (sync_health('contact')->>'is_fresh')::boolean AND
      (sync_health('meeting')->>'is_fresh')::boolean AND
      (sync_health('event')->>'is_fresh')::boolean AND
      (sync_health('embedding')->>'is_fresh')::boolean
    ),
    'checked_at', now()
  )
$function$
;

-- =============================================================================
-- assert_freshness
-- =============================================================================

-- args: source_name text, max_age_minutes integer
CREATE OR REPLACE FUNCTION public.assert_freshness(source_name text, max_age_minutes integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_health jsonb;
BEGIN
  v_health := sync_health(source_name, max_age_minutes);
  IF (v_health->>'is_fresh')::boolean = false THEN
    RAISE EXCEPTION 'sync_stale: source=% age=% min, threshold=% min, last_sync=%',
      source_name,
      v_health->>'age_minutes',
      v_health->>'max_age_minutes',
      v_health->>'last_sync_at';
  END IF;
END;
$function$
;

-- =============================================================================
-- match_jellemind_lessons
-- =============================================================================

-- args: query_embedding vector, top_k integer, applies_to_filter text, filter_lesson_type text, min_similarity double precision, mind_scope_filter text
CREATE OR REPLACE FUNCTION public.match_jellemind_lessons(query_embedding vector, top_k integer DEFAULT 5, applies_to_filter text DEFAULT NULL::text, filter_lesson_type text DEFAULT NULL::text, min_similarity double precision DEFAULT 0.3, mind_scope_filter text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, lesson_text text, lesson_type text, applies_to text[], evidence_summary text, mind_scope text, similarity double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    l.id, l.lesson_text, l.lesson_type, l.applies_to,
    l.evidence_summary, l.mind_scope,
    (1 - (l.embedding <=> query_embedding))::double precision AS similarity
  FROM public.jellemind_lessons l
  WHERE l.active = true
    AND l.embedding IS NOT NULL
    AND (
      applies_to_filter IS NULL
      OR applies_to_filter = ANY (l.applies_to)
      OR '*' = ANY (l.applies_to)
    )
    AND (filter_lesson_type IS NULL OR l.lesson_type = filter_lesson_type)
    AND (mind_scope_filter IS NULL OR l.mind_scope = mind_scope_filter)
    AND (1 - (l.embedding <=> query_embedding)) >= min_similarity
  ORDER BY l.embedding <=> query_embedding
  LIMIT top_k;
$function$
;

-- =============================================================================
-- submit_jellemind_decision
-- =============================================================================

-- args: p_proposal_id uuid, p_action text, p_amendment text, p_reason text, p_lesson_text_override text, p_applies_to_override text[], p_mind_scope_override text
CREATE OR REPLACE FUNCTION public.submit_jellemind_decision(p_proposal_id uuid, p_action text, p_amendment text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_lesson_text_override text DEFAULT NULL::text, p_applies_to_override text[] DEFAULT NULL::text[], p_mind_scope_override text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_proposal record;
  v_new_lesson_id uuid;
  v_final_text text;
  v_final_applies_to text[];
  v_final_scope text;
BEGIN
  IF p_action NOT IN ('accept','reject','amend') THEN
    RAISE EXCEPTION 'invalid action: %', p_action USING ERRCODE = '22023';
  END IF;

  IF p_mind_scope_override IS NOT NULL
     AND p_mind_scope_override NOT IN ('jelle','skill','legalmind') THEN
    RAISE EXCEPTION 'invalid mind_scope: %', p_mind_scope_override USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_proposal
    FROM public.jellemind_lesson_proposals
   WHERE id = p_proposal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal not found: %', p_proposal_id USING ERRCODE = '22023';
  END IF;

  IF v_proposal.status <> 'pending' THEN
    RAISE EXCEPTION 'proposal already reviewed: status=%', v_proposal.status USING ERRCODE = '22023';
  END IF;

  IF p_action = 'accept' THEN
    v_final_text := COALESCE(p_lesson_text_override, v_proposal.lesson_text);
    v_final_applies_to := COALESCE(p_applies_to_override, v_proposal.applies_to);
    v_final_scope := COALESCE(p_mind_scope_override, v_proposal.mind_scope);

    INSERT INTO public.jellemind_lessons (
      lesson_text, lesson_type, applies_to, evidence_summary, created_from_proposal_id, mind_scope
    ) VALUES (
      v_final_text, v_proposal.lesson_type, v_final_applies_to,
      v_proposal.evidence_summary, v_proposal.id, v_final_scope
    )
    RETURNING id INTO v_new_lesson_id;

    UPDATE public.jellemind_lesson_proposals
       SET status = 'accepted',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           resulting_lesson_id = v_new_lesson_id
     WHERE id = p_proposal_id;

    UPDATE public.jellemind_signals
       SET processed = true, processed_at = now()
     WHERE id = ANY (v_proposal.signal_ids) AND processed = false;

    RETURN jsonb_build_object(
      'ok', true, 'action', 'accept',
      'proposal_id', p_proposal_id,
      'lesson_id', v_new_lesson_id,
      'mind_scope', v_final_scope
    );

  ELSIF p_action = 'reject' THEN
    UPDATE public.jellemind_lesson_proposals
       SET status = 'rejected',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           review_reason = p_reason
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object('ok', true, 'action', 'reject', 'proposal_id', p_proposal_id);

  ELSE  -- amend
    IF p_amendment IS NULL OR length(trim(p_amendment)) = 0 THEN
      RAISE EXCEPTION 'amend requires amendment text' USING ERRCODE = '22023';
    END IF;

    UPDATE public.jellemind_lesson_proposals
       SET status = 'amended',
           reviewed_at = now(),
           reviewed_by = 'jelle',
           amend_instructions = p_amendment
     WHERE id = p_proposal_id;

    RETURN jsonb_build_object('ok', true, 'action', 'amend', 'proposal_id', p_proposal_id);
  END IF;
END;
$function$
;

-- =============================================================================
-- get_skill_secret_service
-- =============================================================================

-- args: p_skill_name text, p_secret_name text
CREATE OR REPLACE FUNCTION public.get_skill_secret_service(p_skill_name text, p_secret_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'vault'
AS $function$
DECLARE
  v_value text;
BEGIN
  SELECT decrypted_secret INTO v_value
  FROM vault.decrypted_secrets
  WHERE name = format('skill:%s:%s', p_skill_name, p_secret_name);
  RETURN v_value;
END;
$function$
;

-- =============================================================================
-- search_contactpersonen
-- =============================================================================

-- args: query text, limit_n integer, filter_type text
CREATE OR REPLACE FUNCTION public.search_contactpersonen(query text, limit_n integer DEFAULT 10, filter_type text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, email text, display_naam text, firm_naam text, contact_type text, functietitel text, last_seen_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.email, COALESCE(c.display_naam, c.email), c.firm_naam, c.contact_type, c.functietitel, c.last_seen_at
  FROM contactpersonen c
  WHERE NOT c.is_deleted
    AND (filter_type IS NULL OR c.contact_type = filter_type)
    AND (c.email ILIKE '%' || query || '%' OR c.display_naam ILIKE '%' || query || '%' OR c.voornaam ILIKE '%' || query || '%' OR c.achternaam ILIKE '%' || query || '%' OR c.firm_naam ILIKE '%' || query || '%')
  ORDER BY CASE WHEN c.email ILIKE query || '%' THEN 0 WHEN c.display_naam ILIKE query || '%' THEN 1 WHEN c.voornaam ILIKE query || '%' THEN 2 ELSE 3 END, c.last_seen_at DESC NULLS LAST
  LIMIT limit_n;
$function$
;

-- =============================================================================
-- suggest_task_project
-- =============================================================================

-- args: p_title text, p_notes text, p_top_n integer
CREATE OR REPLACE FUNCTION public.suggest_task_project(p_title text, p_notes text DEFAULT NULL::text, p_top_n integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_top_n int := greatest(1, least(p_top_n, 10));
  v_query text := coalesce(p_title, '') || ' ' || coalesce(p_notes, '');
  v_result jsonb;
BEGIN
  IF nullif(trim(v_query), '') IS NULL THEN
    RETURN jsonb_build_object('candidates', '[]'::jsonb, 'best_match', NULL);
  END IF;

  WITH proj_scores AS (
    SELECT
      tp.id           AS project_id,
      tp.name         AS project_name,
      tp.ai_match_hint,
      greatest(
        similarity(coalesce(p_title,''), coalesce(tp.ai_match_hint,'')),
        similarity(coalesce(p_notes,''), coalesce(tp.ai_match_hint,'')) * 0.7,
        similarity(coalesce(p_title,''), coalesce(tp.name,'')) * 0.6
      ) AS hint_score
    FROM task_projects tp
    WHERE tp.status = 'active'
  ),
  ranked_siblings AS (
    SELECT
      t.project_id,
      similarity(coalesce(t.title,''), p_title) AS sim,
      row_number() OVER (
        PARTITION BY t.project_id
        ORDER BY similarity(coalesce(t.title,''), p_title) DESC
      ) AS rn
    FROM tasks t
    WHERE t.project_id IS NOT NULL
      AND t.status NOT IN ('done','dropped')
      AND length(coalesce(t.title,'')) > 0
  ),
  agg_siblings AS (
    SELECT
      project_id,
      avg(sim) AS sibling_score,
      count(*) AS sibling_count
    FROM ranked_siblings
    WHERE rn <= 3
    GROUP BY project_id
  ),
  scored AS (
    SELECT
      ps.project_id,
      ps.project_name,
      ps.hint_score,
      coalesce(ag.sibling_score, 0) AS sibling_score,
      coalesce(ag.sibling_count, 0) AS sibling_count,
      least(
        1.0::real,
        ps.hint_score::real + coalesce(ag.sibling_score, 0)::real * 0.4
      ) AS combined_score
    FROM proj_scores ps
    LEFT JOIN agg_siblings ag USING (project_id)
  ),
  topn AS (
    SELECT * FROM scored
     WHERE combined_score > 0
     ORDER BY combined_score DESC
     LIMIT v_top_n
  )
  SELECT jsonb_build_object(
    'candidates', coalesce(jsonb_agg(
      jsonb_build_object(
        'project_id', project_id,
        'project_name', project_name,
        'hint_score', round(hint_score::numeric, 3),
        'sibling_score', round(sibling_score::numeric, 3),
        'sibling_count', sibling_count,
        'combined_score', round(combined_score::numeric, 3)
      ) ORDER BY combined_score DESC
    ), '[]'::jsonb),
    'best_match', (
      SELECT jsonb_build_object(
        'project_id', project_id,
        'project_name', project_name,
        'combined_score', round(combined_score::numeric, 3)
      )
      FROM scored
      WHERE combined_score >= 0.4
      ORDER BY combined_score DESC
      LIMIT 1
    )
  )
  INTO v_result
  FROM topn;

  RETURN coalesce(v_result, jsonb_build_object('candidates', '[]'::jsonb, 'best_match', NULL));
END;
$function$
;

-- =============================================================================
-- detect_task_completion_candidates
-- =============================================================================

-- args: p_lookback_days integer, p_min_confidence numeric, p_apply boolean
CREATE OR REPLACE FUNCTION public.detect_task_completion_candidates(p_lookback_days integer DEFAULT 30, p_min_confidence numeric DEFAULT 0.6, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_since timestamptz := now() - (greatest(1, p_lookback_days) || ' days')::interval;
  v_min_conf numeric := greatest(0.0, least(p_min_confidence, 1.0));
  v_candidates jsonb;
  v_applied int := 0;
BEGIN
  WITH open_tasks AS (
    SELECT id, title, coalesce(notes,'') AS notes
      FROM tasks
     WHERE status = 'open'
       AND coalesce(completion_rejected, false) = false
       AND (
         completion_candidate IS NOT TRUE
         OR completion_detected_at IS NULL
         OR completion_detected_at < now() - interval '7 days'
       )
  ),
  c_autodraft AS (
    SELECT t.id AS task_id,
           'autodraft'::text AS source,
           similarity(t.title, coalesce(d.amend_instructions,''))::real AS conf,
           ('Mail-actie via auto-draft op ' || to_char(d.executed_at,'YYYY-MM-DD'))::text AS evidence_text,
           NULL::text AS evidence_url
      FROM open_tasks t
      JOIN autodraft_decisions d
        ON d.action = 'send'
       AND d.execution_status = 'done'
       AND d.executed_at >= v_since
     WHERE d.amend_instructions IS NOT NULL
       AND similarity(t.title, d.amend_instructions) >= 0.4
  ),
  c_sales AS (
    SELECT t.id AS task_id,
           'sales_todos'::text,
           greatest(
             similarity(t.title, s.company_name),
             similarity(t.notes, s.company_name)
           )::real AS conf,
           ('Sales-todo voor ' || s.company_name || ' afgerond op ' || to_char(s.completed_at,'YYYY-MM-DD'))::text,
           NULL::text
      FROM open_tasks t
      JOIN sales_todos s
        ON s.status = 'completed'
       AND s.completed_at >= v_since
       AND s.company_name IS NOT NULL
     WHERE similarity(t.title, s.company_name) >= 0.3
        OR similarity(t.notes, s.company_name) >= 0.3
  ),
  -- c_linkedin verwijderd 2026-09-02: linkedin_activity_log is gedropt bij de
  -- concept-strip v1.135.
  c_proposals AS (
    SELECT t.id AS task_id,
           'agent_proposals'::text,
           similarity(t.title, coalesce(ap.summary,''))::real AS conf,
           ('Voorstel "' || left(coalesce(ap.summary,''), 80) || '" door ' || coalesce(ap.agent_name,'agent') || ' op ' || to_char(ap.reviewed_at,'YYYY-MM-DD'))::text,
           NULL::text
      FROM open_tasks t
      JOIN agent_proposals ap
        ON ap.status IN ('accepted','executed')
       AND ap.reviewed_at >= v_since
     WHERE similarity(t.title, coalesce(ap.summary,'')) >= 0.45
  ),
  -- c_road en c_km verwijderd 2026-09-02: sales_on_road_events en km_trips zijn
  -- gedropt bij de concept-strip v1.135.
  c_runs AS (
    SELECT t.id AS task_id,
           'agent_runs'::text,
           similarity(lower(t.title), lower(ar.agent_name))::real AS conf,
           ('Skill ' || ar.agent_name || ' draaide succesvol op ' || to_char(ar.completed_at,'YYYY-MM-DD HH24:MI'))::text,
           NULL::text
      FROM open_tasks t
      JOIN agent_runs ar
        ON ar.status = 'success'
       AND ar.completed_at >= v_since
     WHERE t.title ~* '\m(draai|run|trigger|laat draaien)\M'
       AND similarity(lower(t.title), lower(ar.agent_name)) >= 0.4
  ),
  unioned AS (
    SELECT * FROM c_autodraft UNION ALL
    SELECT * FROM c_sales     UNION ALL
    SELECT * FROM c_proposals UNION ALL
    SELECT * FROM c_runs
  ),
  ranked AS (
    SELECT
      task_id, source, conf, evidence_text, evidence_url,
      row_number() OVER (PARTITION BY task_id ORDER BY conf DESC) AS rn
    FROM unioned
    WHERE conf >= v_min_conf
  ),
  best AS (SELECT * FROM ranked WHERE rn = 1)
  SELECT jsonb_agg(
    jsonb_build_object(
      'task_id', task_id,
      'source', source,
      'confidence', round(conf::numeric, 3),
      'evidence_text', evidence_text,
      'evidence_url', evidence_url
    ) ORDER BY conf DESC
  )
  INTO v_candidates
  FROM best;

  v_candidates := coalesce(v_candidates, '[]'::jsonb);

  IF p_apply THEN
    UPDATE tasks t
       SET completion_candidate = true,
           completion_evidence = (c->>'evidence_text'),
           completion_evidence_url = nullif(c->>'evidence_url',''),
           completion_source = (c->>'source'),
           completion_confidence = (c->>'confidence')::numeric,
           completion_detected_at = now()
      FROM jsonb_array_elements(v_candidates) AS c
     WHERE t.id = (c->>'task_id')::uuid
       AND t.status = 'open'
       AND coalesce(t.completion_rejected, false) = false;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'candidates', v_candidates,
    'count', jsonb_array_length(v_candidates),
    'applied', v_applied,
    'lookback_days', p_lookback_days,
    'min_confidence', v_min_conf
  );
END;
$function$
;

-- =============================================================================
-- strip_html_inline
-- =============================================================================

-- args: t text
CREATE OR REPLACE FUNCTION public.strip_html_inline(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''), '<style[^>]*>.*?</style>', ' ', 'gi'),
        '<script[^>]*>.*?</script>', ' ', 'gi'),
      '<[^>]+>', ' ', 'g'),
    '\s+', ' ', 'g'))
$function$
;

-- =============================================================================
-- autodraft_purge_old_mails
-- =============================================================================

-- args: p_days integer
CREATE OR REPLACE FUNCTION public.autodraft_purge_old_mails(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int;
begin
  perform public.require_dashboard_auth();
  delete from autodraft_mails
   where status in ('sent','ignored','stale','failed')
     and coalesce(updated_at, scanned_at) < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

-- =============================================================================
-- submit_autodraft_decision
-- =============================================================================

-- args: p_mail_id text, p_action text, p_amend text, p_final_subject text, p_final_body text, p_target_folder text, p_decision_kind text, p_final_to text[]
CREATE OR REPLACE FUNCTION public.submit_autodraft_decision(p_mail_id text, p_action text, p_amend text, p_final_subject text, p_final_body text, p_target_folder text, p_decision_kind text DEFAULT 'reply'::text, p_final_to text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mail        autodraft_mails%rowtype;
  v_decision_id uuid;
  v_new_status  text;
BEGIN
  PERFORM public.require_dashboard_auth();

  IF p_mail_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mail_id_required');
  END IF;
  IF p_action NOT IN ('send','ignore','amend','spam') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_action');
  END IF;
  IF coalesce(p_decision_kind,'reply') NOT IN ('reply','forward') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision_kind');
  END IF;
  IF p_decision_kind = 'forward' AND (p_final_to IS NULL OR array_length(p_final_to,1) IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forward_requires_final_to');
  END IF;

  SELECT * INTO v_mail FROM autodraft_mails WHERE mail_id = p_mail_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mail_not_found');
  END IF;
  IF v_mail.status IN ('sent','ignored','stale') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_'||v_mail.status);
  END IF;
  IF p_action = 'amend' AND (p_amend IS NULL OR length(trim(p_amend)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amend_instructions_required');
  END IF;

  v_new_status := CASE p_action
    WHEN 'send'   THEN 'queued_send'
    WHEN 'ignore' THEN 'queued_ignore'
    WHEN 'amend'  THEN 'queued_amend'
    WHEN 'spam'   THEN 'queued_spam'
  END;

  INSERT INTO autodraft_decisions
    (mail_id, action, amend_instructions, final_subject, final_body, target_folder,
     source_draft_body, source_draft_subject, decision_kind, final_to)
  VALUES
    (p_mail_id, p_action, p_amend, p_final_subject, p_final_body,
     coalesce(p_target_folder, v_mail.target_folder),
     v_mail.draft_body, v_mail.draft_subject,
     coalesce(p_decision_kind,'reply'), p_final_to)
  RETURNING id INTO v_decision_id;

  UPDATE autodraft_mails
     SET status = v_new_status,
         target_folder = coalesce(p_target_folder, target_folder)
   WHERE mail_id = p_mail_id;

  -- Spam: zet ook flagged_as_spam in mail_messages voor latere learn-mode
  IF p_action = 'spam' THEN
    UPDATE mail_messages SET flagged_as_spam = true WHERE id = p_mail_id;
  END IF;

  -- Trigger execute-skill direct
  UPDATE agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'auto-draft-execute' AND enabled = true;

  RETURN jsonb_build_object('ok', true, 'decision_id', v_decision_id, 'status', v_new_status, 'kind', coalesce(p_decision_kind,'reply'));
END;
$function$
;

-- =============================================================================
-- trigger_autodraft_scan
-- =============================================================================

-- args: 
CREATE OR REPLACE FUNCTION public.trigger_autodraft_scan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  update agent_schedules
     set manual_run_requested_at = now()
   where agent_name = 'auto-draft' and enabled = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'schedule_not_found_or_disabled');
  end if;
  return jsonb_build_object('ok', true, 'requested_at', now());
end;
$function$
;

-- =============================================================================
-- trigger_autodraft_execute
-- =============================================================================

-- args: 
CREATE OR REPLACE FUNCTION public.trigger_autodraft_execute()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  update agent_schedules
     set manual_run_requested_at = now()
   where agent_name = 'auto-draft-execute' and enabled = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'schedule_not_found_or_disabled');
  end if;
  return jsonb_build_object('ok', true, 'requested_at', now());
end;
$function$
;

-- =============================================================================
-- reset_autodraft_mail_to_pending
-- =============================================================================

-- args: p_mail_id text
CREATE OR REPLACE FUNCTION public.reset_autodraft_mail_to_pending(p_mail_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  update autodraft_mails
     set status = 'pending'
   where mail_id = p_mail_id
     and status in ('queued_send','queued_ignore','queued_amend','failed','amended');
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_reset_needed_or_not_found');
  end if;
  -- Markeer onverwerkte decisions als skipped zodat execute ze niet alsnog oppakt
  update autodraft_decisions
     set execution_status = 'skipped', execution_error = 'reset_to_pending_by_user'
   where mail_id = p_mail_id and execution_status = 'pending';
  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- set_autodraft_mail_category
-- =============================================================================

-- args: p_mail_id text, p_category_key text
CREATE OR REPLACE FUNCTION public.set_autodraft_mail_category(p_mail_id text, p_category_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  if p_mail_id is null then return jsonb_build_object('ok', false, 'reason', 'mail_id_required'); end if;
  update autodraft_mails set category_key = p_category_key where mail_id = p_mail_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'mail_not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- set_autodraft_target_folder
-- =============================================================================

-- args: p_mail_id text, p_target_folder text
CREATE OR REPLACE FUNCTION public.set_autodraft_target_folder(p_mail_id text, p_target_folder text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  update autodraft_mails set target_folder = p_target_folder where mail_id = p_mail_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'mail_not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- accept_autodraft_category_proposal
-- =============================================================================

-- args: p_proposal_id uuid, p_category_key_override text, p_label_override text, p_instructions_override text, p_folder_override text, p_reviewed_by text
CREATE OR REPLACE FUNCTION public.accept_autodraft_category_proposal(p_proposal_id uuid, p_category_key_override text, p_label_override text, p_instructions_override text, p_folder_override text, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prop autodraft_category_proposals%rowtype;
  v_key  text;
  v_label text;
  v_instr text;
  v_folder text;
begin
  perform public.require_dashboard_auth();

  select * into v_prop from autodraft_category_proposals where id = p_proposal_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_prop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_'||v_prop.status);
  end if;

  v_key    := lower(trim(coalesce(p_category_key_override, v_prop.proposed_key)));
  v_label  := trim(coalesce(p_label_override, v_prop.proposed_label));
  v_instr  := coalesce(p_instructions_override, v_prop.proposed_instructions);
  v_folder := coalesce(p_folder_override, v_prop.proposed_folder);

  insert into autodraft_categories
    (category_key, label, description, handling_instructions,
     default_target_folder, default_action, active, sort_order, updated_by, source)
  values
    (v_key, v_label, v_prop.proposed_description, v_instr,
     v_folder, coalesce(v_prop.proposed_action,'draft'),
     true, 100, coalesce(p_reviewed_by,'dashboard'), 'proposal_accepted')
  on conflict (category_key) do update
    set label                 = excluded.label,
        description           = excluded.description,
        handling_instructions = excluded.handling_instructions,
        default_target_folder = excluded.default_target_folder,
        active                = true,
        updated_by            = excluded.updated_by,
        updated_at            = now();

  update autodraft_category_proposals
     set status      = 'accepted',
         reviewed_at = now(),
         reviewed_by = coalesce(p_reviewed_by,'dashboard')
   where id = p_proposal_id;

  return jsonb_build_object('ok', true, 'category_key', v_key);
end;
$function$
;

-- =============================================================================
-- reject_autodraft_category_proposal
-- =============================================================================

-- args: p_proposal_id uuid, p_reason text, p_reviewed_by text
CREATE OR REPLACE FUNCTION public.reject_autodraft_category_proposal(p_proposal_id uuid, p_reason text, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prop autodraft_category_proposals%rowtype;
begin
  perform public.require_dashboard_auth();
  select * into v_prop from autodraft_category_proposals where id = p_proposal_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_prop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_'||v_prop.status);
  end if;
  update autodraft_category_proposals
     set status       = 'rejected',
         reviewed_at  = now(),
         reviewed_by  = coalesce(p_reviewed_by,'dashboard'),
         review_reason= p_reason
   where id = p_proposal_id;
  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- accept_autodraft_lesson_proposal
-- =============================================================================

-- args: p_proposal_id uuid, p_lesson_override text, p_reviewed_by text
CREATE OR REPLACE FUNCTION public.accept_autodraft_lesson_proposal(p_proposal_id uuid, p_lesson_override text, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prop autodraft_lesson_proposals%rowtype;
  v_lesson_text text;
begin
  perform public.require_dashboard_auth();
  select * into v_prop from autodraft_lesson_proposals where id = p_proposal_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_prop.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'already_'||v_prop.status);
  end if;

  v_lesson_text := coalesce(p_lesson_override, v_prop.proposed_lesson);

  insert into autodraft_style_lessons
    (scope, scope_value, category_key, lesson, evidence, source_decision_ids, active)
  values
    (v_prop.scope, v_prop.scope_value,
     case when v_prop.scope = 'category' then v_prop.scope_value else null end,
     v_lesson_text, v_prop.evidence, v_prop.source_decision_ids, true);

  update autodraft_lesson_proposals
     set status = 'accepted',
         reviewed_at = now(),
         reviewed_by = coalesce(p_reviewed_by, 'dashboard')
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- reject_autodraft_lesson_proposal
-- =============================================================================

-- args: p_proposal_id uuid, p_reason text, p_reviewed_by text
CREATE OR REPLACE FUNCTION public.reject_autodraft_lesson_proposal(p_proposal_id uuid, p_reason text, p_reviewed_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();
  update autodraft_lesson_proposals
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = coalesce(p_reviewed_by, 'dashboard'),
         review_reason = p_reason
   where id = p_proposal_id and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found_or_reviewed'); end if;
  return jsonb_build_object('ok', true);
end;
$function$
;

-- =============================================================================
-- upsert_autodraft_category
-- =============================================================================

-- args: p_category_key text, p_label text, p_description text, p_handling_instructions text, p_default_target_folder text, p_default_action text, p_active boolean, p_sort_order integer, p_updated_by text
CREATE OR REPLACE FUNCTION public.upsert_autodraft_category(p_category_key text, p_label text, p_description text, p_handling_instructions text, p_default_target_folder text, p_default_action text, p_active boolean, p_sort_order integer, p_updated_by text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.require_dashboard_auth();

  if p_category_key is null or length(trim(p_category_key)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_category_key');
  end if;
  if p_label is null or length(trim(p_label)) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_label');
  end if;
  if coalesce(p_default_action,'draft') not in ('draft','skip','flag') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_default_action');
  end if;

  insert into autodraft_categories
    (category_key, label, description, handling_instructions,
     default_target_folder, default_action, active, sort_order, updated_by, source)
  values
    (lower(trim(p_category_key)), trim(p_label), p_description, p_handling_instructions,
     p_default_target_folder, coalesce(p_default_action,'draft'),
     coalesce(p_active, true), coalesce(p_sort_order, 100),
     coalesce(p_updated_by,'dashboard'), 'manual')
  on conflict (category_key) do update
    set label                 = excluded.label,
        description           = excluded.description,
        handling_instructions = excluded.handling_instructions,
        default_target_folder = excluded.default_target_folder,
        default_action        = excluded.default_action,
        active                = excluded.active,
        sort_order            = excluded.sort_order,
        updated_by            = excluded.updated_by,
        updated_at            = now();

  return jsonb_build_object('ok', true, 'category_key', lower(trim(p_category_key)));
end;
$function$
;
