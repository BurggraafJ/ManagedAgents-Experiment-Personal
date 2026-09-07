-- =============================================================================
-- 06b WP1c, derde slag — de view-arm joint op de tabel in plaats van te rekenen
-- =============================================================================
-- Zelfde zeven armen als `20260907052000`, maar de laatste leest nu
-- `hubspot_engagement_company_domain` (4.250 rijen, index op `company_id`) in
-- plaats van `hubspot_engagements` × `unnest` × `hubspot_companies` opnieuw uit te
-- rekenen. Reden en meting: `20260907054000`.
--
-- Met `dst_id = <company>` erop gedrukt wordt dit een index scan op
-- `idx_hs_eng_co_domain_company`; `match_chunks_for_entity` raakt
-- `hubspot_engagements` niet meer aan.
--
-- De zes bestaande armen zijn LETTERLIJK `pg_get_viewdef(…, true)` van vóór 06b —
-- niet gereconstrueerd uit het geheugen (CLAUDE.md hard-rule "repo-file 1:1").
-- Poort b6 (ACL 17/17) moet ná deze wijziging opnieuw groen zijn.
-- =============================================================================

create or replace view public.v_entity_edges_full as
SELECT e.src_type,
    e.src_id,
    e.dst_type,
    e.dst_id,
    e.edge_type,
    1.000 AS confidence,
    e.user_id
   FROM v_entity_edges e
UNION ALL
 SELECT 'mail'::text AS src_type,
    m.id AS src_id,
    'contact'::text AS dst_type,
    er.entity_id AS dst_id,
    'authored_by'::text AS edge_type,
    er.confidence,
    m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(m.from_email) AND er.entity_type = 'contact'::text
  WHERE m.is_deleted = false AND m.from_email IS NOT NULL AND mail_row_in_scope(m.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type,
    m.id AS src_id,
    'company'::text AS dst_type,
    er.entity_id AS dst_id,
    'from_company'::text AS edge_type,
    er.confidence,
    m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email_domain'::text AND er.alias_value = lower(m.from_domain) AND er.entity_type = 'company'::text
  WHERE m.is_deleted = false AND m.from_domain IS NOT NULL AND mail_row_in_scope(m.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type,
    m.id AS src_id,
    'deal'::text AS dst_type,
    d.deal_id AS dst_id,
    'from_contact_on_deal'::text AS edge_type,
    0.95 AS confidence,
    m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(m.from_email) AND er.entity_type = 'contact'::text
     JOIN hubspot_deals d ON er.entity_id = ANY (d.associated_contact_ids)
  WHERE m.is_deleted = false AND m.from_email IS NOT NULL AND NOT d.is_archived AND mail_row_in_scope(m.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'mail'::text AS src_type,
    m.id AS src_id,
    'deal'::text AS dst_type,
    d.deal_id AS dst_id,
    'from_company_on_deal'::text AS edge_type,
    0.75 AS confidence,
    m.user_id
   FROM mail_messages m
     JOIN entity_resolution er ON er.alias_type = 'email_domain'::text AND er.alias_value = lower(m.from_domain) AND er.entity_type = 'company'::text
     JOIN hubspot_deals d ON er.entity_id = ANY (d.associated_company_ids)
  WHERE m.is_deleted = false AND m.from_domain IS NOT NULL AND NOT d.is_archived AND mail_row_in_scope(m.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'event'::text AS src_type,
    a.calendar_event_id::text AS src_id,
    'contact'::text AS dst_type,
    er.entity_id AS dst_id,
    'attended_by'::text AS edge_type,
    er.confidence,
    a.user_id
   FROM calendar_attendees a
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(a.email) AND er.entity_type = 'contact'::text
  WHERE a.email IS NOT NULL AND mail_row_in_scope(a.user_id, ( SELECT mail_scope_user_ids() AS mail_scope_user_ids))
UNION ALL
 SELECT 'meeting'::text AS src_type,
    f.id::text AS src_id,
    'contact'::text AS dst_type,
    er.entity_id AS dst_id,
    'organized_by'::text AS edge_type,
    er.confidence,
    NULL::uuid AS user_id
   FROM fireflies_meetings f
     JOIN entity_resolution er ON er.alias_type = 'email'::text AND er.alias_value = lower(f.organizer_email) AND er.entity_type = 'contact'::text
  WHERE f.organizer_email IS NOT NULL
UNION ALL
 SELECT 'engagement'::text AS src_type,
    d.engagement_id AS src_id,
    'company'::text AS dst_type,
    d.company_id AS dst_id,
    'email_domain'::text AS edge_type,
    0.7 AS confidence,
    NULL::uuid AS user_id
   FROM hubspot_engagement_company_domain d;
