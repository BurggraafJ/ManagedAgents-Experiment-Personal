-- =====================================================================
-- AutoDraft v2 — Fase 1A: autodraft_actions catalog + 10 seed-rijen
-- =====================================================================
-- Catalog-tabel die de zes-categorieën-taxonomie uit Confluence 443809794
-- in DB-vorm zet. Classifier leest enabled-rijen via get_enabled_actions()
-- en bouwt zijn prompt op basis hiervan. UI (Fase 4) beheert deze tabel.
--
-- Taxonomie: reply | forward | file | schedule | delegate | defer
-- Seed: 10 default-acties (zie Antwoord 4 in Confluence-pagina).
--
-- Naming-conventie volgens autodraft_* prefix. Pattern A RLS
-- (service-role schrijft, authenticated leest). Geen PII in deze tabel —
-- alleen catalog-config.
--
-- Bron-doc: https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/443809794
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.autodraft_actions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text UNIQUE NOT NULL,
  category                text NOT NULL,
  display_name            text NOT NULL,
  description             text,
  -- payload-template + targets
  target_type             text,
  target_value            text,
  template                jsonb DEFAULT '{}'::jsonb,
  -- gedrag voor classifier-prompt
  prompt_hint             text,
  example_snippet         text,
  conditions              jsonb DEFAULT '{}'::jsonb,
  confidence_threshold    numeric NOT NULL DEFAULT 0.4,
  enabled                 boolean NOT NULL DEFAULT true,
  is_default              boolean NOT NULL DEFAULT false,
  -- stats (worden via decisions geüpdatet)
  suggested_count         integer NOT NULL DEFAULT 0,
  accepted_count          integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- CHECK: category in de zes hoofdwaarden
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'autodraft_actions_category_check'
  ) THEN
    ALTER TABLE public.autodraft_actions
      ADD CONSTRAINT autodraft_actions_category_check
      CHECK (category IN ('reply','forward','file','schedule','delegate','defer'));
  END IF;
END $$;

-- CHECK: target_type binnen vaste set (NULL toegestaan voor reply.*)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'autodraft_actions_target_type_check'
  ) THEN
    ALTER TABLE public.autodraft_actions
      ADD CONSTRAINT autodraft_actions_target_type_check
      CHECK (target_type IS NULL OR target_type IN (
        'email','folder','jira_project','hubspot_object','skill','none'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_autodraft_actions_enabled
  ON public.autodraft_actions (enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_autodraft_actions_category
  ON public.autodraft_actions (category);

COMMENT ON TABLE public.autodraft_actions IS
  'AutoDraft v2 catalog van mogelijke acties die de classifier kan voorstellen. '
  'Zes-categorieën-taxonomie (reply/forward/file/schedule/delegate/defer) met '
  '~24 sub-typen mogelijk. Skill leest enabled rijen via get_enabled_actions() '
  'en geeft ze mee in de prompt-context. UI (Fase 4) beheert deze tabel via '
  'route /autodraft-actions. Bron-doc: Confluence 443809794.';

COMMENT ON COLUMN public.autodraft_actions.slug IS
  'Unieke identifier, dot-syntax met categorie als prefix. Bv. "forward.finance". '
  'Wordt gebruikt als FK in autodraft_action_decisions.action_slug.';

COMMENT ON COLUMN public.autodraft_actions.template IS
  'Parametriseerbare payload-template per actie. Bv. voor forward: '
  '{"to":[],"cc":[],"cover_text":"<template>","attach_original":true}.';

COMMENT ON COLUMN public.autodraft_actions.conditions IS
  'Rule-engine criteria die de classifier-prompt aanvullen. '
  'Velden: sender_domain_pattern, attachment_types, keyword_triggers, '
  'linked_entity_type. Geen runtime-evaluator — alleen prompt-aanvulling.';

COMMENT ON COLUMN public.autodraft_actions.confidence_threshold IS
  'Minimum classifier-confidence voor deze actie. <0.4 wordt onderdrukt.';

COMMENT ON COLUMN public.autodraft_actions.is_default IS
  'true = seeded met deze migration, geen Jelle-creatie. false = via UI '
  'toegevoegd. Bepaalt of de actie verwijderbaar is via beheerpagina.';

-- RLS — Pattern A (service-role write, authenticated read)
ALTER TABLE public.autodraft_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autodraft_actions' AND policyname = 'autodraft_actions_service'
  ) THEN
    CREATE POLICY autodraft_actions_service
      ON public.autodraft_actions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'autodraft_actions' AND policyname = 'autodraft_actions_authenticated'
  ) THEN
    CREATE POLICY autodraft_actions_authenticated
      ON public.autodraft_actions FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- set_updated_at trigger (idempotent — drop + create)
DROP TRIGGER IF EXISTS set_updated_at_autodraft_actions ON public.autodraft_actions;
CREATE TRIGGER set_updated_at_autodraft_actions
  BEFORE UPDATE ON public.autodraft_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Seed — 10 default-acties (idempotent via ON CONFLICT DO NOTHING)
-- =====================================================================

INSERT INTO public.autodraft_actions
  (slug, category, display_name, description, target_type, target_value,
   prompt_hint, example_snippet, conditions, is_default, enabled)
VALUES
  -- 1. reply.kort
  ('reply.kort', 'reply', 'Reply — kort',
   'Korte reply (1-3 zinnen), zakelijk, geen overbodige uitleg.',
   'none', NULL,
   'Default voor onbekende afzender + kort onderwerp. Houd het bondig — maximaal drie zinnen.',
   'Dank, ontvangen. Ik kom hier binnen 24 uur op terug.',
   '{}'::jsonb,
   true, true),

  -- 2. reply.neutraal
  ('reply.neutraal', 'reply', 'Reply — neutraal',
   'Reply in standaard-toon, 4-8 zinnen, bekende afzender.',
   'none', NULL,
   'Default voor bekende afzender + standaard onderwerp. Toon: zakelijk-vriendelijk.',
   'Dank voor je mail. Ik heb je vraag opgepakt en kom morgen met een voorstel terug.',
   '{}'::jsonb,
   true, true),

  -- 3. reply.uitgebreid
  ('reply.uitgebreid', 'reply', 'Reply — uitgebreid',
   'Uitgebreide reply, meerdere paragrafen, voor lange threads of meervoudige vragen.',
   'none', NULL,
   'Voor lange threads of mails met meerdere expliciete vragen. Behandel elke vraag in een eigen paragraaf.',
   NULL,
   '{"min_questions":2,"min_body_chars":500}'::jsonb,
   true, true),

  -- 4. forward.finance — TODO Jelle: bevestig email (finance@legal-mind.nl of Tessa-direct)
  ('forward.finance', 'forward', 'Doorsturen naar finance',
   'Doorsturen naar Tessa (finance@legal-mind.nl) voor boekhouding/fiscaliteit. '
   'Optionele cover-tekst.',
   'email', 'finance@legal-mind.nl',
   'Bijlage = factuur/PDF/XLS, of sender = bank/btw/leverancier. Cover-tekst kort en duidelijk.',
   'Tessa, hier de Q1-bevestiging — kan deze in de map?',
   '{"sender_keywords":["factuur","btw","bank","boekhoud"],"attachment_types":["pdf","xlsx","xls"]}'::jsonb,
   true, true),

  -- 5. forward.hr — TODO Jelle: bevestig email (personeel@legal-mind.nl of HR-direct)
  ('forward.hr', 'forward', 'Doorsturen naar HR',
   'Doorsturen naar Tessa (personeel@legal-mind.nl) voor salaris/verlof/ziekmelding.',
   'email', 'personeel@legal-mind.nl',
   'Onderwerp bevat salaris/verlof/ziekmelding/personeelszaken.',
   NULL,
   '{"sender_keywords":["salaris","verlof","ziekmelding","personeel","HR"]}'::jsonb,
   true, true),

  -- 6. file.in-afwachting
  ('file.in-afwachting', 'file', 'Verplaatsen naar In Afwachting',
   'Mail wijst op "wij komen erop terug" — wegzetten zodat hij niet vergeten '
   'wordt maar de inbox leeg blijft.',
   'folder', 'Inbox/In Afwachting',
   'Mail eindigt met "we komen erop terug" / "later deze week" / "morgen meer". '
   'Geen reply nodig, alleen folder-move.',
   NULL,
   '{"closing_pattern":true}'::jsonb,
   true, true),

  -- 7. file.archive
  ('file.archive', 'file', 'Archiveren',
   'Direct naar Archive. Voor nieuwsbrief / mass-mail / promo waar geen actie nodig is.',
   'folder', 'Archive',
   'Nieuwsbrief / mass-mail / promotional. Sender = lijst, ontvanger ≠ "to: jelle direct".',
   NULL,
   '{"mass_mail":true}'::jsonb,
   true, true),

  -- 8. file.client-known — dynamische target, classifier kiest folder uit autodraft_folders
  ('file.client-known', 'file', 'Verplaatsen naar klant-map',
   'Sender hoort bij bekende klant — verplaats naar de klant-specifieke map. '
   'Folder wordt door de classifier gekozen uit autodraft_folders met '
   'sender-domein-match.',
   'folder', NULL,
   'Sender-domein matcht een bekende klant-map. Geen reply, alleen filing.',
   NULL,
   '{"requires_klant_match":true}'::jsonb,
   true, true),

  -- 9. delegate.jira-lemind — TODO Jelle: bevestig default-project
  ('delegate.jira-lemind', 'delegate', 'Jira-issue in Lemind',
   'Maak een Jira-issue aan in Lemind-project. Voor bug-rapport, feature-request '
   'of klant-vraag die team-actie vereist.',
   'jira_project', 'LEMIND',
   'Onderwerp wijst op bug-rapport / feature-request / product-issue. '
   'Issue title = mail-subject, body = mail-body samengevat.',
   NULL,
   '{"keywords":["bug","fout","werkt niet","feature","verzoek"]}'::jsonb,
   true, true),

  -- 10. defer.decline
  ('defer.decline', 'defer', 'Beleefde nee + decline-folder',
   'Beleefde nee-reply (sales-pitch / cold-outreach) + verplaatsen naar '
   'Decline-folder. Combinatie van mini-reply + folder-move.',
   'folder', 'Inbox/Decline',
   'Sales-pitch / cold-outreach. Beleefd, kort, definitief.',
   'Dank voor je bericht. Op dit moment is dit niet relevant voor ons.',
   '{"cold_outreach":true}'::jsonb,
   true, true)

ON CONFLICT (slug) DO NOTHING;

-- =====================================================================
-- END
-- =====================================================================
