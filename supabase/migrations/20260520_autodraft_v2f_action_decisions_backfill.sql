-- =====================================================================
-- AutoDraft v2 — Fase 0: backfill historische actie-data
-- =====================================================================
-- Doel: vul autodraft_action_decisions met `outcome='manual'` rijen voor
-- elke incoming mail uit de laatste 180 dagen, op basis van wat er
-- DAADWERKELIJK met die mail is gebeurd (folder_path + reply-presence).
--
-- Geen LLM-call: 99.1% van mails valt onder deterministische regels
-- (gesimuleerd op 3449 mails, 30 fallen in skip-buckets).
--
-- Het deelresultaat voedt:
--   * autodraft_actions.suggested_count / accepted_count via stats-trigger
--     (we zetten was_suggested=false, dus eigenlijk NIET — die triggers
--     vuren alleen op suggested-true. Backfill telt dus niet mee in stats.)
--   * Later: chunker source='action' (geparkeerd) -> RAG voor classifier
--   * Direct: timeline-views en action-historie in de UI
--
-- Idempotent via UNIQUE partial index op (mail_id) WHERE was_suggested=false
-- AND outcome='manual'. Re-run = no-op.
--
-- Bron-doc: Confluence 443809794 §"Fase 0 — Retrospectief indexeren"
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Idempotency-index — voorkomt dubbele backfill-rijen per mail
-- ---------------------------------------------------------------------
-- LET OP: deze index laat normale skill-output (was_suggested=true)
-- ongemoeid, en blokkeert alleen dubbele MANUAL rijen per mail.

CREATE UNIQUE INDEX IF NOT EXISTS uq_autodraft_action_decisions_manual_per_mail
  ON public.autodraft_action_decisions (mail_id)
  WHERE was_suggested = false
    AND outcome      = 'manual'
    AND mail_id      IS NOT NULL;

COMMENT ON INDEX public.uq_autodraft_action_decisions_manual_per_mail IS
  'AutoDraft v2 Fase 0 backfill-idempotency. Eén manual decision per mail. '
  'Heeft GEEN effect op skill-runs (was_suggested=true rijen vallen erbuiten).';

-- ---------------------------------------------------------------------
-- 2. Bulk backfill
-- ---------------------------------------------------------------------
-- Regelvolgorde (eerste match wint):
--   01  got_reply=true                                      -> reply.neutraal
--   02  folder ILIKE 'Archive%'                             -> file.archive
--   03  folder ILIKE '%Junk%'                               -> defer.decline
--   04  folder ILIKE '%/Klanten/%' OR '=Inbox/Klanten'      -> file.client-known
--   05  folder ILIKE '%Customer Succes%'                    -> file.client-known
--   06  folder ILIKE '%Boekhouding%' OR '%Fiscaliteit%'     -> forward.finance
--   07  folder ILIKE '%/Personeel%'                         -> forward.hr
--   08  folder ILIKE '%/JIRA%'                              -> delegate.jira-lemind
--   09  folder ILIKE '%In Afwachting%' OR Inbox/Todo''s     -> file.in-afwachting
--   10  folder LIKE storage-tree                            -> file.archive
--   ELSE                                                    -> SKIP (no INSERT)
--
-- Skip-bucket = 30 mails (root Inbox of onbekende folder). Niet gebackfilled.

WITH source AS (
  SELECT
    m.id                         AS mail_id,
    m.conversation_id            AS conversation_id,
    m.folder_path                AS folder_path,
    m.received_at                AS received_at,
    m.last_modified_at           AS last_modified_at,
    EXISTS (
      SELECT 1
      FROM   public.mail_messages r
      WHERE  r.conversation_id = m.conversation_id
        AND  COALESCE(r.is_from_me, false) = true
        AND  r.sent_at > m.received_at
    )                            AS got_reply
  FROM   public.mail_messages m
  WHERE  m.received_at        > now() - interval '180 days'
    AND  COALESCE(m.is_from_me, false) = false
    AND  COALESCE(m.is_deleted, false) = false
    AND  m.folder_path        IS NOT NULL
    AND  m.conversation_id    IS NOT NULL
),
mapped AS (
  SELECT
    s.*,
    CASE
      WHEN s.got_reply                                                                  THEN 'reply.neutraal'
      WHEN s.folder_path ILIKE 'Archive%'                                               THEN 'file.archive'
      WHEN s.folder_path ILIKE '%Junk%'                                                 THEN 'defer.decline'
      WHEN s.folder_path ILIKE '%/Klanten/%' OR s.folder_path = 'Inbox/Klanten'         THEN 'file.client-known'
      WHEN s.folder_path ILIKE '%Customer Succes%'                                      THEN 'file.client-known'
      WHEN s.folder_path ILIKE '%Boekhouding%' OR s.folder_path ILIKE '%Fiscaliteit%'   THEN 'forward.finance'
      WHEN s.folder_path ILIKE '%/Personeel%'                                           THEN 'forward.hr'
      WHEN s.folder_path ILIKE '%/JIRA%'                                                THEN 'delegate.jira-lemind'
      WHEN s.folder_path ILIKE '%In Afwachting%' OR s.folder_path = 'Inbox/Todo''s'     THEN 'file.in-afwachting'
      WHEN s.folder_path ILIKE '%General Storage%'
        OR s.folder_path ILIKE 'Inbox/Projecten%'
        OR s.folder_path ILIKE 'Inbox/Partners Waiting List%'
        OR s.folder_path ILIKE 'Inbox/Sales Map%'                                       THEN 'file.archive'
      ELSE NULL  -- skip
    END                                                                                  AS action_slug,
    CASE
      WHEN s.got_reply                                                                  THEN 'reply_in_thread'
      WHEN s.folder_path ILIKE 'Archive%'                                               THEN 'folder_archive_terminal'
      WHEN s.folder_path ILIKE '%Junk%'                                                 THEN 'folder_junk_terminal'
      WHEN s.folder_path ILIKE '%/Klanten/%' OR s.folder_path = 'Inbox/Klanten'         THEN 'folder_klanten_tree'
      WHEN s.folder_path ILIKE '%Customer Succes%'                                      THEN 'folder_customer_succes_tree'
      WHEN s.folder_path ILIKE '%Boekhouding%' OR s.folder_path ILIKE '%Fiscaliteit%'   THEN 'folder_finance_tree'
      WHEN s.folder_path ILIKE '%/Personeel%'                                           THEN 'folder_hr_tree'
      WHEN s.folder_path ILIKE '%/JIRA%'                                                THEN 'folder_jira_tree'
      WHEN s.folder_path ILIKE '%In Afwachting%' OR s.folder_path = 'Inbox/Todo''s'     THEN 'folder_in_afwachting_tree'
      ELSE                                                                                   'folder_general_storage_tree'
    END                                                                                  AS inferred_from
  FROM source s
)
INSERT INTO public.autodraft_action_decisions (
  mail_id,
  conversation_id,
  action_slug,
  payload,
  was_suggested,
  suggested_rank,
  classifier_confidence,
  classifier_reasoning,
  outcome,
  decided_at,
  executed_at,
  execution_result,
  linked_entities,
  context_bundle_id,
  created_at
)
SELECT
  m.mail_id,
  m.conversation_id,
  m.action_slug,
  jsonb_build_object(
    'inferred_from',         m.inferred_from,
    'folder_path',           m.folder_path,
    'got_reply',             m.got_reply,
    'backfill_version',      'v2f-2026-05-20',
    'backfill_method',       'deterministic_rules'
  )                                                              AS payload,
  false                                                          AS was_suggested,
  NULL::int                                                      AS suggested_rank,
  NULL::numeric                                                  AS classifier_confidence,
  NULL::text                                                     AS classifier_reasoning,
  'manual'                                                       AS outcome,
  COALESCE(m.last_modified_at, m.received_at)                    AS decided_at,
  COALESCE(m.last_modified_at, m.received_at)                    AS executed_at,
  jsonb_build_object(
    'ok',                    true,
    'backfilled',            true,
    'source',                'mail_messages_folder_path'
  )                                                              AS execution_result,
  NULL::text[]                                                   AS linked_entities,
  NULL::uuid                                                     AS context_bundle_id,
  COALESCE(m.last_modified_at, m.received_at)                    AS created_at
FROM   mapped m
WHERE  m.action_slug IS NOT NULL
ON CONFLICT ON CONSTRAINT uq_autodraft_action_decisions_manual_per_mail
DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Verificatie — counts per action_slug + total
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_total       int;
  v_per_slug    text;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.autodraft_action_decisions
   WHERE was_suggested = false
     AND outcome       = 'manual'
     AND (payload->>'backfill_version') = 'v2f-2026-05-20';

  SELECT string_agg(action_slug || '=' || n::text, ', ' ORDER BY n DESC)
    INTO v_per_slug
    FROM (
      SELECT action_slug, count(*) AS n
        FROM public.autodraft_action_decisions
       WHERE was_suggested = false
         AND outcome       = 'manual'
         AND (payload->>'backfill_version') = 'v2f-2026-05-20'
      GROUP BY action_slug
    ) s;

  RAISE NOTICE '[v2f-backfill] total manual rows = %', v_total;
  RAISE NOTICE '[v2f-backfill] per slug = %', v_per_slug;
END $$;

-- =====================================================================
-- END
-- =====================================================================
