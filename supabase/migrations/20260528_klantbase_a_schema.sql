-- ===========================================================================
-- 20260528_klantbase_a_schema.sql
-- Project: Klantbase verrijking & verlenging — Fase 2 DB-laag
-- Confluence: 461766657
--
-- Creates:
--   • 3 tabellen — klantbase_field_definitions, klantbase_proposals, klantbase_field_proposals
--   • RLS-policies (pattern: user_id = auth.uid())
--   • 8 RPCs — request/accept/approve/reject/dismiss/rerun
--   • Seed: 19 field_definitions uit src/components/views/klantbase/klantbase-data.js
--
-- Idempotent: gebruikt CREATE TABLE IF NOT EXISTS + ON CONFLICT op seed.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. klantbase_field_definitions — globale veld-catalog (geen RLS user-scope)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.klantbase_field_definitions (
  key              text PRIMARY KEY,
  label            text NOT NULL,
  field_type       text NOT NULL CHECK (field_type IN ('euro','int','date','select','percent','text')),
  group_name       text NOT NULL,
  options          jsonb NOT NULL DEFAULT '[]'::jsonb,
  xor_with         text,                                       -- soft self-ref (geen FK)
  computed         text,                                       -- formule-string voor UI
  required         boolean NOT NULL DEFAULT false,
  uitleg           text,
  display_order    smallint NOT NULL,
  hubspot_property text,                                       -- HubSpot deal property (vul je later)
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.klantbase_field_definitions IS
  'Single-source-of-truth voor de 19 klantbase-velden. Beheerbaar via Instellingen-pagina. Skill leest dit voor zijn extractie-prompt (Fase 3).';

ALTER TABLE public.klantbase_field_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS klantbase_field_definitions_read_all ON public.klantbase_field_definitions;
CREATE POLICY klantbase_field_definitions_read_all ON public.klantbase_field_definitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS klantbase_field_definitions_admin_write ON public.klantbase_field_definitions;
CREATE POLICY klantbase_field_definitions_admin_write ON public.klantbase_field_definitions
  FOR ALL TO authenticated
  USING (public.is_admin_or_higher())
  WITH CHECK (public.is_admin_or_higher());

-- ---------------------------------------------------------------------------
-- 2. klantbase_proposals — 1 rij per voorstel (overdracht of renewal)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.klantbase_proposals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- HubSpot anker
  hubspot_deal_id          text NOT NULL,                       -- nieuwe deal (bij renewal)
  old_hubspot_deal_id      text,                                -- alleen bij renewal
  proposal_type            text NOT NULL CHECK (proposal_type IN ('overdracht','renewal')),
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','accepted','rejected','dismissed')),
  -- Deal-snapshot (voor UI filter op deal_owner zonder runtime-join)
  deal_owner_id            text,                                -- HubSpot owner-id
  deal_owner_name          text,                                -- resolved tijdens scan
  deal_owner_email         text,
  company_name             text,
  company_domain           text,
  -- AI metadata
  ai_run_at                timestamptz NOT NULL DEFAULT now(),
  ai_sources_count         smallint NOT NULL DEFAULT 0,
  ai_summary               text,
  ai_model                 text,                                -- 'claude-sonnet-4-6' etc
  ai_confidence            numeric(3,2),                        -- 0.00-1.00 (avg over velden)
  -- Due indicator (computed door skill, gebruikt voor sortering)
  due_date                 date,
  due_label                text,                                -- 'Voor maandafsluiting' etc
  due_urgent               boolean NOT NULL DEFAULT false,
  -- Renewal-only velden
  proposed_from            date,                                -- nieuwe start (1e v/d maand)
  old_ends                 date,                                -- oude einddatum
  renewal_basis            text,                                -- text-uitleg
  -- Lifecycle
  created_at               timestamptz NOT NULL DEFAULT now(),
  accepted_at              timestamptz,
  rejected_at              timestamptz,
  dismissed_at             timestamptz,
  executed_at              timestamptz,
  manual_run_requested_at  timestamptz,                         -- trigger voor klantbase-execute
  execution_result         jsonb                                -- HubSpot API response
);

COMMENT ON TABLE public.klantbase_proposals IS
  'Voorstellen klantbase-agent: overdracht (Sales Pipeline → Customer Base) of renewal (pilot→contract). 1 rij per (user,deal,type). Status pending → accepted/rejected/dismissed. Detail-velden in klantbase_field_proposals.';

-- Unieke actieve voorstellen — geen duplicates per deal+type+user
CREATE UNIQUE INDEX IF NOT EXISTS klantbase_proposals_unique_active
  ON public.klantbase_proposals (user_id, hubspot_deal_id, proposal_type)
  WHERE status NOT IN ('rejected','dismissed');

CREATE INDEX IF NOT EXISTS idx_klantbase_proposals_user_status
  ON public.klantbase_proposals (user_id, status, ai_run_at DESC);

CREATE INDEX IF NOT EXISTS idx_klantbase_proposals_deal
  ON public.klantbase_proposals (hubspot_deal_id);

CREATE INDEX IF NOT EXISTS idx_klantbase_proposals_owner_pending
  ON public.klantbase_proposals (user_id, deal_owner_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_klantbase_proposals_execute_pending
  ON public.klantbase_proposals (manual_run_requested_at)
  WHERE manual_run_requested_at IS NOT NULL AND executed_at IS NULL;

ALTER TABLE public.klantbase_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS klantbase_proposals_user_select ON public.klantbase_proposals;
CREATE POLICY klantbase_proposals_user_select ON public.klantbase_proposals
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS klantbase_proposals_user_update ON public.klantbase_proposals;
CREATE POLICY klantbase_proposals_user_update ON public.klantbase_proposals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT/DELETE alleen via service_role (skill scan + executor)

-- ---------------------------------------------------------------------------
-- 3. klantbase_field_proposals — 1 rij per veld per voorstel (19 per proposal)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.klantbase_field_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id         uuid NOT NULL REFERENCES public.klantbase_proposals(id) ON DELETE CASCADE,
  field_key           text NOT NULL REFERENCES public.klantbase_field_definitions(key),
  proposed_value      text,                                    -- altijd text — UI parse'd zelf
  current_value       text,                                    -- voor renewal-diff; null bij overdracht
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','edited','rejected')),
  src_key             text,                                    -- primaire bron-key
  reason              text,                                    -- met {{cite}}-markers
  sources             text[] NOT NULL DEFAULT '{}',            -- alle bron-keys
  confidence          numeric(3,2),                            -- 0.00-1.00
  user_amended_value  text,                                    -- niet-null bij status=edited
  amended_at          timestamptz,
  amended_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, field_key)
);

COMMENT ON TABLE public.klantbase_field_proposals IS
  '1 rij per veld per klantbase_proposal (19 velden = 19 rijen). Bevat AI-voorstel, redenering met {{cite}}-markers, bronnen, en Jelles inline-aanpassing.';

CREATE INDEX IF NOT EXISTS idx_klantbase_field_proposals_proposal
  ON public.klantbase_field_proposals (proposal_id, field_key);

CREATE INDEX IF NOT EXISTS idx_klantbase_field_proposals_pending
  ON public.klantbase_field_proposals (proposal_id) WHERE status = 'pending';

ALTER TABLE public.klantbase_field_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS klantbase_field_proposals_user_select ON public.klantbase_field_proposals;
CREATE POLICY klantbase_field_proposals_user_select ON public.klantbase_field_proposals
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.klantbase_proposals p
             WHERE p.id = proposal_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS klantbase_field_proposals_user_update ON public.klantbase_field_proposals;
CREATE POLICY klantbase_field_proposals_user_update ON public.klantbase_field_proposals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.klantbase_proposals p
             WHERE p.id = proposal_id AND p.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.klantbase_proposals p
             WHERE p.id = proposal_id AND p.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_klantbase_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS klantbase_field_definitions_updated_at ON public.klantbase_field_definitions;
CREATE TRIGGER klantbase_field_definitions_updated_at
  BEFORE UPDATE ON public.klantbase_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.tg_klantbase_set_updated_at();

DROP TRIGGER IF EXISTS klantbase_field_proposals_updated_at ON public.klantbase_field_proposals;
CREATE TRIGGER klantbase_field_proposals_updated_at
  BEFORE UPDATE ON public.klantbase_field_proposals
  FOR EACH ROW EXECUTE FUNCTION public.tg_klantbase_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. RPCs (8) — alle SECURITY DEFINER + check auth.uid() vs user_id
-- ---------------------------------------------------------------------------

-- 5.1 request_klantbase_run() — trigger nieuwe scan via orchestrator
CREATE OR REPLACE FUNCTION public.request_klantbase_run() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'klantbase';
END $$;

-- 5.2 accept_klantbase_proposal(p_id) — markeer accepted + trigger executor
CREATE OR REPLACE FUNCTION public.accept_klantbase_proposal(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_proposals
     SET status = 'accepted', accepted_at = now()
   WHERE id = p_id AND user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal % not found or not pending for user', p_id;
  END IF;
  UPDATE public.agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'klantbase-execute';
END $$;

-- 5.3 accept_klantbase_field_with_edits(field_id, value) — inline edit
CREATE OR REPLACE FUNCTION public.accept_klantbase_field_with_edits(
  p_field_id uuid, p_value text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_field_proposals fp
     SET status = 'edited', user_amended_value = p_value, amended_at = now()
   WHERE fp.id = p_field_id
     AND EXISTS (SELECT 1 FROM public.klantbase_proposals p
                  WHERE p.id = fp.proposal_id AND p.user_id = auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'field-proposal % not found for user', p_field_id;
  END IF;
END $$;

-- 5.4 approve_klantbase_field(field_id) — accept zonder wijziging
CREATE OR REPLACE FUNCTION public.approve_klantbase_field(p_field_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_field_proposals fp
     SET status = 'approved'
   WHERE fp.id = p_field_id
     AND EXISTS (SELECT 1 FROM public.klantbase_proposals p
                  WHERE p.id = fp.proposal_id AND p.user_id = auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'field-proposal % not found for user', p_field_id;
  END IF;
END $$;

-- 5.5 reject_klantbase_field(field_id) — afwijzen van enkel veld
CREATE OR REPLACE FUNCTION public.reject_klantbase_field(p_field_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_field_proposals fp
     SET status = 'rejected'
   WHERE fp.id = p_field_id
     AND EXISTS (SELECT 1 FROM public.klantbase_proposals p
                  WHERE p.id = fp.proposal_id AND p.user_id = auth.uid());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'field-proposal % not found for user', p_field_id;
  END IF;
END $$;

-- 5.6 reject_klantbase_proposal(p_id) — heel voorstel afwijzen
CREATE OR REPLACE FUNCTION public.reject_klantbase_proposal(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_proposals
     SET status = 'rejected', rejected_at = now()
   WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal % not found for user', p_id;
  END IF;
END $$;

-- 5.7 dismiss_klantbase_proposal(p_id) — soft-dismiss "niet nu"
CREATE OR REPLACE FUNCTION public.dismiss_klantbase_proposal(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_proposals
     SET status = 'dismissed', dismissed_at = now()
   WHERE id = p_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'proposal % not found for user', p_id;
  END IF;
END $$;

-- 5.8 rerun_klantbase_field(field_id) — vraag scan opnieuw voor 1 veld
CREATE OR REPLACE FUNCTION public.rerun_klantbase_field(p_field_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_proposal_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.klantbase_field_proposals fp
     SET status = 'pending', proposed_value = NULL, reason = NULL,
         user_amended_value = NULL, amended_at = NULL
   WHERE fp.id = p_field_id
     AND EXISTS (SELECT 1 FROM public.klantbase_proposals p
                  WHERE p.id = fp.proposal_id AND p.user_id = auth.uid())
   RETURNING proposal_id INTO v_proposal_id;
  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'field-proposal % not found for user', p_field_id;
  END IF;
  UPDATE public.agent_schedules
     SET manual_run_requested_at = now()
   WHERE agent_name = 'klantbase';
END $$;

-- Grants
GRANT EXECUTE ON FUNCTION public.request_klantbase_run() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_klantbase_proposal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_klantbase_field_with_edits(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_klantbase_field(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_klantbase_field(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_klantbase_proposal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_klantbase_proposal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rerun_klantbase_field(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seed: 19 field_definitions uit src/components/views/klantbase/klantbase-data.js
--    LET OP: veld-keys gebruiken 'vragen_treshold_*' (typo zonder 'h') — exact zoals UI.
-- ---------------------------------------------------------------------------

INSERT INTO public.klantbase_field_definitions
  (key, label, field_type, group_name, options, xor_with, computed, required, uitleg, display_order)
VALUES
  -- Pricing & licenties
  ('licentieprijs_per_gebruiker', 'Licentieprijs per gebruiker', 'euro', 'Pricing & licenties',
    '[]'::jsonb, 'vaste_licentieprijs_maand', NULL, true,
    'Wat we per actieve gebruiker per maand factureren. Geldt zowel tijdens de proefperiode als tijdens het contract. Belangrijk: deze prijs verandert nóóit binnen dezelfde deal. Wijzigt de prijs? Dan komt er een nieuwe deal en sluit de oude.', 1),
  ('vaste_licentieprijs_maand', 'Vaste licentieprijs per maand', 'euro', 'Pricing & licenties',
    '[]'::jsonb, 'licentieprijs_per_gebruiker', NULL, false,
    'Één vast bedrag per maand voor de hele klant, in plaats van per actieve gebruiker. Komt bijna nooit voor — alleen bij een speciale afspraak. Vul deze óf de prijs-per-gebruiker in, niet allebei.', 2),
  ('omvang_licentieperiode', '# Accounts (licentieperiode)', 'int', 'Pricing & licenties',
    '[]'::jsonb, NULL, NULL, true,
    'Hoeveel accounts de klant in totaal heeft voor de contractperiode. Vul je voor nu handmatig in — later komt dit automatisch uit het dashboard.', 3),
  ('minimale_licenties_licentieperiode', 'Minimale licenties (licentieperiode)', 'int', 'Pricing & licenties',
    '[]'::jsonb, NULL, NULL, true,
    'De ondergrens: voor zoveel licenties betaalt de klant sowieso, ook als er minder mensen actief zijn. Boven dit minimum rekenen we per actieve gebruiker.', 4),
  -- Contract-structuur
  ('type_contract_jm', 'Type contract (J/M)', 'select', 'Contract-structuur',
    '["Maandelijks","Jaarlijks"]'::jsonb, NULL, NULL, true,
    'Krijgt de klant elke maand of elke jaar een factuur. Bijna altijd maandelijks. Alleen op "Jaarlijks" zetten als de klant daar zelf om vraagt — vooral bij 1-pitters die niet elke maand een factuur willen verwerken.', 5),
  ('startdatum', 'Startdatum contract', 'date', 'Contract-structuur',
    '[]'::jsonb, NULL, 'einddatum_proefperiode + 1 dag', true,
    'De eerste dag dat het echte contract loopt. Altijd de dag ná de proefperiode. Bij een nieuwe deal die een oude vervangt: altijd de 1e van een maand.', 6),
  ('einddatum', 'Einddatum contract', 'date', 'Contract-structuur',
    '[]'::jsonb, NULL, NULL, false,
    'Alleen invullen als er specifiek een einddatum is afgesproken. Standaard leeg laten — het contract loopt dan gewoon door. Bij het vervangen door een nieuwe deal: zet hier de laatste dag van de maand neer.', 7),
  -- DMS-integratie
  ('dms_actief', 'DMS actief', 'select', 'DMS-integratie',
    '["Geen interesse","Aangevraagd","In behandeling","Actief","Niet mogelijk met hun DMS voor nu"]'::jsonb, NULL, NULL, true,
    'Status van de koppeling met het document-systeem van de klant. Géén ja/nee — vijf mogelijke statussen. Bij nieuwe klanten meestal "Actief" of "Aangevraagd".', 8),
  ('type_dms', 'Type DMS', 'select', 'DMS-integratie',
    '["Heeft geen DMS","iManage","Urios","Sharepoint","Google Drive","BaseNet","CCLaw","Hammock","Cicero","Epona","Kleos","NextMatters (NEXTLegal)","Onbekend"]'::jsonb, NULL, NULL, true,
    'Welk document-systeem het kantoor gebruikt. Te achterhalen uit eerder contact, het contract of de notities op de company.', 9),
  ('dms_integratie_prijs', 'DMS-integratie prijs', 'euro', 'DMS-integratie',
    '[]'::jsonb, NULL, NULL, false,
    'Wat we extra per maand rekenen voor de DMS-koppeling, bovenop de licentieprijs.', 10),
  -- Proefperiode
  ('looptijd_proefperiode_maanden', 'Looptijd proefperiode (mnd)', 'int', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, true,
    'Hoe lang de proefperiode duurt, in maanden. Vrijwel altijd 2 of 3. Staat in de licentieovereenkomst.', 11),
  ('startdatum_proefperiode', 'Startdatum proefperiode', 'date', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, true,
    'Eerste dag van de proefperiode.', 12),
  ('einddatum_proefperiode', 'Einddatum proefperiode', 'date', 'Proefperiode',
    '[]'::jsonb, NULL, 'startdatum_proefperiode + looptijd_proefperiode_maanden', true,
    'Laatste dag van de proefperiode. Wordt automatisch berekend. De dag erna start het contract.', 13),
  ('omvang_proefperiode', '# Accounts (proefperiode)', 'int', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, true,
    'Hoeveel accounts de klant gebruikt tijdens de proefperiode.', 14),
  ('vaste_prijs_proefperiode_maand', 'Vaste prijs proefperiode (mnd)', 'euro', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, false,
    'Één vast bedrag per maand voor de hele proefperiode, in plaats van per actieve gebruiker. Zelden gebruikt.', 15),
  ('vragen_treshold_per_gebruiker_proefperiode', 'Vragen-threshold per gebruiker (proef)', 'int', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, true,
    'Hoeveel vragen een gebruiker tijdens de proefperiode moet stellen om als "actief" mee te tellen.', 16),
  ('korting_proefperiode_procent', 'Korting proefperiode (%)', 'percent', 'Proefperiode',
    '[]'::jsonb, NULL, NULL, false,
    'Eventueel afgesproken korting in procent tijdens de proefperiode, op de normale licentieprijs.', 17),
  -- Activiteits-metric
  ('permanent_actief', 'Permanent actief', 'select', 'Activiteits-metric',
    '["Yes","No"]'::jsonb, NULL, NULL, true,
    'Bij nieuwe contracten altijd "Yes". Vroeger kon een gebruiker na 3 maanden zonder activiteit weer als inactief worden gezet ("No"); dat doen we niet meer — eenmaal actief is voor altijd actief.', 18),
  ('vragen_treshold_per_gebruiker_licentieperiode', 'Vragen-threshold per gebruiker (licentieperiode)', 'int', 'Activiteits-metric',
    '[]'::jsonb, NULL, NULL, true,
    'Hoeveel vragen een gebruiker tijdens het contract moet stellen om als "actief" mee te tellen — en dus mee te tellen in de facturatie. Vrijwel altijd dezelfde drempel als tijdens de proefperiode.', 19)
ON CONFLICT (key) DO UPDATE SET
  label         = EXCLUDED.label,
  field_type    = EXCLUDED.field_type,
  group_name    = EXCLUDED.group_name,
  options       = EXCLUDED.options,
  xor_with      = EXCLUDED.xor_with,
  computed      = EXCLUDED.computed,
  required      = EXCLUDED.required,
  uitleg        = EXCLUDED.uitleg,
  display_order = EXCLUDED.display_order,
  updated_at    = now();

COMMIT;
