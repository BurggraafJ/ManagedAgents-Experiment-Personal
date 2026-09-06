-- =============================================================================
-- 06f-α — recept-kolommen voor caps en bron-overrides                (2026-09-06)
-- =============================================================================
-- RESEARCH.md §3.6: geen source_profiles-tabel, drie kolommen op het recept.
-- Per bron blijft de kennis in de rij van het recept dat die bron raakt,
-- tunebaar zonder redeploy — dezelfde vorm als default_filter_sources en
-- bm25_enabled. Terugdraaien = kolom op NULL.
--
--   max_per_record    hoogstens N chunks per (source, source_id) in het resultaat.
--                     Gemeten (30 d, search_fast/rag-chat): meetings 1,87 chunks per
--                     meeting per bundel, 77 % van de meeting-chunks uit records die
--                     2+ chunks tegelijk leveren; Confluence 1,58 / 60,5 %.
--   max_per_source    per-bron-cap van match_chunks. BEWUST een andere kolom dan
--                     default_max_per_source: die is al de cap van het entity-pad
--                     (match_chunks_for_entity, waarde 3) en dezelfde knop hergebruiken
--                     zou search_fast tot 3 mailchunks per bundel terugbrengen.
--   source_overrides  {"<source>":{"exclude":bool,"future_ok":bool,
--                     "max_per_record":int,"max_per_source":int}}. Voor 06b (F10/F11:
--                     e-mail-engagements en stub-masters uit search_fast) en 06e
--                     (future_ok voor event is al de default in de RPC).
--
-- Default NULL, niet 2: een default zou de recepten van de geplande agents
-- (draft_reply, analyze_meeting, enrich_record) stil veranderen — poort K8.
-- Alleen search_fast krijgt hier waarden; 06c/06d zetten hun eigen recept.
-- context-build v2.10 geeft de kolommen door (options.max_per_record /
-- options.source_overrides overrulen; options.max_per_source blijft de knop van
-- het entity-pad).
-- =============================================================================

ALTER TABLE public.context_intents
  ADD COLUMN IF NOT EXISTS max_per_record integer,
  ADD COLUMN IF NOT EXISTS max_per_source integer,
  ADD COLUMN IF NOT EXISTS source_overrides jsonb;

COMMENT ON COLUMN public.context_intents.max_per_record IS
  '06f-α: hoogstens N chunks per (source, source_id) per match_chunks/match_chunks_for_entity-resultaat. NULL = geen cap (gedrag vóór 2026-09-06). Overrulebaar per bron via source_overrides.<source>.max_per_record.';
COMMENT ON COLUMN public.context_intents.max_per_source IS
  '06f-α: per-bron-cap van match_chunks (niet van het entity-pad — dat is default_max_per_source). NULL = geen cap.';
COMMENT ON COLUMN public.context_intents.source_overrides IS
  '06f-α: {"<source>":{"exclude":bool,"future_ok":bool,"max_per_record":int,"max_per_source":int}}. exclude geldt niet voor een bron die de aanroeper expliciet in filter_sources zet; future_ok=true laat een occurred_at in de toekomst recency 1,0 houden (event is default future_ok).';

UPDATE public.context_intents
   SET max_per_record = 2,
       max_per_source = 12,
       notes = coalesce(notes, '') || ' — 06f-α (2026-09-06): max_per_record 2, max_per_source 12. Gemeten vóór: meetings 19,3 salient-chunks per bundel, 1,87 per meeting; jira 19,2 per bundel bij een bron-hint. Zie 06-rag-per-source/IMPLEMENT-NOTES.md.',
       updated_at = now()
 WHERE intent = 'search_fast';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906211000', '06f_alpha_recipe_caps')
ON CONFLICT (version) DO NOTHING;
