-- =====================================================================
-- AutoDraft v2 — Fase 2a data-fixes (Jelle bevestigde 2026-05-20)
-- =====================================================================
-- Antwoorden op de 5 voorlopige interpretaties uit Fase 1
-- (Confluence 452395010 §"Voorlopige interpretaties die ik genomen heb"):
--
--  1. klant_sales_lead vs klant_sales_opvolging: cut bij stage "na
--     kennismaking" bevestigd, MAAR specifieke HubSpot stage_id volgt
--     nog. RPC blijft conservatief (alles = klant_sales_lead) tot Jelle
--     stage_id levert. TODO ingebouwd in RPC-tekst hieronder.
--  2. forward.finance -> finance@legal-mind.nl                BEVESTIGD (no-op)
--  3. forward.hr -> personeel@legal-mind.nl                   BEVESTIGD (no-op)
--  4. delegate.jira-lemind -> project key LEMIND              BEVESTIGD (no-op)
--  5. CB stage 5184563446 (Self-service) -> EIGEN SUBTYPE
--     klant_customer_base_self_service (los van klant_customer_base).
--
-- Idempotent: re-run mag, doet niets bij tweede pass.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nieuwe categorie klant_customer_base_self_service
--    Erft default_action / target_folder / audience van parent CB-rij
--    zodat self-service de bestaande CB-flow volgt totdat Jelle het via
--    UI verfijnt. Sort_order = parent + 1.
-- ---------------------------------------------------------------------

INSERT INTO public.autodraft_categories (
  category_key, label, default_action, default_target_folder, default_audience,
  sort_order, active, source, detect_rules, priority_signals
)
SELECT
  'klant_customer_base_self_service',
  'Klant - Customer Base (self-service)',
  default_action,
  default_target_folder,
  default_audience,
  sort_order + 1,
  true,
  'seeded',
  '{}'::jsonb,
  ARRAY['low_touch','self_service_cb']
FROM public.autodraft_categories
WHERE category_key = 'klant_customer_base'
ON CONFLICT (category_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. resolve_klant_subtype: self-service-tak toevoegen vóór de generieke
--    klant_customer_base-tak zodat stage 5184563446 niet onder CB valt.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.resolve_klant_subtype(text);

CREATE OR REPLACE FUNCTION public.resolve_klant_subtype(p_from_email text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  WITH domain AS (
    SELECT lower(split_part(p_from_email, '@', 2)) AS d
    WHERE p_from_email IS NOT NULL AND p_from_email <> ''
  ),
  company AS (
    SELECT er.entity_id::text AS company_id
      FROM public.entity_resolution er
      JOIN domain ON er.alias_value = domain.d
     WHERE er.alias_type = 'email_domain'
       AND er.entity_type = 'company'
     LIMIT 1
  ),
  stages AS (
    SELECT d.dealstage, d.pipeline_id, d.hs_lastmodifieddate
      FROM public.hubspot_deals d
      JOIN company c ON c.company_id = ANY(d.associated_company_ids)
     WHERE NOT d.is_archived
     ORDER BY d.hs_lastmodifieddate DESC
     LIMIT 5
  )
  SELECT CASE
    -- Pilot: CB Proeftijd + Sales 1-pitters in proefperiode
    WHEN EXISTS (
      SELECT 1 FROM stages
       WHERE dealstage IN (
         '3504527569',  -- CB · Proeftijd
         '4841337018'   -- Sales · 1-pitters in proefperiode (zonder ovk)
       )
    )
    THEN 'klant_pilot'

    -- NIEUW (Fase 2a, 2026-05-20): Self-service-tak vóór generieke CB.
    -- Stage 5184563446 krijgt eigen subtype zodat low-touch CB een eigen
    -- default-action/folder kan krijgen (Jelle's keuze: eigen subtype).
    WHEN EXISTS (
      SELECT 1 FROM stages WHERE dealstage = '5184563446'
    )
    THEN 'klant_customer_base_self_service'

    -- Customer Base actief (overige CB-stages)
    WHEN EXISTS (
      SELECT 1 FROM stages
       WHERE dealstage IN (
         '3136444618',  -- CB · Actieve deals
         '5052825799',  -- CB · Eenpitters / kleine kantoren
         '3417083067'   -- CB · Afgesloten - Vernieuwd
       )
    )
    THEN 'klant_customer_base'

    -- Sales-lead vs opvolging:
    -- Jelle bevestigde 2026-05-20: cut bij stage "na kennismaking".
    -- TODO: specifieke HubSpot stage_id(s) volgen nog van Jelle. Zodra
    -- bekend: voeg een CASE-tak toe vóór deze die 'klant_sales_opvolging'
    -- returnt voor stages waar de kennismaking al heeft plaatsgevonden.
    -- Voor nu blijft alles binnen Sales Pipeline = klant_sales_lead.
    WHEN EXISTS (
      SELECT 1 FROM stages
       WHERE pipeline_id IN (
         'default',        -- Sales Pipeline
         '3571993844',
         '2562718926',
         '2557844668',
         '3534570692',
         '2971054291'
       )
    )
    THEN 'klant_sales_lead'

    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.resolve_klant_subtype(text) IS
  'Deterministische klant-subtype-resolver via HubSpot pipeline + stage. '
  'Returns: klant_pilot | klant_customer_base | klant_customer_base_self_service '
  '| klant_sales_lead | NULL. Self-service-tak toegevoegd 2026-05-20 (Fase 2a). '
  'Sales-lead vs opvolging cut: specifieke stage_id volgt nog van Jelle. '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.resolve_klant_subtype(text) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Verificatie-NOTICES voor de 3 bevestigde no-op seeds
--    (alleen logging — niet-blokkerend bij re-run)
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_finance_ok boolean;
  v_hr_ok      boolean;
  v_jira_ok    boolean;
  v_self_ok    boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.autodraft_actions
     WHERE slug = 'forward.finance' AND target_value = 'finance@legal-mind.nl'
  ) INTO v_finance_ok;

  SELECT EXISTS (
    SELECT 1 FROM public.autodraft_actions
     WHERE slug = 'forward.hr' AND target_value = 'personeel@legal-mind.nl'
  ) INTO v_hr_ok;

  SELECT EXISTS (
    SELECT 1 FROM public.autodraft_actions
     WHERE slug = 'delegate.jira-lemind' AND target_value = 'LEMIND'
  ) INTO v_jira_ok;

  SELECT EXISTS (
    SELECT 1 FROM public.autodraft_categories
     WHERE category_key = 'klant_customer_base_self_service'
  ) INTO v_self_ok;

  RAISE NOTICE 'Fase 2a verificatie:';
  RAISE NOTICE '  forward.finance = finance@legal-mind.nl: %', v_finance_ok;
  RAISE NOTICE '  forward.hr      = personeel@legal-mind.nl: %', v_hr_ok;
  RAISE NOTICE '  delegate.jira   = LEMIND:                  %', v_jira_ok;
  RAISE NOTICE '  klant_customer_base_self_service cat:      %', v_self_ok;

  IF NOT v_finance_ok THEN
    RAISE WARNING 'forward.finance target_value wijkt af van finance@legal-mind.nl';
  END IF;
  IF NOT v_hr_ok THEN
    RAISE WARNING 'forward.hr target_value wijkt af van personeel@legal-mind.nl';
  END IF;
  IF NOT v_jira_ok THEN
    RAISE WARNING 'delegate.jira-lemind target_value wijkt af van LEMIND';
  END IF;
END $$;

-- =====================================================================
-- END
-- =====================================================================
