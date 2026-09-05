-- =============================================================================
-- confluence_get_page — één pagina uit de SPIEGEL, ACL binnen de query (v1.145)
-- =============================================================================
-- Voor de agentic tool `confluence_get_page`. Twee dingen zijn hier bewust:
--
-- 1. De ACL zit IN de functie, niet in de aanroep. Er is geen
--    `p_allowed_spaces`-parameter die een tool kan vergeten mee te geven — dat
--    zou fail-OPEN zijn. Het model kan dus niets meesturen dat de allowlist
--    verbreedt, ook niet via prompt-injectie: het krijgt de rij simpelweg niet.
--
-- 2. Alleen de spiegel. Geen live Confluence-call, ook niet als fallback bij een
--    misser. Een live-fallback zou langs de ACL heen gaan (het org-token ziet
--    álle spaces) en de chat-latency onvoorspelbaar maken.
--
-- Provenance is verplicht in de output: page_id, space_key, title, path, url,
-- version, confluence_updated_at. De chat kan daarmee naar de echte pagina
-- linken — en krijgt een gebruiker daar een 403 van Confluence, dan is dat een
-- ACL-bug die je meteen ziet in plaats van maanden later.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.confluence_get_page(
  p_page_id        text DEFAULT NULL,
  p_title          text DEFAULT NULL,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  page_id text, space_key text, title text, page_path text, url text,
  version integer, confluence_updated_at timestamptz, body_text text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT p.page_id, p.space_key, p.title,
         CASE WHEN cardinality(p.ancestor_titles) > 0
              THEN array_to_string(p.ancestor_titles, ' › ')
              ELSE p.space_key END,
         p.url, p.version, p.confluence_updated_at, p.body_text
    FROM public.confluence_pages p
   WHERE p.is_archived = false
     -- Fail-closed: lege allowlist = geen enkele rij.
     AND p.space_key = ANY (public.confluence_allowed_spaces(p_caller_user_id))
     AND (
       (p_page_id IS NOT NULL AND p.page_id = p_page_id)
       OR (p_page_id IS NULL AND p_title IS NOT NULL AND p.title ILIKE '%' || p_title || '%')
     )
   -- Bij een titel-match: de kortste titel wint, want die is meestal de exacte
   -- pagina en niet een langere die hem toevallig bevat.
   ORDER BY (p_page_id IS NOT NULL) DESC, length(p.title) ASC, p.confluence_updated_at DESC
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.confluence_get_page(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confluence_get_page(text, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.confluence_get_page(text, text, uuid) IS
  'Eén Confluence-pagina uit de spiegel op page_id of (deel van) titel. De space-ACL zit in de functie zelf en kan door de aanroeper niet worden verbreed; onbekende of niet-toegestane pagina geeft nul rijen. Nooit een live Confluence-call.';
