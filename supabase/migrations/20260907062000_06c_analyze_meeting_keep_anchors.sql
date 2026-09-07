-- =============================================================================
-- 06c — entity_anchor_top_n blijft 4 op analyze_meeting (A/B draaide C6 om)
-- =============================================================================
-- 2026-09-07 · spoor 06c. Deze migratie draait één onderdeel van 20260907061000
-- terug, op grond van een A/B die ná die migratie is gedraaid. De rest van dat
-- recept (max_per_record 1, source_overrides, default_top_k 14,
-- default_filter_audience NULL) blijft staan.
--
-- WAT C6 AANNAM. "entity_anchor_top_n 4 → 0 ná WP1 — de anchors zijn vandaag de
-- enige meeting-route en zijn dat na de edge niet meer." De eerste helft is met de
-- via_edge-attributie weerlegd: van de 9 meeting-fragmenten in 12 briefing-calls
-- kwamen er 9 via de nieuwe `involves`-edge en **0 via name_anchor** — de anchors
-- waren die route al niet. De tweede helft ("dus kunnen ze weg") volgt daar niet uit.
--
-- WAT DE A/B MEETTE (3 × 12 gepaarde briefing-calls, identieke input, ~10 min apart):
--   variant                          meeting-chunks via   bundels   gem.    bundels    fallback-
--                                    involves / anchor    mét mtg   chunks  ≤2 chunks  timeouts
--   edge, recept oud, anchors 4          9  /  0           3 / 12    6,42       3          6
--   edge, recept nieuw, anchors 0        9  /  0           5 / 12    5,92       5          6
--   edge, recept nieuw, anchors 4        9  /  0           4 / 12    7,17       2          5
-- (runs/2026-09-07-06c-w1-c6-after-edge.json · …-w2-c6-after-recipe.json ·
--  …-w2-c6-anchors4.json)
--
-- Lees de kolommen apart, want ze zijn niet even hard:
--   • `involves` levert in ALLE DRIE de runs exact 9 fragmenten (3 bundels × 3).
--     Dat deel is deterministisch: het is de nieuwe edge.
--   • `name_anchor` levert in alle drie de runs **0** meeting-fragmenten.
--   • De kolom "bundels mét mtg" beweegt 3 → 5 → 4 doordat de `+semantic`-tak
--     wisselend omvalt: 5 à 6 van de 12 calls worden afgebroken met
--     `entity_fallback: canceling statement due to statement timeout` (175 van die
--     fouten in 7 dagen op prod). Dat verschil is ruis, geen effect — schrijf de
--     3 → 5 dus NIET op het uitzetten van de anchors.
--   • Wat wél buiten de ruis valt: zonder anchors verdubbelt het aantal bundels dat
--     op ≤ 2 fragmenten uitkomt (2 → 5). Zolang de terugvaltak omvalt, zijn de
--     anchors het enige dat de bundel nog vult. Ze zijn vandaag een steunbalk voor
--     een defect elders (spoor 02, memory context-build-te-traag-voor-rag-chat) —
--     zo'n balk haal je pas weg als het defect eronder gerepareerd is.
--
-- Kanttekening bij de similarity: bundels MÉT anchors rapporteren top_similarity
-- exact 0.5000, want context-build injecteert anchors met een vaste
-- combined_score van 0,5 (v2.5, r. 500-522). Dat getal is geen gemeten
-- gelijkenis. Op de zes bundels die vóór én ná geen anchors kregen is de echte
-- top_similarity ongewijzigd (0,2359 / 0,2308 / 0,2273 identiek).
--
-- Terugdraaien = entity_anchor_top_n weer op 0; doe dat pas nadat 02 de
-- terugvaltak-timeout heeft opgelost, en meet dan opnieuw met deze A/B.
-- =============================================================================

UPDATE public.context_intents SET
  entity_anchor_top_n = 4,
  updated_at          = now()
WHERE intent = 'analyze_meeting';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907062000', '06c_analyze_meeting_keep_anchors')
ON CONFLICT (version) DO NOTHING;
