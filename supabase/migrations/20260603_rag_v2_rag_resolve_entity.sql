-- RAG v2 F.1b — entity-resolutie via pg_trgm word_similarity + entity_resolution.
-- Vervangt de ILIKE-substring+lengte-ratio-gok in rag-chat tryResolveEntity (die blijft fallback).
-- word_similarity zit in schema 'extensions' (Supabase) → search_path uitgebreid.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION rag_resolve_entity(p_query text)
RETURNS TABLE(entity_type text, entity_id text, name text, via text, matched_term text, confidence numeric, duplicate_count int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_email text;
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 3 THEN RETURN; END IF;

  -- 1. E-mailadres in query → exacte entity_resolution → contact
  v_email := (regexp_match(lower(p_query), '[\w.+-]+@[\w-]+\.[\w.-]+'))[1];
  IF v_email IS NOT NULL THEN
    RETURN QUERY
      SELECT 'contact'::text, er.entity_id, v_email, 'email_exact'::text, v_email, er.confidence, 1
      FROM entity_resolution er
      WHERE er.alias_type='email' AND er.alias_value=v_email AND er.entity_type='contact'
      ORDER BY er.confidence DESC LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2. Company via word_similarity op naam
  RETURN QUERY
  WITH cands AS (
    SELECT c.company_id::text AS eid, c.name AS nm,
           word_similarity(c.name, p_query) AS sim, count(*) OVER () AS dup
    FROM hubspot_companies c
    WHERE c.is_archived = false AND c.name IS NOT NULL AND length(c.name) >= 3
      AND word_similarity(c.name, p_query) > 0.5
    ORDER BY sim DESC LIMIT 3
  )
  SELECT 'company'::text, eid, nm, 'company_trgm'::text, nm,
         round(LEAST(0.5 + sim*0.5, 0.97)::numeric, 2), dup::int
  FROM cands ORDER BY sim DESC LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- 3. Deal via word_similarity op dealname
  RETURN QUERY
  WITH cands AS (
    SELECT d.deal_id::text AS eid, d.dealname AS nm, word_similarity(d.dealname, p_query) AS sim
    FROM hubspot_deals d
    WHERE d.is_archived = false AND d.dealname IS NOT NULL AND length(d.dealname) >= 3
      AND word_similarity(d.dealname, p_query) > 0.5
    ORDER BY sim DESC LIMIT 1
  )
  SELECT 'deal'::text, eid, nm, 'deal_trgm'::text, nm, round(LEAST(0.5+sim*0.5,0.95)::numeric,2), 1
  FROM cands;
  IF FOUND THEN RETURN; END IF;

  -- 4. Contact via name→contact aliases (entity_resolution) + word_similarity
  RETURN QUERY
  WITH cands AS (
    SELECT er.entity_id AS eid, er.alias_value AS nm, word_similarity(er.alias_value, p_query) AS sim
    FROM entity_resolution er
    WHERE er.alias_type='name' AND er.entity_type='contact' AND length(er.alias_value) >= 4
      AND word_similarity(er.alias_value, p_query) > 0.6
    ORDER BY sim DESC LIMIT 1
  )
  SELECT 'contact'::text, eid, nm, 'contact_name_trgm'::text, nm, round(LEAST(0.5+sim*0.4,0.9)::numeric,2), 1
  FROM cands;
  RETURN;
END $function$;
GRANT EXECUTE ON FUNCTION rag_resolve_entity(text) TO authenticated, service_role, anon;
