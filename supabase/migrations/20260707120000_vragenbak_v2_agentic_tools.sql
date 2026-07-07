-- =============================================================================
-- Vragenbak v2 (agentic) — multi-bron zoek-RPC's + informele-naam entity-resolutie
-- 2026-07-07, project: vervolg op Confluence 471302146.
-- 1. analytics_calendar_search: agenda-events op keyword-regex (met externe
--    deelnemers-filter) voor de agentic route — dekt "welke trainingen gegeven".
-- 2. analytics_notes_search: HubSpot-notities/meetings/calls op keyword-regex.
-- 3. rag_resolve_entity v2: extra branch voor informele/afgekorte bedrijfsnamen
--    ("Vogelaars" → "Vogelaar Bosch Spijer Advocaten") via token-prefix-match.
--    Bestaande branches ongewijzigd; nieuwe branch vuurt alleen als de
--    trgm-branch niets vindt.
-- Alle functies STABLE SECURITY DEFINER, service_role-only (zelfde patroon als
-- de bestaande analytics_*-catalogus), ruim onder de 8s PostgREST-timeout.
-- =============================================================================

create or replace function public.analytics_calendar_search(
  p_keywords_regex text,
  p_from date default null,
  p_to date default null,
  p_external_only boolean default true,
  p_limit int default 40
) returns table(
  subject text, event_date date, location text, external_attendees text,
  organizer text, body_snippet text, scanned_total bigint
)
language sql stable security definer
set search_path to 'public'
as $$
  with scope as (
    select e.id, e.subject, e.start_time, e.location_text, e.body_text, e.body_preview,
           e.organizer_name, e.organizer_email,
           (select string_agg(distinct coalesce(nullif(a.name, ''), a.email), ', ')
            from calendar_attendees a
            where a.calendar_event_id = e.id
              and a.email is not null
              and a.email not ilike '%legal-mind.nl%'
              and a.email not ilike '%legalmind%') as ext_att
    from calendar_events e
    where e.is_deleted = false and coalesce(e.is_cancelled, false) = false
      and (p_from is null or e.start_time >= p_from)
      and (p_to is null or e.start_time < p_to)
  )
  select s.subject, s.start_time::date, nullif(s.location_text, ''), s.ext_att,
         coalesce(nullif(s.organizer_name, ''), s.organizer_email),
         left(regexp_replace(coalesce(s.body_text, s.body_preview, ''), '\s+', ' ', 'g'), 240),
         (select count(*) from scope)
  from scope s
  where (s.subject ~* p_keywords_regex or coalesce(s.body_text, '') ~* p_keywords_regex)
    and (not p_external_only or s.ext_att is not null)
  order by s.start_time desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.analytics_calendar_search(text, date, date, boolean, int) from public, anon, authenticated;
grant execute on function public.analytics_calendar_search(text, date, date, boolean, int) to service_role;

create or replace function public.analytics_notes_search(
  p_keywords_regex text,
  p_from date default null,
  p_to date default null,
  p_types text[] default array['note','meeting','call'],
  p_limit int default 40
) returns table(
  engagement_type text, note_date date, companies text, subject text,
  body_snippet text, scanned_total bigint
)
language sql stable security definer
set search_path to 'public'
as $$
  with scope as (
    select en.id, en.engagement_type, en.hs_timestamp, en.subject,
           regexp_replace(regexp_replace(coalesce(en.body_text, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g') as clean_body,
           (select string_agg(c.name, ' / ')
            from hubspot_companies c
            where c.company_id = any(en.associated_company_ids)) as comps
    from hubspot_engagements en
    where en.is_archived = false
      and en.engagement_type = any(p_types)
      and (p_from is null or en.hs_timestamp >= p_from)
      and (p_to is null or en.hs_timestamp < p_to)
  )
  select s.engagement_type, s.hs_timestamp::date, s.comps, s.subject,
         left(s.clean_body, 300), (select count(*) from scope)
  from scope s
  where (coalesce(s.subject, '') ~* p_keywords_regex or s.clean_body ~* p_keywords_regex)
  order by s.hs_timestamp desc
  limit least(greatest(coalesce(p_limit, 40), 1), 100);
$$;

revoke all on function public.analytics_notes_search(text, date, date, text[], int) from public, anon, authenticated;
grant execute on function public.analytics_notes_search(text, date, date, text[], int) to service_role;

-- rag_resolve_entity v2: + branch 2b (informele bedrijfsnaam, token-prefix).
create or replace function public.rag_resolve_entity(p_query text)
 returns table(entity_type text, entity_id text, name text, via text, matched_term text, confidence numeric, duplicate_count integer)
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_email text;
  v_stop text[] := array['advocaten','advocatuur','advocatenkantoor','advocatenkantoren','kantoor','kantoren','legal','recht','jurist','juristen','notaris','notarissen','holding','group','groep','company','bedrijf','prijs','prijzen','prijsmodel','tarief','tarieven','offerte','offertes','deal','deals','klant','klanten','customer','meeting','meetings','mail','mails','bericht','contact','contacten','partner','partners','team','update','status','samenwerking','overzicht',
    'waarom','welke','welk','hoeveel','wanneer','willen','eigen','genoemd','hebben','heeft','kunnen','moeten','onze','deze','laatste','recente','recent','huidige','stand','zaken','zoals','tussen','rondom','omtrent','vanuit','informatie','vraag','vragen','geef','vertel','toon','dossier','koppeling','argumenten','afgesproken','besproken','gemaild','recentste',
    'afdronk','momenteel','afgelopen','vorige','maand','week','training','trainingen','gegeven','gechurnd','geturned'];
begin
  if p_query is null or length(trim(p_query)) < 3 then return; end if;

  v_email := (regexp_match(lower(p_query), '[\w.+-]+@[\w-]+\.[\w.-]+'))[1];
  if v_email is not null then
    return query
      select 'contact'::text, er.entity_id, v_email, 'email_exact'::text, v_email, er.confidence, 1
      from entity_resolution er
      where er.alias_type='email' and er.alias_value=v_email and er.entity_type='contact'
      order by er.confidence desc limit 1;
    if found then return; end if;
  end if;

  return query
  with cands as (
    select c.company_id::text as eid, c.name as nm,
           word_similarity(c.name, p_query) as sim, count(*) over () as dup
    from hubspot_companies c
    where c.is_archived = false and c.name is not null and length(c.name) >= 3
      and word_similarity(c.name, p_query) > 0.5
      and exists (
        select 1 from regexp_split_to_table(lower(c.name), '[^a-z0-9]+') tok
        where length(tok) >= 4 and tok <> all (v_stop)
          and lower(p_query) ~ ('\m'||tok||'\M')
      )
    order by sim desc limit 3
  )
  select 'company'::text, eid, nm, 'company_trgm'::text, nm,
         round(least(0.5 + sim*0.5, 0.97)::numeric, 2), dup::int
  from cands order by sim desc limit 1;
  if found then return; end if;

  -- 2b (Vragenbak v2, 2026-07-07): informele/afgekorte bedrijfsnaam.
  -- Een query-woord (>=5 tekens, geen stopwoord) matcht een naam-token op
  -- prefix in één van beide richtingen: "Vogelaars" ~ token "vogelaar".
  -- Tie-break: beste token-similarity, dan recentst gewijzigd in HubSpot.
  -- duplicate_count > 1 laat de disambiguatie-UI zijn werk doen.
  return query
  with qwords as (
    select w from regexp_split_to_table(lower(p_query), '[^a-zà-ÿ0-9]+') w
    where length(w) >= 5 and w <> all (v_stop)
  ),
  hits as (
    select c.company_id::text as eid, c.name as nm, c.hs_lastmodifieddate as lastmod,
           max(similarity(tok.tok, qw.w)) as sim
    from hubspot_companies c
    cross join lateral regexp_split_to_table(lower(c.name), '[^a-zà-ÿ0-9]+') as tok(tok)
    join qwords qw on (length(tok.tok) >= 5 and tok.tok <> all (v_stop)
                       and (tok.tok = qw.w or qw.w like tok.tok || '%' or tok.tok like qw.w || '%'))
    where c.is_archived = false and c.name is not null
    group by c.company_id, c.name, c.hs_lastmodifieddate
  ),
  ranked as (
    select h.*, count(*) over () as dup from hits h
  )
  select 'company'::text, eid, nm, 'company_token_prefix'::text, nm,
         0.72::numeric, dup::int
  from ranked order by sim desc nulls last, lastmod desc nulls last limit 1;
  if found then return; end if;

  return query
  with cands as (
    select d.deal_id::text as eid, d.dealname as nm, word_similarity(d.dealname, p_query) as sim
    from hubspot_deals d
    where d.is_archived = false and d.dealname is not null and length(d.dealname) >= 3
      and word_similarity(d.dealname, p_query) > 0.5
      and exists (
        select 1 from regexp_split_to_table(lower(d.dealname), '[^a-z0-9]+') tok
        where length(tok) >= 4 and tok <> all (v_stop)
          and lower(p_query) ~ ('\m'||tok||'\M')
      )
    order by sim desc limit 1
  )
  select 'deal'::text, eid, nm, 'deal_trgm'::text, nm, round(least(0.5+sim*0.5,0.95)::numeric,2), 1
  from cands;
  if found then return; end if;

  return query
  with cands as (
    select er.entity_id as eid, er.alias_value as nm, word_similarity(er.alias_value, p_query) as sim
    from entity_resolution er
    where er.alias_type='name' and er.entity_type='contact' and length(er.alias_value) >= 4
      and word_similarity(er.alias_value, p_query) > 0.6
      and exists (
        select 1 from regexp_split_to_table(lower(er.alias_value), '[^a-z0-9]+') tok
        where length(tok) >= 4 and tok <> all (v_stop)
          and lower(p_query) ~ ('\m'||tok||'\M')
      )
    order by sim desc limit 1
  )
  select 'contact'::text, eid, nm, 'contact_name_trgm'::text, nm, round(least(0.5+sim*0.4,0.9)::numeric,2), 1
  from cands;
  return;
end $function$;
