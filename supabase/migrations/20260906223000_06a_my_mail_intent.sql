-- =============================================================================
-- 06a WP4 — recept `my_mail`: de eigen mailbox op relevantie      (2026-09-06)
-- =============================================================================
-- `rag_search_my_mail` (de RPC achter de tool `my_mail_search`) is
-- recency-only: een regex over onderwerp/tekst/samenvatting, `ORDER BY
-- received_at DESC LIMIT 10`. Geen ranking. Gemeten in de org-mailbox:
--
--   nda|geheimhouding      1.440 treffers · 104 in de laatste 90 d · oudste 2023-11
--   offerte|voorstel       1.070          · 104
--   licentie|overeenkomst    907          ·  71
--   factuur|betaling         733          ·  56
--   demo                     541          ·  20
--
-- De tool toont daarvan de 10 nieuwste; alles wat relevanter maar ouder is,
-- bestaat voor het model niet. Dit recept is de tweede arm: dezelfde vraag,
-- semantisch, over de mailchunks van de vrager. De identiteit is de bestaande
-- owner-as van match_chunks (`p_owner_user_id` → `rag_owner_scope_ids`), niet
-- iets nieuws — `rag_search_my_mail` blijft ongewijzigd.
--
-- Waarom deze waarden:
--   match_chunks         geen entity-pad; de vraag is trefwoorden, geen anker.
--   top_k 10             evenveel als de regex-arm, zodat de merge niet scheeftrekt.
--   min_similarity 0,30  breder dan draft_reply (0,6): dit is zoeken, geen ankeren.
--   recency 0,30 / 90 d  mail veroudert snel, maar niet zó snel dat de arm weer
--                        recency-only wordt (search_fast staat op 0,15).
--   bm25_enabled false   dezelfde meting als WP1: een OR-arm over de index kost
--                        seconden en levert hier niets — de regex-arm ís lexicaal.
--   filter_sources mail  de tool heet niet voor niets my_mail_search.
--   max_per_record 1     één chunk per mail (mail heeft er precies één; de cap
--                        is de borging, niet de verwachting).
--   jellemind/kb uit     dit is een zoektool, geen antwoord; voorkeuren en
--                        kennisbank horen in de compose-stap, niet in de treffers.
-- =============================================================================

INSERT INTO public.context_intents (
  intent, description, default_strategy, default_top_k,
  default_min_similarity, default_recency_weight, default_recency_decay_days,
  default_lookback_days, default_filter_sources, bm25_enabled,
  query_intel_level, max_per_record, inject_jellemind, inject_kb, kb_top_k,
  default_rerank, notes
) VALUES (
  'my_mail',
  'Semantische arm van de tool my_mail_search: de eigen (gespiegelde) mailbox van de vrager op relevantie in plaats van alleen recency.',
  'match_chunks', 10,
  0.30, 0.30, 90,
  NULL, ARRAY['mail']::text[], false,
  'off', 1, false, false, 0,
  false,
  '06a WP4 (2026-09-06). Aangeroepen vanuit rag-chat/agentic.ts execTool(my_mail_search) met owner_user_id = de vrager, naast de regex-arm rag_search_my_mail. Reden: die RPC is ORDER BY received_at DESC LIMIT 10 over 541-1.440 regex-treffers per trefwoordset, dus oudere relevante mail is onzichtbaar. Identiteit blijft de owner-as van match_chunks; de RPC is niet gewijzigd.'
)
ON CONFLICT (intent) DO UPDATE
  SET default_strategy         = EXCLUDED.default_strategy,
      default_top_k            = EXCLUDED.default_top_k,
      default_min_similarity   = EXCLUDED.default_min_similarity,
      default_recency_weight   = EXCLUDED.default_recency_weight,
      default_recency_decay_days = EXCLUDED.default_recency_decay_days,
      default_filter_sources   = EXCLUDED.default_filter_sources,
      bm25_enabled             = EXCLUDED.bm25_enabled,
      query_intel_level        = EXCLUDED.query_intel_level,
      max_per_record           = EXCLUDED.max_per_record,
      inject_jellemind         = EXCLUDED.inject_jellemind,
      inject_kb                = EXCLUDED.inject_kb,
      updated_at               = now();

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906223000', '06a_my_mail_intent')
ON CONFLICT (version) DO NOTHING;
