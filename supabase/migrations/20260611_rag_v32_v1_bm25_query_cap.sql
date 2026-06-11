-- RAG v3.2 V1 (P0-fix), stap 1+2 gecombineerd zoals live toegepast op 2026-06-11
-- (MCP-migraties: rag_v32_v1_bm25_query_cap + rag_v32_v1_bm25_off_for_long_queries).
--
-- DIAGNOSE (gemeten):
--   draft_reply-prefill stuurt volledige mailteksten (<=6000 chars) als query_text.
--   plainto_tsquery maakt daar honderden lexemen van; de ' & '->' | '-transformatie
--   (bedoeld voor recall op korte zoekvragen) maakt er een OR-monster van dat een
--   groot deel van de 30k-chunk fts-index matcht en rankt:
--     match_chunks_for_entity (6000-char query): 9,39s  -> statement timeout (8s)
--     match_chunks            (6000-char query): 4,29s warm
--   Gevolg: 11 autodraft-mails (interne collega's, lange mails) sinds 22 mei in een
--   3-minuten-retry-loop; draft_reply search-fase gemiddeld 6,4s.
--   NB: v_entity_edges_full bleek NIET de bottleneck (volledige evaluatie 0,27s) —
--   materialisatie uit het oorspronkelijke voorstel is daarom vervallen.
--
-- FIX: BM25-arm volledig UIT bij query_text > 500 chars. tsq.q wordt NULL ->
--   bm25_hits leeg, bm25_raw=0, filtered = alleen vector-arm. De vector-arm gebruikt
--   de volledige tekst (embedding elders berekend). Echte zoekvragen (<=500 chars)
--   zijn byte-voor-byte ongewijzigd (sanity: 10/10 resultaten met bm25_score>0).
--
-- RESULTAAT (gemeten): match_chunks lang 4.288ms -> 288ms; E2E context-build
--   draft_reply interne-collega 8.700ms+timeout -> 1.024ms (search 344ms).
--
-- Toegepast op: match_chunks (14-arg) + match_chunks_for_entity (13-arg legacy + 15-arg).
DO $$
DECLARE r record; newdef text; n_changed int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('match_chunks','match_chunks_for_entity')
  LOOP
    newdef := pg_get_functiondef(r.oid);
    IF newdef LIKE '%CASE WHEN length(query_text) > 500%' OR newdef LIKE '%CASE WHEN length(p_query_text) > 500%' THEN
      CONTINUE; -- al toegepast (idempotent)
    END IF;
    newdef := replace(newdef, 'plainto_tsquery(''dutch'', query_text)',
                              'plainto_tsquery(''dutch'', CASE WHEN length(query_text) > 500 THEN NULL ELSE query_text END)');
    newdef := replace(newdef, 'plainto_tsquery(''dutch'', p_query_text)',
                              'plainto_tsquery(''dutch'', CASE WHEN length(p_query_text) > 500 THEN NULL ELSE p_query_text END)');
    EXECUTE newdef;
    n_changed := n_changed + 1;
  END LOOP;
  RAISE NOTICE 'bm25 long-query gate toegepast op % functie(s)', n_changed;
END $$;
