-- Vragenbak v2 fix (2026-07-07): rag_resolve_entity branch 2b tie-break op
-- relatie-historie. "Vogelaars" matchte 3 kantoren; lastmod-recency koos het
-- verkeerde (geen klantrelatie). Nieuwe ranking: churn-record (was klant) >
-- deals aanwezig > token-similarity > lastmod.
-- Live geverifieerd: 'Wat is de afdronk bij Vogelaars momenteel?' →
-- Vogelaar Bosch Spijer Advocaten (333360642265), duplicate_count 5.
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

  -- 2b: informele/afgekorte bedrijfsnaam, tie-break op relatie-historie.
  return query
  with qwords as (
    select w from regexp_split_to_table(lower(p_query), '[^a-zà-ÿ0-9]+') w
    where length(w) >= 5 and w <> all (v_stop)
  ),
  hits as (
    select c.company_id::text as eid, c.name as nm, c.hs_lastmodifieddate as lastmod,
           max(similarity(tok.tok, qw.w)) as sim,
           (case when exists(select 1 from churn_customers cc where cc.company_id = c.company_id::text and cc.superseded = false) then 2 else 0 end
            + case when exists(select 1 from hubspot_deals d where c.company_id = any(d.associated_company_ids) and d.is_archived = false) then 1 else 0 end) as rel_score
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
  from ranked order by rel_score desc, sim desc nulls last, lastmod desc nulls last limit 1;
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
