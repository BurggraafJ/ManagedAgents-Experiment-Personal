-- =============================================================================
-- 06b WP2 — de HubSpot-masters worden her-chunkbaar en dragen hun eigen feiten
-- =============================================================================
-- Gemeten op prod, 2026-09-07 (spoor 06b, RESEARCH.md §1.5/§1.8):
--   * 1.084 van 1.099 deal-chunks (98,6 %) en 2.514 van 5.968 company-chunks zijn
--     ouder dan hun mirror-rij. `fetch_unchunked_source_ids` bood tot nu toe alleen
--     rijen ZONDER chunk aan, dus de dealfase in de index was de fase van het moment
--     van chunken. Correctheidsdefect, geen recall-defect.
--   * De chunker las precies de drie velden die leeg zijn: `description` 0/1.099,
--     `dealtype` 0, `amount` 21. Vandaar p50 51 tekens op een deal-chunk.
--     Wat er wél is: dealstage → label resolveerbaar op 1.099 van 1.099,
--     pipeline-label 13 pipelines, closedate 529, associated_company_ids 819,
--     lifecyclestage 5.968/5.968, city/country 5.347/5.448, num_employees 2.218,
--     contact→bedrijf via associated_company_id 1.346 van 1.507 (als vrije tekst
--     stond het op 51 = 3,4 %), en op 623 deals minstens één licentieveld.
--
-- Deze migratie doet twee dingen:
--   1. Drie chunk-source-views die de lookups in SQL doen (fase-label uit
--      hubspot_pipelines.stages, bedrijfsnaam uit hubspot_companies) en één
--      `version` meeleveren: epoch van hs_lastmodifieddate, met hs_created_at als
--      terugval. Zelfde patroon als v_mail_chunk_source / v_autodraft_action_chunk_source.
--   2. `fetch_unchunked_source_ids` vergelijkt voor deal/company/contact op die
--      versie, precies zoals hij dat voor Confluence al deed.
--
-- De view-filters staan GELIJK aan de filters in de RPC. Zou de view een rij
-- wegfilteren die de RPC aanbiedt, dan bleef die rij eeuwig "unchunked" en draaide
-- de chunker elke 5 minuten dezelfde lege ronde.
--
-- Terugdraaien: `drop view` × 3 + deze functie terug naar de vorige definitie;
-- de chunks blijven staan (met hun nieuwe inhoud) tot een her-chunk.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. deal — fase-label, pipeline-label, bedrijfsnaam, versie
-- -----------------------------------------------------------------------------
create or replace view public.v_hubspot_deal_chunk_source as
select d.deal_id,
       d.dealname,
       d.dealstage,
       d.dealtype,
       d.amount,
       d.closedate,
       d.properties,
       d.hs_lastmodifieddate,
       d.hs_created_at,
       d.is_archived,
       s.label                                                as stage_label,
       p.label                                                as pipeline_label,
       co.names                                               as company_names,
       extract(epoch from coalesce(d.hs_lastmodifieddate, d.hs_created_at,
                                   timestamptz 'epoch'))::bigint as version
  from public.hubspot_deals d
  left join public.hubspot_pipelines p on p.pipeline_id = d.pipeline_id
  left join lateral (
        select st->>'label' as label
          from jsonb_array_elements(coalesce(p.stages, '[]'::jsonb)) st
         where st->>'id' = d.dealstage
         limit 1
      ) s on true
  left join lateral (
        select string_agg(c.name, ', ' order by c.name) as names
          from public.hubspot_companies c
         where c.company_id = any (coalesce(d.associated_company_ids, '{}'::text[]))
           and coalesce(c.name, '') <> ''
      ) co on true
 where d.is_archived = false;

comment on view public.v_hubspot_deal_chunk_source is
  '06b WP2: chunk-bron voor source=''deal''. Lost dealstage op naar het LABEL uit '
  'hubspot_pipelines.stages (nooit het ruwe id in de chunk-tekst — bankitem RO56) en '
  'associated_company_ids naar bedrijfsnamen. `version` = her-chunk-sleutel voor '
  'fetch_unchunked_source_ids. Filter is_archived=false staat gelijk aan die RPC.';

-- -----------------------------------------------------------------------------
-- 2. company — geen join nodig, wel de versie (en de kolommen die de chunker miste)
-- -----------------------------------------------------------------------------
create or replace view public.v_hubspot_company_chunk_source as
select c.company_id,
       c.name,
       c.industry,
       c.domain,
       c.lifecyclestage,
       c.city,
       c.country,
       c.num_employees,
       c.properties,
       c.hs_lastmodifieddate,
       c.hs_created_at,
       c.is_archived,
       dl.names                                               as deal_names,
       coalesce(dl.n, 0)                                      as n_deals,
       extract(epoch from coalesce(c.hs_lastmodifieddate, c.hs_created_at,
                                   timestamptz 'epoch'))::bigint as version,
       -- Nieuwe kolommen staan ACHTERAAN: `create or replace view` mag alleen
       -- appenden, niet herordenen ("cannot change name of view column").
       ct.names                                               as contact_names,
       coalesce(ct.n, 0)                                      as n_contacts
  from public.hubspot_companies c
  -- De eigenaarsnaam die het onderzoek hier wilde bestaat niet in de mirror
  -- (hubspot_owner_map = 1 rij, geen naamkolom). Wat er wél is en wat een
  -- klant-360-vraag zoekt: welke deals aan dit bedrijf hangen. Top 5 op laatst
  -- gewijzigd, zodat de kaart niet volloopt bij een bedrijf met 30 deals.
  left join lateral (
        select string_agg(x.dealname, ', ' order by x.hs_lastmodifieddate desc nulls last) as names,
               count(*) as n
          from (select d.dealname, d.hs_lastmodifieddate
                  from public.hubspot_deals d
                 where c.company_id = any (coalesce(d.associated_company_ids, '{}'::text[]))
                   and d.is_archived = false
                   and coalesce(d.dealname, '') <> ''
                 order by d.hs_lastmodifieddate desc nulls last
                 limit 5) x
      ) dl on true
  -- En de contactpersonen: de spiegel van de `Company:`-regel op de contact-kaart.
  -- Bankitem KL46 vraagt letterlijk "wie is de contactpersoon bij <klant>"; zonder
  -- deze regel staat dat feit alleen op de contact-kaart en moet de retrieval het
  -- van de andere kant vinden.
  left join lateral (
        select string_agg(y.nm, ', ') as names, count(*) as n
          from (select nullif(btrim(concat_ws(' ', k.firstname, k.lastname)), '') as nm
                  from public.hubspot_contacts k
                 where k.associated_company_id = c.company_id
                   and k.is_archived = false
                   and nullif(btrim(concat_ws(' ', k.firstname, k.lastname)), '') is not null
                 order by k.hs_created_at desc nulls last
                 limit 5) y
      ) ct on true;
-- GEEN is_archived-filter: fetch_unchunked_source_ids heeft er ook geen, en de 397
-- gearchiveerde bedrijven zijn vandaag gechunkt. Een filter hier zonder dezelfde
-- filter in de RPC zou een lus geven (RPC biedt aan, view levert niets, chunk komt
-- nooit). Zie IMPLEMENT-NOTES §7 — dit is een bevinding, geen 06b-wijziging.

comment on view public.v_hubspot_company_chunk_source is
  '06b WP2: chunk-bron voor source=''company''. Levert de kolommen die de chunker niet '
  'las (lifecyclestage/city/country/num_employees/domain) plus `version`.';

-- -----------------------------------------------------------------------------
-- 3. contact — bedrijfsnaam via associated_company_id
-- -----------------------------------------------------------------------------
create or replace view public.v_hubspot_contact_chunk_source as
select ct.contact_id,
       ct.firstname,
       ct.lastname,
       ct.email,
       ct.jobtitle,
       ct.company,
       ct.lifecyclestage,
       ct.properties,
       ct.hs_lastmodifieddate,
       ct.hs_created_at,
       ct.is_archived,
       co.name                                                as company_name,
       extract(epoch from coalesce(ct.hs_lastmodifieddate, ct.hs_created_at,
                                   timestamptz 'epoch'))::bigint as version
  from public.hubspot_contacts ct
  left join public.hubspot_companies co on co.company_id = ct.associated_company_id;

comment on view public.v_hubspot_contact_chunk_source is
  '06b WP2: chunk-bron voor source=''contact''. Lost associated_company_id op naar de '
  'bedrijfsnaam (1.346 van 1.507 tegen 51 als vrije tekst) en levert `version`. '
  'hs_lastmodifieddate is op ALLE contacten null — vandaar hs_created_at als terugval, '
  'ook in de chunker (occurred_at stond op new Date()).';

-- -----------------------------------------------------------------------------
-- 4. fetch_unchunked_source_ids: versievergelijking voor de drie masters
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE met dezelfde signatuur, bewust GEEN drop: een drop verliest de
-- proacl en een kale create erna geeft anon weer execute (geheugen
-- `drop-function-verliest-proacl`). Alleen de drie ELSIF-takken hieronder wijzigen;
-- de rest is byte-gelijk aan de vorige definitie.
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
