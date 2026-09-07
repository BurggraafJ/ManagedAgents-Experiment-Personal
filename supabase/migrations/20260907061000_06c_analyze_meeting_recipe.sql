-- =============================================================================
-- 06c — het recept analyze_meeting: één slot per meeting, cap per bron, geen anchors
-- =============================================================================
-- 2026-09-07 · spoor 06c (RESEARCH 06c/06e §2.2/§2.4, vork C6). Draait NA
-- 20260907060000: de caps zijn pas zinvol als er iets te cappen is, en
-- entity_anchor_top_n mag alleen op 0 als de meeting-route ergens anders vandaan komt.
--
-- OUDE WAARDEN (gemeten 2026-09-07 07:44 UTC, runs/…-w0-precheck2.json § e_intents),
-- terugdraaien = deze ene UPDATE omkeren:
--   default_top_k = 10 · max_per_record = NULL · max_per_source = NULL
--   source_overrides = NULL · default_filter_audience = {external,internal}
--   entity_anchor_top_n = 4
--   (ongewijzigd: default_strategy match_chunks_for_entity · default_max_per_source 3
--    · default_lookback_days 60 · query_intel_level entity · bm25_enabled true
--    · max_edges 300 · default_min_similarity 0.3 · default_filter_meeting_category NULL)
--
-- WAAROM max_per_record = 1. Meetings staan op 5,3× hun index-aandeel in de
-- chat-bundels en leveren binnen één record meerdere chunks (902 salients over 47
-- meetings). Met één slot per meeting gaat dat slot volgens M12c in **70,3 %** van
-- de gevallen naar de MACRO-samenvatting (salient 21,6 %, topic 8,2 %) — de
-- samenvatting van ~980 tekens met de hoogste gemiddelde vectorscore (0,5360) van
-- alle chunktypen. Precies wat een briefing nodig heeft. Het is dus een
-- kwaliteitsknop, niet alleen een volumeknop.
--
-- WAAROM source_overrides {"meeting":{"max_per_source":3}} terwijl
-- default_max_per_source al 3 is. Die 3 is de cap van het ENTITY-pad
-- (`p_max_per_source` in match_chunks_for_entity). De `+semantic`-terugvaltak
-- gebruikt `recipe.max_per_source` (maxPerSourceFlat, context-build v2.10 r. 419) en
-- die stond op NULL = géén cap. Zonder deze override capt het entity-pad wel en de
-- terugvaltak niet, terwijl 9 van de 12 gemeten briefing-calls juist via die tak lopen.
--
-- WAAROM default_top_k 10 → 14. context-build valt terug op een extra
-- match_chunks-aanroep zodra het entity-pad < 5 rijen geeft (r. 466). Op de 18
-- entities uit meeting_entity_link geeft het pad ná de arm gemiddeld 7,83 rijen en
-- valt 3 van 18 nog onder de 5 (vóór de arm: 3,28 rijen, 14 van 18). Meer top_k
-- houdt vaker de goedkope, snelle tak vast; die tak is ook de tak die NIET in de
-- statement-timeout loopt (zie hieronder).
--
-- WAAROM default_filter_audience → NULL. Gemeten: het filter houdt 1.355 van de
-- 1.356 meeting-chunks over — het verbergt één chunk. Het zet wel de "selectieve"
-- tak van match_chunks aan (migratie 20260906210000 r. 134). Een filter dat niets
-- filtert en wel gedrag verandert, hoort weg.
--
-- WAAROM entity_anchor_top_n 4 → 0, en waarom dat GEMETEN veilig is. Het onderzoek
-- nam aan dat de naam-anchors "vandaag de enige meeting-route" zijn. Dat is met de
-- via_edge-attributie nagerekend op 12 briefing-calls (runs/…-w1-c6-after-edge.json):
-- van de 9 meeting-fragmenten kwamen er **9 via de nieuwe `involves`-edge en 0 via
-- name_anchor**; de anchors leverden in die 12 calls (0-4 per call) geen enkel
-- meeting-fragment. De anchors kosten wel een extra ilike-scan én ze worden met
-- combined_score 0.5 geïnjecteerd, waardoor ze de RRF-top verdringen. 06b meette
-- op hetzelfde knopje −58 % zoektijd.
-- =============================================================================

UPDATE public.context_intents SET
  default_top_k           = 14,
  max_per_record          = 1,
  source_overrides        = '{"meeting":{"max_per_source":3}}'::jsonb,
  default_filter_audience = NULL,
  entity_anchor_top_n     = 0,
  updated_at              = now()
WHERE intent = 'analyze_meeting';

COMMENT ON TABLE public.context_intents IS
  'Retrieval-recepten per intent (context-build). 06c (2026-09-07) op analyze_meeting: max_per_record 1 (het ene slot per meeting gaat in 70,3 % naar de macro-samenvatting), source_overrides meeting.max_per_source 3 (capt óók de +semantic-terugvaltak, die de flat max_per_source gebruikt), default_top_k 14 (minder vaak onder de 5-rijen-drempel die de terugvaltak aanzet), default_filter_audience NULL (verborg 1 van 1.356 chunks maar zette wel de selectieve match_chunks-tak aan) en entity_anchor_top_n 0 (gemeten: 0 van 9 meeting-fragmenten kwam via name_anchor, 9 via de nieuwe involves-edge).';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907061000', '06c_analyze_meeting_recipe')
ON CONFLICT (version) DO NOTHING;
