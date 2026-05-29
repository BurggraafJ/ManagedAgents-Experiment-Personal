-- klantbase-c: hubspot_deal_files mirror + RPC (sync-trigger)
-- klantbase-d: + parsed_text kolommen (samengevoegd in deze file voor git-record)
-- Toegepast via Supabase MCP 2026-05-29.
BEGIN;

CREATE TABLE IF NOT EXISTS public.hubspot_deal_files (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hubspot_deal_id    text NOT NULL,
  hubspot_file_id    text NOT NULL,
  filename           text,
  mime_type          text,
  size_bytes         bigint,
  download_url       text,
  url_expires_at     timestamptz,
  detected_as_loa    boolean NOT NULL DEFAULT false,
  source_note_id     text,
  source_kind        text NOT NULL DEFAULT 'note_attachment'
                       CHECK (source_kind IN ('note_attachment','deal_attachment','engagement_file')),
  synced_at          timestamptz NOT NULL DEFAULT now(),
  -- klantbase-d toevoegingen:
  file_extension     text,
  parsed_text        text,
  parsed_at          timestamptz,
  parse_error        text,
  UNIQUE (hubspot_deal_id, hubspot_file_id)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_deal_files_deal ON public.hubspot_deal_files (hubspot_deal_id);
CREATE INDEX IF NOT EXISTS idx_hubspot_deal_files_loa
  ON public.hubspot_deal_files (hubspot_deal_id, detected_as_loa) WHERE detected_as_loa = true;

ALTER TABLE public.hubspot_deal_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hubspot_deal_files_read ON public.hubspot_deal_files;
CREATE POLICY hubspot_deal_files_read ON public.hubspot_deal_files
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.request_klantbase_deal_files_sync(p_deal_ids text[]) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.agent_config (agent_name, config_key, config_value, is_secret)
  VALUES ('hubspot-deal-files-sync', 'priority_deals', to_jsonb(p_deal_ids)::text, false)
  ON CONFLICT (agent_name, config_key) DO UPDATE
    SET config_value = to_jsonb(p_deal_ids)::text, updated_at = now();
  UPDATE public.agent_schedules SET manual_run_requested_at = now(), next_run_at = now()
   WHERE agent_name = 'klantbase';
END $$;

GRANT EXECUTE ON FUNCTION public.request_klantbase_deal_files_sync(text[]) TO authenticated;

COMMIT;
