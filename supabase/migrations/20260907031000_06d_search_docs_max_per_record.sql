-- =============================================================================
-- 06d WP3 — fan-out-cap op het docs-recept                          (2026-09-07)
-- =============================================================================
-- RESEARCH.md §1.2 (Q2). 06f-α gaf `context_intents` de kolom `max_per_record`
-- (migratie 20260906211000) en zette hem op `search_fast` = 2. `search_docs` —
-- het recept dat élke documentatievraag van de chat gebruikt — bleef NULL.
--
-- Gemeten op prod, `search_docs` / audience `rag-chat`, top_k 40, venster
-- ná 06a (15 bundels): 39,9 chunks uit gemiddeld **25,7 pagina's**, 1,61 chunks
-- per pagina, **max 9 chunks van één pagina** in dezelfde bundel. Op het echte
-- pad met vijf documentatievragen (`tools/cb-probe-06d.cjs`, armen B/B2/C/D):
--
--   arm                       min_sim  cap   rijen  pagina's (p50, gem.)  max/pag  top-1  search_ms
--   B  chat as-is             0,30     —     40     25 · 23,2             9        0,540  742
--   B2 chat + cap             0,30     2     40     29 · 28,4            2        0,538  808
--   C  recept + cap           0,42     2     40     29 · 28,4            2        0,538  770
--   D  recept zonder cap      0,42     —     40     25 · 23,2             9        0,540  783
--
-- De cap kost niets — top-1 gelijk binnen 0,002, zoektijd binnen de ruis — en
-- levert **+5 pagina's per 40 chunks**. Dat telt dubbel omdat rag-chat daarna
-- 24 van de 40 houdt (`CHAT_CONTEXT_CHUNKS`, geen Cohere-sleutel in de Vault,
-- dus `rerankChunks` is een slice): ook die 24 komen uit meer pagina's.
--
-- Waarom een receptkolom en geen code: de knop bestaat al in `match_chunks`
-- (06f-α) en in context-build v2.10, en terugdraaien is één UPDATE terug naar
-- NULL. `search_fast` heeft de Confluence-fan-out al gedicht (max 2 per pagina
-- gemeten ná α), dus de `source_overrides`-variant uit de koepel-WP3 is
-- overbodig — één kolom op één rij volstaat.
--
-- Grens (risico R5): een lange relevante pagina levert nog maximaal 2 delen.
-- Voor "vat pagina X samen" is er `confluence_get_page` op de agentische route
-- (volledige tekst, ACL binnen de RPC) — bankitem WI03. De Confluence-inventaris
-- is 1.009 chunks over 359 pagina's (mediaan 2 chunks per pagina), dus voor de
-- helft van de wiki verandert de cap niets.
--
-- Terugdraaien:
--   UPDATE public.context_intents SET max_per_record = NULL WHERE intent = 'search_docs';
-- =============================================================================

UPDATE public.context_intents
   SET max_per_record = 2,
       notes = notes || ' — 06d WP3 (2026-09-07): max_per_record=2. Gemeten op 5 documentatievragen, top_k 40: 23,2 -> 28,4 pagina''s per bundel, max per pagina 9 -> 2, top-1 vector gelijk (0,540 -> 0,538), zoektijd 742 -> 770 ms. Terug = kolom op NULL.'
 WHERE intent = 'search_docs';
