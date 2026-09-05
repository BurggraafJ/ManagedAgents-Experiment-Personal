-- =============================================================================
-- confluence_pages: de hele ouderketen bewaren, niet alleen de laatste (v1.145)
-- =============================================================================
-- De ETL vraagt Confluence al om `ancestors` (EXPAND =
-- 'body.storage,version,space,ancestors') en gooit vervolgens alles weg behalve
-- de staart: `parent_id = ancestors[ancestors.length - 1].id`. De volledige
-- keten zit dus al in de respons en kost geen extra call.
--
-- Waarom dat de moeite is — gemeten diepteverdeling over alle 366 pagina's:
--   diepte 0: 8 · 1: 23 · 2: 69 · 3: 112 · 4: 100 · 5: 51 · 6: 2 · 7: 1
--   (mediaan 3, max 7)
-- Dat is echte hiërarchie. En wiki-titels zijn juist generiek — "Overzicht",
-- "Proces", "Werkwijze" — dus het pad is wat ze onderscheidt. In de
-- MetaRAG-leader van de chunk is `path=` daarmee waardevoller dan de titel zelf.
--
-- ⚠ LABELS: `labels` wordt hier aangemaakt maar bewust NIET gebruikt in de
-- chunk-metadata, de leader of de graph-edges. Reden: een live census over alle
-- 366 pagina's in alle 8 spaces gaf 0 pagina's met een label en 0 distinct
-- labels. Elk label-item zou op een lege verzameling werken. De kolom en de
-- expand-term staan er alleen zodat het veld zich vult zodra iemand ooit begint
-- met labelen; hertel vóór je er iets op bouwt (~10 GETs).
-- =============================================================================

ALTER TABLE public.confluence_pages
  ADD COLUMN IF NOT EXISTS ancestor_ids    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ancestor_titles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS labels          text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.confluence_pages.ancestor_ids IS
  'Volledige ouderketen van root naar direct-ouder (page_ids). parent_id blijft bestaan en is de staart hiervan.';
COMMENT ON COLUMN public.confluence_pages.ancestor_titles IS
  'Titels bij ancestor_ids, zelfde volgorde. Voedt path= in de MetaRAG-leader van de chunk.';
COMMENT ON COLUMN public.confluence_pages.labels IS
  'Confluence-labels. Stond op 2026-09-05 site-breed op nul (0/366 pagina''s); alleen aanwezig zodat het veld zich vult als er ooit gelabeld wordt. Niets in de retrieval hangt eraan.';
