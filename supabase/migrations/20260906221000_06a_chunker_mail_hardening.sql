-- =============================================================================
-- 06a WP2 — chunker-hardening: venster-eerst + één chunk per mail  (2026-09-06)
-- =============================================================================
-- Twee dingen, beide op de mail-tak. De derde (fetchUnchunked binnen de per-bron
-- try) zit in supabase/functions/chunker/index.ts.
--
-- 1) `fetch_unchunked_source_ids('mail')` — venster-eerst.
--    Gemeten (06a/RESEARCH.md §1.8, EXPLAIN (analyze, buffers) op prod):
--      volledige anti-join, warm : 58 ms, 15.973 buffers (≈ 125 MB)
--      idem, koud                : 76 ms
--      venster 30 d eerst        : 27,6 ms, 2.825 buffers (508 mails in venster)
--      hash-antijoin-herschrijving: 1.801 ms (slechter, verworpen)
--    In steady state (0 mails zonder chunk) leest de cron elke vijf minuten dus
--    125 MB naast een HNSW van 382 MB in 256 MB shared_buffers. Precies dat
--    maakte 2026-09-06 07:15 UTC de enige fout van 30 dagen mogelijk
--    (`fetch_unchunked_mail_failed: canceling statement due to statement timeout`,
--    koude index + parallelle EXPLAIN's + een OpenAI-storing).
--    Nieuwe mail is per definitie recent, dus het venster vindt het werk; de
--    volledige scan blijft voor backfill en late enrichment en draait alleen als
--    het venster de LIMIT niet vult. De twee takken zijn disjunct op received_at
--    (NULL valt in de tweede), dus er kan geen id dubbel terugkomen.
--
--    CREATE OR REPLACE, geen DROP: `fetch_unchunked_source_ids` is SECURITY
--    DEFINER met proacl {postgres, authenticated, service_role}; een DROP zou
--    die ACL verliezen (geheugen `drop-function-verliest-proacl`). Gemeten vóór:
--    {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} —
--    verifieer ná deze migratie dat dezelfde drie er staan.
--
-- 2) Partiële unieke index op mailchunks.
--    chunkMail levert per mail precies één chunk (sequence 0). De 389
--    race-dubbelen die 06f-α opruimde ontstonden doordat twee chunker-runs
--    dezelfde mail tegelijk oppakten (0,02–14,8 s uit elkaar); 30 dagen
--    agent_runs laten 0 overlappende runs zien, dus de oorzaak is niet te
--    reproduceren — een unieke index maakt de uitkomst onmogelijk.
--    Gemeten vóór deze migratie: 0 dubbele source_id's over 14.338 mailchunks,
--    dus de index kan gebouwd worden.
--    GEEN `CONCURRENTLY`: de repo-conventie is dat migraties via `supabase db
--    push` in één transactie draaien en CONCURRENTLY daar niet mag (zie
--    20260518_get_sender_history_rpc.sql). De partiële index dekt 14.338 rijen;
--    de SHARE-lock duurt honderden milliseconden en de chunker schrijft elke
--    vijf minuten een handvol rijen.
--    De chunker logt een 23505 op deze index voortaan als waarschuwing, niet als
--    run-fout (index.ts, processChunks).
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

CREATE UNIQUE INDEX IF NOT EXISTS chunks_mail_one_per_message
  ON public.chunks (source_id)
  WHERE source = 'mail';

COMMENT ON INDEX public.chunks_mail_one_per_message IS
  '06a WP2 (2026-09-06): chunkMail levert precies één chunk per mail; deze index maakt de race-dubbelen die 06f-α opruimde (389 stuks) structureel onmogelijk. De chunker logt een 23505 hierop als waarschuwing, niet als run-fout.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906221000', '06a_chunker_mail_hardening')
ON CONFLICT (version) DO NOTHING;
