-- =====================================================================
-- AutoDraft v2 — Fase 1C: autodraft_categories schema-uitbreiding +
-- 8 nieuwe categorieën (15 t/m 22 uit Confluence 450494465)
-- =====================================================================
-- Uitbreiding voor deterministisch pre-classifier filteren (~30-50% van
-- mails wordt zo uit Sonnet-scope gehaald). Plus haakjes voor Outlook-
-- kleurlabel-mapping (open vraag #1 voor Jelle).
--
-- Bron-doc: https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/450494465
-- =====================================================================

-- 1. Nieuwe kolommen — allemaal nullable / met default
ALTER TABLE public.autodraft_categories
  ADD COLUMN IF NOT EXISTS detect_rules         jsonb   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS outlook_color_hint   text,
  ADD COLUMN IF NOT EXISTS confidence_floor     numeric NOT NULL DEFAULT 0.4,
  ADD COLUMN IF NOT EXISTS priority_signals     text[];

COMMENT ON COLUMN public.autodraft_categories.detect_rules IS
  'Gestructureerde matching die deterministisch loopt vóór Sonnet. '
  'Velden (alle optioneel): is_calendar_invite (bool), '
  'subject_starts_with (text[]), subject_not_starting_with (text[]), '
  'sender_email_pattern (text), sender_domain_pattern (text), '
  'attachment_types (text[]), closing_pattern (bool), ooo_pattern (bool), '
  'cancel_pattern (bool). Pas als geen rule matcht of confidence-floor niet '
  'gehaald wordt, fallback naar LLM-classifier.';

COMMENT ON COLUMN public.autodraft_categories.outlook_color_hint IS
  'Bij welke Outlook-categorie-kleur (handmatig label op de mail) hoort deze '
  'category-key. Bv. "Rode categorie" = aandeelhouder, "Blauwe categorie" = '
  'klant_pilot. OPEN VRAAG voor Jelle — mapping nog niet bevestigd '
  '(Confluence 450494465 §"Open eindjes" #1).';

COMMENT ON COLUMN public.autodraft_categories.confidence_floor IS
  'Minimum classifier-confidence om deze categorie te kiezen. Pre-filter '
  'mag deze waarde overschrijven met deterministic=true.';

COMMENT ON COLUMN public.autodraft_categories.priority_signals IS
  'Sleutelwoorden / sender-patronen die voor de classifier deze categorie '
  'sterk suggereren — meegestuurd als hints in de prompt.';

-- 2. Index voor outlook_color_hint lookups
CREATE INDEX IF NOT EXISTS idx_autodraft_categories_outlook_color
  ON public.autodraft_categories (outlook_color_hint)
  WHERE outlook_color_hint IS NOT NULL;

-- =====================================================================
-- 3. Backfill detect_rules voor bestaande categorieën waar we vandaag
--    al deterministische regels in src/lib/autodraft.js hebben staan
-- =====================================================================

-- aandeelhouder: hardcoded e-mail-set in src/lib/autodraft.js
-- (zie open vraag #6: verhuizen naar detect_rules of laten?)
-- Voorlopig: lege detect_rules, hold tot Jelle bevestigt verhuizing.

-- nieuwsbrief + notificatie: domein-patronen (best-effort, kan Jelle verfijnen)
UPDATE public.autodraft_categories
   SET detect_rules = jsonb_build_object(
         'sender_keywords', ARRAY['newsletter','nieuwsbrief','unsubscribe','mailchimp','marketing'],
         'mass_mail_hint', true
       )
 WHERE category_key = 'nieuwsbrief'
   AND detect_rules = '{}'::jsonb;

UPDATE public.autodraft_categories
   SET detect_rules = jsonb_build_object(
         'sender_keywords', ARRAY['noreply','no-reply','notify','notification','automated'],
         'sender_domain_pattern', '^(noreply|no-reply|notify|notifications?)@.*$'
       )
 WHERE category_key = 'notificatie'
   AND detect_rules = '{}'::jsonb;

-- =====================================================================
-- 4. Nieuwe categorieën — 15 t/m 22
-- =====================================================================
-- detect_rules vullen we hier zo concreet mogelijk; pre-classifier in
-- de skill (Fase 2) interpreteert deze velden.
-- =====================================================================

INSERT INTO public.autodraft_categories
  (category_key, label, default_action, default_target_folder, default_audience,
   sort_order, active, source, detect_rules, priority_signals)
VALUES
  -- 15. calendar_invite
  ('calendar_invite', 'Kalenderuitnodiging', 'flag',
   NULL, 'for_you',
   200, true, 'seeded',
   jsonb_build_object(
     'is_calendar_invite', true,
     'subject_not_starting_with', ARRAY['Geaccepteerd:','Geweigerd:','Voorlopig:','Geannuleerd:']
   ),
   ARRAY['attachment_ics','sender_in_calendar_attendees']),

  -- 16. calendar_response
  ('calendar_response', 'Kalender-reactie (geaccepteerd/geweigerd)', 'skip',
   'Archive', 'not_for_you',
   201, true, 'seeded',
   jsonb_build_object(
     'is_calendar_invite', true,
     'subject_starts_with', ARRAY['Geaccepteerd:','Geweigerd:','Voorlopig:']
   ),
   ARRAY['rsvp_response']),

  -- 17. automatic_reply (out-of-office)
  ('automatic_reply', 'Out of office / automatisch antwoord', 'skip',
   'Archive', 'not_for_you',
   202, true, 'seeded',
   jsonb_build_object(
     'ooo_pattern', true,
     'subject_pattern', '\b(out of office|automatic reply|auto[-\s]?reply|automatisch antwoord|automatische reactie|afwezig(heidsmelding)?|on (annual )?leave|on holiday|holiday reply|otto|otho|ferien)\b'
   ),
   ARRAY['ooo_subject','ooo_body']),

  -- 18. cancelled_invite
  ('cancelled_invite', 'Geannuleerde kalenderuitnodiging', 'skip',
   'Archive', 'not_for_you',
   203, true, 'seeded',
   jsonb_build_object(
     'cancel_pattern', true,
     'subject_pattern', '^(canceled|cancelled|geannuleerd|annulering|annuleren):'
   ),
   ARRAY['cancellation']),

  -- 19. closing_mail
  ('closing_mail', 'Afsluitende mail (geen vraag, korte ack)', 'skip',
   'Archive', 'not_for_you',
   204, true, 'seeded',
   jsonb_build_object(
     'closing_pattern', true,
     'no_question_mark', true,
     'max_body_chars', 500
   ),
   ARRAY['closing_opener','closing_decision','closing_time']),

  -- 20. bounce
  ('bounce', 'Bounce / undeliverable', 'skip',
   'Archive', 'not_for_you',
   205, true, 'seeded',
   jsonb_build_object(
     'sender_email_pattern', '(mailer-daemon|postmaster)@',
     'subject_keywords', ARRAY['undeliverable','undelivered','delivery has failed','niet bezorgd']
   ),
   ARRAY['mailer_daemon']),

  -- 21. delivery_report
  ('delivery_report', 'Delivery-/leesbevestiging', 'skip',
   'Archive', 'not_for_you',
   206, true, 'seeded',
   jsonb_build_object(
     'subject_starts_with', ARRAY['Delivery','Read Receipt','Read:','Bezorgd:','Gelezen:'],
     'is_system_generated', true
   ),
   ARRAY['delivery_receipt']),

  -- 22. personal
  ('personal', 'Persoonlijke mail (familie/vrienden)', 'flag',
   'Inbox', 'for_you',
   207, true, 'seeded',
   jsonb_build_object(
     'requires_personal_domain_match', true
   ),
   ARRAY['personal_contact'])

ON CONFLICT (category_key) DO NOTHING;

-- =====================================================================
-- END
-- =====================================================================
