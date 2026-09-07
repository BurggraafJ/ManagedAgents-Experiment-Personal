-- =============================================================================
-- 06c + 06e — bankwerk: drie onbewijsbare items naar de lane waar ze WEL scoren,
--             één item uit, en een tweede persona op de agenda
-- =============================================================================
-- 2026-09-07 · spoor 06c/06e (RESEARCH §2.10, vorken C8/C15; EVAL-GATES 06c §3, 06e §3).
--
-- HET BANKDEFECT, MET EEN GETAL. Op de agentische en de structured route bouwt
-- rag-chat geen bundel, dus `rag_eval_results.sources` is daar altijd leeg.
-- Gemeten over alle evalrijen van de laatste 30 uur (runs/…-w0-p-before.json §P7):
--     route        rijen   sources = []
--     agentic       296    296  (100 %)
--     structured    204    204  (100 %)
--     semantic      716    100
--     retrieval     587     44
-- Een `expect_sources_include` op een CHAT-item is dus een routeloterij: groen als
-- de router semantic kiest, per definitie rood als hij agentisch of structured kiest.
-- Dat is memory `eval-lane-cannot-prove-envelope-fields`, nu met een getal.
--
-- DRIE ITEMS, NIET TWEE. Het onderzoek noemde MA24 en KL41. Dezelfde assert staat
-- ook op **RO48** — en dat item heeft `ground_truth_status = 'verified'`, dus het
-- gold als een harde regressiecontrole terwijl het een loterij was.
--
-- ELKE HERSCHRIJVING IS VOORAF GEMETEN (06a's MA46-les: laad nooit een item dat per
-- definitie rood is). `tools/bank-probe.cjs` heeft per kandidaat exact de
-- retrieval-lane-call gedaan die de runner zou doen
-- (runs/2026-09-07-06c-w3-bank-probe-meeting.json):
--     MA24  retrieval/analyze_meeting top_k 15 → 15 chunks, GEEN meeting-bron   ✗
--     MA24  retrieval/search_fast     top_k 40 → 34 chunks, meeting aanwezig    ✓
--     KL41  retrieval/search_fast     top_k 40 → 40 chunks, meeting aanwezig    ✓
--     KL41  retrieval/analyze_meeting top_k 15 → 15 chunks, GEEN meeting-bron   ✗
--     RO48  retrieval/search_fast     top_k 40 → 26 chunks, meeting aanwezig    ✓
-- Vandaar `search_fast` met top_k 40 voor alle drie: dat is óók de vorm van het al
-- bestaande, geverifieerde MA37 (retrieval + must_include_source).
-- =============================================================================

UPDATE public.rag_eval_questions SET
  lane      = 'retrieval',
  intent    = 'search_fast',
  options   = '{"top_k":40}'::jsonb,
  asserts   = '{"must_include_source":"meeting"}'::jsonb,
  tags      = array(SELECT DISTINCT unnest(coalesce(tags, ARRAY[]::text[]) || ARRAY['retrieval','meeting'])),
  notes     = coalesce(notes || E'\n', '') ||
    '2026-09-07 (06c): van chat/expect_sources_include naar de retrieval-lane. Op de agentische route is envelope.sources in 296/296 gevallen leeg, dus de oude assert was een routeloterij. Nieuwe vorm vooraf gemeten met tools/bank-probe.cjs: search_fast top_k 40 levert de meeting-bron.',
  updated_at = now()
WHERE id IN ('MA24', 'KL41', 'RO48');

-- ─── E30: het recept dat het testte bestaat niet meer ────────────────────────
-- C8 verwijdert `match_appointment` (25 bundels in 88 dagen, 25/25 evalrunner,
-- 2 event-chunks in totaal). E30 had `asserts = {}` en scoorde dus niets (hit=null).
-- Beide voorgestelde herschrijvingen zijn VOORAF gemeten en vielen af
-- (runs/2026-09-07-06c-w3-bank-probe-e30.json):
--     E30 → search_fast top_k 20 + must_include_source event → 8 chunks,
--           bronnen company,contact,deal,engagement,meeting — geen event   ✗
--     E30 → search      top_k 20 + must_include_source event → 10 chunks,
--           zelfde bronnen — geen event                                    ✗
-- Reden, gemeten: de vraag lost op naar een ENTITY, dus de call gaat over het
-- entity-pad, en vanaf die entity is geen event-chunk in één hop bereikbaar.
-- Een item laden dat vooraf rood meet is precies wat 06a met MA46 heeft afgeleerd,
-- dus E30 gaat uit met een gedateerde reden in plaats van een gokherschrijving.
UPDATE public.rag_eval_questions SET
  is_active  = false,
  notes      = coalesce(notes || E'\n', '') ||
    '2026-09-07 (06e/C8): gedeactiveerd. Het recept match_appointment is verwijderd (25 bundels in 88 dagen, alle evalrunner, 2 event-chunks totaal) en dit item had asserts={}. Twee herschrijvingen vooraf gemeten (search_fast en search, beide + must_include_source event): geen event-bron, want de vraag lost op naar een entity en het entity-pad bereikt event-chunks niet in één hop. Heractiveren zodra er een agenda-recept is dat event WEL haalt.',
  updated_at = now()
WHERE id = 'E30';

-- ─── E28 blijft zoals hij is, en dit is waarom ──────────────────────────────
-- E28 (cross-source) heeft ook `asserts = {}`. Twee vullingen gemeten
-- (runs/…-w3-bank-probe-meeting.json en …-w3-bank-probe-e28.json):
--     E28 → analyze_meeting top_k 15 + meeting  → 15 chunks, geen meeting-bron  ✗
--     E28 → search_fast     top_k 40 + meeting  →  0 chunks                     ✗
--     E28 → search_fast     top_k 40 + min_chunks 10 → 0 chunks                 ✗
-- Die 0 is zelf een vondst: `search_fast` heeft bm25_enabled=false en
-- min_similarity 0,30, dus zonder één chunk boven 0,30 cosine valt er niets over.
-- Op `analyze_meeting` (bm25 aan) geeft dezelfde vraag 15 fragmenten. E28 blijft
-- daarom onaangeroerd — n/a is eerlijker dan een assert die we vooraf rood meten.

-- ─── Twee collega_beperkt-items op de agenda (de duurzame Jay-arm) ──────────
-- `--persona` FILTERT, hij overschrijft niet (memory
-- eval-runner-persona-is-filter-not-override) en alle 15 agenda-items stonden op
-- persona 'jelle' — een Jay-arm was dus niet uit de bank te halen. Deze twee items
-- maken hem permanent meetbaar.
--
-- ⚠ ZE STAAN VANDAAG ROOD, EN DAT IS DE MEETWAARDE. Gemeten met een geminte
--   Jay-JWT (runs/2026-09-07-06e-w3-persona-jay.json): Jay kreeg via
--   `calendar_search` **8 rijen, precies zoveel als Jelle**, beiden
--   caller_identified=true. `analytics_calendar_search` is SECURITY DEFINER en
--   noemt user_id noch auth.uid(), dus hij stapt over de (correcte) RLS van
--   calendar_events heen. Migratie 20260907066000 voegt `p_caller_user_id` toe;
--   de ontbrekende schakel is één argument in rag-chat/agentic.ts — verboden
--   bestand in deze kick, overdracht spoor 03/04. Zodra dat argument er staat,
--   worden deze twee items groen zonder dat iemand ze hoeft aan te passen.
--
-- expect_tools_include NAAST expect_max_rows is bewust: zonder de positieve
-- controle zou "0 rijen" ook groen zijn als de router de agenda-tool nooit belt.
-- Dat is precies de fout die de Confluence-golden-set met G1 heeft afgeleerd.
INSERT INTO public.rag_eval_questions
  (id, question, dimension, depth, intent, skill, qtype, is_core, is_active,
   expect_signal, asserts, options, notes, lane, category, persona,
   ground_truth_status, tags, bank_version)
VALUES
  ('MA48',
   'Welke externe afspraken staan er de komende twee weken in de agenda?',
   'agenda', 'makkelijk', 'search', 'zoeken', 'analytical', false, true,
   'Een collega zonder eigen agenda-scope mag hier geen afspraken uit Jelle''s agenda terugkrijgen, en de agenda-tool moet wel gebeld zijn (anders is 0 rijen een valse groen).',
   '{"expect_tools_include":["calendar_search"],"expect_max_rows":0}'::jsonb,
   '{}'::jsonb,
   '2026-09-07 (06e): nieuwe Jay-arm. Rood tot rag-chat/agentic.ts p_caller_user_id meegeeft aan analytics_calendar_search (spoor 03/04). Gemeten vertrekpunt: Jay 8 rijen, Jelle 8 rijen.',
   'chat', 'agenda', 'collega_beperkt', 'todo', ARRAY['agenda','identiteit','negatief'], '1.1'),
  ('MA49',
   'Hoeveel klantgesprekken stonden er de afgelopen maand in de agenda?',
   'agenda', 'midden', 'search', 'zoeken', 'analytical', false, true,
   'Zelfde negatieve controle als MA48, maar met een telvraag: een collega zonder agenda-scope mag geen aantal uit Jelle''s agenda kunnen noemen.',
   '{"expect_tools_include":["calendar_search"],"expect_max_rows":0}'::jsonb,
   '{}'::jsonb,
   '2026-09-07 (06e): nieuwe Jay-arm, telvariant. Rood tot p_caller_user_id bedraad is (spoor 03/04).',
   'chat', 'agenda', 'collega_beperkt', 'todo', ARRAY['agenda','identiteit','negatief'], '1.1')
ON CONFLICT (id) DO NOTHING;

-- ─── RO55 wordt NIET toegevoegd, en dit is de meting die dat besluit ────────
-- EVAL-GATES 06c §3 stelt RO55 voor: "filter_sources=['meeting'] mag met
-- max_per_record niet boven 2 per record uitkomen". Dat is LETTERLIJK wat RO52 al
-- assert: `{"expect_min_chunks":5,"must_include_source":"meeting","max_chunks_per_record":2}`
-- met `options {"top_k":40,"filter_sources":["meeting"]}` — en RO52 is groen.
-- RO55 zou dus een duplicaat zijn.
-- Wat C14 écht meetbaar zou maken is een PLAFOND op het bundel-volume: de 23 (nu 25)
-- evalbundels die α's uitzondering raken hebben 40 meeting-chunks en gemiddeld
-- 46.145 tekens. De runner kent `expect_min_chunks` (een bodem) maar heeft geen
-- `expect_max_chunks`. Die sleutel toevoegen betekent rag-eval-cron/asserts.ts
-- wijzigen — de SCORER — tussen de nul- en de ná-meting van deze PR, en dan zijn
-- vóór en ná niet meer door dezelfde code beoordeeld. Dat kost meer dan RO55
-- oplevert. Overdracht: spoor 01 voegt `expect_max_chunks` toe, 06f-α gebruikt het.

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907065000', '06c_06e_bank')
ON CONFLICT (version) DO NOTHING;
