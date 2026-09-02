-- =============================================================================
-- Migratie E — enrich-vóór-chunk-gate op fetch_unchunked_source_ids('mail')
-- Per-user Outlook, fase 1 · MAIL-PIPELINE.md §3.6 punt 2
-- =============================================================================
-- Waarom:
--   De chunker is insert-once: `fetch_unchunked_source_ids` kent alleen
--   `NOT EXISTS chunks` en de chunker schrijft `embedding_input_hash: null`, dus
--   er is geen rechunk-pad. Een mail die tijdens een verse backfill door de
--   */5-chunker wordt opgepakt vóórdat de enricher erbij was, krijgt PERMANENT
--   een chunk zonder de MetaRAG-leader (party_type, lifecycle, topics) — precies
--   de metadata waar de verrijkingsketen voor bestaat.
--
--   Vandaag gaat dat goed omdat de backfill al klaar was toen de chunker
--   aanhaakte (16.133 verrijkt vs 16.046 mail-chunks). Bij een nieuwe mailbox is
--   die orde niet gegarandeerd.
--
-- De gate: een mail komt pas in de chunk-wachtrij als er een mail_enrichment-rij
-- staat. De pre-filter (spam, nieuwsbrieven, OOO, bounces, agenda-invites) maakt
-- die rij gratis en zonder LLM, dus in de praktijk loopt verrijking vanzelf voor.
--
-- Ontsnappingsluik (bewust toegevoegd, staat niet in het ontwerp):
--   Een harde gate zonder luik betekent dat een mail die om wat voor reden dan
--   ook nooit verrijkt wordt (budget hard_block die dagen aanhoudt, een enricher
--   die op één mail blijft falen) NOOIT meer retrievebaar wordt. Dat is een
--   stille permanente stall. Daarom: mail ouder dan ENRICH_GRACE_DAYS mag alsnog
--   gechunkt worden — zonder leader, maar wel vindbaar. Zichtbaar te monitoren
--   via v_mail_chunk_gate_pending hieronder.
-- =============================================================================

begin;

create or replace function public.fetch_unchunked_source_ids(p_source text, p_limit integer default 10)
returns table(source_id text)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  -- Zie kopcommentaar: na deze periode mag een onverrijkte mail alsnog door,
  -- zodat een vastgelopen verrijking niet stil de RAG-index bevriest.
  ENRICH_GRACE_DAYS constant int := 14;
BEGIN
  IF p_source = 'mail' THEN
    RETURN QUERY
      SELECT m.id FROM mail_messages m
      WHERE m.is_deleted = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
        AND (
          EXISTS (SELECT 1 FROM mail_enrichment e WHERE e.mail_id = m.id)
          OR m.received_at < now() - make_interval(days => ENRICH_GRACE_DAYS)
        )
      ORDER BY m.received_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'engagement' THEN
    RETURN QUERY
      SELECT e.id FROM hubspot_engagements e
      WHERE e.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'engagement' AND c.source_id = e.id)
      ORDER BY COALESCE(e.hs_timestamp, e.hs_created_at) DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'jira' THEN
    RETURN QUERY
      SELECT j.issue_key FROM jira_issues j
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'jira' AND c.source_id = j.issue_key)
      ORDER BY j.jira_updated_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'deal' THEN
    RETURN QUERY
      SELECT d.deal_id FROM hubspot_deals d
      WHERE d.is_archived = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'deal' AND c.source_id = d.deal_id)
      ORDER BY d.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'company' THEN
    RETURN QUERY
      SELECT co.company_id FROM hubspot_companies co
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'company' AND c.source_id = co.company_id)
      ORDER BY co.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'contact' THEN
    RETURN QUERY
      SELECT con.contact_id FROM hubspot_contacts con
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'contact' AND c.source_id = con.contact_id)
      ORDER BY con.hs_lastmodifieddate DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'meeting' THEN
    RETURN QUERY
      SELECT f.id::text FROM fireflies_meetings f
      WHERE NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'meeting' AND c.source_id = f.id::text)
      ORDER BY f.date_time DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'event' THEN
    RETURN QUERY
      SELECT ev.id::text FROM calendar_events ev
      WHERE ev.is_cancelled = false
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'event' AND c.source_id = ev.id::text)
      ORDER BY ev.start_time DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'lesson' THEN
    RETURN QUERY
      SELECT l.id::text FROM jellemind_lessons l
      WHERE l.active = true
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'lesson' AND c.source_id = l.id::text)
      ORDER BY l.created_at DESC NULLS LAST LIMIT p_limit;

  ELSIF p_source = 'action' THEN
    RETURN QUERY
      SELECT d.id::text FROM autodraft_action_decisions d
      WHERE d.outcome IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'action' AND c.source_id = d.id::text)
      ORDER BY COALESCE(d.decided_at, d.created_at) DESC NULLS LAST LIMIT p_limit;

  ELSE
    RAISE EXCEPTION 'unknown_source: %', p_source USING ERRCODE = '22023';
  END IF;
END $function$;

comment on function public.fetch_unchunked_source_ids(text, integer) is
  'Chunk-wachtrij per bron. Voor ''mail'' geldt de enrich-vóór-chunk-gate: '
  'alleen mails met een mail_enrichment-rij (of ouder dan 14 dagen) komen door, '
  'zodat de MetaRAG-leader nooit ontbreekt op een verse mailbox.';

revoke all on function public.fetch_unchunked_source_ids(text, integer) from public;
grant execute on function public.fetch_unchunked_source_ids(text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Monitor: wat staat er vast achter de gate, per mailbox?
-- Als `blocked` hier oploopt terwijl `overdue` > 0, staat de verrijking stil.
-- -----------------------------------------------------------------------------
create or replace view public.v_mail_chunk_gate_pending
with (security_invoker = on) as
  SELECT m.user_id,
         count(*)                                                        AS blocked,
         count(*) FILTER (WHERE m.received_at < now() - interval '14 days') AS overdue,
         min(m.received_at)                                              AS oldest_blocked_at
    FROM mail_messages m
   WHERE m.is_deleted = false
     AND NOT EXISTS (SELECT 1 FROM chunks c WHERE c.source = 'mail' AND c.source_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM mail_enrichment e WHERE e.mail_id = m.id)
   GROUP BY m.user_id;

comment on view public.v_mail_chunk_gate_pending is
  'Mails die door de enrich-vóór-chunk-gate wachten, per mailbox. overdue > 0 = '
  'verrijking loopt achter en de grace-periode laat ze zonder leader door.';

grant select on public.v_mail_chunk_gate_pending to authenticated, service_role;

commit;

-- =============================================================================
-- Verificatie (los uitvoeren):
--   select * from public.v_mail_chunk_gate_pending;
--   select count(*) from public.fetch_unchunked_source_ids('mail', 100);
-- =============================================================================
