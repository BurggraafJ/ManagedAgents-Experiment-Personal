-- AutoDraft v3.0 — Fase 1: Metadata-driven classifier schema
--
-- Doel: koppel autodraft_actions catalog aan de 5-assige mail_enrichment laag.
-- Daarmee kan een nieuwe RPC `resolve_action_from_metadata` deterministisch
-- bepalen welke action_slug bij een mail past, vóór Sonnet überhaupt aan zet komt.
--
-- IDEMPOTENT — kan herhaald draaien zonder errors.
--
-- Wijzigingen:
--   1. autodraft_actions krijgt 6 nieuwe kolommen voor metadata-triggers
--   2. autodraft_action_decisions krijgt `tier`, `undo_until`, `metadata_match`
--   3. autopilot_enabled is GLOBAL OFF — Jelle activeert handmatig per slug
--   4. Seed-update: bestaande 10 default-acties krijgen trigger-mappings
--
-- Geen breaking changes — bestaande v12-flow blijft werken.

BEGIN;

-- ============================================================================
-- 1. Schema-uitbreiding autodraft_actions
-- ============================================================================

ALTER TABLE public.autodraft_actions
  ADD COLUMN IF NOT EXISTS speech_act_triggers text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS topic_triggers       text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS lifecycle_triggers   text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS party_type_triggers  text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS cycle_stage_triggers text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS sentiment_triggers   text[]    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS autopilot_eligible   boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_enabled    boolean   DEFAULT false,
  ADD COLUMN IF NOT EXISTS autopilot_min_conf   numeric   DEFAULT 0.95,
  ADD COLUMN IF NOT EXISTS oneclick_min_conf    numeric   DEFAULT 0.70;

COMMENT ON COLUMN public.autodraft_actions.speech_act_triggers IS
  'Mail-enrichment speech_act waarden die deze actie suggereren (Request/Propose/Commit/Deliver/Inform/Amend/Ack/Decline/Accept). Empty = geen restrictie.';
COMMENT ON COLUMN public.autodraft_actions.topic_triggers IS
  'mail_enrichment.topics waarden die deze actie suggereren. ANY-match telt.';
COMMENT ON COLUMN public.autodraft_actions.lifecycle_triggers IS
  'mail_enrichment.party_lifecycle_at_moment waarden (lead/pilot/active/churned/...).';
COMMENT ON COLUMN public.autodraft_actions.party_type_triggers IS
  'mail_enrichment.party_type waarden (customer/partner/vendor/internal/personal/unknown).';
COMMENT ON COLUMN public.autodraft_actions.cycle_stage_triggers IS
  'mail_enrichment.cycle_stage_signal waarden (qualification/proposal_sent/churn_signal/...).';
COMMENT ON COLUMN public.autodraft_actions.sentiment_triggers IS
  'mail_enrichment.sentiment waarden waarop deze actie passend is (negative/neutral/positive/escalated/...).';
COMMENT ON COLUMN public.autodraft_actions.autopilot_eligible IS
  'Mag deze actie überhaupt zonder klik uitgevoerd worden? File-acties: ja. Reply/forward/delegate: nee.';
COMMENT ON COLUMN public.autodraft_actions.autopilot_enabled IS
  'Heeft Jelle deze actie expliciet aangezet voor autopilot? Default false — handmatig activeren per slug.';
COMMENT ON COLUMN public.autodraft_actions.autopilot_min_conf IS
  'Minimum classifier-confidence vereist voor autopilot (default 0.95).';
COMMENT ON COLUMN public.autodraft_actions.oneclick_min_conf IS
  'Minimum classifier-confidence voor one-click tier (default 0.70). Onder = 3-tab reasoned.';

-- ============================================================================
-- 2. Schema-uitbreiding autodraft_action_decisions
-- ============================================================================

ALTER TABLE public.autodraft_action_decisions
  ADD COLUMN IF NOT EXISTS tier           text,
  ADD COLUMN IF NOT EXISTS undo_until     timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_match jsonb,
  ADD COLUMN IF NOT EXISTS classifier_source text DEFAULT 'sonnet';

COMMENT ON COLUMN public.autodraft_action_decisions.tier IS
  'autopilot | one-click | reasoned. Bepaalt UI-render-mode en undo-window.';
COMMENT ON COLUMN public.autodraft_action_decisions.undo_until IS
  'Timestamp tot wanneer autopilot-actie ongedaan gemaakt kan worden (default +24u).';
COMMENT ON COLUMN public.autodraft_action_decisions.metadata_match IS
  'JSONB met welke triggers de action matchten — bv {"speech_act":["Deliver"],"topic":["finance_invoice"]}.';
COMMENT ON COLUMN public.autodraft_action_decisions.classifier_source IS
  'metadata_router | sonnet | backfill | legacy_v2 — voor cost-attributie + debug.';

-- Index voor tier-queries (briefing aggregation)
CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_tier
  ON public.autodraft_action_decisions(tier, decided_at DESC)
  WHERE tier IS NOT NULL;

-- Index voor undo-lookup
CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_undo
  ON public.autodraft_action_decisions(undo_until)
  WHERE undo_until IS NOT NULL AND outcome = 'autopilot';

-- ============================================================================
-- 3. Seed-update: trigger-mappings voor de 10 default-acties
--
-- LET OP: autopilot_enabled blijft op FALSE voor alle slugs. Jelle activeert
-- handmatig per slug via /postvak/instellingen → Acties → toggle.
-- ============================================================================

-- file.archive — veilige autopilot-kandidaat (later aan te zetten door Jelle)
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Ack','Inform','Deliver'],
  topic_triggers       = ARRAY['newsletter','notification','automatic_reply','bounce','delivery_report','calendar_response'],
  party_type_triggers  = ARRAY['vendor','newsletter','notification','unknown'],
  sentiment_triggers   = ARRAY['neutral','positive'],
  autopilot_eligible   = true,
  autopilot_min_conf   = 0.95
WHERE slug = 'file.archive';

-- file.in-afwachting — alleen bij Commit (zij beloven iets)
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Commit','Accept'],
  topic_triggers       = ARRAY['follow_up','contract_negotiation','proposal_sent'],
  party_type_triggers  = ARRAY['customer','partner','lead'],
  sentiment_triggers   = ARRAY['neutral','positive'],
  autopilot_eligible   = false   -- nooit autopilot, alleen voorstel
WHERE slug = 'file.in-afwachting';

-- file.client-known — verplaats naar klant-map, file-action veilig
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Inform','Deliver','Ack'],
  party_type_triggers  = ARRAY['customer'],
  lifecycle_triggers   = ARRAY['active','pilot','churned'],
  sentiment_triggers   = ARRAY['neutral','positive'],
  autopilot_eligible   = true,
  autopilot_min_conf   = 0.92
WHERE slug = 'file.client-known';

-- forward.finance — financiële mails naar Tessa
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Deliver','Inform'],
  topic_triggers       = ARRAY['finance_invoice','finance_payment','finance_reminder','tax_filing','bookkeeping'],
  party_type_triggers  = ARRAY['vendor','customer','partner'],
  autopilot_eligible   = false,  -- forward = onomkeerbare actie, blijft 1-klik
  oneclick_min_conf    = 0.75
WHERE slug = 'forward.finance';

-- forward.hr — HR/recruitment mails naar Personeel
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Inform','Request','Deliver'],
  topic_triggers       = ARRAY['recruitment','salary','leave_request','personnel','hr'],
  party_type_triggers  = ARRAY['recruiter','vendor','internal'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.75
WHERE slug = 'forward.hr';

-- reply.kort — korte ack-reply
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Ack','Inform','Deliver'],
  sentiment_triggers   = ARRAY['neutral','positive'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.70
WHERE slug = 'reply.kort';

-- reply.neutraal — default for_you reply
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Request','Propose','Amend'],
  party_type_triggers  = ARRAY['customer','partner','lead','internal'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.70
WHERE slug = 'reply.neutraal';

-- reply.uitgebreid — voor inhoudelijke vragen
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Request','Propose'],
  topic_triggers       = ARRAY['contract_negotiation','license_agreement','legal_question','pricing','sla_amendment','proposal_sent','support'],
  party_type_triggers  = ARRAY['customer','partner','lead'],
  cycle_stage_triggers = ARRAY['qualification','proposal_sent','contract_negotiation','churn_signal'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.65
WHERE slug = 'reply.uitgebreid';

-- delegate.jira-lemind — bug-rapport / feature-request
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Request','Inform'],
  topic_triggers       = ARRAY['bug_report','feature_request','support','user_complaint'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.80
WHERE slug = 'delegate.jira-lemind';

-- defer.decline — sales-pitch / cold outreach
UPDATE public.autodraft_actions SET
  speech_act_triggers  = ARRAY['Propose','Request'],
  topic_triggers       = ARRAY['cold_outreach','sales_pitch','lead_outreach'],
  party_type_triggers  = ARRAY['unknown','vendor'],
  autopilot_eligible   = false,
  oneclick_min_conf    = 0.75
WHERE slug = 'defer.decline';

COMMIT;
