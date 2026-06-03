-- RAG v2 F.2c — autofill-cron gebruikt nu de router (enrichment-activatie) + eerlijke provenance.
--
-- Bevinding (live geverifieerd 2026-06-03): de DOMINANTE schrijver van
-- autodraft_action_decisions is de autofill-cron `autodraft_proposals_autofill()`
-- (niet de skill-Stap-7c). Die deed alles deterministisch maar:
--   (a) labelde elke rij 'sonnet' (de kolom-DEFAULT) → een provenance-leugen,
--   (b) raadpleegde de router `resolve_action_from_metadata` NOOIT (hardcoded reply.neutraal).
-- Het beeld "router 26× vs sonnet 3662×" was daardoor grotendeels vals: er waren
-- maar ~21 ECHTE Sonnet-beslissingen (pre-v18); de rest was de manual-historie
-- (3419, was_suggested=false) + deterministische autofill (mislabeled 'sonnet').
--
-- Fix: (1) eerlijke kolom-default, (2) historie relabelen naar de waarheid,
-- (3) cron raadpleegt de router voor de rank-1 reply-slug (neutraal/uitgebreid/kort
--     op DOEL — activeert de 5-assige mail-verrijking) + schrijft eerlijke
--     classifier_source/tier/confidence per rij.
-- Rank 2-3 blijven BEWUST deterministisch (folder-heuristiek = skill's target_folder
-- is een sterker signaal dan metadata-only voor non-reply for_you; zie AutoDraft v3.1
-- werkstroom-G analyse: metadata is zwak discriminerend voor de for_you-verb).

-- (1) eerlijke kolom-default (was 'sonnet' = leugen voor de deterministische vangnet-cron)
ALTER TABLE public.autodraft_action_decisions ALTER COLUMN classifier_source SET DEFAULT 'deterministic';

-- (2a) relabel aantoonbaar mislabelde deterministische historie (autofill + legacy backfill)
UPDATE public.autodraft_action_decisions
   SET classifier_source = 'deterministic'
 WHERE classifier_source = 'sonnet'
   AND (classifier_reasoning ILIKE 'Autofill cron%' OR classifier_reasoning ILIKE 'Legacy backfill%');

-- (2b) relabel de manual-gedragslog (Jelle's eigen acties; was_suggested=false) → 'manual'
UPDATE public.autodraft_action_decisions
   SET classifier_source = 'manual'
 WHERE classifier_source = 'sonnet'
   AND outcome = 'manual'
   AND was_suggested = false;

-- (3) cron-herschrijf: router reply-pick voor rank-1 (for_you) + eerlijke source/tier/confidence.
CREATE OR REPLACE FUNCTION public.autodraft_proposals_autofill()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted   int := 0;
  v_superseded int := 0;
BEGIN
  -- (0) Sluit verweesde open voorstellen af (ONGEWIJZIGD).
  WITH closed AS (
    UPDATE autodraft_action_decisions d
       SET outcome = 'superseded',
           decided_at = now(),
           execution_result = COALESCE(d.execution_result, '{}'::jsonb)
             || jsonb_build_object('reason', 'mail_no_longer_pending', 'closed_by', 'autofill-cron')
     WHERE d.outcome IS NULL
       AND d.was_suggested = true
       AND NOT EXISTS (
             SELECT 1 FROM autodraft_mails m
              WHERE m.mail_id = d.mail_id AND m.status IN ('pending','amended')
           )
    RETURNING 1
  )
  SELECT count(*) INTO v_superseded FROM closed;

  -- (1) Vul ontbrekende voorstellen voor nog-open mails.
  WITH open_mails AS (
    SELECT m.mail_id, m.conversation_id, m.audience, m.suggested_action,
           m.draft_variants, m.target_folder,
           m.draft_subject, m.draft_body,
           CASE
             WHEN m.target_folder ILIKE '%Boekhouding%' OR m.target_folder ILIKE '%Fiscaliteit%' THEN 'forward.finance'
             WHEN m.target_folder ILIKE '%/Personeel%' OR m.target_folder ILIKE '%Afdelingen/Personeel%' THEN 'forward.hr'
             WHEN m.target_folder ILIKE '%/Klanten/%' OR m.target_folder ILIKE 'Inbox/Klanten' OR m.target_folder ILIKE '%Customer Succes%' THEN 'file.client-known'
             WHEN m.target_folder ILIKE '%JIRA%' THEN 'delegate.jira-lemind'
             WHEN m.target_folder ILIKE '%In Afwachting%' OR m.target_folder ILIKE 'Inbox/Todo''s' THEN 'file.in-afwachting'
             ELSE NULL
           END AS folder_action_slug,
           COALESCE(jsonb_array_length(m.draft_variants), 0) AS n_variants,
           rep.action_slug AS router_reply_slug,
           rep.confidence  AS router_reply_conf,
           rep.tier        AS router_reply_tier
    FROM   autodraft_mails m
    LEFT JOIN LATERAL (
      SELECT rr.action_slug, rr.confidence, rr.tier
        FROM resolve_action_from_metadata(m.mail_id, 6) rr
        JOIN public.autodraft_actions a2 ON a2.slug = rr.action_slug AND a2.enabled = true
       WHERE rr.action_slug LIKE 'reply.%'
       ORDER BY rr.rank
       LIMIT 1
    ) rep ON true
    WHERE  m.status NOT IN ('stale','sent','ignored','failed')
      AND  NOT EXISTS (
             SELECT 1 FROM autodraft_action_decisions d
              WHERE d.mail_id = m.mail_id AND d.was_suggested = true
           )
  ),
  expanded AS (
    -- RANK 1 — for_you: router reply-pick (op doel) met embedded draft; not_for_you: file.archive
    SELECT o.mail_id, o.conversation_id, 1 AS rank,
           CASE WHEN o.audience = 'not_for_you' THEN 'file.archive'
                ELSE COALESCE(o.router_reply_slug, 'reply.neutraal') END AS slug,
           CASE WHEN o.audience = 'not_for_you'
                  THEN jsonb_build_object('target_folder', COALESCE(o.target_folder, 'Archive'), 'source', 'autofill')
                ELSE public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 0) END AS payload,
           CASE WHEN o.audience = 'for_you' AND o.router_reply_slug IS NOT NULL THEN 'metadata_router'
                ELSE 'deterministic' END AS source,
           CASE WHEN o.audience = 'for_you' THEN COALESCE(o.router_reply_tier, 'reasoned') ELSE 'reasoned' END AS tier,
           CASE WHEN o.audience = 'for_you' THEN COALESCE(o.router_reply_conf, 0.5) ELSE 0.5 END AS conf,
           CASE WHEN o.audience = 'for_you' AND o.router_reply_slug IS NOT NULL
                  THEN 'Autofill cron — router reply-pick (' || o.router_reply_slug || ') uit mail-verrijking. Geen Sonnet-call.'
                ELSE 'Autofill cron — deterministisch op basis van autodraft_mails. Geen Sonnet-call.' END AS reasoning
      FROM open_mails o
    UNION ALL
    -- RANK 2 — deterministisch alternatief (folder-heuristiek = skill's target_folder)
    SELECT o.mail_id, o.conversation_id, 2 AS rank,
           CASE
             WHEN o.audience = 'not_for_you'                      THEN 'defer.decline'
             WHEN o.folder_action_slug IS NOT NULL                THEN o.folder_action_slug
             WHEN o.n_variants > 1                                THEN 'reply.uitgebreid'
             ELSE 'file.in-afwachting'
           END AS slug,
           CASE
             WHEN o.audience = 'not_for_you'                      THEN jsonb_build_object('reason', 'audience=not_for_you', 'source', 'autofill')
             WHEN o.folder_action_slug LIKE 'forward.%'           THEN jsonb_build_object('to', CASE o.folder_action_slug WHEN 'forward.finance' THEN 'finance@legal-mind.nl' WHEN 'forward.hr' THEN 'personeel@legal-mind.nl' ELSE '' END, 'source', 'autofill')
             WHEN o.folder_action_slug = 'delegate.jira-lemind'   THEN jsonb_build_object('system', 'jira', 'target', 'LEMIND', 'source', 'autofill')
             WHEN o.folder_action_slug IS NOT NULL                THEN jsonb_build_object('target_folder', o.target_folder, 'source', 'autofill')
             WHEN o.n_variants > 1                                THEN public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 1)
             ELSE                                                      jsonb_build_object('target_folder', 'Inbox/Todo''s', 'source', 'autofill')
           END AS payload,
           'deterministic' AS source, 'reasoned' AS tier, 0.5 AS conf,
           'Autofill cron — deterministisch alternatief. Geen Sonnet-call.' AS reasoning
      FROM open_mails o
    UNION ALL
    -- RANK 3 — deterministisch (ONGEWIJZIGD)
    SELECT o.mail_id, o.conversation_id, 3 AS rank,
           CASE WHEN o.audience = 'not_for_you' THEN 'reply.kort' ELSE 'defer.decline' END AS slug,
           CASE WHEN o.audience = 'not_for_you' THEN public._autodraft_reply_payload(o.draft_variants, o.draft_subject, o.draft_body, 0)
                ELSE jsonb_build_object('reason', 'als geen actie nodig', 'source', 'autofill') END AS payload,
           'deterministic' AS source, 'reasoned' AS tier, 0.5 AS conf,
           'Autofill cron — deterministisch alternatief. Geen Sonnet-call.' AS reasoning
      FROM open_mails o
  )
  INSERT INTO autodraft_action_decisions (
    mail_id, conversation_id, action_slug, payload,
    was_suggested, suggested_rank, classifier_confidence, classifier_reasoning,
    outcome, decided_at, executed_at, created_at,
    classifier_source, tier
  )
  SELECT e.mail_id, e.conversation_id, e.slug,
         e.payload || jsonb_build_object('backfill_version', 'autofill-cron'),
         true, e.rank, e.conf, e.reasoning,
         NULL, NULL, NULL, now(),
         e.source, e.tier
  FROM   expanded e
  JOIN   public.autodraft_actions a ON a.slug = e.slug AND a.enabled = true;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'rows_inserted', v_inserted, 'orphans_superseded', v_superseded,
                            'ran_at', now(), 'version', 'router-reply-pick-2026-06-03');
END $function$;
