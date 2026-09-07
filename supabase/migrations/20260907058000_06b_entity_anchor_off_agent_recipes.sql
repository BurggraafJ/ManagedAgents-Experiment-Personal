-- =============================================================================
-- 06b WP3 (F-06b-3) — entity_anchor_top_n = 0 op enrich_record + compose_followup
-- =============================================================================
-- `entity_anchor_top_n` komt alleen uit de receptkolom (`context-build/index.ts` regel
-- 502; er is geen options-override), dus de A/B was: meten met 4, kolom naar 0,
-- opnieuw meten. Dezelfde vraag, dezelfde company, naam in de vraagtekst zodat de
-- entity via `company_trgm` resolveert:
--
--   anchor 4 -> search_ms 2.857, anchors_injected 4, 8 chunks:
--              meeting 2 · mail 3 · deal 2 · confluence 1, top1_vector_score = NULL
--   anchor 0 -> search_ms 1.212, anchors_injected 0, 8 chunks:
--              company 1 · engagement 3 · mail 1 · deal 2 · confluence 1, top1 = 0,5978
--   controle: search_fast (staat al op 0) 576 -> 438 ms, samenstelling ongewijzigd
--
-- Dat is 58 % sneller (poort b1 vroeg >= 40 % op deze arm), maar de tweede reden weegt
-- zwaarder: met vier ankers erin verdringen die de COMPANY-MASTER-KAART en twee
-- engagement-chunks, en is de top-1-chunk een anker ZONDER vectorscore. Met de ankers
-- uit staat de kaart waar de vraag over gaat wél in het bundel, met een echte treffer
-- als kop. De ankerinjectie was een pleister voor stub-masters; WP2 heeft de masters
-- verrijkt, dus de pleister kan eraf.
--
-- ALLEEN deze twee recepten. `analyze_meeting` is 06c en `search` is 06f-beta; die
-- houden hun 4. De ILIKE-scan zelf staat in het context-build-LICHAAM en is buiten
-- scope (F-06b-5, overgedragen aan 06f-beta met de meting).
--
-- Terugdraaien: dezelfde UPDATE met 4.
-- =============================================================================

UPDATE public.context_intents
   SET entity_anchor_top_n = 0,
       notes = coalesce(notes || E'\n', '') ||
               '06b WP3 (2026-09-07): entity_anchor_top_n 4 -> 0. Gemeten op de '
            || 'named-entity-arm: search_ms 2.857 -> 1.212 (-58 %), en het bundel bevat '
            || 'daardoor de company-master-kaart in plaats van vier ankers zonder '
            || 'vectorscore. De ankerinjectie compenseerde stub-masters; WP2 heeft die '
            || 'verrijkt.',
       updated_at = now()
 WHERE intent IN ('enrich_record', 'compose_followup');
