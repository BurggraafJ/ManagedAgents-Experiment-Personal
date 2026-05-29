-- klantbase-b: handmatige verlenging-aanvragen queue + RPCs
-- Toegepast via Supabase MCP 2026-05-28. Lokale file voor git-record.
BEGIN;

CREATE TABLE IF NOT EXISTS public.klantbase_renewal_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_query       text NOT NULL,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','matched','processed','failed','dismissed')),
  matched_company_id  text,
  matched_deal_id     text,
  result_proposal_id  uuid REFERENCES public.klantbase_proposals(id) ON DELETE SET NULL,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_klantbase_renewal_requests_queue
  ON public.klantbase_renewal_requests (user_id, status, created_at)
  WHERE status IN ('queued','matched');

ALTER TABLE public.klantbase_renewal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS klantbase_renewal_requests_user_select ON public.klantbase_renewal_requests;
CREATE POLICY klantbase_renewal_requests_user_select ON public.klantbase_renewal_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS klantbase_renewal_requests_user_update ON public.klantbase_renewal_requests;
CREATE POLICY klantbase_renewal_requests_user_update ON public.klantbase_renewal_requests
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP TRIGGER IF EXISTS klantbase_renewal_requests_updated_at ON public.klantbase_renewal_requests;
CREATE TRIGGER klantbase_renewal_requests_updated_at
  BEFORE UPDATE ON public.klantbase_renewal_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_klantbase_set_updated_at();

CREATE OR REPLACE FUNCTION public.request_klantbase_renewal(p_company_query text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_company_query IS NULL OR length(trim(p_company_query)) = 0 THEN
    RAISE EXCEPTION 'company_query may not be empty';
  END IF;
  INSERT INTO public.klantbase_renewal_requests (user_id, company_query)
       VALUES (auth.uid(), trim(p_company_query)) RETURNING id INTO v_id;
  UPDATE public.agent_schedules SET manual_run_requested_at = now(), next_run_at = now()
   WHERE agent_name = 'klantbase';
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.dismiss_klantbase_renewal_request(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_renewal_requests SET status = 'dismissed'
   WHERE id = p_id AND user_id = auth.uid() AND status IN ('queued','matched','failed');
  IF NOT FOUND THEN RAISE EXCEPTION 'renewal-request % not found or already processed', p_id; END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.request_klantbase_renewal(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_klantbase_renewal_request(uuid) TO authenticated;

COMMIT;
