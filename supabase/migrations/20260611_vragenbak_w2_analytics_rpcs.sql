-- =============================================================================
-- Vragenbak in de breedte — W2: Motor A analytics-RPC's (read-only, parameterisch)
-- =============================================================================
-- 2026-06-11. Project Confluence 471302146. Afgebakende read-only RPC's — géén
-- vrije text-to-SQL. Aangeroepen door rag-chat (service_role) via de router.
-- Alle functies STABLE; EXPLAIN ANALYZE op de zwaarste (uncontacted): 1,2s,
-- ruim onder de PostgREST statement-timeout (~8s).
-- Toegang: alleen service_role (rag-chat edge); anon/authenticated geen grant.
-- =============================================================================

-- Helper: stage-label uit hubspot_pipelines.stages (jsonb array van {id,label}).
CREATE OR REPLACE FUNCTION analytics_stage_label(p_pipeline_id text, p_stage_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s->>'label'
  FROM hubspot_pipelines p, LATERAL jsonb_array_elements(p.stages) s
  WHERE p.pipeline_id = p_pipeline_id AND s->>'id' = p_stage_id
  LIMIT 1;
$$;

-- 1. Gechurnde klanten in een venster (A02). superseded uitgesloten.
--    Rijen zonder churned_at vallen buiten elk venster (bewust: datum onbekend);
--    p_include_undated=true toont ze apart (churned_at NULL, gesorteerd achteraan).
CREATE OR REPLACE FUNCTION analytics_churned_in_window(
  p_from date,
  p_to date DEFAULT NULL,
  p_include_undated boolean DEFAULT false
)
RETURNS TABLE (company_name text, dealname text, churned_at date, detected_at date, new_provider text, churn_summary text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cc.company_name, cc.dealname, cc.churned_at::date, cc.detected_at::date,
         cc.new_provider, left(cc.churn_summary, 300)
  FROM churn_customers cc
  WHERE cc.superseded = false
    AND (
      (cc.churned_at IS NOT NULL AND cc.churned_at >= p_from
       AND cc.churned_at < coalesce(p_to, (now() + interval '1 day'))::timestamptz)
      OR (p_include_undated AND cc.churned_at IS NULL)
    )
  ORDER BY cc.churned_at NULLS LAST;
$$;

-- 2. Actieve klanten zonder mailcontact in p_days dagen (A05).
--    Klant = niet-gearchiveerde Customer Base-deal in lopende stage
--    (Proeftijd / Actieve deals / Eenpitters / Self-service), met company-domain.
--    Laatste contact = nieuwste in- of uitgaande mail op domein-match.
CREATE OR REPLACE FUNCTION analytics_uncontacted_since(p_days int DEFAULT 60)
RETURNS TABLE (company_name text, domain text, dealname text, stage_label text, last_mail_at timestamptz, days_silent int, scanned_total int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH active_cb AS (
    SELECT DISTINCT ON (c.company_id)
      c.company_id, c.name AS company_name, lower(c.domain) AS domain,
      d.dealname, analytics_stage_label(d.pipeline_id, d.dealstage) AS stage_label
    FROM hubspot_deals d
    CROSS JOIN LATERAL unnest(d.associated_company_ids) AS ac(cid)
    JOIN hubspot_companies c ON c.company_id = ac.cid
    WHERE d.pipeline_id = '2299277539' AND d.is_archived = false
      AND d.dealstage IN ('3504527569','3136444618','5052825799','5184563446')
      AND c.domain IS NOT NULL
    ORDER BY c.company_id, d.hs_lastmodifieddate DESC NULLS LAST
  ), last_contact AS (
    SELECT a.domain, max(GREATEST(coalesce(m.received_at, '-infinity'), coalesce(m.sent_at, '-infinity'))) AS last_mail_at
    FROM (SELECT DISTINCT domain FROM active_cb) a
    JOIN mail_messages m ON (m.from_domain = a.domain AND NOT m.is_from_me)
      OR (m.is_from_me AND m.to_recipients::text ILIKE '%@' || a.domain || '%')
    WHERE m.is_deleted = false
    GROUP BY a.domain
  )
  SELECT a.company_name, a.domain, a.dealname, a.stage_label,
         lc.last_mail_at,
         CASE WHEN lc.last_mail_at IS NULL THEN NULL ELSE (now()::date - lc.last_mail_at::date) END AS days_silent,
         (SELECT count(*)::int FROM active_cb) AS scanned_total
  FROM active_cb a
  LEFT JOIN last_contact lc ON lc.domain = a.domain
  WHERE lc.last_mail_at IS NULL OR lc.last_mail_at < now() - make_interval(days => p_days)
  ORDER BY lc.last_mail_at ASC NULLS FIRST;
$$;

-- 3. Lopende pilots/proefperiodes (A03): Customer Base stage Proeftijd
--    + Sales Pipeline '1-pitters in proefperiode (zonder ovk)'.
CREATE OR REPLACE FUNCTION analytics_active_pilots()
RETURNS TABLE (bron text, company_name text, dealname text, stage_label text, closedate date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'customer_base'::text AS bron,
         c.name, d.dealname, analytics_stage_label(d.pipeline_id, d.dealstage), d.closedate::date
  FROM hubspot_deals d
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(d.associated_company_ids) LIMIT 1
  ) c ON true
  WHERE d.pipeline_id = '2299277539' AND d.is_archived = false AND d.dealstage = '3504527569'
  UNION ALL
  SELECT 'sales_pipeline'::text,
         c.name, d.dealname, analytics_stage_label(d.pipeline_id, d.dealstage), d.closedate::date
  FROM hubspot_deals d
  LEFT JOIN LATERAL (
    SELECT c2.name FROM hubspot_companies c2
    WHERE c2.company_id = ANY(d.associated_company_ids) LIMIT 1
  ) c ON true
  WHERE d.pipeline_id = 'default' AND d.is_archived = false AND d.dealstage = '4841337018'
  ORDER BY 1, 4 NULLS LAST;
$$;

-- 4. Generieke telling per pipeline/stage (router-tool voor "hoeveel ... in fase ...").
CREATE OR REPLACE FUNCTION analytics_count_by_stage(p_pipeline_label text DEFAULT NULL)
RETURNS TABLE (pipeline_label text, stage_label text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.label, coalesce(analytics_stage_label(d.pipeline_id, d.dealstage), d.dealstage), count(*)
  FROM hubspot_deals d
  JOIN hubspot_pipelines p ON p.pipeline_id = d.pipeline_id
  WHERE d.is_archived = false
    AND (p_pipeline_label IS NULL OR p.label ILIKE '%' || p_pipeline_label || '%')
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$$;

-- 5. Deals boven bedrag (A04). LET OP: amount wordt in HubSpot niet bijgehouden
--    (live gecheckt 2026-06-11: 0 deals met amount>0 op 3 na) — de router-catalogus
--    instrueert het antwoord-LLM om eerlijk te melden dat dit niet uit de data kan
--    wanneer deze functie (vrijwel) leeg terugkomt.
CREATE OR REPLACE FUNCTION analytics_deals_over_amount(p_min numeric DEFAULT 10000)
RETURNS TABLE (dealname text, pipeline_label text, stage_label text, amount numeric, closedate date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.dealname, p.label,
         coalesce(analytics_stage_label(d.pipeline_id, d.dealstage), d.dealstage),
         d.amount, d.closedate::date
  FROM hubspot_deals d
  JOIN hubspot_pipelines p ON p.pipeline_id = d.pipeline_id
  WHERE d.is_archived = false AND d.amount IS NOT NULL AND d.amount > p_min
  ORDER BY d.amount DESC;
$$;

-- Toegang: alleen service_role (rag-chat edge). Geen anon/authenticated.
REVOKE ALL ON FUNCTION analytics_stage_label(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_churned_in_window(date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_uncontacted_since(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_active_pilots() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_count_by_stage(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION analytics_deals_over_amount(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analytics_stage_label(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_churned_in_window(date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_uncontacted_since(int) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_active_pilots() TO service_role;
GRANT EXECUTE ON FUNCTION analytics_count_by_stage(text) TO service_role;
GRANT EXECUTE ON FUNCTION analytics_deals_over_amount(numeric) TO service_role;
