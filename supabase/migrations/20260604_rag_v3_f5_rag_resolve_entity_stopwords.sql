-- RAG v3 F.5: breid de distinctive-token stopwoordenlijst van rag_resolve_entity uit met
-- Nederlandse vraag-/functie-/algemene woorden (>=4 chars). Fixt false-positive E06: query
-- "...genoemd WAAROM advocaten een eigen dossier..." matchte CRM-company "Waarom" (conf 0.97).
-- Live toegepast 2026-06-04. Verbetert ook rag-chat (zelfde RPC).
CREATE OR REPLACE FUNCTION public.rag_resolve_entity(p_query text)
 RETURNS TABLE(entity_type text, entity_id text, name text, via text, matched_term text, confidence numeric, duplicate_count integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','extensions'
AS $rgf$
DECLARE
  v_email text;
  v_stop text[] := ARRAY['advocaten','advocatuur','advocatenkantoor','advocatenkantoren','kantoor','kantoren','legal','recht','jurist','juristen','notaris','notarissen','holding','group','groep','company','bedrijf','prijs','prijzen','prijsmodel','tarief','tarieven','offerte','offertes','deal','deals','klant','klanten','customer','meeting','meetings','mail','mails','bericht','contact','contacten','partner','partners','team','update','status','samenwerking','overzicht',
    'waarom','welke','welk','hoeveel','wanneer','willen','eigen','genoemd','hebben','heeft','kunnen','moeten','onze','deze','laatste','recente','recent','huidige','stand','zaken','zoals','tussen','rondom','omtrent','vanuit','informatie','vraag','vragen','geef','vertel','toon','dossier','koppeling','argumenten','afgesproken','besproken','gemaild','recentste'];
BEGIN
  IF p_query IS NULL OR length(trim(p_query)) < 3 THEN RETURN; END IF;

  v_email := (regexp_match(lower(p_query), '[\w.+-]+@[\w-]+\.[\w.-]+'))[1];
  IF v_email IS NOT NULL THEN
    RETURN QUERY
      SELECT 'contact'::text, er.entity_id, v_email, 'email_exact'::text, v_email, er.confidence, 1
      FROM entity_resolution er
      WHERE er.alias_type='email' AND er.alias_value=v_email AND er.entity_type='contact'
      ORDER BY er.confidence DESC LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN QUERY
  WITH cands AS (
    SELECT c.company_id::text AS eid, c.name AS nm,
           word_similarity(c.name, p_query) AS sim, count(*) OVER () AS dup
    FROM hubspot_companies c
    WHERE c.is_archived = false AND c.name IS NOT NULL AND length(c.name) >= 3
      AND word_similarity(c.name, p_query) > 0.5
      AND EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(c.name), '[^a-z0-9]+') tok
        WHERE length(tok) >= 4 AND tok <> ALL (v_stop)
          AND lower(p_query) ~ ('\m'||tok||'\M')
      )
    ORDER BY sim DESC LIMIT 3
  )
  SELECT 'company'::text, eid, nm, 'company_trgm'::text, nm,
         round(LEAST(0.5 + sim*0.5, 0.97)::numeric, 2), dup::int
  FROM cands ORDER BY sim DESC LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH cands AS (
    SELECT d.deal_id::text AS eid, d.dealname AS nm, word_similarity(d.dealname, p_query) AS sim
    FROM hubspot_deals d
    WHERE d.is_archived = false AND d.dealname IS NOT NULL AND length(d.dealname) >= 3
      AND word_similarity(d.dealname, p_query) > 0.5
      AND EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(d.dealname), '[^a-z0-9]+') tok
        WHERE length(tok) >= 4 AND tok <> ALL (v_stop)
          AND lower(p_query) ~ ('\m'||tok||'\M')
      )
    ORDER BY sim DESC LIMIT 1
  )
  SELECT 'deal'::text, eid, nm, 'deal_trgm'::text, nm, round(LEAST(0.5+sim*0.5,0.95)::numeric,2), 1
  FROM cands;
  IF FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH cands AS (
    SELECT er.entity_id AS eid, er.alias_value AS nm, word_similarity(er.alias_value, p_query) AS sim
    FROM entity_resolution er
    WHERE er.alias_type='name' AND er.entity_type='contact' AND length(er.alias_value) >= 4
      AND word_similarity(er.alias_value, p_query) > 0.6
      AND EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(er.alias_value), '[^a-z0-9]+') tok
        WHERE length(tok) >= 4 AND tok <> ALL (v_stop)
          AND lower(p_query) ~ ('\m'||tok||'\M')
      )
    ORDER BY sim DESC LIMIT 1
  )
  SELECT 'contact'::text, eid, nm, 'contact_name_trgm'::text, nm, round(LEAST(0.5+sim*0.4,0.9)::numeric,2), 1
  FROM cands;
  RETURN;
END $rgf$;