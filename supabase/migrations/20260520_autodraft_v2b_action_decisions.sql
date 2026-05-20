-- =====================================================================
-- AutoDraft v2 — Fase 1B: autodraft_action_decisions audit-log
-- =====================================================================
-- Eén tabel voor de hele lifecycle van een actie:
--   suggested → decided (accept/amend/reject) → executed
-- Plus handmatige historische acties die zonder suggestion-fase landden
-- (bv. via Fase 0 backfill of toekomstige direct-execute paden).
--
-- Geen losse action_executions-tabel — alles hier voor één audit-stream.
--
-- Bron-doc: https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/443809794
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.autodraft_action_decisions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Link naar mail (nullable — handmatige acties zonder source-mail kunnen ook)
  mail_id                 text REFERENCES public.mail_messages(id) ON DELETE SET NULL,
  conversation_id         text,
  -- Actie zelf
  action_slug             text NOT NULL REFERENCES public.autodraft_actions(slug),
  payload                 jsonb DEFAULT '{}'::jsonb,
  -- Voorstel-fase (NULL als deze actie zonder suggestion is uitgevoerd)
  was_suggested           boolean NOT NULL DEFAULT false,
  suggested_rank          integer,  -- 1/2/3 binnen de drie voorstellen
  classifier_confidence   numeric,
  classifier_reasoning    text,
  -- Decision-fase
  outcome                 text,     -- accept | amend | reject | manual
  decided_at              timestamptz,
  -- Execution-fase
  executed_at             timestamptz,
  execution_result        jsonb,
  -- Entity-link voor timeline + RAG retrieval
  linked_entities         text[],   -- ['entity:company:42', 'entity:contact:17']
  -- Audit
  context_bundle_id       uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- CHECKs op outcome + suggested_rank
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autodraft_action_decisions_outcome_check') THEN
    ALTER TABLE public.autodraft_action_decisions
      ADD CONSTRAINT autodraft_action_decisions_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('accept','amend','reject','manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autodraft_action_decisions_rank_check') THEN
    ALTER TABLE public.autodraft_action_decisions
      ADD CONSTRAINT autodraft_action_decisions_rank_check
      CHECK (suggested_rank IS NULL OR suggested_rank BETWEEN 1 AND 5);
  END IF;
END $$;

-- Indexen voor de typische lookups
CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_mail
  ON public.autodraft_action_decisions (mail_id) WHERE mail_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_slug
  ON public.autodraft_action_decisions (action_slug);

CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_outcome
  ON public.autodraft_action_decisions (outcome) WHERE outcome IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_decided_at
  ON public.autodraft_action_decisions (decided_at DESC) WHERE decided_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_conv
  ON public.autodraft_action_decisions (conversation_id) WHERE conversation_id IS NOT NULL;

-- GIN voor entity-array lookups (timeline-builder, RAG)
CREATE INDEX IF NOT EXISTS idx_autodraft_action_decisions_entities_gin
  ON public.autodraft_action_decisions USING GIN (linked_entities)
  WHERE linked_entities IS NOT NULL;

COMMENT ON TABLE public.autodraft_action_decisions IS
  'AutoDraft v2 audit-log voor de hele actie-lifecycle: suggested → decided '
  '(accept/amend/reject/manual) → executed. Eén stream, geen losse '
  'action_executions-tabel. Voedt: classifier-feedback (suggested_count + '
  'accepted_count stats), entity-timeline (linked_entities), RAG '
  '(via chunker source=action). Bron-doc: Confluence 443809794.';

COMMENT ON COLUMN public.autodraft_action_decisions.was_suggested IS
  'true = kwam uit classifier-suggestion. false = handmatige actie '
  '(Fase 0 backfill of toekomstige direct-execute pad).';

COMMENT ON COLUMN public.autodraft_action_decisions.suggested_rank IS
  '1/2/3 — welke positie van de drie voorstellen. NULL als was_suggested=false.';

COMMENT ON COLUMN public.autodraft_action_decisions.outcome IS
  'accept = Jelle keurt voorstel goed zoals het is. amend = Jelle wijzigt payload '
  'voor execute. reject = geen actie. manual = direct uitgevoerd zonder '
  'suggestion-fase (alleen voor backfill/direct-execute).';

COMMENT ON COLUMN public.autodraft_action_decisions.execution_result IS
  'Output van daily-admin-execute (of equivalent) na de actie. Bv. '
  '{"ok":true,"outlook_message_id":"AAMk...","timestamp":"..."}.';

COMMENT ON COLUMN public.autodraft_action_decisions.linked_entities IS
  'Entity-IDs in formaat entity:<type>:<id> — bv. ["entity:company:HBOFAW123"]. '
  'Voor timeline-aggregatie en RAG entity-aware retrieval.';

COMMENT ON COLUMN public.autodraft_action_decisions.context_bundle_id IS
  'FK naar context_bundles als deze actie via CaaS-bundle is gegenereerd. '
  'Voor reproductie + audit van de classifier-input.';

-- RLS — Pattern A
ALTER TABLE public.autodraft_action_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'autodraft_action_decisions' AND policyname = 'autodraft_action_decisions_service') THEN
    CREATE POLICY autodraft_action_decisions_service
      ON public.autodraft_action_decisions FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'autodraft_action_decisions' AND policyname = 'autodraft_action_decisions_authenticated') THEN
    CREATE POLICY autodraft_action_decisions_authenticated
      ON public.autodraft_action_decisions FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

-- updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at_autodraft_action_decisions
  ON public.autodraft_action_decisions;
CREATE TRIGGER set_updated_at_autodraft_action_decisions
  BEFORE UPDATE ON public.autodraft_action_decisions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- Stats-trigger — increment counters op autodraft_actions
-- =====================================================================
-- Bij INSERT met was_suggested=true → suggested_count++
-- Bij outcome='accept' (eerste keer gezet) → accepted_count++
-- =====================================================================

CREATE OR REPLACE FUNCTION public.autodraft_action_decisions_update_stats()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.was_suggested = true THEN
    UPDATE public.autodraft_actions
       SET suggested_count = suggested_count + 1
     WHERE slug = NEW.action_slug;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (OLD.outcome IS DISTINCT FROM NEW.outcome)
     AND NEW.outcome = 'accept' THEN
    UPDATE public.autodraft_actions
       SET accepted_count = accepted_count + 1
     WHERE slug = NEW.action_slug;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_autodraft_action_decisions_update_stats
  ON public.autodraft_action_decisions;
CREATE TRIGGER trg_autodraft_action_decisions_update_stats
  AFTER INSERT OR UPDATE OF outcome ON public.autodraft_action_decisions
  FOR EACH ROW EXECUTE FUNCTION public.autodraft_action_decisions_update_stats();

COMMENT ON FUNCTION public.autodraft_action_decisions_update_stats() IS
  'Houdt autodraft_actions.suggested_count + accepted_count bij. '
  'Fired bij INSERT (suggested++) en UPDATE OF outcome=accept (accepted++).';

-- =====================================================================
-- END
-- =====================================================================
