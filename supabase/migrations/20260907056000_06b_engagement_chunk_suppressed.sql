-- =============================================================================
-- 06b WP1a, tweede slag — de dedup moet DUURZAAM zijn
-- =============================================================================
-- Wat er gebeurde. WP1a verwijderde 4.888 dubbele e-mail-engagement-chunks. Maar de
-- engagement-tak van `fetch_unchunked_source_ids` biedt élke niet-gearchiveerde rij
-- aan die **geen chunk** heeft:
--
--   SELECT e.id FROM hubspot_engagements e
--    WHERE e.is_archived = false
--      AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source='engagement' AND c.source_id=e.id)
--
-- Een verwijderde chunk maakt de rij dus per definitie weer "unchunked". Gemeten 5
-- minuten nadat `chunker-cron` terugkwam: **4.707 rijen aangeboden** en **180 chunks
-- al teruggeschreven** (engagement-chunks 6.699 → 6.879). Zonder deze migratie had de
-- cron de hele dedup in ongeveer acht dagen ongedaan gemaakt — stil, want elke ronde
-- ziet er gezond uit.
--
-- Waarom een lijst en geen predicaat. De dedup-sleutel is een hash-join tussen
-- `hubspot_engagements` en `mail_messages` op genormaliseerd onderwerp + afzender + ±1
-- dag; die kost ~13 s. Dat mag niet in een RPC die de chunker elke vijf minuten
-- aanroept. Dus: één keer uitrekenen, opslaan, en de RPC krijgt een goedkope
-- `NOT EXISTS` op de primary key.
--
-- Waarom niet `is_archived = true` op de mirror-rij. Dat zou werken en het is
-- expliciet niet gedaan: `ASK-JELLE.md` punt 1 zegt dat de HubSpot-rij ongemoeid
-- blijft ("je ziet in HubSpot niets veranderen"). Deze tabel raakt de spiegel niet.
--
-- Terugdraaien = `delete from hubspot_engagement_chunk_suppressed` (de chunker pakt ze
-- de volgende ronde weer op) of de tabel droppen en het predicaat weghalen.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.hubspot_engagement_chunk_suppressed (
  engagement_id text        PRIMARY KEY,
  reason        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hubspot_engagement_chunk_suppressed IS
  '06b WP1a: engagements die bewust GEEN zoek-chunk hebben. De mirror-rij blijft staan; '
  'alleen de chunk is onderdrukt. fetch_unchunked_source_ids slaat deze ids over, anders '
  'schrijft de chunker een verwijderde dubbele chunk elke ronde opnieuw terug.';

ALTER TABLE public.hubspot_engagement_chunk_suppressed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hs_eng_suppressed_read ON public.hubspot_engagement_chunk_suppressed;
CREATE POLICY hs_eng_suppressed_read ON public.hubspot_engagement_chunk_suppressed
  FOR SELECT TO authenticated USING ((SELECT public.is_admin_or_higher()));
DROP POLICY IF EXISTS hs_eng_suppressed_service ON public.hubspot_engagement_chunk_suppressed;
CREATE POLICY hs_eng_suppressed_service ON public.hubspot_engagement_chunk_suppressed
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- De sleutel, één keer. Zelfde hash-join-vorm als tools/wp1a-dedup.sql: genormaliseerd
-- onderwerp (re:/fw:/fwd:/aw:/antw: gestript, witruimte gecollapst, lowercase) +
-- hs_email_from_email + hetzelfde moment ± 1 dag.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hs_engagement_mail_duplicates_refresh()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  WITH e AS MATERIALIZED (
    SELECT en.id,
           regexp_replace(lower(regexp_replace(coalesce(en.subject,''), '^\s*((re|fw|fwd|aw|antw|antwoord)\s*:\s*)+', '', 'i')), '\s+', ' ', 'g') s,
           en.hs_timestamp t,
           lower(coalesce(en.type_specific->>'hs_email_from_email','')) fr
      FROM hubspot_engagements en
     WHERE en.engagement_type = 'email' AND coalesce(en.subject,'') <> ''
  ),
  m AS MATERIALIZED (
    SELECT mm.id,
           regexp_replace(lower(regexp_replace(coalesce(mm.subject,''), '^\s*((re|fw|fwd|aw|antw|antwoord)\s*:\s*)+', '', 'i')), '\s+', ' ', 'g') s,
           coalesce(mm.received_at, mm.sent_at) t,
           lower(coalesce(mm.from_email,'')) fr
      FROM mail_messages mm
     WHERE coalesce(mm.subject,'') <> ''
  ),
  d AS (
    SELECT DISTINCT e.id
      FROM e JOIN m ON m.s = e.s AND m.fr = e.fr
     WHERE abs(extract(epoch from (m.t - e.t))) < 86400
  )
  INSERT INTO hubspot_engagement_chunk_suppressed (engagement_id, reason)
  SELECT d.id, 'mail_messages_duplicate_subject_sender_1d' FROM d
  ON CONFLICT (engagement_id) DO NOTHING;

  SELECT count(*) INTO v_n FROM hubspot_engagement_chunk_suppressed;
  RETURN v_n;
END $function$;

COMMENT ON FUNCTION public.hs_engagement_mail_duplicates_refresh() IS
  '06b WP1a: vult hubspot_engagement_chunk_suppressed met de e-mail-engagements die een '
  'bewijsbare tweeling in mail_messages hebben (onderwerp + afzender + ±1 dag). Alleen '
  'toevoegen, nooit verwijderen — een engagement die eenmaal dubbel was, blijft dubbel.';

SELECT public.hs_engagement_mail_duplicates_refresh() AS n_suppressed;
