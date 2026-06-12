-- =============================================================================
-- Vragenbak W5: data-home RPC's — licentieprijs / startdatum / licentiewaarde
-- =============================================================================
-- 2026-06-12. Fork-beslissing op meting: A01/A06/A07 hard-faal puur op data-
-- afwezigheid terwijl live HubSpot 96-99% dekking heeft (startdatum 98/102,
-- licentieprijs 101/102). hubspot-sync-etl v10 mirrort de licentie/contract-
-- props nu mee in hubspot_deals.properties (jsonb). Deze RPC's ontsluiten ze.
-- HubSpot levert datums als epoch-ms strings — analytics_prop_date parset
-- zowel epoch-ms als ISO.
-- Toegang: alleen service_role (rag-chat edge).
-- =============================================================================

-- Helpers: veilige date/numeric uit properties-jsonb.
CREATE OR REPLACE FUNCTION analytics_prop_date(p jsonb, k text)
RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(p->>k, '') = '' THEN NULL
    WHEN p->>k ~ '^\d{10,16}$' THEN (to_timestamp((p->>k)::bigint / 1000.0) AT TIME ZONE 'UTC')::date
    WHEN p->>k ~ '^\d{4}-\d{2}-\d{2}' THEN substring(p->>k from 1 for 10)::date
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION analytics_prop_num(p jsonb, k text)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(p->>k, '') = '' THEN NULL
    WHEN p->>k ~ '^-?\d+(\.\d+)?$' THEN (p->>k)::numeric
    ELSE NULL
  END;
$$;

-- 1. Klanten op licentieprijs (A01): match op prijs-per-gebruiker of vaste maandprijs.
CREATE OR REPLACE FUNCTION analytics_customers_by_price(p_price numeric)
RETURNS TABLE (company_name text, dealname text, stage_label text,
               prijs_per_gebruiker numeric, vaste_maandprijs numeric, startdatum date, scanned_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lopend AS (
    SELECT d.*, analytics_prop_num(d.properties, 'licentieprijs_per_gebruiker') AS ppu,
           analytics_prop_num(d.properties, 'vaste_licentieprijs_maand') AS vast,
           analytics_prop_date(d.properties, 'startdatum') AS startdatum
    FROM hubspot_deals d
    WHERE d.pipeline_id = '2299277539' AND d.is_archived = false
      AND d.dealstage IN ('3504527569','3136444618','5052825799','5184563446')
  )
  SELECT c.name, l.dealname, analytics_stage_label(l.pipeline_id, l.dealstage),
         l.ppu, l.vast, l.startdatum,
         (SELECT count(*)::int FROM lopend)
  FROM lopend l
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(l.associated_company_ids) LIMIT 1
  ) c ON true
  WHERE l.ppu = p_price OR l.vast = p_price
  ORDER BY l.startdatum NULLS LAST;
$$;

-- 2. Gestart in venster (A07): startdatum-gebaseerd, ongeacht huidige stage
--    (ook later gechurnde klanten zijn toen gestart). Customer Base-pipeline.
CREATE OR REPLACE FUNCTION analytics_started_in_window(p_from date, p_to date DEFAULT NULL)
RETURNS TABLE (company_name text, dealname text, startdatum date, stage_label text,
               prijs_per_gebruiker numeric, scanned_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cb AS (
    SELECT d.*, analytics_prop_date(d.properties, 'startdatum') AS startdatum,
           analytics_prop_num(d.properties, 'licentieprijs_per_gebruiker') AS ppu
    FROM hubspot_deals d
    WHERE d.pipeline_id = '2299277539' AND d.is_archived = false
  )
  SELECT c.name, cb.dealname, cb.startdatum,
         analytics_stage_label(cb.pipeline_id, cb.dealstage), cb.ppu,
         (SELECT count(*)::int FROM cb WHERE cb.startdatum IS NOT NULL)
  FROM cb
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(cb.associated_company_ids) LIMIT 1
  ) c ON true
  WHERE cb.startdatum IS NOT NULL
    AND cb.startdatum >= p_from
    AND cb.startdatum < coalesce(p_to, (now() + interval '1 day')::date)
  ORDER BY cb.startdatum;
$$;

-- 3. Maandelijkse licentiewaarde (A06): per lopende klant
--    vaste maandprijs, anders prijs-per-gebruiker × minimale licenties (met korting).
--    Transparant per rij; de som + missing-data-telling maakt de edge/het antwoord.
CREATE OR REPLACE FUNCTION analytics_license_value()
RETURNS TABLE (company_name text, dealname text, stage_label text,
               maand_waarde numeric, berekening text, scanned_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lopend AS (
    SELECT d.*,
           analytics_prop_num(d.properties, 'vaste_licentieprijs_maand') AS vast,
           analytics_prop_num(d.properties, 'licentieprijs_per_gebruiker') AS ppu,
           coalesce(analytics_prop_num(d.properties, 'minimale_licenties_licentieperiode'),
                    analytics_prop_num(d.properties, 'omvang_licentieperiode')) AS n_lic,
           analytics_prop_num(d.properties, 'korting_licentieperiode_procent') AS korting
    FROM hubspot_deals d
    WHERE d.pipeline_id = '2299277539' AND d.is_archived = false
      AND d.dealstage IN ('3504527569','3136444618','5052825799','5184563446')
  )
  SELECT c.name, l.dealname, analytics_stage_label(l.pipeline_id, l.dealstage),
         round(CASE
           WHEN l.vast IS NOT NULL THEN l.vast * (1 - coalesce(l.korting, 0) / 100.0)
           WHEN l.ppu IS NOT NULL AND l.n_lic IS NOT NULL THEN l.ppu * l.n_lic * (1 - coalesce(l.korting, 0) / 100.0)
           ELSE NULL
         END, 2) AS maand_waarde,
         CASE
           WHEN l.vast IS NOT NULL THEN 'vaste maandprijs' || CASE WHEN coalesce(l.korting,0) > 0 THEN format(' −%s%% korting', l.korting) ELSE '' END
           WHEN l.ppu IS NOT NULL AND l.n_lic IS NOT NULL THEN format('%s × %s licenties', l.ppu, l.n_lic) || CASE WHEN coalesce(l.korting,0) > 0 THEN format(' −%s%% korting', l.korting) ELSE '' END
           WHEN l.ppu IS NOT NULL THEN 'prijs per gebruiker bekend, aantal licenties onbekend'
           ELSE 'geen prijsdata'
         END AS berekening,
         (SELECT count(*)::int FROM lopend)
  FROM lopend l
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(l.associated_company_ids) LIMIT 1
  ) c ON true
  ORDER BY maand_waarde DESC NULLS LAST;
$$;

REVOKE ALL ON FUNCTION analytics_prop_date(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_prop_num(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_customers_by_price(numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_started_in_window(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_license_value() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics_prop_date(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_prop_num(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_customers_by_price(numeric) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_started_in_window(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_license_value() TO service_role;
