-- =============================================================================
-- 06b WP3 — analytics_notes_search: dekking erbij, de scan eraf
-- =============================================================================
-- Gemeten (RESEARCH.md §1.9, prod 2026-09-07):
--   * De RPC-default `p_types = {note,meeting,call}` dekt 1.244 van 11.586
--     niet-gearchiveerde engagements. `email` (9.783) en `task` (559) zijn voor élk
--     keyword-pad onzichtbaar, en `rag-chat/agentic.ts` geeft `p_types` niet door —
--     dus die default is altijd van kracht. 145 aanroepen / 90 d, p50 211 ms,
--     p95 581 ms, 2 fouten, 7 nul-rijen: een DEKKINGS-, geen latencyprobleem.
--   * `~*` naar `websearch_to_tsquery('dutch', …)` VERLIEST recall: 145 → 107 en
--     127 → 78 treffers op dezelfde populatie, een strikte deelverzameling zonder
--     één treffer die de regex mist (de NL-stemmer matcht geen samenstellingen).
--     Daarom blijft `~*` staan en komt er een trigram-index bij; pg_trgm 1.6 staat aan.
--   * Met `email` erbij duurde de ONGEÏNDEXEERDE vorm 4.560–5.478 ms (tegen
--     1.292–2.050 ms op de kleine populatie). Twee oorzaken, beide hier weg:
--       (a) twee `regexp_replace` per rij over 30,6 MB body → nu een STORED
--           gegenereerde kolom `body_clean`, één keer berekend bij schrijven;
--       (b) `scanned_total = (select count(*) from scope)` maakte de CTE
--           twee-keer-gerefereerd en dus GEMATERIALISEERD: elke aanroep bouwde de
--           volledige scope inclusief bodies, ook als er drie treffers waren.
--           Nu is de telling een losse count over `idx_hs_eng_type` en loopt het
--           treffer-pad over de trigram-index.
--
-- Geen nieuwe zichtbaarheid. De engagement-bodies die `email` toevoegt staan al
-- zonder eigenaarsscope in `chunks` (11.588 engagement-chunks, `owner_user_id` null)
-- en zijn dus via `semantic_search` al voor elke aanroeper bereikbaar; HubSpot heeft
-- geen per-user-ACL (RESEARCH §2.2). Deze migratie verbreedt de dekking van het
-- keyword-pad naar wat het vector-pad al zag.
--
-- Terugdraaien: `drop index` × 2, `alter table … drop column body_clean`, en deze
-- functie terug naar de definitie van migratie 20260707120000.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. body_clean: dezelfde twee regexen als de RPC deed, nu één keer bij schrijven
-- -----------------------------------------------------------------------------
-- Beide `regexp_replace(text,text,text,text)` en `coalesce` zijn IMMUTABLE, dus
-- toegestaan in een generated column. STORED (Postgres kent geen VIRTUAL), dus dit
-- is een tabel-rewrite over 11.586 rijen — seconden, niet minuten.
ALTER TABLE public.hubspot_engagements
  ADD COLUMN IF NOT EXISTS body_clean text
  GENERATED ALWAYS AS (
    regexp_replace(regexp_replace(coalesce(body_text, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g')
  ) STORED;

COMMENT ON COLUMN public.hubspot_engagements.body_clean IS
  '06b WP3: HTML-gestripte, witruimte-gecollapste body. Identieke uitdrukking aan de '
  'twee regexp_replace die analytics_notes_search per aanroep per rij deed.';

-- -----------------------------------------------------------------------------
-- 2. Trigram-indexen — `~*` blijft de matcher, pg_trgm doet de voorselectie
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hs_eng_body_clean_trgm
  ON public.hubspot_engagements USING gin (body_clean gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_hs_eng_subject_trgm
  ON public.hubspot_engagements USING gin (subject gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 3. De RPC: dezelfde signatuur, bredere default, geen gematerialiseerde scope
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE met identieke argumenttypes → vervanging, geen overload, en de
-- proacl blijft staan (geheugen `drop-function-verliest-proacl`). Alleen de
-- `p_types`-default en het lichaam wijzigen; de RETURNS-vorm is byte-gelijk, zodat
-- `rag-chat/agentic.ts` niets hoeft te weten.
CREATE OR REPLACE FUNCTION public.analytics_notes_search(
  p_keywords_regex text,
  p_from date DEFAULT NULL::date,
  p_to date DEFAULT NULL::date,
  p_types text[] DEFAULT ARRAY['note'::text, 'meeting'::text, 'call'::text, 'email'::text, 'task'::text],
  p_limit integer DEFAULT 40)
 RETURNS TABLE(engagement_type text, note_date date, companies text, subject text, body_snippet text, scanned_total bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- `p_types => null` is NIET hetzelfde als de parameter weglaten: `= any(NULL)`
  -- geeft NULL en dus NUL rijen. Gemeten tijdens de implementatie van 06b: een
  -- expliciete null leverde 0 treffers waar de default 40 gaf — een stil leeg
  -- resultaat, precies wat spoor 02 uit de keten probeert te halen. Vandaar de
  -- coalesce op beide plekken; hij staat inline en niet in een CTE, want
  -- `= any((select … ))` leest Postgres als een subquery-ANY en niet als array-ANY.
  with scanned as (
    -- Losse telling: draait op idx_hs_eng_type en leest geen body.
    select count(*)::bigint as n
      from hubspot_engagements en
     where en.is_archived = false
       and en.engagement_type = any(coalesce(nullif(p_types, '{}'::text[]),
             array['note','meeting','call','email','task']))
       and (p_from is null or en.hs_timestamp >= p_from)
       and (p_to is null or en.hs_timestamp < p_to)
  ),
  hits as (
    -- Treffer-pad: `~*` op twee trigram-geïndexeerde kolommen. Eén keer
    -- gerefereerd, dus inlinebaar; de LIMIT knijpt vóór de bedrijfsnaam-lookup.
    select en.id, en.engagement_type, en.hs_timestamp, en.subject,
           en.associated_company_ids, left(en.body_clean, 300) as snippet
      from hubspot_engagements en
     where en.is_archived = false
       and en.engagement_type = any(coalesce(nullif(p_types, '{}'::text[]),
             array['note','meeting','call','email','task']))
       and (p_from is null or en.hs_timestamp >= p_from)
       and (p_to is null or en.hs_timestamp < p_to)
       and (coalesce(en.subject, '') ~* p_keywords_regex or en.body_clean ~* p_keywords_regex)
     order by en.hs_timestamp desc
     limit least(greatest(coalesce(p_limit, 40), 1), 100)
  )
  select h.engagement_type,
         h.hs_timestamp::date,
         (select string_agg(c.name, ' / ')
            from hubspot_companies c
           where c.company_id = any(h.associated_company_ids)) as companies,
         h.subject,
         h.snippet,
         (select n from scanned)
    from hits h
   order by h.hs_timestamp desc;
$function$;

COMMENT ON FUNCTION public.analytics_notes_search(text, date, date, text[], integer) IS
  'Keyword-zoek over hubspot_engagements. 06b WP3 (2026-09-07): p_types-default verbreed '
  'naar {note,meeting,call,email,task} (was {note,meeting,call} = 1.244 van 11.586 rijen; '
  'agentic.ts geeft p_types niet door), matcher blijft ~* omdat tsquery 26-39 % recall '
  'verliest, en het lichaam leest de STORED kolom body_clean via twee gin_trgm-indexen '
  'in plaats van twee regexp_replace per rij over een gematerialiseerde scope.';
