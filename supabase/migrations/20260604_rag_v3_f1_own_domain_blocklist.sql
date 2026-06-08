-- RAG v3 F.1: eigen/test-domeinen mogen niet naar een company resolven (vervuilt interne-contact graph; R02).
-- Live toegepast 2026-06-04 via Supabase MCP apply_migration (zelfde naam).
CREATE OR REPLACE FUNCTION public.refresh_entity_resolution()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_email_count   int := 0;
  v_domain_count  int := 0;
  v_name_count    int := 0;
  v_started_at    timestamptz := now();
BEGIN
  -- 1. email → contact
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(c.email))
         'email', lower(c.email), 'contact', c.contact_id, 1.000, 'hubspot_mirror'
    FROM hubspot_contacts c
   WHERE c.email IS NOT NULL AND length(trim(c.email)) > 0
   ORDER BY lower(c.email), c.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_email_count = ROW_COUNT;

  -- 2. email_domain → company. Blocklist: consumer-domeinen + eigen/test-domeinen (RAG v3 F.1).
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(co.domain))
         'email_domain', lower(co.domain), 'company', co.company_id, 0.900, 'hubspot_mirror'
    FROM hubspot_companies co
   WHERE co.domain IS NOT NULL AND length(trim(co.domain)) > 0
     AND lower(co.domain) NOT IN ('gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','me.com','live.com','live.nl','protonmail.com','proton.me','ziggo.nl','kpn.nl','xs4all.nl','planet.nl','telfort.nl','online.nl','home.nl','quicknet.nl','t-online.de','legal-mind.nl','test.nl','test1.nl')
   ORDER BY lower(co.domain), co.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_domain_count = ROW_COUNT;

  -- 3. name → contact (firstname + lastname concat, lowercase)
  INSERT INTO entity_resolution (alias_type, alias_value, entity_type, entity_id, confidence, source)
  SELECT DISTINCT ON (lower(trim(c.firstname || ' ' || c.lastname)))
         'name', lower(trim(c.firstname || ' ' || c.lastname)), 'contact', c.contact_id, 0.700, 'hubspot_mirror'
    FROM hubspot_contacts c
   WHERE c.firstname IS NOT NULL AND length(trim(c.firstname)) > 0
     AND c.lastname  IS NOT NULL AND length(trim(c.lastname)) > 0
   ORDER BY lower(trim(c.firstname || ' ' || c.lastname)), c.hs_lastmodifieddate DESC NULLS LAST
  ON CONFLICT (alias_type, alias_value, entity_type, entity_id) DO UPDATE
    SET updated_at = now(), confidence = EXCLUDED.confidence;
  GET DIAGNOSTICS v_name_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'started_at', v_started_at, 'completed_at', now(),
    'duration_ms', extract(milliseconds from (now() - v_started_at))::int,
    'inserted_or_updated', jsonb_build_object(
      'email_to_contact', v_email_count, 'domain_to_company', v_domain_count,
      'name_to_contact', v_name_count, 'total', v_email_count + v_domain_count + v_name_count
    )
  );
END $function$;

-- Verwijder de bestaande eigen/test-domein → company aliassen (R02-oorzaak).
DELETE FROM entity_resolution
 WHERE alias_type='email_domain' AND alias_value IN ('legal-mind.nl','test.nl','test1.nl');
