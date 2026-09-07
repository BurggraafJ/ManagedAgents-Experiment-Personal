-- =============================================================================
-- 06b WP1b — e-mail-engagements CAPPEN op search_fast, niet uitsluiten
-- =============================================================================
-- Gemeten op het echte pad (context-build → match_chunks, 8 echte vragen uit
-- rag_chat_query_log, audience 'rag-chat-bench-06b', 2026-09-07; RESEARCH.md §1.10):
--
--   arm                                    p50 search  p95 search  chunks  top-1-bronnen
--   A baseline                                 1.572       4.006      24    referentie
--   B {"engagement":{"exclude":true}}           1.916       3.130      19    3 van 8 verschoven
--   C {"engagement":{"max_per_source":3}}         628       1.451      15    IDENTIEK aan A
--
-- Uitsluiten is dus LANGZAMER (het zet `v_selective` aan via v_excluded, waardoor de
-- iteratieve HNSW-scan een bredere kandidatenpool leest) en het ruilt
-- engagement-flooding voor meeting-stub-flooding: 36 van de 48 vrijgekomen plekken
-- gingen naar meeting-stubs. Cappen haalt 33 engagement-chunks weg, laat alle andere
-- bronnen en álle top-1-chunks staan en is 2,5× sneller.
--
-- Waarom 3: engagement leverde 8,10 chunks per search_fast-bundel (230 bundels ná
-- 06f-α), waarvan 1.238 e-mail-chunks met p50-rang 13. De recept-cap
-- max_per_source = 12 gold voor élke bron; deze override geldt alleen voor engagement.
--
-- `max_per_record` (2) en `max_per_source` (12) blijven staan; de override vervangt
-- alleen `max_per_source` voor de bron `engagement` (contract in migratie
-- 20260906210000 regel 44-49 en 265-266). Er wordt géén `exclude` en géén
-- `future_ok` gezet, dus `v_selective` en de recency-klem blijven ongewijzigd.
--
-- Terugdraaien: één UPDATE … SET source_overrides = NULL WHERE intent='search_fast'.
-- =============================================================================

UPDATE public.context_intents
   SET source_overrides = jsonb_build_object('engagement', jsonb_build_object('max_per_source', 3)),
       notes = coalesce(notes || E'\n', '') ||
               '06b WP1b (2026-09-07): source_overrides {"engagement":{"max_per_source":3}}. '
            || 'Gemeten op 8 echte vragen: search_ms p50 1.572 -> 628, p95 4.006 -> 1.451, '
            || 'engagement-chunks 48 -> 15, top-1-bron per vraag identiek aan de baseline. '
            || 'Uitsluiten is langzamer (p50 1.916) en verplaatst de flooding naar meeting-stubs.',
       updated_at = now()
 WHERE intent = 'search_fast';
