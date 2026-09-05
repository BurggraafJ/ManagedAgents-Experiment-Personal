-- =============================================================================
-- context_intents.default_filter_sources — bronnen per recept        (v1.145)
-- =============================================================================
-- Gemeten defect, gevonden doordat de golden set G4 afwisselend groen en rood
-- werd op exact dezelfde vraag:
--
--   bundle 73990f1c  filter_sources=null  search 8406 ms  20 fragmenten
--   bundle bfd9971e  filter_sources=null  search 8272 ms   0 fragmenten
--                    vector_errors: ["canceling statement due to statement timeout"]
--
-- De oorzaak zit in de koppeling tussen twee dingen die niets met elkaar te
-- maken hebben. In context-build staat:
--
--   const qi = applyFullIntel ? parseQueryIntent(queryText) : null
--
-- `parseQueryIntent` levert óók de BRON-HINT ("documentatie"/"wiki"/"handboek"
-- -> filter_sources=['confluence']). Het nieuwe `search_docs`-recept zet
-- query_intel_level op 'off' om HyDE over te slaan — en zet daarmee per
-- ongeluk ook de bron-hint uit. Een documentatievraag doorzocht dus alle ~48k
-- chunks in plaats van de ~1000 wiki-chunks: 4,6-8,4 s in plaats van 0,5-1,3 s,
-- met een statement-timeout net over de rand.
--
-- De bron-hint loskoppelen van HyDE zou ook `draft_reply` en de andere
-- 'off'-recepten raken, en die staan daar bewust op. Daarom hier: het recept
-- zegt zelf welke bronnen erbij horen, net zoals het dat al doet voor audience
-- en meeting_category. De aanroeper kan het nog steeds overrulen met
-- options.filter_sources.
--
-- kb_article staat erbij omdat "documentatie" voor een gebruiker de wiki én de
-- kennisbank is; het zijn er maar 4 chunks, dus het kost niets.
-- =============================================================================

ALTER TABLE public.context_intents
  ADD COLUMN IF NOT EXISTS default_filter_sources text[];

COMMENT ON COLUMN public.context_intents.default_filter_sources IS
  'Bronnen waartoe dit recept standaard beperkt. NULL = alle bronnen. Wordt pas gebruikt als de aanroeper zelf geen options.filter_sources meegeeft en de query-intel geen bron-hint oplevert.';

UPDATE public.context_intents
   SET default_filter_sources = ARRAY['confluence','kb_article']::text[],
       notes = notes || ' — v1.145: default_filter_sources vastgezet op confluence+kb_article, omdat query_intel_level=off ook de bron-hint uitschakelt en de vraag anders over alle 48k chunks liep (8s, statement-timeout).',
       updated_at = now()
 WHERE intent = 'search_docs';
