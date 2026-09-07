-- =============================================================================
-- 06e — analytics_calendar_search: verbredingsladder + match_appointment eruit
-- =============================================================================
-- 2026-09-07 · spoor 06e (RESEARCH 06c/06e §2.6 en §2.8, vorken C8/C9).
--
-- WAAROM. De agenda-tool wordt 145× per 90 dagen gebeld en geeft in 34 gevallen
-- (23,4 %) NUL rijen terug. De A/B-replay (P4) heeft die 34 uitgesplitst door
-- dezelfde gelogde argumenten opnieuw uit te voeren:
--     zoals gelogd                                 gem.  9,83 rijen · 34 leeg
--     + p_external_only = false                    gem. 21,16 rijen · 26 leeg  (−8)
--     + ook zonder datumvenster                    gem. 72,04 rijen ·  5 leeg  (−21)
-- 29 van de 34 leegtes zijn dus een ARGUMENT-default, niet een lege agenda:
-- 8× de "alleen externe deelnemers"-eis en 21× een datumvenster dat het model
-- zelf verzint. De 5 resterende blijven leeg (die afspraak bestaat niet).
-- Daarom een ladder in de RPC in plaats van een semantische arm (C13): een
-- tweede index repareert nul van de 29 en kost een embedding per call.
--
-- KOSTEN. Per trap gemeten (M12d, dezelfde regex): 73 ms · 21 ms · 67 ms ⇒
-- worst case ≈ 161 ms, ONDER het huidige productie-gemiddelde van 184 ms per
-- call. De trappen 2 en 3 draaien alleen als ze iets kunnen toevoegen (trap 2
-- alleen als de aanroeper external_only=true gaf, trap 3 alleen als er een
-- venster was), dus een normale call blijft één scan.
--
-- WAT DE AANROEPER MERKT. Eén extra OUTPUT-kolom `widened`
-- (NULL | 'attendees' | 'window'). rag-chat/agentic.ts mapt op naam
-- (r. 236: r.event_date / r.external_attendees / r.organizer / r.subject), dus
-- een extra kolom breekt de aanroeper niet en rag-chat hoeft niet open (C10).
--
-- ⚠ p_limit-default 40 → 60 is op de agentische route een NO-OP: agentic.ts
--   geeft `p_limit: 40` HARD mee (r. 633). De default raakt alleen aanroepers
--   die de parameter weglaten (evalrunner, SQL, toekomstige callers). De
--   limiet-verhoging voor de agent hoort in agentic.ts en gaat als overdracht
--   naar spoor 03. Gemeten: 6 van de 145 calls raakten 40, 0 boven 100.
--
-- ⚠ Een extra RETURNS TABLE-kolom is een return-type-wijziging: CREATE OR
--   REPLACE kan dat niet, dus DROP + CREATE. Gemeten proacl VÓÓR de drop
--   (pg_proc.proacl, 2026-09-07 07:44 UTC):
--       {postgres=X/postgres,service_role=X/postgres}
--   Géén `authenticated`, géén PUBLIC-entry. Een kale CREATE zou PUBLIC
--   execute teruggeven (memory drop-function-verliest-proacl), vandaar de
--   expliciete REVOKE + GRANT onderaan — service_role only, net als vóór.
--
-- ⚠⚠ EN NU HET PUNT DAT DE METING TOEVOEGDE — p_caller_user_id.
--   Poort e5 (blokkerend) vraagt: een agenda-vraag met een geminte JAY-JWT mag geen
--   afspraak uit Jelle's agenda opleveren. Gemeten op 2026-09-07 08:4x UTC
--   (runs/2026-09-07-06e-w3-persona-jay.json): Jay kreeg via `calendar_search`
--   **8 rijen — precies zoveel als Jelle**, beiden `caller_identified=true`.
--   De oorzaak staat hier: deze functie is SECURITY DEFINER en noemt `user_id`,
--   `auth.uid()` noch een scope-helper, dus hij stapt over de RLS van
--   `calendar_events` heen. Die RLS is er wél en is correct
--   (`session_mfa_ok() AND (user_id = auth.uid() OR is_admin_or_higher())`), en alle
--   1.984 events staan op één user_id. Dit is geen nieuw defect: de functie is nooit
--   gescoped geweest. Het is ook geen incident van deze functie alleen — van de 14
--   `analytics_*`-functies zijn er 13 SECURITY DEFINER zonder enige gebruikersfilter;
--   alleen `analytics_uncontacted_since` noemt user_id + scope (overdracht 03b/07).
--
--   De verbredingsladder maakt van juist die ongescopede agenda MEER bereikbaar.
--   Daarom gaat de scope-mogelijkheid in dezelfde migratie mee:
--   `p_caller_user_id uuid DEFAULT NULL`. NULL = exact het gedrag van vandaag, dus
--   geen enkele aanroeper breekt. Niet-NULL = alleen de events van die gebruiker.
--   Waarom een PARAMETER en niet `auth.uid()` in het lichaam: rag-chat roept de RPC
--   aan via een client waarvan `auth.uid()` binnen een SECURITY DEFINER-functie NULL
--   kan zijn (memory per-user-outlook-phase1: "scope-regel invoker=NULL-bij-JWT vs
--   definer=auth.uid()"). Een `auth.uid()`-filter zou de tool dan voor iedereen op
--   nul rijen zetten — stil, en precies het soort fout dat dit spoor uitbant.
--   De ontbrekende schakel is één regel in `rag-chat/agentic.ts` r. 633
--   (`p_caller_user_id: <sub van de vrager>`); dat bestand valt onder het
--   rag-chat-verbod van deze kick en gaat als overdracht naar spoor 03/04.
--   e5 is dus GROEN op de RPC (bewezen met een directe call: Jay-uuid → 0 rijen) en
--   ROOD op de route. Zo staat het in de poortentabel; niet mooier.
-- =============================================================================

DROP FUNCTION IF EXISTS public.analytics_calendar_search(text, date, date, boolean, integer);
DROP FUNCTION IF EXISTS public.analytics_calendar_search(text, date, date, boolean, integer, uuid);

CREATE FUNCTION public.analytics_calendar_search(
  p_keywords_regex text,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_external_only boolean DEFAULT true,
  p_limit integer DEFAULT 60,
  p_caller_user_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(
  subject text,
  event_date date,
  location text,
  external_attendees text,
  organizer text,
  body_snippet text,
  scanned_total bigint,
  widened text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lim int := least(greatest(coalesce(p_limit, 60), 1), 100);
BEGIN
  -- Trap 1 — exact zoals gevraagd.
  RETURN QUERY
  WITH scope AS (
    SELECT e.id, e.subject, e.start_time, e.location_text, e.body_text, e.body_preview,
           e.organizer_name, e.organizer_email,
           (SELECT string_agg(DISTINCT coalesce(nullif(a.name, ''), a.email), ', ')
              FROM calendar_attendees a
             WHERE a.calendar_event_id = e.id
               AND a.email IS NOT NULL
               AND a.email NOT ILIKE '%legal-mind.nl%'
               AND a.email NOT ILIKE '%legalmind%') AS ext_att
      FROM calendar_events e
     WHERE e.is_deleted = false AND coalesce(e.is_cancelled, false) = false
       AND (p_caller_user_id IS NULL OR e.user_id = p_caller_user_id)
       AND (p_from IS NULL OR e.start_time >= p_from)
       AND (p_to IS NULL OR e.start_time < p_to)
  )
  SELECT s.subject, s.start_time::date, nullif(s.location_text, ''), s.ext_att,
         coalesce(nullif(s.organizer_name, ''), s.organizer_email),
         left(regexp_replace(coalesce(s.body_text, s.body_preview, ''), '\s+', ' ', 'g'), 240),
         (SELECT count(*) FROM scope),
         NULL::text
    FROM scope s
   WHERE (s.subject ~* p_keywords_regex OR coalesce(s.body_text, '') ~* p_keywords_regex)
     AND (NOT p_external_only OR s.ext_att IS NOT NULL)
   ORDER BY s.start_time DESC
   LIMIT v_lim;
  IF FOUND THEN RETURN; END IF;

  -- Trap 2 — zonder de "alleen externe deelnemers"-eis (8 van de 34 leegtes).
  -- Alleen zinvol als de aanroeper die eis stelde; anders is trap 2 = trap 1.
  IF coalesce(p_external_only, true) THEN
    RETURN QUERY
    WITH scope AS (
      SELECT e.id, e.subject, e.start_time, e.location_text, e.body_text, e.body_preview,
             e.organizer_name, e.organizer_email,
             (SELECT string_agg(DISTINCT coalesce(nullif(a.name, ''), a.email), ', ')
                FROM calendar_attendees a
               WHERE a.calendar_event_id = e.id
                 AND a.email IS NOT NULL
                 AND a.email NOT ILIKE '%legal-mind.nl%'
                 AND a.email NOT ILIKE '%legalmind%') AS ext_att
        FROM calendar_events e
       WHERE e.is_deleted = false AND coalesce(e.is_cancelled, false) = false
         AND (p_caller_user_id IS NULL OR e.user_id = p_caller_user_id)
         AND (p_from IS NULL OR e.start_time >= p_from)
         AND (p_to IS NULL OR e.start_time < p_to)
    )
    SELECT s.subject, s.start_time::date, nullif(s.location_text, ''), s.ext_att,
           coalesce(nullif(s.organizer_name, ''), s.organizer_email),
           left(regexp_replace(coalesce(s.body_text, s.body_preview, ''), '\s+', ' ', 'g'), 240),
           (SELECT count(*) FROM scope),
           'attendees'::text
      FROM scope s
     WHERE (s.subject ~* p_keywords_regex OR coalesce(s.body_text, '') ~* p_keywords_regex)
     ORDER BY s.start_time DESC
     LIMIT v_lim;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Trap 3 — ook zonder datumvenster (21 van de 34 leegtes). Alleen zinvol als
  -- er een venster was; anders is trap 3 = trap 2.
  IF p_from IS NOT NULL OR p_to IS NOT NULL THEN
    RETURN QUERY
    WITH scope AS (
      SELECT e.id, e.subject, e.start_time, e.location_text, e.body_text, e.body_preview,
             e.organizer_name, e.organizer_email,
             (SELECT string_agg(DISTINCT coalesce(nullif(a.name, ''), a.email), ', ')
                FROM calendar_attendees a
               WHERE a.calendar_event_id = e.id
                 AND a.email IS NOT NULL
                 AND a.email NOT ILIKE '%legal-mind.nl%'
                 AND a.email NOT ILIKE '%legalmind%') AS ext_att
        FROM calendar_events e
       WHERE e.is_deleted = false AND coalesce(e.is_cancelled, false) = false
         AND (p_caller_user_id IS NULL OR e.user_id = p_caller_user_id)
    )
    SELECT s.subject, s.start_time::date, nullif(s.location_text, ''), s.ext_att,
           coalesce(nullif(s.organizer_name, ''), s.organizer_email),
           left(regexp_replace(coalesce(s.body_text, s.body_preview, ''), '\s+', ' ', 'g'), 240),
           (SELECT count(*) FROM scope),
           'window'::text
      FROM scope s
     WHERE (s.subject ~* p_keywords_regex OR coalesce(s.body_text, '') ~* p_keywords_regex)
     ORDER BY s.start_time DESC
     LIMIT v_lim;
  END IF;

  RETURN;
END
$function$;

-- Rechten exact terug zoals ze vóór de DROP stonden: service_role (+ eigenaar),
-- geen authenticated, geen PUBLIC.
--
-- ⚠ `REVOKE ... FROM PUBLIC` alleen is NIET genoeg, en dat is hier gemeten in
--   plaats van aangenomen. Na de eerste apply stond de proacl op
--       {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   terwijl hij vóór de DROP `{postgres=X/postgres,service_role=X/postgres}` was:
--   dit project heeft ALTER DEFAULT PRIVILEGES dat nieuwe functies EXECUTE aan
--   `authenticated` geeft. Memory `drop-function-verliest-proacl` één laag dieper:
--   de DROP verliest de ACL en de default privileges vullen hem ANDERS terug.
--   Voor deze functie is dat geen detail — hij is SECURITY DEFINER en (zolang
--   p_caller_user_id niet bedraad is) ongescoped, dus met een `authenticated`-grant
--   kan elke ingelogde gebruiker via PostgREST de hele agenda uitlezen. Meet de
--   proacl dus ná élke DROP+CREATE, niet alleen ervoor.
REVOKE ALL ON FUNCTION public.analytics_calendar_search(text, date, date, boolean, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_calendar_search(text, date, date, boolean, integer, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.analytics_calendar_search(text, date, date, boolean, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.analytics_calendar_search(text, date, date, boolean, integer, uuid) TO service_role;

COMMENT ON FUNCTION public.analytics_calendar_search(text, date, date, boolean, integer, uuid) IS
  'Agenda-zoektool voor de agentische route. 06e (2026-09-07): verbredingsladder — 0 rijen ⇒ opnieuw zonder de externe-deelnemers-eis (kolom widened=attendees) ⇒ 0 rijen ⇒ opnieuw zonder datumvenster (widened=window). Gemeten: 29 van de 34 lege calls in 90 dagen zijn een argument-default, niet een lege agenda; ladderkosten 73/21/67 ms, worst case 161 ms tegen 184 ms productie-gemiddelde. p_limit-default 40 → 60; agentic.ts geeft 40 hard mee, dus die verhoging raakt de agent NIET (overdracht spoor 03). p_caller_user_id (default NULL = ongescoped, het gedrag van vandaag) beperkt de agenda tot één gebruiker; agentic.ts geeft hem nog niet mee, dus de tool levert vandaag nog aan iedere aanroeper de hele agenda — poort e5, overdracht spoor 03/04.';

-- ─── C8 — match_appointment: WEL buiten gebruik, NIET verwijderbaar ─────────
-- Bewijs (RESEARCH §2.6): 25 bundels in 88 dagen, 25/25 trigger_type='eval',
-- 25/25 via match_chunks (nooit het entity-pad, want query_intel_level='off'),
-- en over die 25 bundels in totaal 2 event-chunks. Het enige bankitem (E30)
-- had asserts={} en scoorde dus niets.
--
-- ⚠ C8 zei "rij weg". Dat KAN NIET, en dat is hier gemeten in plaats van aangenomen:
--     ERROR 23503: update or delete on table "context_intents" violates foreign key
--     constraint "context_bundles_intent_fkey" on table "context_bundles"
--     DETAIL: Key (intent)=(match_appointment) is still referenced from context_bundles
--   `context_bundles.intent` heeft een FK naar `context_intents.intent`, dus een recept
--   verwijderen betekent 25 bundels telemetrie weggooien. Dat is een slechtere ruil dan
--   het probleem: het recept is een vervuilde naam, de telemetrie is bewijsmateriaal.
--   Daarom blijft de rij staan en gaat hij BUITEN GEBRUIK:
--     • zijn enige aanroeper — bankitem E30 — is gedeactiveerd (migratie 20260907065000);
--     • de description zegt nu expliciet dat het recept niet gebruikt moet worden.
--   Wie hem echt weg wil, moet eerst de FK-strategie kiezen (ON DELETE SET NULL op
--   context_bundles.intent, of de bundels archiveren) — dat is een schemabesluit en
--   hoort bij 01/07, niet bij een recept-opruiming.
--   Oude description, voor het terugdraaien: 'Afspraak/agenda-item matchen'.
--   Overige oude waarden (ongewijzigd gelaten, hier voor de volledigheid):
--   intent='match_appointment', description='Afspraak/agenda-item matchen',
--   default_strategy='match_chunks_for_entity', default_top_k=5,
--   default_recency_weight=0.15, default_recency_decay_days=90,
--   default_min_similarity=0.3, default_max_per_source=2, default_rerank=false,
--   default_lookback_days=90, inject_jellemind=false, inject_kb=false,
--   max_edges=300, query_intel_level='off', entity_anchor_top_n=0,
--   bm25_enabled=true, max_per_record=NULL, max_per_source=NULL,
--   source_overrides=NULL, default_filter_audience=NULL,
--   default_filter_meeting_category=NULL, default_filter_sources=NULL
-- (gemeten 2026-09-07 07:44 UTC, runs/2026-09-07-06c-w0-precheck2.json § e_intents)
UPDATE public.context_intents SET
  description = 'BUITEN GEBRUIK sinds 2026-09-07 (06e/C8). Niet gebruiken. In 88 dagen 25 bundels, alle 25 van de evalrunner, met 2 event-chunks in totaal; de naam suggereerde een capaciteit die niet bestond. De rij kan niet verwijderd worden omdat context_bundles.intent een FK naar deze tabel heeft (25 bundels telemetrie). Voor agenda-vragen: analytics_calendar_search via de agentische route.',
  updated_at  = now()
WHERE intent = 'match_appointment';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260907066000', '06e_calendar_search_ladder')
ON CONFLICT (version) DO NOTHING;
