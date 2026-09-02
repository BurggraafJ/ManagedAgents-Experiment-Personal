-- =============================================================================
-- mail_accounts I — graf- en roll-up-views user_id-bewust
-- MAIL-PIPELINE.md §3.8 / §3.9 stap 7   ·   2026-09-02
-- =============================================================================
-- Vervolg op migratie H. Zelfde regels:
--   * `user_id` komt ACHTERAAN de kolomlijst (create or replace blijft werken);
--   * filter via public.mail_row_in_scope(owner, mail_scope_user_ids());
--   * rijen zonder eigenaar (HubSpot, Jira, Fireflies) zijn gedeeld corpus en
--     blijven altijd zichtbaar — user_id = NULL.
--
-- Voor roll-ups die per definitie één rij per bron leveren (v_postvak_health,
-- v_truth_of_sources, v_mail_enrichment_progress) splitsen we NIET per user:
-- dat zou de vorm van de view veranderen. In plaats daarvan worden de tellingen
-- gescoopt en zegt `user_id` op welke mailbox ze slaan — NULL = niet
-- gerestricteerd (browser/RLS) of meer dan één mailbox in scope.
--
-- Volgorde is belangrijk: v_entity_edges_full leest v_entity_edges.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. v_entity_edges
-- -----------------------------------------------------------------------------
create or replace view public.v_entity_edges
with (security_invoker = on) as
  select 'deal'::text as src_type, d.deal_id as src_id, 'company'::text as dst_type,
         c.c as dst_id, 'belongs_to'::text as edge_type, null::uuid as user_id
    from public.hubspot_deals d, lateral unnest(d.associated_company_ids) c(c)
   where d.is_archived = false and c.c is not null
  union all
  select 'deal'::text, d.deal_id, 'contact'::text, c.c, 'involves'::text, null::uuid
    from public.hubspot_deals d, lateral unnest(d.associated_contact_ids) c(c)
   where d.is_archived = false and c.c is not null
  union all
  select 'deal'::text, d.deal_id, 'owner'::text, d.hubspot_owner_id, 'owned_by'::text, null::uuid
    from public.hubspot_deals d
   where d.is_archived = false and d.hubspot_owner_id is not null
  union all
  select 'engagement'::text, e.id, 'deal'::text, d.d, 'about'::text, null::uuid
    from public.hubspot_engagements e, lateral unnest(e.associated_deal_ids) d(d)
   where e.is_archived = false and d.d is not null
  union all
  select 'engagement'::text, e.id, 'company'::text, c.c, 'about'::text, null::uuid
    from public.hubspot_engagements e, lateral unnest(e.associated_company_ids) c(c)
   where e.is_archived = false and c.c is not null
  union all
  select 'engagement'::text, e.id, 'contact'::text, c.c, 'about'::text, null::uuid
    from public.hubspot_engagements e, lateral unnest(e.associated_contact_ids) c(c)
   where e.is_archived = false and c.c is not null
  union all
  select 'engagement'::text, e.id, 'owner'::text, e.hubspot_owner_id, 'logged_by'::text, null::uuid
    from public.hubspot_engagements e
   where e.is_archived = false and e.hubspot_owner_id is not null
  union all
  select 'contact'::text, c.contact_id, 'company'::text, c.associated_company_id, 'works_at'::text, null::uuid
    from public.hubspot_contacts c
   where c.associated_company_id is not null
  union all
  select 'contact'::text, c.contact_id, 'owner'::text, c.hubspot_owner_id, 'owned_by'::text, null::uuid
    from public.hubspot_contacts c
   where c.hubspot_owner_id is not null
  union all
  select 'company'::text, co.company_id, 'owner'::text, co.hubspot_owner_id, 'owned_by'::text, null::uuid
    from public.hubspot_companies co
   where co.hubspot_owner_id is not null
  union all
  -- Mail is mailbox-eigendom: zonder filter expandeert de entity-graph van
  -- mailbox A straks over de threads van mailbox B.
  select 'mail'::text, m.id, 'conversation'::text, m.conversation_id, 'in_thread'::text, m.user_id
    from public.mail_messages m
   where m.is_deleted = false and m.conversation_id is not null
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'jira'::text, j.issue_key, 'jira'::text, j.parent_key, 'sub_of'::text, null::uuid
    from public.jira_issues j
   where j.parent_key is not null
  union all
  select 'event'::text, ev.id::text, 'meeting'::text, ev.fireflies_meeting_id::text, 'recorded_as'::text, ev.user_id
    from public.calendar_events ev
   where ev.is_cancelled = false and ev.fireflies_meeting_id is not null
     and public.mail_row_in_scope(ev.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'event'::text, ev.id::text, 'event_series'::text, ev.series_master_id, 'occurrence_of'::text, ev.user_id
    from public.calendar_events ev
   where ev.is_cancelled = false and ev.series_master_id is not null
     and public.mail_row_in_scope(ev.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'event'::text, a.calendar_event_id::text, 'email'::text, lower(a.email), 'has_attendee'::text, a.user_id
    from public.calendar_attendees a
   where a.email is not null
     and public.mail_row_in_scope(a.user_id, (select public.mail_scope_user_ids()));

-- -----------------------------------------------------------------------------
-- 2. v_entity_edges_full
-- -----------------------------------------------------------------------------
create or replace view public.v_entity_edges_full
with (security_invoker = on) as
  select e.src_type, e.src_id, e.dst_type, e.dst_id, e.edge_type,
         1.000 as confidence, e.user_id
    from public.v_entity_edges e
  union all
  select 'mail'::text, m.id, 'contact'::text, er.entity_id, 'authored_by'::text, er.confidence, m.user_id
    from public.mail_messages m
    join public.entity_resolution er
      on er.alias_type = 'email' and er.alias_value = lower(m.from_email) and er.entity_type = 'contact'
   where m.is_deleted = false and m.from_email is not null
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'mail'::text, m.id, 'company'::text, er.entity_id, 'from_company'::text, er.confidence, m.user_id
    from public.mail_messages m
    join public.entity_resolution er
      on er.alias_type = 'email_domain' and er.alias_value = lower(m.from_domain) and er.entity_type = 'company'
   where m.is_deleted = false and m.from_domain is not null
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'mail'::text, m.id, 'deal'::text, d.deal_id, 'from_contact_on_deal'::text, 0.95, m.user_id
    from public.mail_messages m
    join public.entity_resolution er
      on er.alias_type = 'email' and er.alias_value = lower(m.from_email) and er.entity_type = 'contact'
    join public.hubspot_deals d on er.entity_id = any (d.associated_contact_ids)
   where m.is_deleted = false and m.from_email is not null and not d.is_archived
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'mail'::text, m.id, 'deal'::text, d.deal_id, 'from_company_on_deal'::text, 0.75, m.user_id
    from public.mail_messages m
    join public.entity_resolution er
      on er.alias_type = 'email_domain' and er.alias_value = lower(m.from_domain) and er.entity_type = 'company'
    join public.hubspot_deals d on er.entity_id = any (d.associated_company_ids)
   where m.is_deleted = false and m.from_domain is not null and not d.is_archived
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'event'::text, a.calendar_event_id::text, 'contact'::text, er.entity_id, 'attended_by'::text, er.confidence, a.user_id
    from public.calendar_attendees a
    join public.entity_resolution er
      on er.alias_type = 'email' and er.alias_value = lower(a.email) and er.entity_type = 'contact'
   where a.email is not null
     and public.mail_row_in_scope(a.user_id, (select public.mail_scope_user_ids()))
  union all
  select 'meeting'::text, f.id::text, 'contact'::text, er.entity_id, 'organized_by'::text, er.confidence, null::uuid
    from public.fireflies_meetings f
    join public.entity_resolution er
      on er.alias_type = 'email' and er.alias_value = lower(f.organizer_email) and er.entity_type = 'contact'
   where f.organizer_email is not null;

-- -----------------------------------------------------------------------------
-- 3. v_entity_timeline_summary
-- -----------------------------------------------------------------------------
-- Blijft één rij per entity_email; per user splitsen zou de HubSpot-tak (geen
-- eigenaar) altijd een eigen NULL-rij geven en dus óók bij één mailbox de vorm
-- veranderen. user_id = de mailbox die de eigendoms-events leverde, NULL als
-- dat er geen of meer dan één is.
create or replace view public.v_entity_timeline_summary
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  events as (
    select lower(m.from_email) as entity_email,
           'mail'::text        as kind,
           case when m.is_from_me then 'outgoing'::text else 'incoming'::text end as direction,
           m.received_at       as occurred_at,
           m.id                as source_id,
           m.subject           as title,
           "left"(coalesce(nullif(m.body_preview, ''), m.body_text), 120) as preview,
           m.user_id
      from public.mail_messages m
     where not m.is_deleted and m.from_email is not null
       and m.received_at >= now() - interval '90 days'
       and public.mail_row_in_scope(m.user_id, (select ids from scope))
    union all
    select lower(a.email), 'meeting'::text, 'event'::text, e.start_time, e.id::text, e.subject,
           "left"(coalesce(nullif(e.body_preview, ''), e.location_text), 120), e.user_id
      from public.calendar_events e
      join public.calendar_attendees a on a.calendar_event_id = e.id
     where not e.is_deleted and not e.is_cancelled and a.email is not null
       and e.start_time >= now() - interval '90 days'
       and public.mail_row_in_scope(e.user_id, (select ids from scope))
    union all
    select lower(hc.email), 'engagement'::text, e.engagement_type,
           coalesce(e.hs_timestamp, e.hs_created_at), e.id, e.subject,
           "left"(public.strip_html_inline(coalesce(e.body_text, '')), 120), null::uuid
      from public.hubspot_engagements e
      join lateral unnest(e.associated_contact_ids) u(contact_id) on true
      join public.hubspot_contacts hc on hc.contact_id = u.contact_id
     where not e.is_archived and hc.email is not null
       and coalesce(e.hs_timestamp, e.hs_created_at) >= now() - interval '90 days'
  ), ranked as (
    select ev.entity_email, ev.kind, ev.direction, ev.occurred_at, ev.source_id,
           ev.title, ev.preview, ev.user_id,
           row_number() over (partition by ev.entity_email order by ev.occurred_at desc) as rn
      from events ev
  )
  select entity_email,
         count(*)                                                                        as actions_total,
         count(*) filter (where occurred_at >= now() - interval '7 days')::integer       as actions_7d,
         count(*) filter (where occurred_at >= now() - interval '30 days')::integer      as actions_30d,
         max(occurred_at)                                                                as last_action_at,
         jsonb_agg(jsonb_build_object(
           'kind', kind, 'direction', direction, 'occurred_at', occurred_at,
           'source_id', source_id, 'title', title, 'preview', preview
         ) order by occurred_at desc) filter (where rn <= 10)                            as recent_actions,
         case when count(distinct user_id) = 1
              then (array_agg(distinct user_id) filter (where user_id is not null))[1]
         end                                                                             as user_id
    from ranked
   group by entity_email;

-- -----------------------------------------------------------------------------
-- 4. v_postvak_health
-- -----------------------------------------------------------------------------
create or replace view public.v_postvak_health
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  mail_sync as (
    -- Runs van vóór v1.133 dragen geen mailbox-stempel; die tellen we mee,
    -- anders zou de health-view stilvallen op historie.
    select max(r.started_at) as last_run
      from public.agent_runs r
     where r.agent_name = 'mail-sync' and r.status = 'success'
       and ( (select ids from scope) is null
             or not (r.stats ? 'mailbox_email')
             or exists (
                  select 1 from public.mail_accounts a
                   where a.mailbox_email = r.stats ->> 'mailbox_email'
                     and public.mail_row_in_scope(a.user_id, (select ids from scope))
                ) )
  ), auto_draft as (
    select max(r.started_at) as last_run
      from public.agent_runs r
     where r.agent_name = 'auto-draft' and r.status = 'success'
       and (r.stats ->> 'mode') = 'scan'
  ), ghosts as (
    select count(*)::integer as n
      from public.autodraft_mails am
     where am.status = any (array['pending', 'amended'])
       and public.mail_row_in_scope(am.user_id, (select ids from scope))
       and not exists (select 1 from public.mail_messages mm where mm.id = am.mail_id)
  ), pending_invalid_folder as (
    select count(*)::integer as n
      from public.autodraft_mails am
     where am.status = any (array['pending', 'amended'])
       and am.target_folder is not null and am.target_folder <> ''
       and public.mail_row_in_scope(am.user_id, (select ids from scope))
       and not exists (
             select 1 from public.mail_folders mf
              where mf.full_path = am.target_folder and mf.user_id = am.user_id
           )
  )
  select ms.last_run                                                  as mail_sync_last_run,
         extract(epoch from now() - ms.last_run)::integer / 60         as mail_sync_minutes_ago,
         ad.last_run                                                  as auto_draft_last_run,
         extract(epoch from now() - ad.last_run)::integer / 60         as auto_draft_minutes_ago,
         g.n                                                          as ghost_rows,
         pif.n                                                        as pending_invalid_folder,
         case
           when g.n > 0 or pif.n > 0 then 'red'::text
           when ms.last_run is null or ms.last_run < now() - interval '30 minutes' then 'red'::text
           when ms.last_run < now() - interval '15 minutes' then 'yellow'::text
           when ad.last_run is null or ad.last_run < now() - interval '90 minutes' then 'yellow'::text
           else 'green'::text
         end                                                          as verdict,
         public.mail_scope_single_user_id()                           as user_id
    from mail_sync ms, auto_draft ad, ghosts g, pending_invalid_folder pif;

-- -----------------------------------------------------------------------------
-- 5. v_truth_of_sources
-- -----------------------------------------------------------------------------
create or replace view public.v_truth_of_sources
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  mail_sync as (
    select coalesce(sum(s.total_messages_synced), 0::bigint)                       as total_synced,
           max(s.last_delta_at)                                                    as last_delta,
           count(*) filter (where s.last_error is not null)::integer               as error_count,
           count(*)::integer                                                       as folders_tracked
      from public.mail_sync_state s
     where public.mail_row_in_scope(s.user_id, (select ids from scope))
  ), mail_backfill as (
    select count(*) filter (where b.status = 'done')::integer         as done_buckets,
           count(*) filter (where b.status = 'empty')::integer        as empty_buckets,
           count(*) filter (where b.status = 'pending')::integer      as pending_buckets,
           count(*) filter (where b.status = 'in_progress')::integer  as in_progress_buckets,
           count(*) filter (where b.status = 'error')::integer        as error_buckets,
           count(*)::integer                                          as total_buckets
      from public.mail_backfill_state b
     where public.mail_row_in_scope(b.user_id, (select ids from scope))
  )
  select 'mail'::text as source,
         (select count(*) from public.mail_messages m
           where not m.is_deleted
             and public.mail_row_in_scope(m.user_id, (select ids from scope))) as total,
         ms.last_delta as last_sync,
         ms.error_count,
         jsonb_build_object(
           'folders_tracked', ms.folders_tracked,
           'backfill', jsonb_build_object(
             'total', mb.total_buckets, 'done', mb.done_buckets, 'empty', mb.empty_buckets,
             'pending', mb.pending_buckets, 'in_progress', mb.in_progress_buckets,
             'error', mb.error_buckets,
             'percent_complete', case when mb.total_buckets > 0
               then round((mb.done_buckets + mb.empty_buckets)::numeric * 100.0 / mb.total_buckets::numeric)
               else 0::numeric end)) as extra,
         public.mail_scope_single_user_id() as user_id
    from mail_sync ms, mail_backfill mb
  union all
  select 'hubspot'::text,
         (select count(*) from public.hubspot_deals where not is_archived)
         + (select count(*) from public.hubspot_companies where not is_archived)
         + (select count(*) from public.hubspot_contacts where not is_archived)
         + (select count(*) from public.hubspot_engagements where not is_archived),
         (select last_delta_sync from public.hubspot_sync_state where id = 1),
         (select count(*) filter (where last_error is not null)::integer from public.hubspot_engagements_sync_state),
         jsonb_build_object(
           'deals', (select count(*) from public.hubspot_deals where not is_archived),
           'companies', (select count(*) from public.hubspot_companies where not is_archived),
           'contacts', (select count(*) from public.hubspot_contacts where not is_archived),
           'engagements', (select count(*) from public.hubspot_engagements where not is_archived),
           'engagements_by_type', (select jsonb_object_agg(t.engagement_type, t.n)
             from (select engagement_type, count(*) as n from public.hubspot_engagements
                    where not is_archived and engagement_type is not null
                    group by engagement_type) t)),
         null::uuid
  union all
  select 'jira'::text,
         (select count(*) from public.jira_issues where not is_deleted),
         (select last_delta_sync from public.jira_sync_state where id = 1),
         0,
         jsonb_build_object(
           'issues', (select count(*) from public.jira_issues where not is_deleted),
           'projects', (select count(*) from public.jira_projects)),
         null::uuid
  union all
  select 'fireflies'::text,
         (select count(*) from public.fireflies_meetings),
         (select last_delta_sync_at from public.fireflies_sync_state where id = 1),
         0,
         jsonb_build_object(
           'meetings', (select count(*) from public.fireflies_meetings),
           'action_items_total', (select count(*) from public.fireflies_action_items),
           'jelle_open', (select count(*) from public.fireflies_action_items
                           where is_for_jelle and processed_at is null),
           'jelle_total', (select count(*) from public.fireflies_action_items where is_for_jelle)),
         null::uuid
  union all
  -- Agenda hangt sinds migratie F óók aan een mailbox (calendar_sync_state is
  -- geen singleton meer), dus dezelfde scope-regel als mail.
  select 'calendar'::text,
         (select count(*) from public.calendar_events e
           where not e.is_deleted
             and public.mail_row_in_scope(e.user_id, (select ids from scope))),
         (select max(css.last_delta_sync_at) from public.calendar_sync_state css
           where public.mail_row_in_scope(css.user_id, (select ids from scope))),
         0,
         jsonb_build_object(
           'events', (select count(*) from public.calendar_events e
                       where not e.is_deleted
                         and public.mail_row_in_scope(e.user_id, (select ids from scope))),
           'active', (select count(*) from public.calendar_events e
                       where not e.is_deleted and not e.is_cancelled
                         and public.mail_row_in_scope(e.user_id, (select ids from scope))),
           'attendees', (select count(*) from public.calendar_attendees a
                          where public.mail_row_in_scope(a.user_id, (select ids from scope))),
           'linked_to_fireflies', (select count(*) from public.calendar_events e
                                    where not e.is_deleted and e.fireflies_meeting_id is not null
                                      and public.mail_row_in_scope(e.user_id, (select ids from scope)))),
         public.mail_scope_single_user_id()
  union all
  select 'contactpersonen'::text,
         (select count(*) from public.contactpersonen where not is_deleted),
         (select max(last_delta_sync) from public.contactpersonen_sync_state),
         (select count(*) filter (where last_error is not null)::integer from public.contactpersonen_sync_state),
         jsonb_build_object(
           'contacts', (select count(*) from public.contactpersonen where not is_deleted),
           'firms', (select count(*) from public.firms where not is_deleted),
           'unlinked', (select count(*) from public.contactpersonen where not is_deleted and firm_id is null),
           'by_type', (select jsonb_object_agg(t.contact_type, t.n)
             from (select contact_type, count(*) as n from public.contactpersonen
                    where not is_deleted and contact_type is not null
                    group by contact_type) t)),
         null::uuid;

-- -----------------------------------------------------------------------------
-- 6. v_mail_enrichment_progress
-- -----------------------------------------------------------------------------
create or replace view public.v_mail_enrichment_progress
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids)
  select (select count(*) from public.mail_messages m
           where m.is_deleted is not true
             and public.mail_row_in_scope(m.user_id, (select ids from scope)))          as totaal_mails,
         (select count(*) from public.mail_enrichment e
           where public.mail_row_in_scope(e.user_id, (select ids from scope)))          as verrijkt,
         (select count(*) from public.mail_messages m
           where m.is_deleted is not true
             and public.mail_row_in_scope(m.user_id, (select ids from scope))
             and not exists (select 1 from public.mail_enrichment e where e.mail_id = m.id)) as resterend,
         round((select count(*) from public.mail_enrichment e
                 where public.mail_row_in_scope(e.user_id, (select ids from scope)))::numeric
               / nullif((select count(*) from public.mail_messages m
                          where m.is_deleted is not true
                            and public.mail_row_in_scope(m.user_id, (select ids from scope))), 0)::numeric
               * 100::numeric, 1)                                                        as pct_klaar,
         (select round(sum(e.enrichment_cost_usd), 4) from public.mail_enrichment e
           where public.mail_row_in_scope(e.user_id, (select ids from scope)))          as cost_usd_tot_nu,
         (select max(e.enriched_at) from public.mail_enrichment e
           where public.mail_row_in_scope(e.user_id, (select ids from scope)))          as laatste_enrichment,
         (select count(*) from public.mail_enrichment e
           where e.enrichment_model like 'pre_filter%'
             and public.mail_row_in_scope(e.user_id, (select ids from scope)))          as pre_filtered,
         (select count(*) from public.mail_enrichment e
           where e.enrichment_model = 'gpt-5-nano'
             and public.mail_row_in_scope(e.user_id, (select ids from scope)))          as llm_nano_only,
         (select count(*) from public.mail_enrichment e
           where e.enrichment_model like '%gpt-5-mini%'
             and public.mail_row_in_scope(e.user_id, (select ids from scope)))          as llm_with_mini,
         public.mail_scope_single_user_id()                                              as user_id;

-- -----------------------------------------------------------------------------
-- 7. v_company_data_quality
-- -----------------------------------------------------------------------------
-- Het "eigen domein" kwam uit een heuristiek (meest-voorkomende from_domain van
-- eigen mail, LIMIT 1). Met twee mailboxen is dat een willekeurige keuze; de
-- registry weet het exact. De heuristiek blijft als fallback zolang geen enkel
-- account own_domains gevuld heeft.
create or replace view public.v_company_data_quality
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  registry_domains as (
    select distinct on (lower(d.d)) lower(d.d) as domain, a.user_id
      from public.mail_accounts a, unnest(a.own_domains) as d(d)
     where coalesce(d.d, '') <> ''
       and public.mail_row_in_scope(a.user_id, (select ids from scope))
     order by lower(d.d), a.created_at
  ), heuristic_domain as (
    select lower(split_part(m.from_email, '@', 2)) as domain
      from public.mail_messages m
     where m.is_from_me = true and m.from_email is not null
       and public.mail_row_in_scope(m.user_id, (select ids from scope))
     group by lower(split_part(m.from_email, '@', 2))
     order by count(*) desc
     limit 1
  ), self_domain as (
    select rd.domain, rd.user_id from registry_domains rd
    union all
    select hd.domain, public.mail_scope_single_user_id()
      from heuristic_domain hd
     where not exists (select 1 from registry_domains)
  ), dup_groups as (
    select lower(nullif(trim(both from hc.domain), '')) as domain,
           count(*)::integer                            as n,
           array_agg(hc.company_id)                     as company_ids,
           array_agg(hc.name)                           as names
      from public.hubspot_companies hc
     where hc.is_archived = false and hc.domain is not null
       and length(trim(both from hc.domain)) >= 4
     group by lower(nullif(trim(both from hc.domain), ''))
    having count(*) > 1
  )
  select 'self_domain_set_as_company'::text  as issue_type,
         c.company_id,
         c.name,
         lower(trim(both from c.domain))     as domain,
         null::text                          as extra_info,
         sd.user_id
    from public.hubspot_companies c
    join self_domain sd on sd.domain = lower(trim(both from c.domain))
   where c.is_archived = false
  union all
  select 'duplicate_domain'::text,
         unnest(dg.company_ids),
         unnest(dg.names),
         dg.domain,
         ('shared with: ' || (dg.n - 1) || ' other company record')
           || case when (dg.n - 1) = 1 then '' else 's' end,
         null::uuid
    from dup_groups dg;

commit;

notify pgrst, 'reload schema';
