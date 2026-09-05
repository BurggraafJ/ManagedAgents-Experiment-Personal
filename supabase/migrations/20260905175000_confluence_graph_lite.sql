-- =============================================================================
-- v_entity_edges: Confluence-hiërarchie als graph-lite edge         (v1.145)
-- =============================================================================
-- Eén edge-type, bewust: `child_of` (pagina -> ouderpagina). Daarmee krijgt
-- match_chunks_for_entity 1-hop "pagina's rond deze pagina" gratis, want die
-- joint chunks op (source, source_id) = expanded.(type, id) en Confluence-chunks
-- hebben source='confluence', source_id=page_id. Geen RPC-wijziging nodig.
--
-- Wat er BEWUST niet in zit:
--   `tagged` (pagina -> label)  — een census over alle 366 pagina's gaf 0 labels
--                                  en 0 distinct labels. De tak zou nooit een rij
--                                  opleveren.
--   `in_space` (pagina -> space) — p_max_edges staat op 300 en is load-bearing
--                                  sinds de timeout-P0 van 2026-06-02. Space LM
--                                  heeft 190 pagina's; als `space`-entity zou die
--                                  in z'n eentje bijna de hele cap opsouperen.
--                                  Pas toevoegen als er een use-case is.
--
-- ⚠ De ACL geldt ook hier. match_chunks_for_entity filtert Confluence-chunks op
-- cf_visible met p_caller_user_id; zonder dat zou een graph-expansie een prima
-- omweg naar een MT-pagina zijn. Gecontroleerd in dezelfde ronde.
--
-- Gegenereerd uit de live definitie met tmp/gen-edges.cjs: de bestaande takken
-- zijn byte-exact overgenomen, alleen de laatste UNION ALL is nieuw.
-- =============================================================================

CREATE OR REPLACE VIEW public.v_entity_edges AS
SELECT 'deal'::text AS src_type,
    d.deal_id AS src_id,
    'company'::text AS dst_type,
    c.c AS dst_id,
    'belongs_to'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_deals d,
    LATERAL unnest(d.associated_company_ids) c(c)
  WHERE d.is_archived = false AND c.c IS NOT NULL
UNION ALL
 SELECT 'deal'::text AS src_type,
    d.deal_id AS src_id,
    'contact'::text AS dst_type,
    c.c AS dst_id,
    'involves'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_deals d,
    LATERAL unnest(d.associated_contact_ids) c(c)
  WHERE d.is_archived = false AND c.c IS NOT NULL
UNION ALL
 SELECT 'deal'::text AS src_type,
    d.deal_id AS src_id,
    'owner'::text AS dst_type,
    d.hubspot_owner_id AS dst_id,
    'owned_by'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_deals d
  WHERE d.is_archived = false AND d.hubspot_owner_id IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type,
    e.id AS src_id,
    'deal'::text AS dst_type,
    d.d AS dst_id,
    'about'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_engagements e,
    LATERAL unnest(e.associated_deal_ids) d(d)
  WHERE e.is_archived = false AND d.d IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type,
    e.id AS src_id,
    'company'::text AS dst_type,
    c.c AS dst_id,
    'about'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_engagements e,
    LATERAL unnest(e.associated_company_ids) c(c)
  WHERE e.is_archived = false AND c.c IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type,
    e.id AS src_id,
    'contact'::text AS dst_type,
    c.c AS dst_id,
    'about'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_engagements e,
    LATERAL unnest(e.associated_contact_ids) c(c)
  WHERE e.is_archived = false AND c.c IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type,
    e.id AS src_id,
    'owner'::text AS dst_type,
    e.hubspot_owner_id AS dst_id,
    'logged_by'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_engagements e
  WHERE e.is_archived = false AND e.hubspot_owner_id IS NOT NULL
UNION ALL
 SELECT 'contact'::text AS src_type,
    c.contact_id AS src_id,
    'company'::text AS dst_type,
    c.associated_company_id AS dst_id,
    'works_at'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_contacts c
  WHERE c.associated_company_id IS NOT NULL
UNION ALL
 SELECT 'contact'::text AS src_type,
    c.contact_id AS src_id,
    'owner'::text AS dst_type,
    c.hubspot_owner_id AS dst_id,
    'owned_by'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_contacts c
  WHERE c.hubspot_owner_id IS NOT NULL
UNION ALL
 SELECT 'company'::text AS src_type,
    co.company_id AS src_id,
    'owner'::text AS dst_type,
    co.hubspot_owner_id AS dst_id,
    'owned_by'::text AS edge_type,
    NULL::uuid AS user_id
   FROM hubspot_companies co
  WHERE co.hubspot_owner_id IS NOT NULL
UNION ALL
 SELECT 'mail'::text AS src_type,
    m.id AS src_id,
    'conversation'::text AS dst_type,
    m.conversation_id AS dst_id,
    'in_thread'::text AS edge_type,
    m.user_id
   FROM mail_messages m
  WHERE m.is_deleted = false AND m.conversation_id IS NOT NULL AND mail_row_in_scope(m.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'jira'::text AS src_type,
    j.issue_key AS src_id,
    'jira'::text AS dst_type,
    j.parent_key AS dst_id,
    'sub_of'::text AS edge_type,
    NULL::uuid AS user_id
   FROM jira_issues j
  WHERE j.parent_key IS NOT NULL
UNION ALL
 SELECT 'event'::text AS src_type,
    ev.id::text AS src_id,
    'meeting'::text AS dst_type,
    ev.fireflies_meeting_id::text AS dst_id,
    'recorded_as'::text AS edge_type,
    ev.user_id
   FROM calendar_events ev
  WHERE ev.is_cancelled = false AND ev.fireflies_meeting_id IS NOT NULL AND mail_row_in_scope(ev.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'event'::text AS src_type,
    ev.id::text AS src_id,
    'event_series'::text AS dst_type,
    ev.series_master_id AS dst_id,
    'occurrence_of'::text AS edge_type,
    ev.user_id
   FROM calendar_events ev
  WHERE ev.is_cancelled = false AND ev.series_master_id IS NOT NULL AND mail_row_in_scope(ev.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'event'::text AS src_type,
    a.calendar_event_id::text AS src_id,
    'email'::text AS dst_type,
    lower(a.email) AS dst_id,
    'has_attendee'::text AS edge_type,
    a.user_id
   FROM calendar_attendees a
  WHERE a.email IS NOT NULL AND mail_row_in_scope(a.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'confluence'::text AS src_type,
    p.page_id AS src_id,
    'confluence'::text AS dst_type,
    p.parent_id AS dst_id,
    'child_of'::text AS edge_type,
    NULL::uuid AS user_id
   FROM confluence_pages p
  WHERE p.is_archived = false AND p.parent_id IS NOT NULL;
