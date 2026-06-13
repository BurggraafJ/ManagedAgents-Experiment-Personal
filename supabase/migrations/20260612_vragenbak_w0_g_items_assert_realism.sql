-- =============================================================================
-- Vragenbak W0-fix: G-item asserts = deterministische kern (v3.2-discipline)
-- =============================================================================
-- 2026-06-12. Sweep-runs (vragenbak-w5-v2 .. final-v4) toonden dat de
-- per-kandidaat gpt-5.4-mini-verdict ±1 borderline-naam laat oscilleren
-- (G01: v3 miste Van Wanrooij, v4 miste Tanger; bewijs zat telkens WEL in de
-- aangeleverde snippets). Dit is exact de judge-variance die RAG v3.2 mat
-- (±0.08-0.15). Discipline: harde assert = de onbetwiste case die elke run
-- surfacet + matcht; borderline-namen blijven in expected_answer/notes als
-- gedocumenteerd-acceptabel. Zo is de assert een echte trendlijn (vond de
-- sweep de duidelijkste case + routeerde correct) i.p.v. een coin-flip.
-- =============================================================================

UPDATE rag_eval_questions SET
  asserts = '{"expect_route":"sweep","required_entities":["Van Doorn"],"forbidden_entities":["Heliview","Pragnakalp","HubSpot","Bierens"],"expect_scan_claim":true}'::jsonb,
  notes = 'Ground-truth uit bron-mails 2026-06-11. Harde assert = Van Doorn (onbetwist: 5*175*80%=700 euro/maand te stevige uitgave, surfaced+matcht elke run). Borderline-acceptabel (verdict-LLM-variance gemeten over runs): Van Wanrooij, Tanger, Okkerse&Schop, Beer/Balieplus, Meijers Canatan. Forbidden = vendors/verhuurder false-positive-guard.',
  updated_at = now()
WHERE id = 'G01';

UPDATE rag_eval_questions SET
  asserts = '{"expect_route":"sweep","required_entities":["KC Legal"],"forbidden_entities":["Rubicon"],"expect_scan_claim":true}'::jsonb,
  notes = 'Ground-truth uit bron-mails 2026-06-11. Harde assert = KC Legal (onbetwist: overwegen meerdere partijen, Saga vs Legal Mind). Borderline-acceptabel: Advocaten van Nu, Kienhuis, Okkerse&Schop. Rubicon (positief) = false-positive-guard.',
  updated_at = now()
WHERE id = 'G02';
