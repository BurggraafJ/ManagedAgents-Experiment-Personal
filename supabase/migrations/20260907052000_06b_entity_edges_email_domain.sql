-- =============================================================================
-- 06b WP1c — engagement → company via het e-mailDOMEIN
-- =============================================================================
-- Gemeten (RESEARCH.md §1.2/§1.3, prod 2026-09-07):
--   * E-mail-engagements hebben `associated_company_ids`, `_contact_ids` én
--     `_deal_ids` LEEG op 9.783 van 9.783 rijen. Er is geen associatie-tabel;
--     associaties zijn ARRAY-kolommen op de rij, en voor e-mail zijn ze niet gevuld.
--   * `type_specific` draagt wél adressen: `hs_email_from_email` op 9.738 (99,5 %),
--     `hs_email_to_email` op 9.738, `hs_email_cc_email` op 2.198 — 21.674 adressen
--     over 9.749 engagements (2,22 per stuk), 787 domeinen.
--   * Na uitsluiting van het EIGEN domein (legal-mind.nl is zelf een company-rij,
--     wat de naïeve "99,1 % resolveerbaar" verklaart) is 3.463 van 9.749 (35,5 %)
--     koppelbaar aan een `hubspot_companies.domain`, over 223 domeinen.
--   * Vandaar dat een company-entity vandaag 1.320 engagement-chunks bereikt terwijl
--     9.783 van de 9.785 e-mailchunks "een" edge hebben: die edge is
--     `engagement → owner (logged_by)`, 11.486 stuks. Vanuit de KLANT is de
--     klantcorrespondentie in HubSpot onzichtbaar.
--
-- Vorm: één extra UNION ALL-arm op `v_entity_edges_full`, `edge_type='email_domain'`,
-- `confidence 0.7`. Bewust NIET via `chunks.entity_ids`: dat pad heeft geen afnemer
-- (`match_chunks_for_entity` joint op (source, source_id) via deze view, en
-- entity_ids is op alle 20.162 HubSpot-chunks leeg — 06a's les).
--
-- Confidence 0.7 en niet 1.0 omdat een domeinmatch geen associatie is: een mail van
-- iemand bij dat domein zegt niet dat de engagement óver die company gaat. Gevolg dat
-- je moet weten: `expanded_forward`/`expanded_backward` sorteren
-- `ORDER BY confidence DESC LIMIT p_max_edges` (120 op search_fast, 300 elders), dus
-- bij een company met veel edges van confidence 1.0 vallen deze het eerst af. Dat is
-- gewenst — de zekere edges gaan voor — en het is gemeten in `reach_from_company`
-- (IMPLEMENT-NOTES §3).
--
-- ⛔ Deze view zit in het `match_chunks_for_entity`-pad. Poort b6
-- (`confluence_acl_eval.cjs` 17/17 vóór én ná) is daarom BLOKKEREND. Terugdraaien =
-- `create or replace view` met dezelfde definitie zonder de laatste arm.
--
-- De zes bestaande armen hieronder zijn LETTERLIJK `pg_get_viewdef(…, true)` van vóór
-- deze migratie — niet gereconstrueerd uit het geheugen (CLAUDE.md hard-rule
-- "repo-file 1:1", en de reden dat die regel bestaat).
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
   FROM ( SELECT DISTINCT e.id AS engagement_id,
            c.company_id
           FROM hubspot_engagements e
             CROSS JOIN LATERAL unnest(string_to_array(concat_ws(','::text, e.type_specific ->> 'hs_email_from_email'::text, e.type_specific ->> 'hs_email_to_email'::text, e.type_specific ->> 'hs_email_cc_email'::text), ','::text)) a(addr)
             JOIN hubspot_companies c ON lower(NULLIF(c.domain, ''::text)) = lower(split_part(btrim(a.addr), '@'::text, 2))
          WHERE e.engagement_type = 'email'::text AND e.is_archived = false AND "position"(a.addr, '@'::text) > 0 AND lower(split_part(btrim(a.addr), '@'::text, 2)) !~~ '%legal-mind%'::text) d;
