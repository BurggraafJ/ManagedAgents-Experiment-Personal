-- =============================================================================
-- 06f-α — rag_chunks_reconcile(): index-hygiëne, dagelijks             (2026-09-06)
-- =============================================================================
-- RESEARCH.md §3.1 (d). Gemeten vóór deze migratie (runs/2026-09-06-explain-
-- baseline.json en de hygiëne-telling in IMPLEMENT-NOTES.md):
--
--   mail chunks van verwijderde mails (is_deleted=true)        1.480   (9,1 %)
--   mails met 2 chunks (race-dubbelen: beide MetaRAG, 0,02–15 s
--   uit elkaar, zelfde versie, geen parts, geen parent)          389 records / 778 chunks
--   deal chunks van gearchiveerde deals                           128
--   event chunks van geannuleerde (6) of verwijderde (124) events 130
--   kb_article chunk van een gearchiveerd artikel                   1
--   action chunk zonder besluit                                     1
--
-- Elke klasse is een bron die volgens zijn eigen waarheidstabel niet meer
-- (door)zoekbaar hoort te zijn; het zijn afgeleide data, geen bedrijfsdata.
-- Verwijderen is terugdraaibaar door her-chunken — behalve wezen (de bron is
-- weg), en die horen weg.
--
-- Wat de functie BEWUST NIET doet:
--   • Toekomstige occurred_at (65 engagement-taken, 50 events) verwijderen. Dat
--     zijn echte records; fetch_unchunked_source_ids zou ze binnen 5 minuten
--     opnieuw laten chunken (chunker-cron */5) — een embed-lus. De recency-boost
--     die ze kregen is in match_chunks zelf geklemd (migratie 20260906210000).
--   • Meer dan p_max_fraction (default 25 %) van een bron verwijderen als het
--     er meer dan 50 zijn. Een lege of half-gesyncte waarheidstabel (mail_messages
--     na een sync-storing) mag nooit de index leeg trekken: dan slaat de klasse
--     over, status 'warning', en de teller staat in agent_runs.stats.
--
-- Definitie van "hoort erin" is per bron gelijk aan wat fetch_unchunked_source_ids
-- als chunkbaar beschouwt (anders ontstaat een verwijder-/herchunk-lus). Voor
-- event wijkt dat af: de RPC kende alleen is_cancelled, terwijl 124 chunks van
-- soft-deleted events (is_deleted=true) in de index stonden. Daarom krijgt de
-- event-tak van fetch_unchunked_source_ids hier dezelfde voorwaarde. De rest
-- van die functie is byte-voor-byte de live definitie van 2026-09-06 (die
-- afwijkt van de laatste repo-migratie 20260520: mail-tak met ENRICH_GRACE_DAYS
-- en de confluence-tak zijn in een ander kanaal gedeployd).
--
-- Cron: dagelijks 03:50 UTC (05:50 CEST), na confluence-acl-sync (03:40) en de
-- nachtelijke opruimers. Logt een rij in agent_runs (agent_name
-- 'rag-chunks-reconcile', run_type 'pg_cron').
-- =============================================================================

-- ── 1. fetch_unchunked_source_ids: event-tak ook zonder soft-deleted events ─
-- CREATE OR REPLACE (zelfde signatuur) — de proacl blijft staan:
-- {postgres=X,authenticated=X,service_role=X}.
CREATE OR REPLACE FUNCTION public.fetch_unchunked_source_ids(p_source text, p_limit integer DEFAULT 10)
 RETURNS TABLE(source_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ENRICH_GRACE_DAYS constant int := 14;
BEGIN
  IF p_source = 'mail' THEN
    RETURN QUERY
      SELECT m.id FROM mail_messages m
      WHERE m.is_deleted = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
        AND (
          EXISTS (SELECT 1 FROM mail_enrichment e WHERE e.mail_id = m.id)
          OR m.received_at < now() - make_interval(days => ENRICH_GRACE_DAYS)
        )
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

-- ── 2. rag_chunks_reconcile() ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rag_chunks_reconcile(p_dry_run boolean DEFAULT false, p_max_fraction numeric DEFAULT 0.25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_t0        timestamptz := clock_timestamp();
  v_classes   jsonb := '[]'::jsonb;
  v_deleted   int := 0;
  v_skipped   text[] := '{}'::text[];
  v_status    text := 'success';
  v_report    jsonb;
  c           record;
  v_ids       uuid[];
  v_n         int;
  v_src_total int;
  v_del       int;
BEGIN
  -- Eén regel per klasse: naam, bron, en de query die de te verwijderen chunk_ids
  -- oplevert. De voorwaarde "hoort erin" is per bron dezelfde als in
  -- fetch_unchunked_source_ids — anders wordt verwijderen een herchunk-lus.
  FOR c IN
    SELECT * FROM (VALUES
      ('mail_orphan', 'mail',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'mail'
             AND NOT EXISTS (SELECT 1 FROM mail_messages m WHERE m.id = c.source_id AND m.is_deleted = false) $q$),
      -- Race-dubbelen: twee chunker-runs schreven dezelfde mail binnen seconden. Houd de
      -- oudste (rn = 1), nooit multi-part- of kind-chunks (parts > 1 / parent_chunk_id).
      ('mail_duplicate', 'mail',
       $q$ SELECT x.chunk_id FROM (
             SELECT chunk_id, row_number() OVER (PARTITION BY source_id ORDER BY created_at ASC, chunk_id ASC) AS rn
               FROM chunks WHERE source = 'mail' AND parent_chunk_id IS NULL
                AND COALESCE((metadata->>'parts')::int, 1) = 1) x WHERE x.rn > 1 $q$),
      ('deal_gone', 'deal',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'deal'
             AND NOT EXISTS (SELECT 1 FROM hubspot_deals d WHERE d.deal_id = c.source_id AND d.is_archived = false) $q$),
      ('engagement_gone', 'engagement',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'engagement'
             AND NOT EXISTS (SELECT 1 FROM hubspot_engagements e WHERE e.id = c.source_id AND e.is_archived = false) $q$),
      ('event_gone', 'event',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'event'
             AND NOT EXISTS (SELECT 1 FROM calendar_events e WHERE e.id::text = c.source_id
                               AND e.is_cancelled = false AND COALESCE(e.is_deleted, false) = false) $q$),
      ('kb_article_not_validated', 'kb_article',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'kb_article'
             AND NOT EXISTS (SELECT 1 FROM kb_articles k WHERE k.id::text = c.source_id AND k.status IN ('gevalideerd', 'gepubliceerd')) $q$),
      ('confluence_gone', 'confluence',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'confluence'
             AND NOT EXISTS (SELECT 1 FROM confluence_pages p WHERE p.page_id = c.source_id AND p.is_archived = false) $q$),
      ('meeting_gone_or_personal', 'meeting',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'meeting'
             AND NOT EXISTS (SELECT 1 FROM fireflies_meetings f WHERE f.id::text = c.source_id AND COALESCE(f.audience, '') <> 'personal') $q$),
      ('lesson_inactive', 'lesson',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'lesson'
             AND NOT EXISTS (SELECT 1 FROM jellemind_lessons l WHERE l.id::text = c.source_id AND l.active = true) $q$),
      ('action_gone', 'action',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'action'
             AND NOT EXISTS (SELECT 1 FROM autodraft_action_decisions d WHERE d.id::text = c.source_id AND d.outcome IS NOT NULL) $q$),
      ('company_gone', 'company',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'company'
             AND NOT EXISTS (SELECT 1 FROM hubspot_companies x WHERE x.company_id = c.source_id) $q$),
      ('contact_gone', 'contact',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'contact'
             AND NOT EXISTS (SELECT 1 FROM hubspot_contacts x WHERE x.contact_id = c.source_id) $q$),
      ('jira_gone', 'jira',
       $q$ SELECT c.chunk_id FROM chunks c WHERE c.source = 'jira'
             AND NOT EXISTS (SELECT 1 FROM jira_issues j WHERE j.issue_key = c.source_id) $q$)
    ) AS t(class, source, q)
  LOOP
    EXECUTE format('SELECT coalesce(array_agg(chunk_id), ''{}''::uuid[]) FROM (%s) s', c.q) INTO v_ids;
    v_n := coalesce(cardinality(v_ids), 0);
    SELECT count(*) INTO v_src_total FROM chunks WHERE source = c.source;
    v_del := 0;

    IF v_n > 50 AND v_src_total > 0 AND v_n > p_max_fraction * v_src_total THEN
      -- Vangnet: een half-gesyncte waarheidstabel mag de index niet leegtrekken.
      v_skipped := v_skipped || c.class;
      v_status := 'warning';
    ELSIF v_n > 0 AND NOT p_dry_run THEN
      DELETE FROM chunks WHERE chunk_id = ANY (v_ids);
      GET DIAGNOSTICS v_del = ROW_COUNT;
      v_deleted := v_deleted + v_del;
    END IF;

    v_classes := v_classes || jsonb_build_object(
      'class', c.class, 'source', c.source, 'source_total', v_src_total,
      'candidates', v_n, 'deleted', v_del,
      'guard_tripped', (c.class = ANY (v_skipped)));
  END LOOP;

  v_report := jsonb_build_object(
    'dry_run', p_dry_run, 'deleted_total', v_deleted, 'guard_tripped', to_jsonb(v_skipped),
    'max_fraction', p_max_fraction, 'classes', v_classes,
    'duration_ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000),
    'chunks_after', (SELECT count(*) FROM chunks));

  INSERT INTO agent_runs (agent_name, run_type, started_at, completed_at, status, summary, stats)
  VALUES ('rag-chunks-reconcile', 'pg_cron', v_t0, now(), v_status,
          format('%s%s chunks verwijderd in %s klassen%s',
                 CASE WHEN p_dry_run THEN '[dry-run] ' ELSE '' END, v_deleted, jsonb_array_length(v_classes),
                 CASE WHEN cardinality(v_skipped) > 0 THEN format(' — vangnet: %s overgeslagen', array_to_string(v_skipped, ',')) ELSE '' END),
          v_report);

  RETURN v_report;
END $function$;

COMMENT ON FUNCTION public.rag_chunks_reconcile(boolean, numeric) IS
  '06f-α (2026-09-06): verwijdert chunks waarvan de bron niet meer chunkbaar is (mail is_deleted, race-dubbelen per mail, gearchiveerde deals/engagements, geannuleerde of verwijderde events, niet-gevalideerde kb-artikelen, gearchiveerde Confluence-pagina''s, personal meetings, inactieve lessons, actions zonder besluit, verdwenen company/contact/jira). Vangnet: > 50 én > p_max_fraction van een bron → klasse overgeslagen, status warning. p_dry_run=true telt alleen. Logt in agent_runs (rag-chunks-reconcile). Dagelijks via cron rag-chunks-reconcile-daily.';

-- Alleen de server mag opruimen: geen PUBLIC/anon/authenticated.
REVOKE ALL ON FUNCTION public.rag_chunks_reconcile(boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rag_chunks_reconcile(boolean, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rag_chunks_reconcile(boolean, numeric) TO service_role;

-- ── 3. Cron: dagelijks 03:50 UTC ─────────────────────────────────────────────
SELECT cron.unschedule('rag-chunks-reconcile-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-chunks-reconcile-daily');
SELECT cron.schedule('rag-chunks-reconcile-daily', '50 3 * * *', $cmd$SELECT public.rag_chunks_reconcile();$cmd$);

-- ── 4. Autovacuum ná de reconcile: dode tuples zitten in de HNSW-graaf ───────
-- Gemeten direct ná de eerste run (2.129 verwijderd): dezelfde probe gaf met
-- hnsw.ef_search=80 nog 60 in plaats van 80 levende rijen — de index levert zijn
-- ef kandidaten inclusief tombstones, de zichtbaarheidscheck haalt ze er daarna
-- uit. De standaard-autovacuum grijpt pas in bij 50 + 20 % dode tuples (≈ 9.300
-- op 46.000): zonder ingreep blijft dat maanden zo.
--
-- Een VACUUM via pg_cron werkt NIET: de cron-sessie heeft de database-brede
-- statement_timeout van 120 s en de HNSW-bulkdelete over 382 MB duurt langer
-- (gemeten: job faalde exact na 2 minuten, 18:22→18:24 UTC, en herstartte).
-- Autovacuum heeft geen statement_timeout, is cost-gedempt en doet de index mee.
-- Daarom: per-tabel-drempel. Normale churn op chunks is laag (autovacuum_count
-- was 0, n_dead_tup ≈ 6 vóór de reconcile), dus 200 dode tuples = "de reconcile
-- heeft iets weggehaald" → vacuum volgt binnen de naptime.
ALTER TABLE public.chunks SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold = 500
);
-- Opruimen van de tijdelijke variant uit de sessie van 2026-09-06 (idempotent).
SELECT cron.unschedule('rag-chunks-vacuum-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-chunks-vacuum-daily');
SELECT cron.unschedule('rag-chunks-vacuum-once') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rag-chunks-vacuum-once');

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906212000', '06f_alpha_rag_chunks_reconcile')
ON CONFLICT (version) DO NOTHING;
