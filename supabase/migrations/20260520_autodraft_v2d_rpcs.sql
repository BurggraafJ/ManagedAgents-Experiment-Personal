-- =====================================================================
-- AutoDraft v2 — Fase 1D: RPCs (resolve_klant_subtype + get_enabled_actions)
-- =====================================================================
-- Twee RPCs voor de classifier:
--
-- 1) resolve_klant_subtype(p_from_email)
--    Deterministische klant-resolver via HubSpot pipeline + stage.
--    Returns 'klant_customer_base' | 'klant_pilot' | 'klant_sales_lead' |
--    'klant_sales_opvolging' | NULL.
--    Pad: email → email_domain alias → entity_resolution.entity_id (company)
--         → hubspot_deals.associated_company_ids → meest recente dealstage.
--
-- 2) get_enabled_actions()
--    Returnt enabled autodraft_actions in een format dat de classifier-
--    prompt direct kan consumeren (slug + display + hint + voorbeeld).
--
-- get_entity_timeline is bewust NIET in deze migration — bestaande
-- get_company_mails/events/notes RPCs (20260518_company_timeline_rpcs.sql)
-- dekken het company-pad al. Beslissing met Jelle 2026-05-20.
--
-- Bron-doc: https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/450494465
--           + https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/443809794
-- =====================================================================

-- =====================================================================
-- RPC 1 — resolve_klant_subtype
-- =====================================================================

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
    -- Pilot: Customer Base "Proeftijd" + Sales Pipeline "1-pitters in proefperiode"
    WHEN EXISTS (
      SELECT 1 FROM stages
      WHERE dealstage IN (
        '3504527569',  -- CB · Proeftijd
        '4841337018'   -- Sales · 1-pitters in proefperiode (zonder ovk)
      )
    )
    THEN 'klant_pilot'

    -- Customer Base actief: alle CB-stages met actieve werkrelatie
    WHEN EXISTS (
      SELECT 1 FROM stages
      WHERE dealstage IN (
        '3136444618',  -- CB · Actieve deals
        '5052825799',  -- CB · Eenpitters / kleine kantoren
        '5184563446',  -- CB · Self-service (low-touch maar wel CB)
        '3417083067'   -- CB · Afgesloten - Vernieuwd
      )
    )
    THEN 'klant_customer_base'

    -- Sales-lead vs opvolging: VOORLOPIGE CUT (open vraag #3 voor Jelle).
    -- Lead = Sales Pipeline stages waar nog géén kennismakingsgesprek
    -- heeft plaatsgevonden. Opvolging = wel kennismaking geweest.
    -- Cut wordt door Jelle bevestigd; voor nu: alle Sales Pipeline
    -- gerelateerde stages = sales_lead (conservatief).
    WHEN EXISTS (
      SELECT 1 FROM stages
      WHERE pipeline_id IN (
        'default',         -- Sales Pipeline
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
  'Pad: from_email → email_domain alias in entity_resolution → entity_id '
  '(company) → hubspot_deals.associated_company_ids → meest recente '
  'dealstage. Returns: klant_pilot | klant_customer_base | klant_sales_lead '
  '| NULL. NB: lead-vs-opvolging cut is VOORLOPIG; bevestiging Jelle '
  'gevraagd (Confluence 450494465 §"Open eindjes" #3). '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.resolve_klant_subtype(text) TO authenticated;

-- =====================================================================
-- RPC 2 — get_enabled_actions
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_enabled_actions();

CREATE OR REPLACE FUNCTION public.get_enabled_actions()
RETURNS TABLE (
  slug                  text,
  category              text,
  display_name          text,
  description           text,
  prompt_hint           text,
  example_snippet       text,
  target_type           text,
  target_value          text,
  confidence_threshold  numeric,
  is_default            boolean,
  suggested_count       integer,
  accepted_count        integer
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT a.slug, a.category, a.display_name, a.description,
         a.prompt_hint, a.example_snippet,
         a.target_type, a.target_value, a.confidence_threshold,
         a.is_default, a.suggested_count, a.accepted_count
    FROM public.autodraft_actions a
   WHERE a.enabled = true
   ORDER BY
     -- defaults eerst (gegarandeerde set), dan op acceptance-rate
     a.is_default DESC,
     CASE WHEN a.suggested_count > 0
          THEN a.accepted_count::numeric / a.suggested_count
          ELSE 0.5
     END DESC,
     a.slug;
$$;

COMMENT ON FUNCTION public.get_enabled_actions() IS
  'Returnt enabled rijen uit autodraft_actions in formaat dat de classifier-'
  'prompt direct kan consumeren. Gesorteerd op default-eerst, daarna op '
  'accept-rate (accepted_count / suggested_count). Skill leest dit één keer '
  'per run en bouwt few-shot prompt-context. '
  'SECURITY INVOKER + LANGUAGE sql STABLE.';

GRANT EXECUTE ON FUNCTION public.get_enabled_actions() TO authenticated;

-- =====================================================================
-- END
-- =====================================================================
