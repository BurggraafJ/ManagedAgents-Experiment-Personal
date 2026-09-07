-- =============================================================================
-- 06c — kandidaten-RPC's voor de salient-her-embed
-- =============================================================================
-- 2026-09-07 · spoor 06c (vorken C4/C5), hoort bij chunker-meeting-v2/reembed.ts.
--
-- WAAROM EEN RPC EN GEEN POSTGREST-FILTER. De job moet "salient-chunks zonder de
-- huidige prefix-versie" ophalen, dus een predicaat op metadata->>'prefix_version'
-- dat óók NULL meeneemt. Dat is in PostgREST een `or=(…is.null,…neq.X)` op een
-- jsonb-pad — syntax die vanuit deze omgeving niet te testen is (geen service-key
-- lokaal, alleen de Management-API). Een RPC is wél direct met SQL te verifiëren, en
-- het predicaat staat dan in de migratie waar het te reviewen is in plaats van in een
-- string in de edge-functie.
--
-- Zelf-drainend: de job vraagt N kandidaten, embedt ze, zet
-- metadata.prefix_version en vraagt opnieuw. `_remaining` is de teller waarop
-- gestopt wordt. Beide functies zijn read-only.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.meeting_salient_reembed_candidates(
  p_version text,
  p_limit   integer DEFAULT 80)
RETURNS TABLE(
  chunk_id    uuid,
  content     text,
  speaker     text,
  fact_type   text,
  occurred_at timestamptz,
  metadata    jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT c.chunk_id, c.content, c.speaker, c.fact_type, c.occurred_at, c.metadata
    FROM chunks c
   WHERE c.source = 'meeting'
     AND c.chunk_type = 'salient'
     AND coalesce(c.metadata->>'prefix_version', '') <> coalesce(p_version, '')
   ORDER BY c.chunk_id
   LIMIT least(greatest(coalesce(p_limit, 80), 1), 200);
$function$;

CREATE OR REPLACE FUNCTION public.meeting_salient_reembed_remaining(p_version text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int FROM chunks c
   WHERE c.source = 'meeting'
     AND c.chunk_type = 'salient'
     AND coalesce(c.metadata->>'prefix_version', '') <> coalesce(p_version, '');
$function$;

-- Beide zijn schrijf-loos maar lezen chunk-inhoud: service_role only, geen PUBLIC,
-- geen authenticated (memory drop-function-verliest-proacl — een kale CREATE geeft
-- PUBLIC execute terug).
REVOKE ALL ON FUNCTION public.meeting_salient_reembed_candidates(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_salient_reembed_candidates(text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_salient_reembed_candidates(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.meeting_salient_reembed_remaining(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meeting_salient_reembed_remaining(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.meeting_salient_reembed_remaining(text) TO service_role;

COMMENT ON FUNCTION public.meeting_salient_reembed_candidates(text, integer) IS
  '06c (2026-09-07): salient-chunks die de opgegeven prefix-versie nog niet dragen (NULL telt mee). Voedt de zelf-drainende her-embed in chunker-meeting-v2 (mode=reembed_salients). Read-only.';
COMMENT ON FUNCTION public.meeting_salient_reembed_remaining(text) IS
  '06c (2026-09-07): hoeveel salient-chunks nog op de oude prefix staan. De stopteller van de her-embed-lus.';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907064000', '06c_salient_reembed_rpcs')
ON CONFLICT (version) DO NOTHING;
