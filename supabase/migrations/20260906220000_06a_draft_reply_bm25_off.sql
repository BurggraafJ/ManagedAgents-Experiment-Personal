-- =============================================================================
-- 06a WP1 — draft_reply en classify_mail_action uit de 8 s-zone   (2026-09-06)
-- =============================================================================
-- Gemeten (06a/RESEARCH.md §1.4, prod, dezelfde opgeslagen mail-embedding, vorm
-- van draft_reply: top_k 5, min_sim 0,6, 365 d, audience external):
--
--   query_text 400 tekens  (< 500 → de BM25-OR-arm doet mee)   15.378 / 12.874 ms
--   query_text 900 tekens  (> 500 → match_chunks zet de tsquery op NULL)  418 ms
--   query_text NULL        (= bm25_enabled false)                        17,7 ms
--   de OR-tsquery van diezelfde 400 tekens matcht 38.452 van 46.382 chunks (82,9 %)
--
-- Een inkomende mail ÍS de zoekvraag. Korte mails (< 500 tekens, de helft van de
-- auto-draft-bundels) laten de lexicale arm dus 83 % van de index rangschikken;
-- boven de 8 s PostgREST-timeout wordt dat een vector_errors-rij en een lege
-- bundel. Bundeltelemetrie 60 d, audience='auto-draft': n 438, build p50 1.422 /
-- p95 8.668 ms, search p50 490 / p95 8.047 ms, 21 lege bundels (4,8 %),
-- avg_top_similarity 0,785. De trage staart (n=48) is voor 84 % search.
-- Op de eval-lane (audience='rag-eval-cron', korte vragen) had 13 van 38
-- draft_reply-bundels vector_errors.
--
-- Dit is dezelfde knop die search_fast in v1.146 kreeg. Wat verloren gaat zijn
-- lexicale treffers op namen in korte mails; die dekt de entity-route
-- (from_email → contact / from_domain → company, die dit recept al draait) plus
-- de MetaRAG-leader die in de mail-embedding zit.
--
-- Terugdraaien = deze UPDATE met true. Geen deploy nodig: context-build leest de
-- receptrij per call.
-- =============================================================================

UPDATE public.context_intents
   SET bm25_enabled = false,
       notes = coalesce(notes, '') || ' — 06a WP1 (2026-09-06): bm25_enabled=false. Gemeten: query_text < 500 tekens laat de BM25-OR-arm 82,9 % van de index rangschikken (12,9–15,4 s per RPC-call tegen 0,4 s boven de 500-tekencap en 17,7 ms zonder arm); daarboven de 8 s PostgREST-timeout = lege bundel. Zie 06-rag-per-source/06a/IMPLEMENT-NOTES.md.',
       updated_at = now()
 WHERE intent IN ('draft_reply', 'classify_mail_action')
   AND bm25_enabled IS DISTINCT FROM false;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260906220000', '06a_draft_reply_bm25_off')
ON CONFLICT (version) DO NOTHING;
