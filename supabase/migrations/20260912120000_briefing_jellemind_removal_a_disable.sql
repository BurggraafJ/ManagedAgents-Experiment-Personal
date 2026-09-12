-- =============================================================================
-- Briefing + JelleMind removal — deel A: uitzetten (omkeerbaar)
-- =============================================================================
-- Jelle's product-lock van 2026-09-12 (Maestro, sporen 12 + 13). Deze migratie
-- zet alles UIT en verwijdert geen enkele rij behalve de chunks van de bron die
-- verdwijnt. Deel B (20260912121000) doet de DROP's en hoort pas te draaien ná
-- de backup die dáár in de kop staat.
--
-- Waarom gesplitst: de precedent van v1.135 (STRIP-CONCEPTS) is app-PR eerst,
-- DB-PR daarna. En omdat deel A veilig is om nú te draaien, ook als de drop
-- nog een week wacht.
--
-- Volgorde binnen deze file is niet vrij:
--   1. schedules uit    — anders schrijft de orchestrator tijdens de rest door
--   2. cron uit         — idem voor jellemind-embed
--   3. recepten uit     — context-build mag match_jellemind_lessons niet meer
--                         aanroepen (de code kan het sinds v2.11 sowieso niet,
--                         dit is de tweede riem)
--   4. chunker-bron uit — fetch_unchunked_source_ids zonder 'lesson'-tak
--   5. chunks opruimen  — pas ná 4, anders biedt de RPC elke rij meteen weer
--                         aan (geheugen chunk-delete-is-not-durable)
--
-- Idempotent: alles staat op IF EXISTS / WHERE EXISTS en mag twee keer draaien.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schedules uit — de orchestrator pakt deze agents niet meer op.
-- -----------------------------------------------------------------------------
UPDATE public.agent_schedules
   SET enabled = false
 WHERE agent_name IN ('jellemind', 'meeting-briefing', 'jellemind-embed')
   AND enabled IS DISTINCT FROM false;

-- -----------------------------------------------------------------------------
-- 2. pg_cron — elke job die deze twee producten aanjaagt.
--    Expliciet op naam-patroon en mét RAISE NOTICE, zodat in de log staat wat
--    er daadwerkelijk weg is: de jobnamen leven niet in deze repo.
--    LET OP: 'inbox-briefing' / get_inbox_briefing (AutoDraft v3) valt hier
--    bewust NIET onder — dat is een ander product en blijft draaien.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niet aanwezig — stap 2 overgeslagen';
    RETURN;
  END IF;
  FOR r IN
    SELECT jobname FROM cron.job
     WHERE jobname ILIKE '%jellemind%'
        OR jobname ILIKE 'meeting-briefing%'
        OR jobname ILIKE '%-meeting-briefing%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
    RAISE NOTICE 'cron.unschedule(%)', r.jobname;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Recepten — geen enkele intent injecteert nog lessons.
--    De kolommen blijven staan (context-build leest ze nog voor retrieval_meta);
--    alleen de waarden gaan uit. Dat houdt deel A omkeerbaar.
-- -----------------------------------------------------------------------------
UPDATE public.context_intents
   SET inject_jellemind = false,
       jellemind_top_k  = 0,
       jellemind_scopes = '{}'::text[]
 WHERE inject_jellemind IS DISTINCT FROM false
    OR COALESCE(jellemind_top_k, 0) <> 0
    OR COALESCE(array_length(jellemind_scopes, 1), 0) <> 0;

-- -----------------------------------------------------------------------------
-- 4. fetch_unchunked_source_ids zonder de 'lesson'-tak.
--
--    Letterlijk de functie uit 20260907057000, met alleen dat ene ELSIF-blok
--    eruit — de rest is byte-gelijk overgenomen uit die file, niet uit het hoofd
--    hergeschreven (les van de rag-chat-paste van 2026-07-16).
--
--    CREATE OR REPLACE met dezelfde signatuur, dus de proacl blijft staan
--    (geheugen drop-function-verliest-proacl). Geen DROP, geen kale CREATE.
--
--    Zonder deze stap vraagt de chunker na de drop van jellemind_lessons naar
--    een tabel die niet bestaat; die tak wordt weliswaar niet meer aangeroepen
--    (chunker v1.8 kent de bron niet meer), maar een dangling referentie in een
--    load-bearing RAG-functie laten staan is precies hoe het P0 van 2026-06-02
--    onzichtbaar bleef.
-- -----------------------------------------------------------------------------
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

-- De grant hoort bij CREATE OR REPLACE niet te veranderen; expliciet herhaald
-- zodat een latere kale CREATE hem niet stil verbreedt naar PUBLIC
-- (geheugen bare-create-function-grants-public).
REVOKE ALL ON FUNCTION public.fetch_unchunked_source_ids(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_unchunked_source_ids(text, integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. De chunks van de verdwenen bron.
--
--    Pas ná stap 4: zolang de RPC de 'lesson'-tak nog heeft, biedt hij elke
--    verwijderde rij de volgende ronde opnieuw aan en staat de index binnen
--    minuten weer vol (geheugen chunk-delete-is-not-durable, 4.888 → 180 terug
--    in 5 minuten).
--
--    Tel in een TWEEDE statement, niet in hetzelfde: een statement ziet zijn
--    eigen write niet (geheugen same-statement-count-cannot-see-its-own-write).
-- -----------------------------------------------------------------------------
DELETE FROM public.chunks WHERE source = 'lesson';

-- Controle (apart statement): moet 0 zijn.
SELECT count(*) AS lesson_chunks_na_opruimen
  FROM public.chunks WHERE source = 'lesson';

-- -----------------------------------------------------------------------------
-- Verifiatie-queries voor de operator (handmatig draaien, niets muteren):
--
--   SELECT agent_name, enabled FROM agent_schedules
--    WHERE agent_name IN ('jellemind','meeting-briefing','jellemind-embed');
--   -- verwacht: 3× enabled = false (of minder rijen als een agent niet bestaat)
--
--   SELECT jobname FROM cron.job WHERE jobname ILIKE '%jellemind%';
--   -- verwacht: 0 rijen
--
--   SELECT intent, inject_jellemind, jellemind_top_k FROM context_intents
--    WHERE inject_jellemind IS TRUE;
--   -- verwacht: 0 rijen
--
--   SELECT count(*) FROM chunks WHERE source = 'lesson';
--   -- verwacht: 0
-- =============================================================================
