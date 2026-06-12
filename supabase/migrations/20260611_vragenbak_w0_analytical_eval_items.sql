-- =============================================================================
-- Vragenbak in de breedte — W0: analytical eval-items (qtype='analytical')
-- =============================================================================
-- 2026-06-11. Project Confluence 471302146; eval-addendum 471269378 (A01-A06).
-- Ground-truth HAND-GEVERIFIEERD (SQL + bron-mails gelezen) op 2026-06-11:
--   A02: churn_customers april 2026 = AK Advocaten + Beer Advocaten/Balieplus.
--   A07: HubSpot live startdatum jan 2026 = Westpoint, Gelissen, Noortje Lina,
--        FTW, Nexavelo, Vogelaar Bosch Spijer, Beer Advocaten (7 exact).
--   A01: HubSpot live licentieprijs_per_gebruiker=175 in lopende CB-stages = 31.
--   A04: amount is in HubSpot NIET in gebruik (0 deals > 10000) — het juiste
--        antwoord is "deze data wordt niet bijgehouden" (eerlijkheids-test).
--   G01: prijs-bezwaar in onderhandeling (bron-mails gelezen):
--        REQUIRED Van Doorn c.s. ("5*175*80%=700/mnd te stevige uitgave"),
--                 Van Wanrooij (fee-onderhandeling "50% tegen 2 leads"),
--                 Tanger ("automatisch overgaan in duur betaald abonnement niet akkoord");
--        acceptabel: Okkerse & Schop (kosten-kritisch), Beer Advocaten
--        (prijs-churn naar TextCortex €35), Meijers Canatan (voorwaarden).
--   G02: twijfel geuit in mails: REQUIRED KC Legal ("meerdere partijen, Saga"),
--        Advocaten van Nu ("terughoudend ivm geheimhoudingsplicht/avg");
--        acceptabel: Kienhuis (andri.ai-vergelijking), Okkerse & Schop,
--        Van Doorn c.s. (kosten-twijfel).
--   G03/G04: router-negatives — thematische resp. entity-diepte vraag moet
--        semantic blijven (geen route naar structured/sweep).
-- Asserts-keys voor analytical (rag-eval-cron v2.2): expect_route,
--   required_entities, forbidden_entities, answer_must_match_regex,
--   expect_min_rows, expect_max_rows, expect_scan_claim.
-- Kern-12 (is_core) blijft onaangeraakt; alle items is_core=false.
-- =============================================================================

INSERT INTO rag_eval_questions (id, question, dimension, depth, intent, skill, qtype, is_core, is_active, expected_answer, asserts, options, notes)
VALUES
('A01', 'Geef een overzicht van alle klanten met een licentieprijs van 175 euro per gebruiker per maand.',
 'analytical-filter', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Een lijst van ~31 lopende Customer Base-klanten met licentieprijs_per_gebruiker = 175, o.a. Westpoint advocaten, Kneppelhout Advocaten, Van Doorn c.s. Advocaten, Gelissen Belastingadviseurs is Vernieuwd (telt niet mee in lopend).',
 '{"expect_route":"structured","required_entities":["Westpoint","Kneppelhout","Van Doorn"],"forbidden_entities":["Beer Advocaten"],"expect_min_rows":25,"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Vereist licentieprops in mirror (W5 data-home). Ground-truth live HubSpot 2026-06-11: 31 lopend (14 Proeftijd, 5 Actief, 12 Eenpitters).'),
('A02', 'Welke klanten zijn in april 2026 gechurnd?',
 'analytical-filter-tijd', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'AK Advocaten (gechurnd 16 april 2026) en Beer Advocaten / Balieplus (21 april 2026). Bron: churn-administratie.',
 '{"expect_route":"structured","required_entities":["AK Advocaten","Beer Advocaten"],"forbidden_entities":["Rassers","DVAN","Vogelaar"],"expect_max_rows":4,"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Vast venster april 2026 (deterministisch). churn_customers: AK 2026-04-16, Beer 2026-04-21.'),
('A03', 'Hoeveel actieve pilots of proefperiodes lopen er op dit moment?',
 'analytical-telling', 'telling', 'search', 'rag-chat', 'analytical', false, true,
 'Telling van lopende proefperiodes: Customer Base stage Proeftijd (peildatum 2026-06-11: 20 deals) plus Sales Pipeline 1-pitters in proefperiode; definitie moet in het antwoord staan.',
 '{"expect_route":"structured","answer_must_match_regex":"(proefperiode|pilot|Proeftijd)","expect_min_rows":1,"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Aantal verschuift over tijd; assert op route + definitie-transparantie, niet op exact getal.'),
('A04', 'Welke deals zijn groter dan 10.000 euro en in welke fase zitten ze?',
 'analytical-filter', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Eerlijk antwoord: het veld amount wordt in HubSpot niet bijgehouden (0 deals met amount > 10.000), dus deze vraag is niet uit de data te beantwoorden. Geen gefantaseerde lijst.',
 '{"expect_route":"structured","answer_must_match_regex":"(geen|niet|ontbreek)"}'::jsonb,
 '{}'::jsonb,
 'Eerlijkheids-test: live HubSpot 2026-06-11 heeft 0 deals met amount>10000 (veld ongebruikt). Antwoord moet dat zeggen, niet hallucineren.'),
('A05', 'Welke actieve klanten hebben we al 60 dagen of langer niet per mail gesproken?',
 'analytical-filter-tijd', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Lijst van actieve Customer Base-klanten waarvan het laatste mailcontact (in- of uitgaand, domein-match) 60+ dagen geleden is; peildatum 2026-06-11 ~49 van 64. Elke rij hoort een laatste-contactdatum ouder dan 60 dagen te hebben.',
 '{"expect_route":"structured","expect_min_rows":5,"answer_must_match_regex":"60","expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Relatief venster -> property-asserts (route, min_rows, scan-claim); exacte lijst verschuift dagelijks.'),
('A06', 'Wat is de totale maandelijkse licentiewaarde van alle actieve klanten?',
 'analytical-aggregatie', 'aggregatie', 'search', 'rag-chat', 'analytical', false, true,
 'Som van vaste maandprijzen plus (licentieprijs per gebruiker x minimale licenties) over lopende Customer Base-klanten, met expliciete definitie en missing-data-disclaimer.',
 '{"expect_route":"structured","answer_must_match_regex":"(€|euro|EUR)","expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Vereist licentieprops in mirror (W5). Bedrag verschuift; assert route + valuta + scan-claim.'),
('A07', 'Maak een tabel van alle klanten die gestart zijn in januari 2026.',
 'analytical-filter-tijd', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Exact 7: Westpoint advocaten (19 jan), Gelissen Belastingadviseurs (5 jan), Noortje Lina Strafrechtadvocaten (5 jan), FTW Advocaten (8 jan), Nexavelo advocaten (6 jan), Vogelaar Bosch Spijer Advocaten (15 jan), Beer Advocaten / Balieplus (26 jan). Startdatum-gebaseerd, ongeacht latere churn.',
 '{"expect_route":"structured","required_entities":["Westpoint","Gelissen","Noortje Lina","FTW","Nexavelo","Vogelaar","Beer Advocaten"],"expect_min_rows":7,"expect_max_rows":9,"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Vereist startdatum in mirror (W5). Ground-truth live HubSpot 2026-06-11: 7 exact, vast venster.'),
('G01', 'Maak een opsomming van iedereen die tijdens de onderhandelingen moeilijk heeft gedaan over de prijs.',
 'sweep-classificatie', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Hard geverifieerd: Van Doorn c.s. Advocaten (700 euro/mnd te stevige uitgave), Van Wanrooij (fee-onderhandeling 50% korting tegen leads), Tanger Advocaten (automatisch duur betaald abonnement niet akkoord). Acceptabel extra: Okkerse & Schop (kosten-kritisch), Beer Advocaten/Balieplus (prijs-churn TextCortex 35 euro), Meijers Canatan (voorwaarden-onderhandeling). Met bronverwijzing per rij en N-gescand-claim.',
 '{"expect_route":"sweep","required_entities":["Van Doorn","Van Wanrooij","Tanger"],"forbidden_entities":["Heliview","Pragnakalp","HubSpot","Bierens"],"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Ground-truth uit bron-mails gelezen 2026-06-11. Forbidden = vendors/verhuurder/event-partner (false-positive-guard).'),
('G02', 'Geef een lijst van iedereen die in de mails heeft laten weten dat ze twijfelden over Legal Mind.',
 'sweep-classificatie', 'exhaustief', 'search', 'rag-chat', 'analytical', false, true,
 'Hard geverifieerd: KC Legal (overweegt meerdere partijen, vergelijkt met Saga), Advocaten van Nu (terughoudend ivm geheimhoudingsplicht/AVG). Acceptabel extra: Kienhuis Legal (vergelijkt met andri.ai), Okkerse & Schop (intern beraad, pitch nodig), Van Doorn c.s. (kosten-twijfel). Met bronverwijzing per rij en N-gescand-claim.',
 '{"expect_route":"sweep","required_entities":["KC Legal","Advocaten van Nu"],"forbidden_entities":["Rubicon","Straatman Koster"],"expect_scan_claim":true}'::jsonb,
 '{}'::jsonb,
 'Ground-truth uit bron-mails gelezen 2026-06-11. Rubicon (positief) en Straatman Koster (contactwissel) = false-positive-guards.'),
('G03', 'Wat zijn de belangrijkste zorgen die advocatenkantoren noemen over AI en betrouwbaarheid?',
 'router-negative', 'thematisch', 'search', 'rag-chat', 'analytical', false, true,
 'Thematische synthese (geen lijst van wie) — dit hoort via het bestaande semantische RAG-pad te lopen, niet via structured of sweep.',
 '{"expect_route":"semantic"}'::jsonb,
 '{}'::jsonb,
 'Router-guard: vraagt naar WAT (themas), niet WIE (lijst). Mag niet naar sweep routeren.'),
('G04', 'Geef me de laatste stand van zaken rond Forsyte Advocaten.',
 'router-negative', 'entity-diepte', 'search', 'rag-chat', 'analytical', false, true,
 'Entity-diepte vraag over een klant — hoort via het bestaande semantische/entity-pad te lopen (RFO-kernvraag), niet via structured of sweep.',
 '{"expect_route":"semantic"}'::jsonb,
 '{}'::jsonb,
 'Router-guard: een-entiteit-diepte moet semantic blijven (zelfde vraag als kernitem RFO maar dan door rag-chat).')
ON CONFLICT (id) DO NOTHING;
