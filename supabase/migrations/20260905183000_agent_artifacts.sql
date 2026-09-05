-- =============================================================================
-- WP4 — agent_artifacts: een antwoord dat je kunt meenemen
-- =============================================================================
-- De chat kan een tabel berekenen maar niets afgeven. Deze migratie legt de
-- opslag neer waar `agent-artifact-build` een Excel of CSV in zet en een
-- signed URL van teruggeeft.
--
-- Drie ontwerpkeuzes, alle drie met een reden:
--
-- 1. EIGENAAR-ONLY, GEEN GEDEELDE BAK. Een artefact is een uitdraai van
--    HubSpot-, mail- en churn-data. De bucket is privaat, het pad begint met
--    de user-id, en zowel de tabel-RLS als de storage-policy hangt aan
--    `auth.uid()`. Een signed URL is bewust kort geldig (24 uur): hij is een
--    downloadlink, geen publicatiekanaal. Risico R10 uit het onderzoek.
--
-- 2. NIETS WORDT VOORAF GEBOUWD. rag-chat zet in de envelop alleen
--    `artifacts_available: ["xlsx","csv"]`. Pas als iemand klikt draait de
--    generator. Een xlsx die niemand opent kost rekentijd en opslag, en de
--    meeste chatantwoorden worden gelezen en niet gedownload.
--
-- 3. `rows`/`columns`/`params` GAAN MEE IN DE RIJ. Daarmee is "zelfde tabel als
--    vorige maand" later een parameterwijziging in plaats van een nieuwe vraag,
--    en is een uitgedeeld bestand terug te leiden naar de run die hem maakte.
--
-- Bewaartermijn: `expires_at` staat standaard op 30 dagen. Er is nog geen
-- opruim-cron — zie de follow-up in AGENT-REBUILD.md. Zonder die cron groeit de
-- bucket, dus de kolom staat er nu al zodat de opruimer straks niet hoeft te
-- gokken wat weg mag.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.agent_artifacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_log_id  uuid,                       -- rag_chat_query_log.id: welke vraag leverde dit op
  type          text NOT NULL CHECK (type IN ('xlsx', 'csv')),
  title         text NOT NULL,
  question      text,                       -- de vraag zelf, voor het verantwoordingsblad
  storage_path  text NOT NULL,
  rows          jsonb NOT NULL DEFAULT '[]'::jsonb,
  columns       jsonb NOT NULL DEFAULT '[]'::jsonb,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- definitie, route, peildatum, bronnen
  bytes         integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_owner   ON public.agent_artifacts (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_expires ON public.agent_artifacts (expires_at);

COMMENT ON TABLE public.agent_artifacts IS
  'WP4 — downloadbare uitdraaien uit de chat (xlsx/csv). Eigenaar-only; het bestand staat in de private bucket agent-artifacts onder <owner_id>/. rows/columns/params staan erbij zodat een export herbouwbaar en herleidbaar is.';
COMMENT ON COLUMN public.agent_artifacts.params IS
  'Verantwoording die óók in het bestand terechtkomt: definitie per metric, route, peildatum, doorzochte bronnen, run-id. Een geëxporteerd getal zonder herkomst gaat een vergadering in en komt er als feit weer uit.';

ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_artifacts_owner_select ON public.agent_artifacts;
CREATE POLICY agent_artifacts_owner_select ON public.agent_artifacts
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS agent_artifacts_owner_delete ON public.agent_artifacts;
CREATE POLICY agent_artifacts_owner_delete ON public.agent_artifacts
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Schrijven gebeurt uitsluitend door de edge function (service_role). Geen
-- INSERT-policy voor `authenticated`: een browser die zelf een rij mag maken,
-- mag ook een storage_path van iemand anders invullen.

-- ── De bucket ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agent-artifacts', 'agent-artifacts', false, 26214400, ARRAY[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Eigenaar-only op het pad. `storage.foldername(name)[1]` is de eerste map, en
-- die is per afspraak de user-id — de edge function schrijft nergens anders.
-- Let op het verschil met km-excels: die policy laat élke ingelogde gebruiker
-- élk bestand zien. Voor kilometerstanden mag dat; voor een uitdraai van de
-- klantenportefeuille niet.
DROP POLICY IF EXISTS agent_artifacts_owner_read ON storage.objects;
CREATE POLICY agent_artifacts_owner_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'agent-artifacts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS agent_artifacts_owner_remove ON storage.objects;
CREATE POLICY agent_artifacts_owner_remove ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'agent-artifacts' AND (storage.foldername(name))[1] = auth.uid()::text);
