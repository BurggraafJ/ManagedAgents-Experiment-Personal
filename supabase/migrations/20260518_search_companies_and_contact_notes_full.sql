-- =====================================================================
-- V9.9 — search_companies + get_contact_notes_full (Stap A + B)
-- =====================================================================
-- Twee nieuwe/vervangende RPC's voor consistentie en bredere note-dekking:
--
-- A) public.search_companies(query text, limit_n int)
--    Autocomplete-RPC voor de Company-tijdlijn — vervangt inline
--    supabase.from('hubspot_companies').ilike(...) zodat het patroon
--    consistent is met search_contactpersonen.
--
-- B) public.get_contact_notes_full(p_hubspot_contact_id text,
--                                   p_lookback_days int)
--    Verbreding van get_contact_notes — pakt nu OOK notes op company-
--    niveau van het bedrijf waar dit contact bij hoort. Op contact-
--    niveau zit slechts 6% van alle notes (37/614); de overige 94%
--    zitten op company. Per note via_company boolean zodat de UI kan
--    aangeven "deze note ging over het bedrijf, niet specifiek over dit
--    contact". get_contact_notes blijft bestaan voor backward-compat.
-- =====================================================================

-- =====================================================================
-- A) search_companies
-- =====================================================================
CREATE OR REPLACE FUNCTION public.search_companies(
  query text,
  limit_n int DEFAULT 8
)
RETURNS TABLE (
  company_id            text,
  name                  text,
  domain                text,
  industry              text,
  lifecyclestage        text,
  city                  text,
  country               text,
  hs_lastmodifieddate   timestamptz
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT c.company_id, c.name, c.domain, c.industry,
         c.lifecyclestage, c.city, c.country, c.hs_lastmodifieddate
  FROM public.hubspot_companies c
  WHERE c.is_archived = false
    AND length(coalesce(query, '')) >= 2
    AND (
      c.name ILIKE '%' || query || '%'
      OR c.domain ILIKE '%' || query || '%'
    )
  ORDER BY
    -- exact-match boost
    (lower(c.name) = lower(query)) DESC,
    (lower(c.domain) = lower(query)) DESC,
    c.hs_lastmodifieddate DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(limit_n, 8), 50));
$$;

COMMENT ON FUNCTION public.search_companies(text, int) IS
  'Autocomplete-search op hubspot_companies — ILIKE op name + domain, '
  'exact-match boost bovenop, gesorteerd op laatst-gewijzigd. Min query 2 '
  'tekens, cap clamped 1-50. SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.search_companies(text, int) TO authenticated;

-- =====================================================================
-- B) get_contact_notes_full — direct + via-company
-- =====================================================================
DROP FUNCTION IF EXISTS public.get_contact_notes_full(text, int);

CREATE OR REPLACE FUNCTION public.get_contact_notes_full(
  p_hubspot_contact_id text,
  p_lookback_days int DEFAULT 730
)
RETURNS TABLE (
  engagement_id           text,
  engagement_type         text,
  subject                 text,
  body_text               text,
  body_truncated          boolean,
  hs_timestamp            timestamptz,
  hubspot_owner_id        text,
  associated_contact_ids  text[],
  associated_company_ids  text[],
  associated_deal_ids     text[],
  via_company             boolean
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH contact_company AS (
    SELECT associated_company_id
    FROM public.hubspot_contacts
    WHERE contact_id = p_hubspot_contact_id
      AND is_archived = false
      AND associated_company_id IS NOT NULL
    LIMIT 1
  ),
  direct_notes AS (
    -- Tak A: notes direct gekoppeld aan dit contact
    SELECT e.id, e.engagement_type, e.subject, e.body_text, e.body_truncated,
           e.hs_timestamp, e.hubspot_owner_id,
           e.associated_contact_ids, e.associated_company_ids,
           e.associated_deal_ids,
           false AS via_company
    FROM public.hubspot_engagements e
    WHERE e.is_archived = false
      AND lower(e.engagement_type) = 'note'
      AND e.associated_contact_ids @> ARRAY[p_hubspot_contact_id]
      AND e.hs_timestamp >= (now() - (p_lookback_days || ' days')::interval)
  ),
  company_notes AS (
    -- Tak B: notes op company-niveau (van het bedrijf van dit contact),
    -- maar NIET ook direct aan dit contact gekoppeld (anders dubbel).
    SELECT e.id, e.engagement_type, e.subject, e.body_text, e.body_truncated,
           e.hs_timestamp, e.hubspot_owner_id,
           e.associated_contact_ids, e.associated_company_ids,
           e.associated_deal_ids,
           true AS via_company
    FROM public.hubspot_engagements e
    CROSS JOIN contact_company cc
    WHERE e.is_archived = false
      AND lower(e.engagement_type) = 'note'
      AND e.associated_company_ids @> ARRAY[cc.associated_company_id]
      AND NOT (e.associated_contact_ids @> ARRAY[p_hubspot_contact_id])
      AND e.hs_timestamp >= (now() - (p_lookback_days || ' days')::interval)
  )
  SELECT * FROM direct_notes
  UNION ALL
  SELECT * FROM company_notes
  ORDER BY hs_timestamp DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_contact_notes_full(text, int) IS
  'HubSpot NOTE-engagements voor een contact — UNION van direct (notes met '
  'contact-id in associated_contact_ids) en via-company (notes op het '
  'bedrijf van het contact). Per note via_company boolean. Dedup tegen '
  'dubbele weergave: company-notes filteren contact-direct uit. Cap 100, '
  'lookback default 730d. SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.get_contact_notes_full(text, int) TO authenticated;
