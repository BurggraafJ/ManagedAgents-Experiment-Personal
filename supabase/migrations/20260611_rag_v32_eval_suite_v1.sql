-- RAG v3.2 — Eval-suite v1 (lens B): gold-vragen uit de cron-hardcode naar een tabel,
-- + deterministische asserts + ground-truth + bredere intents/consumenten.
-- Kern-12 (is_core) behoudt EXACT de vraagteksten van rag-eval-cron v1 voor trend-continuïteit.
-- Toegepast via MCP apply_migration op 2026-06-11 (rag_v32_eval_suite_v1 + rag_v32_eval_runs_pass_rate).

CREATE TABLE IF NOT EXISTS rag_eval_questions (
  id text PRIMARY KEY,
  question text NOT NULL,
  dimension text,
  depth text,
  intent text NOT NULL DEFAULT 'search',
  skill text,
  qtype text NOT NULL DEFAULT 'functional',  -- functional | negative | regression | shadow
  is_core boolean NOT NULL DEFAULT false,    -- 12-kern trendlijn (niet wijzigen)
  is_active boolean NOT NULL DEFAULT true,
  expected_answer text,                      -- ground-truth (geverifieerd) voor answer_correctness
  expect_signal text,                        -- menselijk leesbare verwachting
  asserts jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- asserts-keys (alle optioneel):
  --   must_match_regex        : top-K content moet regex matchen (case-insens)
  --   must_include_source     : bron moet in top-K zitten
  --   must_exclude_source     : bron mag NIET in top-K zitten
  --   top1_max_age_days       : top-1 occurred_at max N dagen oud
  --   expect_no_context       : negative — correcte uitkomst is 'geen relevante context'
  --   expect_strategy_prefix  : retrieval_strategy moet hiermee beginnen
  --   expect_reranked         : reranked moet true zijn
  --   expect_meta_null        : retrieval_meta->>{key} moet null zijn (bv filter_sentiment, query_intent)
  --   max_build_ms            : context-build mag niet langzamer zijn dan dit
  options jsonb NOT NULL DEFAULT '{}'::jsonb, -- context-build options (bv from_email voor draft_reply)
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rag_eval_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rag_eval_questions_auth_read ON rag_eval_questions;
CREATE POLICY rag_eval_questions_auth_read ON rag_eval_questions FOR SELECT TO authenticated USING (true);

ALTER TABLE rag_eval_results
  ADD COLUMN IF NOT EXISTS signal_hit boolean,
  ADD COLUMN IF NOT EXISTS assert_detail text,
  ADD COLUMN IF NOT EXISTS answer_correctness numeric;

ALTER TABLE rag_eval_runs
  ADD COLUMN IF NOT EXISTS signal_pass_rate numeric,
  ADD COLUMN IF NOT EXISTS n_asserted integer,
  ADD COLUMN IF NOT EXISTS avg_answer_correctness numeric;

-- ============================== SEED (50 items) ==============================
-- Kern-12 (is_core=true, exact de rag-eval-cron v1-teksten) + v0-verbreding (search/enrich_record/
-- analyze_meeting/extract_actions/compose_followup/match_appointment/classify) + hard negatives
-- N01-N04 + KB-bleed K02 + recency T01 + meta-regressies R03/R06/R08/S01 + draft_reply-shadow
-- DR01-DR03 (DR03 = P0-marker interne-collega entity-timeout).
-- ON CONFLICT DO NOTHING: her-runnen overschrijft bestaande vragen nooit; beheer via de tabel zelf.
INSERT INTO rag_eval_questions (id, question, dimension, depth, intent, skill, qtype, is_core, expected_answer, expect_signal, asserts, options, notes) VALUES
('E04','Wat is er besproken over het LegalMind prijsmodel en adoptie?','wat-zei-X-over-Y','makkelijk','search','zoeken','functional',true,'Adoptiemodel: minimaal ~25% van het kantoor / 5 gebruikers; EUR 175 per maand per gebruiker, onbeperkt gebruik.','meeting pricing/adoptie','{"must_match_regex":"adoptie|25%"}','{}',NULL),
('E06','Welke argumenten zijn genoemd waarom advocaten een eigen dossier of DMS-koppeling willen?','wat-zei-X-over-Y','diep','search','zoeken','functional',true,'Eigen dossier is verplicht voor de advocaat; DMS-koppeling zodat documenten automatisch in het DMS van de advocaat komen; delen van dossiers is de grootste aanvraag.','meeting fact agreement/decision','{"must_match_regex":"dossier"}','{}',NULL),
('E12','Welke pilots of proefperiodes lopen er nu?','lifecycle-sales','midden','search','zoeken','functional',true,'O.a. pilottraject Kienhuis Legal (conceptovereenkomst in voorbereiding) en pilot Benvalor per 1 juli 2026.','topic=pilot mails','{"must_match_regex":"pilot"}','{}',NULL),
('E14','Wat zijn de belangrijkste bezwaren die klanten noemen over de prijs?','vrije-semantiek','makkelijk','search','zoeken','functional',true,NULL,'objection/pricing chunks','{"must_match_regex":"prijs|pricing|tarief"}','{}','Retrieval-zwakte bekend (judge R=0 op 2026-06-11): thema-chunks komen op, bezwaar-chunks niet.'),
('E15','Welke zorgen hebben advocatenkantoren over AI en betrouwbaarheid?','vrije-semantiek','midden','search','zoeken','functional',true,'AI wordt versnipperd gebruikt; vraag is procesmatige inzet; Copilot=generalist vs specialisatie.','meeting AI-adoptie','{"must_match_regex":"AI"}','{}',NULL),
('E16','Wat is onze positionering ten opzichte van concurrenten?','vrije-semantiek','diep','search','zoeken','functional',true,'Specialisatie in Nederlands recht; volledige Moonlit-integratie als onderscheider (t.o.v. Legora/Zeno e.a.).','note concurrentie + meeting','{"must_match_regex":"Legora|Moonlit|concurrent"}','{}',NULL),
('E20','Wat is de besproken maandprijs per gebruiker?','feit-specifiek','makkelijk','search','zoeken','functional',true,'EUR 175 per maand per gebruiker (onbeperkt gebruik).','meeting price-chunk 175 euro','{"must_match_regex":"175"}','{}','2026-06-11: antwoord koos Moonlit-inkoopprijs (20/30 euro) terwijl 175-chunk in top-8 zat — ground-truth-check moet dit vangen.'),
('E21','Wat is de laatste stand rondom TTFA?','feit-specifiek','makkelijk','search','zoeken','functional',true,'Jay Alberts deelde 3-jun-2026 zijn visie (niet overhaast releasen, klanten betrekken); George Gowers bevestigde 4-jun en komt erop terug.','mail Aanpak rondom TTFA','{"must_match_regex":"TTFA"}','{}',NULL),
('E22','Welke kandidaat is voorgesteld voor de sales-rol?','feit-specifiek','midden','search','zoeken','functional',true,'Shane Remmerswaal (via YPD).','jira MANAGEMENT-170 / mail-thread','{"must_match_regex":"Shane Remmerswaal"}','{}',NULL),
('E36','Wat is de visie op AI-versnippering binnen kantoren?','vrije-semantiek','diep','search','zoeken','functional',true,'AI wordt te versnipperd ingezet; doel is procesmatige, gestructureerde inzet (standard operating procedures).','meeting AI versnipperd','{"must_match_regex":"versnipperd"}','{}',NULL),
('R01','Wat is de huidige status van onze samenwerking met Rutgers en Posch?','named-entity','midden','search','zoeken','regression',true,NULL,'Rutgers & Posch entity-chunks bovenaan','{"must_match_regex":"Rutgers","expect_strategy_prefix":"match_chunks_for_entity"}','{}','F.1-regressie. NB duplicate company-records (2).'),
('RFO','Geef me de laatste stand van zaken rond Forsyte Advocaten','named-entity','midden','search','zoeken','regression',true,NULL,'Forsyte entity-chunks','{"must_match_regex":"Forsyte","expect_strategy_prefix":"match_chunks_for_entity"}','{}','F.1-regressie.'),
('E01','Wat is de huidige status met Kerckhoffs Advocaten?','relatie-stand','makkelijk','search','zoeken','functional',false,NULL,'deal+mails Kerckhoffs','{"must_match_regex":"Kerckhoffs"}','{}',NULL),
('E03','Hoe staat het ervoor met Forsyte Advocaten?','relatie-stand','midden','search','zoeken','functional',false,NULL,'entity Forsyte','{"must_match_regex":"Forsyte"}','{}',NULL),
('E07','Welke mails kreeg ik afgelopen week?','tijdgebonden','makkelijk','search','zoeken','functional',false,NULL,'filter_after ~14d, source=mail','{"must_include_source":"mail","top1_max_age_days":14}','{}',NULL),
('E08','Wat speelde er in mei 2026 rond pricing?','tijdgebonden','midden','search','zoeken','functional',false,NULL,'jaar/maand-filter + pricing','{"must_match_regex":"prijs|pricing"}','{}',NULL),
('E09','Wat is er sinds de start van de pilot bij Incentive Advies gebeurd?','tijdgebonden','diep','search','zoeken','functional',false,NULL,'temporeel thread Incentive','{"must_match_regex":"Incentive"}','{}',NULL),
('E10','Welke deals staan momenteel in onderhandeling?','lifecycle-sales','makkelijk','search','zoeken','functional',false,NULL,'deal onderhandel-stages','{"must_include_source":"deal"}','{}',NULL),
('E17','Welke mails wachten nog op mijn antwoord?','openstaande-actie','makkelijk','search','zoeken','functional',false,NULL,'asks_response=true benut (F.8)','{"must_include_source":"mail"}','{}','F.8: asks_response hoort auto te vuren op deze cue.'),
('E24','Vertel me over Hall B.V.','named-entity','makkelijk','search','zoeken','functional',false,NULL,'company+deal Hall B.V.','{"must_match_regex":"Hall"}','{}',NULL),
('E25','Wat speelt er bij Vanhees advocaten?','named-entity','makkelijk','search','zoeken','functional',false,NULL,'deal/mails Vanhees','{"must_match_regex":"Vanhees"}','{}',NULL),
('E26','Wat heeft Jay Alberts recent gemaild?','named-entity','midden','search','zoeken','regression',false,NULL,'contact Jay Alberts (niet eigen company) — R02','{"must_match_regex":"Alberts"}','{}','R02-regressie: moet naar contact resolven, niet eigen company.'),
('E27','Welke klanten hebben zowel een lopende pilot als een openstaande prijsvraag?','cross-source','diep','search','zoeken','functional',false,NULL,'multi-hop pilot+pricing','{}','{}','Multi-hop; verwacht zwak op top-k RAG (analytische laag = apart project).'),
('E33','Welke evaluatie-notitie staat er over het product?','engagement','midden','search','zoeken','functional',false,NULL,'engagement note evaluatie 20/05','{"must_include_source":"engagement","must_match_regex":"evaluatie"}','{}',NULL),
('E34','Welke afspraken staan er komende periode in mijn agenda?','event','makkelijk','search','zoeken','functional',false,NULL,'source=event toekomstig','{"must_include_source":"event"}','{}',NULL),
('E35','Hoe log ik voor het eerst in?','kb','makkelijk','search','zoeken','functional',false,'E-mailadres bevestigen, wachtwoord instellen, daarna inloggen (KB-artikel).','kb_article eerste keer inloggen — legitieme KB-hit','{"must_include_source":"kb_article"}','{}','KB-positief: artikel hoort te hitten nu kb_article in main-pad zit.'),
('E02','Vat de relatie met Rutgers & Posch samen.','relatie-stand','midden','enrich_record','daily-admin','functional',false,NULL,'company+deal+mail Rutgers & Posch','{"must_match_regex":"Rutgers"}','{}',NULL),
('E05','Wat is er gezegd over Wolters Kluwer en Libra?','wat-zei-X-over-Y','midden','analyze_meeting','meeting-briefing','functional',false,NULL,'meeting-topic WK/Libra','{"must_match_regex":"Wolters Kluwer|Libra"}','{}',NULL),
('E11','Welke klanten naderen een verlenging?','lifecycle-sales','midden','enrich_record','daily-admin','functional',false,NULL,'lifecycle=renewing / renewal-topics','{"must_match_regex":"verleng|renewal|verloopt"}','{}',NULL),
('E13','Stel een follow-up op voor Vanhees advocaten na het laatste contact.','lifecycle-sales','diep','compose_followup','sales-on-road','functional',false,NULL,'entity Vanhees + recente historie','{"must_match_regex":"Vanhees"}','{}',NULL),
('E18','Welke actiepunten kwamen uit de laatste meetings?','openstaande-actie','midden','extract_actions','taken','functional',false,NULL,'meeting action-items','{"must_include_source":"meeting"}','{}',NULL),
('E19','Welke Jira-taken staan nog open?','openstaande-actie','makkelijk','extract_actions','taken','functional',false,'O.a. MANAGEMENT-171 (gesprek Wouter) en MANAGEMENT-170 (kandidaat Shane Remmerswaal).','jira Nog doen','{"must_include_source":"jira","must_match_regex":"MANAGEMENT-17"}','{}',NULL),
('E23','Via welke partner kwam er een introductie binnen?','feit-specifiek','midden','enrich_record','daily-admin','functional',false,'Via Mees Holding (Maarten Icking) — partner-intro.','mail intro_referral meesholding.com','{"must_match_regex":"Mees ?Holding|meesholding|Icking"}','{}',NULL),
('E28','Welke afspraken uit meetings zijn nog niet per mail bevestigd?','cross-source','diep','analyze_meeting','meeting-briefing','functional',false,NULL,'meeting commitments vs mail (multi-hop)','{}','{}',NULL),
('E29','Koppel de deal-status van Kerckhoffs aan de laatste meeting en mail.','cross-source','diep','enrich_record','daily-admin','functional',false,NULL,'entity Kerckhoffs 1-hop','{"must_match_regex":"Kerckhoffs"}','{}',NULL),
('E30','Wanneer kan ik een kennismaking met Incentive Advies inplannen?','agenda','midden','match_appointment','agenda','functional',false,NULL,'agenda/event + lead-context','{}','{}',NULL),
('E32','Is een Slack-notificatiemail relevant voor mij of archiveren?','classify','makkelijk','classify_mail_action','auto-draft','functional',false,'Niet voor Jelle; archiveren (Archief/Notificaties).','not_for_you → Notificaties','{}','{}',NULL),
('N01','Welke deal loopt er momenteel met Apple Inc?','negative','midden','search','zoeken','negative',false,'(geen relevante context)','geen Apple-deal in data','{"expect_no_context":true}','{}',NULL),
('N02','Wat is er besproken met ons kantoor in New York?','negative','midden','search','zoeken','negative',false,'(geen relevante context)','geen NY-kantoor','{"expect_no_context":true}','{}',NULL),
('N03','Wanneer is de fusie met Houthoff afgerond?','negative','diep','search','zoeken','negative',false,'(geen relevante context)','plausibel-klinkend maar onbestaand','{"expect_no_context":true}','{}','Test verzinsel-weerstand: faithfulness onder druk.'),
('N04','Welk bedrag heeft Legal Mind opgehaald in de Series B?','negative','diep','search','zoeken','negative',false,'(geen relevante context)','geen Series B in data','{"expect_no_context":true}','{}',NULL),
('K02','Wat is de status van de pilot bij Kienhuis Legal?','kb-bleed','midden','search','zoeken','regression',false,NULL,'Kienhuis-thread; GEEN kb_article (generieke onboarding-artikelen mogen niet bleeden)','{"must_match_regex":"Kienhuis","must_exclude_source":"kb_article"}','{}','Bewaakt KB-ruis nu kb_article in het main-pad meedoet (4 artikelen sinds 11-jun).'),
('T01','Welke mails heb ik de afgelopen dagen ontvangen?','recency','makkelijk','search','zoeken','functional',false,NULL,'verse mail bovenaan','{"must_include_source":"mail","top1_max_age_days":7}','{}',NULL),
('R03','Wat besprak ik recent in meetings over prijzen?','regressie','midden','search','zoeken','regression',false,NULL,'meeting-chunks aanwezig ondanks bedrag-cue (F.5 bron-hint-merge)','{"must_include_source":"meeting"}','{}','F.5-regressie: bedrag-regel mag meetings niet wegfilteren.'),
('R06','Wat is er gezegd over Drafting 1.0 en 2.0?','regressie','midden','search','zoeken','regression',false,NULL,'geen action-bron in algemeen zoeken (F.2)','{"must_exclude_source":"action"}','{}','F.2-regressie.'),
('R08','Welke zorgen leven er op dit moment bij klanten?','regressie','midden','search','zoeken','regression',false,NULL,'reranker hoort te vuren op search','{"expect_reranked":true}','{}','F.4-regressie.'),
('S01','Welke klanten zijn ontevreden of hebben geklaagd?','regressie','midden','search','zoeken','regression',false,NULL,'sentiment-cue in query mag GEEN auto-filter zetten (F.8-correctie)','{"expect_meta_null":"filter_sentiment"}','{}','Bewaakt dat sentiment-auto UIT blijft (gemeten slecht, v20).'),
('DR01','From: tom.profijt@kienhuislegal.nl\nSubject: RE: Voorstel roadmap en pilottraject\nHa Jelle, wil jij een conceptovereenkomst opstellen voor het draaien van de pilot? Thnx. Tom','draft-shadow','midden','draft_reply','auto-draft','shadow',false,NULL,'externe klant-reply; entity-pad of hybrid; context met Kienhuis-historie','{"must_match_regex":"Kienhuis|pilot","expect_meta_null":"query_intent","max_build_ms":8000}','{"from_email":"tom.profijt@kienhuislegal.nl","from_domain":"kienhuislegal.nl"}','Shadow van het kritieke pad. query_intent moet null zijn (geen query-intel op draft_reply).'),
('DR02','From: info@nieuwkantoor-advocaten.nl\nSubject: Interesse in Legal Mind\nGoedemiddag, wij zijn een kantoor met 12 advocaten en willen graag een demo van Legal Mind inplannen. Wat zijn de mogelijkheden en tarieven?','draft-shadow','makkelijk','draft_reply','auto-draft','shadow',false,NULL,'onbekende lead; semantisch pad; pricing/demo-context','{"expect_meta_null":"query_intent","max_build_ms":8000}','{"from_email":"info@nieuwkantoor-advocaten.nl","from_domain":"nieuwkantoor-advocaten.nl"}',NULL),
('DR03','From: alberts@legal-mind.nl\nSubject: Re: Storing\nHi Jelle, de storing van vanochtend is opgelost. Zullen we vanmiddag even bellen over de opvolging richting de klanten?','draft-shadow','midden','draft_reply','auto-draft','shadow',false,NULL,'interne collega — documenteert de entity-timeout (P0): verwacht FAIL tot fix','{"max_build_ms":8000}','{"from_email":"alberts@legal-mind.nl","from_domain":"legal-mind.nl"}','P0-marker: faalt nu met statement timeout op match_chunks_for_entity via v_entity_edges_full. Slaat om naar groen na fix.')
ON CONFLICT (id) DO NOTHING;
