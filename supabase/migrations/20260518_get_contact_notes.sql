-- =====================================================================
-- get_contact_notes RPC + GIN-index op associated_contact_ids
-- =====================================================================
-- Doel: HubSpot NOTE-engagements voor een contact als optionele 6e
-- categorie in de Postvak-Tijdlijn (en de Contact-tijdlijn-zoekpagina).
-- Default-uit toggle in UI — staan default niet aan zodat ze niet de
-- focus wegnemen van mails + meetings.
--
-- Schrijver: dashboard-refresh skill (handmatig)
-- Lezer    : SenderTimeline.jsx (V9.6+)
-- =====================================================================

-- GIN-index voor snel associated_contact_ids @> ARRAY[X] lookup
CREATE INDEX IF NOT EXISTS idx_hubspot_engagements_contact_ids_gin
  ON public.hubspot_engagements USING GIN (associated_contact_ids);

COMMENT ON INDEX public.idx_hubspot_engagements_contact_ids_gin IS
  'GIN-index voor get_contact_notes (en company-variant) — versnelt '
  'array-containment-search op associated_contact_ids.';

CREATE OR REPLACE FUNCTION public.get_contact_notes(
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
  associated_company_ids  text[],
  associated_deal_ids     text[]
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT e.id,
         e.engagement_type,
         e.subject,
         e.body_text,
         e.body_truncated,
         e.hs_timestamp,
         e.hubspot_owner_id,
         e.associated_company_ids,
         e.associated_deal_ids
  FROM public.hubspot_engagements e
  WHERE e.is_archived = false
    AND lower(e.engagement_type) = 'note'
    AND e.associated_contact_ids @> ARRAY[p_hubspot_contact_id]
    AND e.hs_timestamp >= (now() - (p_lookback_days || ' days')::interval)
  ORDER BY e.hs_timestamp DESC
  LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_contact_notes(text, int) IS
  'HubSpot NOTE-engagements gekoppeld aan een contact. Default lookback '
  '730 dagen, cap 100. SECURITY INVOKER + LANGUAGE sql STABLE. '
  'Gebruiker: dashboard SenderTimeline.jsx (V9.6+, optionele toggle).';

GRANT EXECUTE ON FUNCTION public.get_contact_notes(text, int) TO authenticated;
