-- =============================================================================
-- Spoor 05 — Artefacten v2: pdf, tabbladen, kolomdefinities, lijn en opruimen
-- =============================================================================
-- De v1-tabel (20260905183000) kan één tabblad in twee formaten. Wat de
-- vragenbank vraagt is breder, en elk stuk hieronder hangt aan een gemeten item:
--
--   • pdf als échte rij     — AR03/AR08 stonden op `pending` omdat `window.print()`
--                             geen bestand oplevert: geen rij, geen bytes, niets
--                             wat de evalrunner kan aanwijzen.
--   • sheets                — AR06 vraagt letterlijk "een Excel met per tabblad
--                             een maand". Zonder kolom is dat een string-hack in
--                             `params`.
--   • column_defs           — AR09 ("bron per rij") en AR32 ("hoe zeker ben je")
--                             vragen betekenis PER KOLOM. Het verantwoordingsblad
--                             beschrijft vandaag de tabel, niet de kolommen.
--   • source_artifact_id    — "zelfde als vorige maand" (AR28) en "vergelijk met
--                             vorige week" (AR39) vragen een lijn tussen twee
--                             bestanden. ON DELETE SET NULL zodat de opruimer een
--                             ouder bestand mag wissen zonder het kind mee te
--                             slepen.
--   • build_ms/build_cost_usd — de poort "bytes en kosten per artefact gelogd".
--                             De kosten staan structureel op 0,00 omdat de lichte
--                             weg (pdf-lib, ExcelJS) niets kost; de kolom bestaat
--                             zodat een toekomstige leverancier NIET ongezien kan
--                             binnenkomen.
--
-- Idempotent: elk statement mag twee keer draaien. Policies worden hier bewust
-- NIET aangeraakt — de vier bestaande (2 op de tabel, 2 op storage.objects)
-- blijven letterlijk zoals ze zijn; de poort is een pg_policies-diff vóór/ná.
-- =============================================================================

-- ── 1. pdf toestaan ──────────────────────────────────────────────────────────
-- CHECK vervangen i.p.v. verruimen: een CHECK is niet te "alteren", en door hem
-- eerst te droppen is dit statement herhaalbaar.
ALTER TABLE public.agent_artifacts DROP CONSTRAINT IF EXISTS agent_artifacts_type_check;
ALTER TABLE public.agent_artifacts
  ADD CONSTRAINT agent_artifacts_type_check CHECK (type IN ('xlsx', 'csv', 'pdf'));

-- ── 2. de bucket weigert vandaag élke pdf-upload ─────────────────────────────
-- allowed_mime_types is een whitelist op storage-niveau; zonder deze regel valt
-- de pdf-build om op de upload en niet op iets wat je in de logs terugziet.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY[
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv',
         'application/pdf']
 WHERE id = 'agent-artifacts';

-- ── 3. de vijf nieuwe kolommen ───────────────────────────────────────────────
ALTER TABLE public.agent_artifacts
  ADD COLUMN IF NOT EXISTS sheets             jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS column_defs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_artifact_id uuid REFERENCES public.agent_artifacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS build_ms           integer,
  ADD COLUMN IF NOT EXISTS build_cost_usd     numeric(10,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_source
  ON public.agent_artifacts (source_artifact_id);

COMMENT ON COLUMN public.agent_artifacts.sheets IS
  'Tabbladdefinities voor een meerbladige xlsx: [{name, columns[], rows[]}]. Leeg = het enkelvoudige geval, waarbij rows/columns het databad zijn. Expliciet meegegeven door de aanroeper — automatisch splitsen op een datumkolom raadt naar de bedoeling en is niet terug te lezen in de verantwoording (fork F9).';
COMMENT ON COLUMN public.agent_artifacts.column_defs IS
  'Betekenis per kolom: [{key, label, definition, type, format, width}]. Voedt numFmt in Excel, de uitlijning in de pdf en het kolommenblok op het verantwoordingsblad. Een kolomkop zonder definitie is precies hoe een geëxporteerd getal een feit wordt.';
COMMENT ON COLUMN public.agent_artifacts.source_artifact_id IS
  'Het vorige artefact waar dit er een herhaling van is ("zelfde als vorige maand"). ON DELETE SET NULL: de opruimer mag de ouder wissen zonder het kind mee te slepen.';
COMMENT ON COLUMN public.agent_artifacts.build_ms IS
  'Bouwtijd in milliseconden, gemeten in de edge function rond de bytes-generatie. Gemeten bandbreedte pdf: 6 ms (3 rijen) tot 1.411 ms (5.000 rijen).';
COMMENT ON COLUMN public.agent_artifacts.build_cost_usd IS
  'Leverancierskosten van deze bouw. Structureel 0,00 bij de lichte weg (pdf-lib/ExcelJS draaien in de edge runtime). De kolom bestaat zodat een toekomstige externe generator niet ongezien kan binnenkomen: 0,00 hoort een meting te zijn, geen aanname.';

COMMENT ON TABLE public.agent_artifacts IS
  'Downloadbare uitdraaien uit de chat (xlsx/csv/pdf). Eigenaar-only; het bestand staat in de private bucket agent-artifacts onder <owner_id>/. rows/columns/params/sheets/column_defs staan erbij zodat een export herbouwbaar en herleidbaar is; expires_at is de bewaartermijn die agent-artifact-cleanup handhaaft.';

-- ── 4. bewaartermijn zonder deploy ───────────────────────────────────────────
-- 30 dagen blijft de default, maar hij verhuist naar agent_config zodat Jelle
-- hem kan wijzigen zonder een edge-deploy. `expires_at` in de rij blijft de
-- enige waarheid: de builder leest deze waarde alleen bij het maken.
INSERT INTO public.agent_config (agent_name, config_key, config_value)
VALUES ('agent-artifacts', 'retention_days', '30'::jsonb)
ON CONFLICT (agent_name, config_key) DO NOTHING;

-- ── 5. agent_artifact_recent — "zelfde als …" ────────────────────────────────
-- SECURITY INVOKER, en dat is de hele beveiliging: de bestaande owner-only
-- RLS-policy op agent_artifacts filtert. Met SECURITY DEFINER zou je de
-- eigenaarscheck met de hand moeten overdoen, en die met de hand overgedane
-- check is precies wat er in een latere sessie sneuvelt.
CREATE OR REPLACE FUNCTION public.agent_artifact_recent(p_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid, title text, type text, created_at timestamptz, expires_at timestamptz,
  columns jsonb, period jsonb, rows_n integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT a.id, a.title, a.type, a.created_at, a.expires_at,
         a.columns, a.params -> 'period', jsonb_array_length(a.rows)
    FROM public.agent_artifacts a
   WHERE a.expires_at > now()
   ORDER BY a.created_at DESC
   LIMIT greatest(1, least(coalesce(p_limit, 20), 100));
$function$;

-- Een kale CREATE geeft PUBLIC (en dus anon) execute. Expliciet intrekken.
REVOKE ALL ON FUNCTION public.agent_artifact_recent(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_artifact_recent(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.agent_artifact_recent(integer) IS
  'De laatste nog-geldige artefacten van de AANROEPER, voor de "zelfde als …"-keuze in de chat-UI. SECURITY INVOKER: de owner-only RLS op agent_artifacts doet het filteren, dus een tweede persona ziet nul rijen van de eerste. Verlopen rijen blijven eruit — een link aanbieden die de opruimer vannacht weghaalt is erger dan hem niet aanbieden.';
