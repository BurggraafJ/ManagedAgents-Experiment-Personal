-- =====================================================================
-- get_contact_company — RPC voor contact→company lookup (V9.10)
-- =====================================================================
-- Voor de contact-tijdlijn-banner "Onderdeel van [Bedrijf]". Joint
-- hubspot_contacts → hubspot_companies via associated_company_id en
-- voegt counts toe (aantal andere contacten, mails, events, notes voor
-- die company) zodat de banner direct context geeft.
--
-- Returns 0 of 1 rij (één contact = één primary company in HubSpot).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_contact_company(
  p_hubspot_contact_id text
)
RETURNS TABLE (
  company_id        text,
  name              text,
  domain            text,
  industry          text,
  lifecyclestage    text,
  city              text,
  country           text,
  num_employees     integer,
  other_contacts    integer,
  notes_on_company  integer
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH cc AS (
    SELECT associated_company_id
    FROM public.hubspot_contacts
    WHERE contact_id = p_hubspot_contact_id
      AND is_archived = false
      AND associated_company_id IS NOT NULL
    LIMIT 1
  )
  SELECT c.company_id,
         c.name,
         c.domain,
         c.industry,
         c.lifecyclestage,
         c.city,
         c.country,
         c.num_employees,
         (SELECT count(*)::int FROM public.hubspot_contacts hc
          WHERE hc.is_archived = false
            AND hc.associated_company_id = c.company_id
            AND hc.contact_id <> p_hubspot_contact_id)   AS other_contacts,
         (SELECT count(*)::int FROM public.hubspot_engagements e
          WHERE e.is_archived = false
            AND lower(e.engagement_type) = 'note'
            AND e.associated_company_ids @> ARRAY[c.company_id]) AS notes_on_company
  FROM public.hubspot_companies c
  WHERE c.is_archived = false
    AND c.company_id = (SELECT associated_company_id FROM cc);
$$;

COMMENT ON FUNCTION public.get_contact_company(text) IS
  'Lookup van company-info + counts voor een HubSpot-contact. Returns 0 '
  'of 1 rij. Gebruikt door ContactTimelineView (V9.10+) voor de '
  '"Onderdeel van [bedrijf]"-banner met jump-link naar company-tijdlijn.';

GRANT EXECUTE ON FUNCTION public.get_contact_company(text) TO authenticated;
