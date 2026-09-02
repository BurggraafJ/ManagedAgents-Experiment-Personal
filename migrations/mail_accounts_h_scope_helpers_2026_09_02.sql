-- =============================================================================
-- mail_accounts H — scope-helpers + de mail-kernviews user_id-bewust
-- MAIL-PIPELINE.md §3.8 / §3.9 stap 7   ·   2026-09-02
-- =============================================================================
-- Probleem (uit §3.8): deze views leveren vandaag correcte antwoorden púúr
-- omdat er één mailbox is. Zodra mailbox #2 bestaat tellen ze over mailboxen
-- heen wanneer een SERVICE-ROLE-caller (elke agent) ze aanroept — RLS geldt
-- daar niet. Via de browser blijft het goed, want alle views staan op
-- security_invoker=on en mail_messages heeft RLS.
--
-- Aanpak (§3.8): elke view krijgt (a) een `user_id`-kolom achteraan als
-- passthrough en (b) een scope-filter dat NIETS doet voor een browser-caller
-- (RLS beslist, gedrag van vandaag blijft exact) en voor een service-role-caller
-- terugvalt op de org-mailbox(en) — precies de default die de agents nu al
-- impliciet hebben.
--
-- Kolommen worden ACHTERAAN toegevoegd, zodat `create or replace view` blijft
-- werken en bestaande consumenten (kolomvolgorde, `select *`) ongemoeid blijven.
--
-- Eén mailbox = geen enkel verschil: mail_scope_user_ids() levert dan de rij
-- van Jelle (scope='org'), en alle mail is van Jelle.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Scope-helpers
-- -----------------------------------------------------------------------------
-- NULL = geen restrictie. Een lege array = restrictie die niets toelaat.
-- Dat is dezelfde conventie als rag_owner_scope_ids() uit migratie B, en de
-- reden dat de helpers hieronder daar op terugvallen in plaats van de logica
-- te kopiëren.

-- Predikaat: hoort deze rij bij de gevraagde scope?
-- `p_owner IS NULL` = rij zonder eigenaar (HubSpot, Jira, Fireflies) — die is
-- gedeeld corpus en valt altijd binnen scope, net als chunks.owner_user_id.
-- IMMUTABLE + één expressie => Postgres inlinet 'm, dus indexen blijven bruikbaar.
create or replace function public.mail_row_in_scope(p_owner uuid, p_scope uuid[])
returns boolean
language sql
immutable
as $$
  select p_scope is null or p_owner is null or p_owner = any(p_scope);
$$;

comment on function public.mail_row_in_scope(uuid, uuid[]) is
  'Scope-predikaat voor mail-views/RPCs. NULL-scope = geen restrictie; NULL-owner = gedeeld corpus.';

-- Scope voor SECURITY INVOKER-objecten (alle views, en de RPCs die als caller
-- draaien). Bij een browser-JWT geven we NULL terug: RLS op mail_messages doet
-- daar het werk en we willen de admin-inzage niet stilzwijgend versmallen
-- (MAIL-PIPELINE.md §4 open vraag 2). Zonder JWT (service-role, cron) is de
-- default de org-mailbox — exact wat de agents vandaag impliciet krijgen.
create or replace function public.mail_scope_user_ids(p_user_id uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_user_id is not null            then array[p_user_id]
    when (select auth.uid()) is not null  then null::uuid[]
    else public.rag_owner_scope_ids(null)
  end;
$$;

comment on function public.mail_scope_user_ids(uuid) is
  'Mailbox-scope voor security_invoker-views/RPCs: expliciet > RLS (browser) > org-mailbox (service-role).';

-- Scope voor SECURITY DEFINER-RPCs. Daar geldt geen RLS, dus een ingelogde
-- caller moet expliciet op zichzelf gescoopt worden; anders zou mailbox #2
-- gewoon de org-mailbox kunnen uitlezen via een definer-RPC.
create or replace function public.mail_definer_scope_ids(p_user_id uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_user_id is not null            then array[p_user_id]
    when (select auth.uid()) is not null  then array[(select auth.uid())]
    else public.rag_owner_scope_ids(null)
  end;
$$;

comment on function public.mail_definer_scope_ids(uuid) is
  'Mailbox-scope voor SECURITY DEFINER-RPCs: expliciet > de ingelogde user > org-mailbox (service-role).';

-- De mailbox waar een roll-up-view (één rij, geen per-user GROUP BY) op slaat.
-- NULL = niet gerestricteerd (browser/RLS) of meer dan één mailbox in scope.
create or replace function public.mail_scope_single_user_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when cardinality(s.ids) = 1 then s.ids[1] end
    from (select public.mail_scope_user_ids() as ids) s;
$$;

comment on function public.mail_scope_single_user_id() is
  'De ene mailbox waar de huidige scope op slaat, of NULL bij geen/meerdere.';

revoke all on function public.mail_row_in_scope(uuid, uuid[])   from public;
revoke all on function public.mail_scope_user_ids(uuid)         from public;
revoke all on function public.mail_definer_scope_ids(uuid)      from public;
revoke all on function public.mail_scope_single_user_id()       from public;
grant execute on function public.mail_row_in_scope(uuid, uuid[])  to authenticated, service_role;
grant execute on function public.mail_scope_user_ids(uuid)        to authenticated, service_role;
grant execute on function public.mail_definer_scope_ids(uuid)     to authenticated, service_role;
grant execute on function public.mail_scope_single_user_id()      to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. v_mail_inbox_folders — per-account inbox-resolutie
-- -----------------------------------------------------------------------------
-- Vervangt de `well_known_name='inbox' LIMIT 1`-scalar uit v_mail_pending_ai.
-- Precies één rij per mailbox (DISTINCT ON), well_known_name wint van naam-match.
-- Naam-match: 'Inbox'/'Postvak IN' plus het eerste element van
-- mail_accounts.folder_names — de ETL-conventie zet de inbox daar vooraan
-- (DEFAULT_FOLDER_NAMES = ["Inbox","Sent Items","Drafts","Concepten"]).
create or replace view public.v_mail_inbox_folders
with (security_invoker = on) as
  select distinct on (f.user_id)
         f.user_id,
         f.id           as folder_id,
         f.display_name,
         f.full_path,
         case when f.well_known_name = 'inbox' then 'well_known_name' else 'display_name' end as resolved_by
    from public.mail_folders f
    left join public.mail_accounts a on a.user_id = f.user_id
   where f.well_known_name = 'inbox'
      or lower(coalesce(f.full_path, f.display_name)) = any (
           array['inbox', 'postvak in']
           || case when a.folder_names ->> 0 is not null
                   then array[lower(a.folder_names ->> 0)]
                   else array[]::text[] end
         )
   order by f.user_id, (f.well_known_name = 'inbox') desc, f.full_path;

comment on view public.v_mail_inbox_folders is
  'Eén inbox-folder per mailbox. well_known_name wint; anders naam-match op Inbox/Postvak IN/folder_names[0].';

grant select on public.v_mail_inbox_folders to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. mail_threads — GROUP BY user_id, conversation_id
-- -----------------------------------------------------------------------------
-- Zonder user_id in de GROUP BY smelten twee mailboxen die dezelfde
-- conversation_id kennen samen tot één thread met de berichten van allebei.
create or replace view public.mail_threads
with (security_invoker = on) as
  select m.conversation_id,
         count(*)                                                                as message_count,
         max(m.received_at)                                                      as latest_at,
         min(m.received_at)                                                      as first_at,
         array_agg(distinct m.from_email) filter (where m.from_email is not null) as participant_emails,
         bool_or(not m.is_read)                                                  as has_unread,
         bool_or(m.is_from_me)                                                   as has_my_reply,
         -- m.id als tweede sortering: prod heeft ~41 threads met gelijke
         -- received_at, waardoor message_ids in de oude view per run van volgorde
         -- kon wisselen. Zelfde inhoud, nu deterministisch.
         array_agg(m.id order by m.received_at, m.id)                            as message_ids,
         m.user_id
    from public.mail_messages m
   where not m.is_deleted
     and public.mail_row_in_scope(m.user_id, (select public.mail_scope_user_ids()))
   group by m.user_id, m.conversation_id;

comment on view public.mail_threads is
  'Thread-rollup per mailbox. Consumenten die op conversation_id joinen moeten ook op user_id joinen.';

-- -----------------------------------------------------------------------------
-- 4. v_mail_pending_ai — per-account inbox i.p.v. één willekeurige folder
-- -----------------------------------------------------------------------------
create or replace view public.v_mail_pending_ai
with (security_invoker = on) as
  select mm.id as mail_id,
         mm.conversation_id,
         mm.received_at,
         mm.from_email,
         mm.from_name,
         mm.to_recipients,
         mm.cc_recipients,
         mm.subject,
         mm.body_preview,
         mm.has_attachments,
         mm.folder_id,
         mm.folder_path,
         mm.is_read,
         mm.is_calendar_invite,
         mm.user_id
    from public.mail_messages mm
    join public.v_mail_inbox_folders inb
      on inb.user_id = mm.user_id and inb.folder_id = mm.folder_id
   where not mm.is_deleted
     and not mm.is_from_me
     and not mm.is_calendar_invite
     and mm.received_at >= now() - interval '14 days'
     and public.mail_row_in_scope(mm.user_id, (select public.mail_scope_user_ids()))
     and not exists (select 1 from public.autodraft_mails am where am.mail_id = mm.id);

comment on view public.v_mail_pending_ai is
  'Inbox-mails van de laatste 14 dagen zonder autodraft-rij, per mailbox (v_mail_inbox_folders).';

-- -----------------------------------------------------------------------------
-- 5. contact_directory — mail-tak per mailbox
-- -----------------------------------------------------------------------------
-- Blijft één rij per e-mailadres (PARTITION BY email); user_id is die van de
-- winnende bron (NULL voor HubSpot-rijen).
create or replace view public.contact_directory
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  all_sources as (
    select lower(hc.email) as email,
           coalesce(nullif(trim(both from (coalesce(hc.firstname, '') || ' ') || coalesce(hc.lastname, '')), ''), hc.email) as display_name,
           hc.company,
           'hubspot'::text        as source,
           null::timestamptz      as last_seen,
           1                      as source_priority,
           null::uuid             as user_id
      from public.hubspot_contacts hc
     where hc.email is not null and hc.email <> '' and not hc.is_archived
    union all
    select lower(m.from_email)                        as email,
           nullif(trim(both from m.from_name), '')     as display_name,
           null::text                                  as company,
           'mail'::text                                as source,
           max(m.received_at)                          as last_seen,
           2                                           as source_priority,
           m.user_id
      from public.mail_messages m
     where m.from_email is not null and not m.is_from_me and not m.is_deleted
       and public.mail_row_in_scope(m.user_id, (select ids from scope))
     group by lower(m.from_email), nullif(trim(both from m.from_name), ''), m.user_id
  ), ranked as (
    select a.email, a.display_name, a.company, a.source, a.last_seen, a.source_priority, a.user_id,
           row_number() over (
             partition by a.email
             order by a.source_priority,
                      (a.display_name is null or a.display_name like '%@%'),
                      a.last_seen desc nulls last
           ) as rn
      from all_sources a
  )
  select email,
         coalesce(display_name, email) as display_name,
         company,
         source,
         last_seen,
         user_id
    from ranked
   where rn = 1;

-- -----------------------------------------------------------------------------
-- 6. v_missing_hubspot_contacts — afzenders per mailbox tellen
-- -----------------------------------------------------------------------------
-- De drempel mail_count >= 3 hoort per mailbox te gelden: drie mails in mailbox
-- A plus twee in mailbox B is geen contact van vijf mails.
create or replace view public.v_missing_hubspot_contacts
with (security_invoker = on) as
  with scope as (select public.mail_scope_user_ids() as ids),
  all_company_domains as (
    select hc.company_id, lower(nullif(trim(both from hc.domain), '')) as domain
      from public.hubspot_companies hc
     where hc.is_archived = false and hc.domain is not null and length(trim(both from hc.domain)) >= 4
    union
    select ca.company_id, ca.domain
      from public.hubspot_company_aliases ca
  ), contact_emails as (
    select hc.associated_company_id as company_id, lower(hc.email) as email
      from public.hubspot_contacts hc
     where hc.is_archived = false and hc.email is not null and hc.associated_company_id is not null
  ), domain_senders as (
    select acd.company_id,
           acd.domain,
           lower(m.from_email)  as email,
           max(m.from_name)     as sender_name,
           count(*)::integer    as mail_count,
           min(m.received_at)   as first_mail,
           max(m.received_at)   as last_mail,
           m.user_id
      from all_company_domains acd
      join public.mail_messages m on lower(m.from_email) like ('%@' || acd.domain)
     where m.is_deleted = false and m.from_email is not null
       and public.mail_row_in_scope(m.user_id, (select ids from scope))
     group by acd.company_id, acd.domain, lower(m.from_email), m.user_id
  )
  select ds.company_id,
         c.name                  as company_name,
         ds.domain               as matched_domain,
         ds.email                as missing_email,
         ds.sender_name,
         ds.mail_count,
         ds.first_mail,
         ds.last_mail,
         now() - ds.last_mail    as time_since_last_mail,
         ds.user_id
    from domain_senders ds
    join public.hubspot_companies c on c.company_id = ds.company_id
   where ds.mail_count >= 3
     and not exists (
       select 1 from contact_emails ce
        where ce.company_id = ds.company_id and ce.email = ds.email
     )
   order by ds.mail_count desc;

-- -----------------------------------------------------------------------------
-- 7. v_autodraft_action_chunk_source — eigenaar van de beslissing meegeven
-- -----------------------------------------------------------------------------
-- De chunker leest deze view en schrijft er `action`-chunks uit. Die staan nu
-- nog met owner_user_id = NULL in `chunks` (= gedeeld corpus). De user_id-kolom
-- hier is wat de chunker straks nodig heeft om ze per mailbox te bezitten —
-- zie MAIL-STEP7.md "Wat er nog open staat".
create or replace view public.v_autodraft_action_chunk_source
with (security_invoker = on) as
  select d.id::text        as decision_id,
         d.mail_id,
         d.conversation_id,
         d.action_slug,
         d.payload,
         d.was_suggested,
         d.suggested_rank,
         d.outcome,
         d.decided_at,
         d.executed_at,
         d.created_at,
         a.category,
         a.display_name,
         a.target_value,
         m.subject,
         m.from_email,
         m.from_domain,
         m.folder_path,
         coalesce(m.user_id, d.user_id) as user_id
    from public.autodraft_action_decisions d
    left join public.autodraft_actions a on a.slug = d.action_slug
    left join public.mail_messages m on m.id = d.mail_id
   where d.outcome is not null
     and public.mail_row_in_scope(coalesce(m.user_id, d.user_id), (select public.mail_scope_user_ids()));

commit;

-- Nieuwe/gewijzigde signatures voor PostgREST zichtbaar maken.
notify pgrst, 'reload schema';
