-- =============================================================================
-- Vragenbak W5-fixes: (1) licentiewaarde 0-placeholder, (2) A07 ground-truth
-- =============================================================================
-- 2026-06-12, beide meting-gedreven:
-- (1) analytics_license_value: 70/71 lopende deals hebben vaste_licentieprijs_
--     maand = 0 als HubSpot-placeholder -> de formule pakte 'vaste maandprijs
--     0' i.p.v. ppu×licenties (totaal kelderde naar €1.125). Fix: prijsvelden
--     tellen alleen mee als > 0; 69/71 hebben positieve ppu én licenties.
-- (2) A07: de mirror+RPC vonden 12 starters in jan 2026; live HubSpot-hercheck
--     bevestigt dat er écht 12 zijn — de oorspronkelijke ground-truth-query
--     (BETWEEN '2026-01-01' AND '2026-01-31' via CRM-query-engine) miste de 5
--     deals met startdatum exact 2026-01-01T00:00Z (grens-artefact). Eval-item
--     A07 bijgewerkt naar de geverifieerde 12.
-- =============================================================================

CREATE OR REPLACE FUNCTION analytics_license_value()
RETURNS TABLE (company_name text, dealname text, stage_label text,
               maand_waarde numeric, berekening text, scanned_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lopend AS (
    SELECT d.*,
           nullif(analytics_prop_num(d.properties, 'vaste_licentieprijs_maand'), 0) AS vast,
           nullif(analytics_prop_num(d.properties, 'licentieprijs_per_gebruiker'), 0) AS ppu,
           nullif(coalesce(analytics_prop_num(d.properties, 'minimale_licenties_licentieperiode'),
                           analytics_prop_num(d.properties, 'omvang_licentieperiode')), 0) AS n_lic,
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

-- A07: geverifieerde ground-truth = 12 starters jan 2026 (mirror + live her-check).
UPDATE rag_eval_questions SET
  expected_answer = 'Exact 12 (startdatum-gebaseerd, ongeacht latere churn of vernieuwing): Spoor Hoekman Advocaten, Smeets Gijbels (2), Absolute Advocaten, AKZ Advocatuur, Schol & Gorter Advocaten (allen 1 jan), Noortje Lina Strafrechtadvocaten (5 jan), Gelissen Belastingadviseurs (5 jan), Nexavelo advocaten (6 jan), FTW Advocaten (8 jan), Vogelaar Bosch Spijer Advocaten (15 jan), Westpoint advocaten (19 jan), Beer Advocaten / Balieplus (26 jan).',
  asserts = '{"expect_route":"structured","required_entities":["Westpoint","Gelissen","Noortje Lina","FTW","Nexavelo","Vogelaar","Beer Advocaten","Spoor Hoekman","Absolute","AKZ","Schol"],"expect_min_rows":12,"expect_max_rows":14,"expect_scan_claim":true}'::jsonb,
  notes = 'Ground-truth herzien 2026-06-12: mirror+RPC vonden 12, live HubSpot-hercheck bevestigde 12 (oorspronkelijke CRM-query BETWEEN-grens miste 5 deals met startdatum exact 2026-01-01T00:00Z). Vast venster.',
  updated_at = now()
WHERE id = 'A07';
