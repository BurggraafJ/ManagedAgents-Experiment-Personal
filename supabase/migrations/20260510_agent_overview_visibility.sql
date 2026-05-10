-- =====================================================================
-- Agent overview-visibility — sessie 16 (2026-05-10)
-- =====================================================================
-- Voegt een toggle toe om agents wel/niet in het Dashboard-overzicht te
-- tonen. Onafhankelijk van enabled (active) status — een agent kan live
-- draaien maar wel verborgen zijn uit het overzicht (bv. helper-agents
-- die je in de Functies-sectie wil zien, niet in de hoofdgrid).
--
-- Drie wijzigingen:
--   1. Kolom show_in_overview op agent_schedules (default true)
--   2. RPC set_agent_overview_visibility(agent, visible) voor dashboard
--   3. Default-false voor bekende infra/helper-agents (orchestrator etc.)
-- =====================================================================

-- 1. Kolom toevoegen (idempotent)
ALTER TABLE public.agent_schedules
  ADD COLUMN IF NOT EXISTS show_in_overview boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agent_schedules.show_in_overview IS
  'Toont deze agent in het hoofd-Dashboard agents-grid. False = verborgen (helper/infra). Onafhankelijk van enabled.';

-- 2. RPC voor dashboard om de flag te toggelen
CREATE OR REPLACE FUNCTION public.set_agent_overview_visibility(
  p_agent_name text,
  p_visible boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existed boolean;
BEGIN
  IF p_agent_name IS NULL OR length(trim(p_agent_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_name_required');
  END IF;

  UPDATE public.agent_schedules
     SET show_in_overview = COALESCE(p_visible, true),
         updated_at = now()
   WHERE agent_name = p_agent_name
  RETURNING true INTO v_existed;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'agent_not_found');
  END IF;

  RETURN jsonb_build_object('ok', true, 'agent_name', p_agent_name, 'visible', p_visible);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_agent_overview_visibility(text, boolean) TO authenticated, anon;

COMMENT ON FUNCTION public.set_agent_overview_visibility IS
  'Toggle of een agent zichtbaar is in het Dashboard agents-overzicht. Onafhankelijk van enabled.';

-- 3. Verberg standaard-helpers/infra die je niet in het hoofdgrid wil zien
--    (Daily Admin / AutoDraft / etc. blijven default zichtbaar)
UPDATE public.agent_schedules
   SET show_in_overview = false
 WHERE agent_name IN (
   'orchestrator',
   'dashboard-refresh',
   'agent-manager',
   'chunker',
   'mail-backfill',
   'hubspot-engagements-sync',
   'autodraft-rag-prefill'
 )
   AND show_in_overview IS DISTINCT FROM false;
