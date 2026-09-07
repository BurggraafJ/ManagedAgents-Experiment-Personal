-- =============================================================================
-- 06b WP1a, derde slag — fetch_unchunked_source_ids slaat de onderdrukte rijen over
-- =============================================================================
-- Byte-gelijk aan de functie uit migratie 20260907050000, met één extra NOT EXISTS in
-- de engagement-tak: de lijst uit 20260907056000. Zonder die regel schrijft de chunker
-- de 4.888 verwijderde dubbele chunks in ongeveer acht dagen allemaal terug — stil,
-- want elke cron-ronde ziet er gezond uit. Gemeten binnen 5 minuten na het terugzetten
-- van chunker-cron: 4.707 aangeboden, 180 al terug.
--
-- CREATE OR REPLACE met dezelfde signatuur, dus de proacl blijft staan
-- (geheugen drop-function-verliest-proacl).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fetch_unchunked_source_ids(p_source text, p_limit integer DEFAULT 10)
 RETURNS TABLE(source_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ENRICH_GRACE_DAYS constant int := 14;
  MAIL_WINDOW_DAYS  constant int := 30;   -- 06a WP2: venster-eerst op de mail-tak
  v_found int := 0;
BEGIN
  IF p_source = 'mail' THEN
    -- Venster eerst (goedkoop): vrijwel al het werk is nieuwe mail.
    RETURN QUERY
      SELECT m.id FROM mail_messages m
      WHERE m.is_deleted = false
        AND m.received_at >= now() - make_interval(days => MAIL_WINDOW_DAYS)
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
        AND (
          EXISTS (SELECT 1 FROM mail_enrichment e WHERE e.mail_id = m.id)
          OR m.received_at < now() - make_interval(days => ENRICH_GRACE_DAYS)
        )
      ORDER BY m.received_at DESC NULLS LAST LIMIT p_limit;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found >= p_limit THEN
      RETURN;
    END IF;
    -- Rest van de tabel (backfill / late enrichment / received_at NULL). Alleen
    -- als het venster de LIMIT niet vulde; disjunct met de tak hierboven.
    RETURN QUERY
      SELECT m.id FROM mail_messages m
      WHERE m.is_deleted = false
        AND (m.received_at IS NULL OR m.received_at < now() - make_interval(days => MAIL_WINDOW_DAYS))
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
        AND (
          EXISTS (SELECT 1 FROM mail_enrichment e WHERE e.mail_id = m.id)
          OR m.received_at < now() - make_interval(days => ENRICH_GRACE_DAYS)
        )
      ORDER BY m.received_at DESC NULLS LAST LIMIT (p_limit - v_found);
    RETURN;

  ELSIF p_source = 'engagement' THEN
    -- 06b WP1a: sla de bewust onderdrukte rijen over. Zonder deze regel maakt de
    -- chunker de dedup elke ronde ongedaan: een verwijderde chunk maakt de rij weer
    -- "unchunked". Gemeten 5 minuten na het terugzetten van chunker-cron: 4.707 rijen
    -- aangeboden, 180 chunks al terug. De lijst is een primary-key-lookup, dus dit
    -- kost niets. Zie migratie 20260907056000.
    RETURN QUERY
      SELECT e.id FROM hubspot_engagements e
      WHERE e.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'engagement' AND c.source_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM hubspot_engagement_chunk_suppressed s WHERE s.engagement_id = e.id)
      ORDER BY COALESCE(e.hs_timestamp, e.hs_created_at) DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'jira' THEN
    RETURN QUERY
      SELECT j.issue_key FROM jira_issues j
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'jira' AND c.source_id = j.issue_key)
      ORDER BY j.jira_updated_at DESC NULLS LAST LIMIT p_limit;

  -- 06b WP2: deal/company/contact zijn her-chunkbaar geworden. Dezelfde vorm als de
  -- confluence-tak: bied de rij aan zodra GEEN chunk een versie draagt die >= de
  -- huidige is. De bestaande 8.574 master-chunks hebben geen `version` in metadata en
  -- worden daardoor precies één keer opnieuw aangeboden.
  ELSIF p_source = 'deal' THEN
    RETURN QUERY
      SELECT v.deal_id FROM v_hubspot_deal_chunk_source v
      WHERE NOT EXISTS (
          SELECT 1 FROM chunks c
           WHERE c.source = 'deal'
             AND c.source_id = v.deal_id
             AND c.metadata->>'version' ~ '^[0-9]+$'
             AND (c.metadata->>'version')::bigint >= v.version
        )
      ORDER BY v.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'company' THEN
    RETURN QUERY
      SELECT v.company_id FROM v_hubspot_company_chunk_source v
      WHERE NOT EXISTS (
          SELECT 1 FROM chunks c
           WHERE c.source = 'company'
             AND c.source_id = v.company_id
             AND c.metadata->>'version' ~ '^[0-9]+$'
             AND (c.metadata->>'version')::bigint >= v.version
        )
      ORDER BY v.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'contact' THEN
    RETURN QUERY
      SELECT v.contact_id FROM v_hubspot_contact_chunk_source v
      WHERE NOT EXISTS (
          SELECT 1 FROM chunks c
           WHERE c.source = 'contact'
             AND c.source_id = v.contact_id
             AND c.metadata->>'version' ~ '^[0-9]+$'
             AND (c.metadata->>'version')::bigint >= v.version
        )
      -- hs_lastmodifieddate is op alle 1.507 contacten null; hs_created_at is de
      -- enige zinnige volgorde.
      ORDER BY v.hs_created_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'meeting' THEN
    RETURN QUERY
      SELECT f.id::text FROM fireflies_meetings f
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'meeting' AND c.source_id = f.id::text)
      ORDER BY f.date_time DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'event' THEN
    RETURN QUERY
      SELECT ev.id::text FROM calendar_events ev
      WHERE ev.is_cancelled = false
        -- 06f-α: soft-deleted events horen net zo min in de index als geannuleerde.
        AND COALESCE(ev.is_deleted, false) = false
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

  ELSIF p_source = 'confluence' THEN
    RETURN QUERY
      SELECT p.page_id FROM confluence_pages p
      WHERE p.is_archived = false
        AND COALESCE(length(p.body_text), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM chunks c
           WHERE c.source = 'confluence'
             AND c.source_id = p.page_id
             AND c.metadata->>'version' ~ '^[0-9]+$'
             AND (c.metadata->>'version')::int >= p.version
        )
      ORDER BY p.confluence_updated_at DESC NULLS LAST LIMIT p_limit;

  ELSE
    RAISE EXCEPTION 'unknown_source: %', p_source USING ERRCODE = '22023';
  END IF;
END $function$;
