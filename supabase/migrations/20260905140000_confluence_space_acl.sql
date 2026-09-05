-- =============================================================================
-- Confluence per-user space-ACL                              (v1.145, 2026-09-05)
-- =============================================================================
-- v1.142 legde de org-brede spiegel aan met één bewuste vereenvoudiging:
-- `chunks.owner_user_id` blijft NULL, dus IEDEREEN die de index mag lezen zag
-- ELKE gespiegelde space. Dat klopte zolang er één gebruiker was. Het klopt niet
-- meer zodra er een tweede bij komt, want de wiki is NIET vlak:
--
--   Gemeten 2026-09-05 op `bg-intelligence.atlassian.net` via
--   `GET /wiki/api/v2/spaces/{id}/permissions` (org-token):
--
--     space      read-principals
--     LM         group confluence-users-bg-intelligence  (+ admins, org-admins)
--     LM1  LE    idem
--     LE1  AI    idem
--     BI         idem
--     Marketing  idem
--     MT         GEEN ENKELE GROEP — 5 met naam genoemde personen
--
--   `MT` is dus de restricted space uit Jelle's voorbeeld: read hangt daar aan
--   individuen, niet aan "iedereen met een licentie". 21 pagina's / ~50 chunks
--   die vandaag voor elke ingelogde Maestro-gebruiker vindbaar zouden zijn.
--
-- ── Het model ───────────────────────────────────────────────────────────────
--
-- Eén regel: **een gebruiker ziet space S alleen als er een grant-rij bestaat.**
-- Geen rij = geen toegang. Er is geen "en anders mag het wel"-tak.
--
--   confluence_spaces          wat bestaat er, wie mag het lezen (uit Confluence)
--   confluence_identities      Maestro-user  ⇄  Atlassian-accountId
--   confluence_space_grants    het gematerialiseerde resultaat (user × space)
--
-- De grants worden NIET met de hand onderhouden: `confluence-acl-sync` leest
-- per space de read-permissies, klapt leesgroepen uit naar hun leden, en
-- herberekent. Confluence blijft de bron van waarheid — we spiegelen zijn
-- rechten, we verzinnen ze niet.
--
-- ── Waarom gematerialiseerd en niet live ────────────────────────────────────
--
-- Een live permission-check per chat-turn zou 1 Confluence-call per space per
-- vraag kosten bovenop een retrieval-pad dat nu al 17-21 s doet (zie
-- rag-chat/agentic.ts). De rechten wijzigen ~nooit; de vragen komen continu.
-- Gematerialiseerd is hier zowel sneller als eerlijker: het is te inspecteren
-- (`confluence_acl_debug`) en te testen zonder Atlassian erbij te halen.
--
-- ── Wie mag namens wie vragen ───────────────────────────────────────────────
--
-- `confluence_allowed_spaces(p_user)` NEGEERT `p_user` als de aanroeper een
-- browsersessie is (`auth.role() = 'authenticated'`): dan is `auth.uid()` de
-- enige waarheid en kun je niet de spaces van een collega opvragen door een
-- andere uuid mee te geven. Alleen server-to-server (service_role, pg_cron,
-- psql) mag namens iemand anders vragen — die heeft de service-key toch al.
--
-- ── De onbekende aanroeper ──────────────────────────────────────────────────
--
-- Cron-agents (auto-draft, meeting-briefing) hebben geen `auth.uid()` en geen
-- Atlassian-identiteit. Die krijgen `org_baseline`-spaces: precies de spaces
-- waar Confluence zélf read aan een brede licentiegroep geeft, dus NOOIT een
-- restricted space als MT. Een gebruiker zonder herkende identiteit krijgt
-- niets — hij kan in Confluence zelf ook niets openen.
-- =============================================================================

-- ─── 1. Spaces + hun leesrechten, zoals Confluence ze rapporteert ────────────
create table if not exists public.confluence_spaces (
  space_key         text        primary key,
  space_id          text,
  name              text        not null default '',
  space_type        text,                       -- global | collaboration | knowledge_base | personal
  status            text        not null default 'current',  -- current | archived
  -- 'open'       = read aan een groep uit agent_config('confluence-acl','open_groups')
  -- 'restricted' = read alleen aan met naam genoemde personen / smalle groepen
  visibility        text        not null default 'restricted',
  -- Effectief: met naam genoemde lezers PLUS de leden van elke leesgroep.
  -- Uitklappen gebeurt in confluence-acl-sync, zodat de grant-berekening hier
  -- één array-vergelijking is en geen groepslidmaatschap hoeft te kennen.
  read_account_ids  text[]      not null default '{}',
  -- Alleen de met naam genoemden. Puur voor `via`-attributie en debug.
  direct_account_ids text[]     not null default '{}',
  read_group_names  text[]      not null default '{}',
  -- Spiegelen we deze space? Staat in agent_config('confluence-sync-etl','spaces').
  -- Een space die we niet spiegelen heeft geen chunks; hem uit de allowlist
  -- houden maakt `confluence_allowed_spaces` eerlijk in plaats van hoopvol.
  is_mirrored       boolean     not null default false,
  -- Mag een aanroeper ZONDER identiteit (cron-agent) hier in zoeken?
  -- Default false; acl-sync zet dit gelijk aan (visibility = 'open').
  org_baseline      boolean     not null default false,
  page_count        integer     not null default 0,
  synced_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.confluence_spaces is
  'Confluence-spaces + hun READ-principals, gespiegeld uit /wiki/api/v2/spaces/{id}/permissions door confluence-acl-sync (v1.145). Basis voor de per-user space-ACL op de RAG-index.';
comment on column public.confluence_spaces.read_account_ids is
  'Effectieve lezers: met naam genoemde accountIds PLUS de leden van elke leesgroep. Uitgeklapt door confluence-acl-sync.';
comment on column public.confluence_spaces.org_baseline is
  'true = een aanroeper zonder Atlassian-identiteit (cron-agent) mag hier in zoeken. Wordt gelijkgezet aan (visibility=''open''); een restricted space komt hier nooit in.';

create index if not exists confluence_spaces_mirrored_idx
  on public.confluence_spaces (is_mirrored) where is_mirrored = true;

drop trigger if exists confluence_spaces_touch on public.confluence_spaces;
create trigger confluence_spaces_touch
  before update on public.confluence_spaces
  for each row execute function public.set_updated_at();

alter table public.confluence_spaces enable row level security;

drop policy if exists confluence_spaces_read on public.confluence_spaces;
create policy confluence_spaces_read on public.confluence_spaces
  for select to authenticated using ((select public.is_admin_or_higher()));

drop policy if exists confluence_spaces_service on public.confluence_spaces;
create policy confluence_spaces_service on public.confluence_spaces
  for all to service_role using (true) with check (true);

-- ─── 2. Maestro-user ⇄ Atlassian-account ─────────────────────────────────────
-- Bron-voorkeur (hoog → laag), afgehandeld in confluence-acl-sync:
--   1. `user_connectors(provider='confluence').account_email` — de gebruiker
--      heeft zelf gekoppeld, dus dit IS zijn Atlassian-identiteit.
--   2. `auth.users.email` — zelfde mailadres op de site = dezelfde persoon.
--   3. handmatig (`source='manual'`) — voor wie een ander mailadres gebruikt.
-- Geen match = geen identiteit = geen enkele space. Dat is opzet: raden wie
-- iemand in Confluence is, is precies de fout die deze tabel moet voorkomen.
create table if not exists public.confluence_identities (
  user_id               uuid        primary key references auth.users(id) on delete cascade,
  atlassian_account_id  text        not null,
  atlassian_email       text,
  display_name          text,
  source                text        not null default 'email_match',  -- connector | email_match | manual
  resolved_at           timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint confluence_identities_account_uniq unique (atlassian_account_id)
);

comment on table public.confluence_identities is
  'Maestro-user ⇄ Atlassian-accountId. Zonder rij heeft een gebruiker GEEN Confluence-leesrechten in de RAG-index (fail-closed).';

drop trigger if exists confluence_identities_touch on public.confluence_identities;
create trigger confluence_identities_touch
  before update on public.confluence_identities
  for each row execute function public.set_updated_at();

alter table public.confluence_identities enable row level security;

drop policy if exists confluence_identities_read_own on public.confluence_identities;
create policy confluence_identities_read_own on public.confluence_identities
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists confluence_identities_service on public.confluence_identities;
create policy confluence_identities_service on public.confluence_identities
  for all to service_role using (true) with check (true);

-- ─── 3. De grants: het gematerialiseerde antwoord ────────────────────────────
create table if not exists public.confluence_space_grants (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  space_key   text        not null references public.confluence_spaces(space_key) on delete cascade,
  -- user = met naam in de space-permissies · group = via een leesgroep
  -- manual = door Jelle gezet, wordt door acl-sync NIET weggegooid
  via         text        not null default 'group',
  synced_at   timestamptz not null default now(),
  primary key (user_id, space_key)
);

comment on table public.confluence_space_grants is
  'Wie mag welke Confluence-space lezen. Gematerialiseerd uit confluence_spaces × confluence_identities door confluence_recompute_grants(). via=''manual'' overleeft een hersync.';

create index if not exists confluence_space_grants_user_idx
  on public.confluence_space_grants (user_id);

alter table public.confluence_space_grants enable row level security;

drop policy if exists confluence_space_grants_read_own on public.confluence_space_grants;
create policy confluence_space_grants_read_own on public.confluence_space_grants
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists confluence_space_grants_service on public.confluence_space_grants;
create policy confluence_space_grants_service on public.confluence_space_grants
  for all to service_role using (true) with check (true);

-- ─── 4. Config: welke groepen gelden als "iedereen" ──────────────────────────
insert into public.agent_config (agent_name, config_key, config_value)
select 'confluence-acl', 'open_groups',
       '["confluence-users-bg-intelligence","confluence-users-legal-mind"]'::jsonb
where not exists (
  select 1 from public.agent_config
   where agent_name = 'confluence-acl' and config_key = 'open_groups'
);

-- ─── 5. De resolver ──────────────────────────────────────────────────────────
create or replace function public.confluence_allowed_spaces(p_user uuid default null)
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with caller as (
    -- Een browsersessie mag NOOIT namens een ander vragen: p_user wordt daar
    -- genegeerd. Alleen service_role / pg_cron / psql mag dat, en die heeft de
    -- service-key toch al.
    select case
      when coalesce(auth.role(), '') = 'authenticated' then auth.uid()
      else coalesce(p_user, auth.uid())
    end as uid
  )
  select coalesce(array_agg(distinct s.space_key), array[]::text[])
    from public.confluence_spaces s
   where s.is_mirrored = true
     and s.status = 'current'
     and case
           -- Bekende aanroeper: exact wat Confluence hem geeft.
           when (select uid from caller) is not null
             then exists (
               select 1 from public.confluence_space_grants g
                where g.user_id = (select uid from caller)
                  and g.space_key = s.space_key
             )
           -- Onbekende aanroeper (cron-agent): alleen de brede spaces.
           else s.org_baseline
         end;
$function$;

comment on function public.confluence_allowed_spaces(uuid) is
  'Welke Confluence-spaces mag deze aanroeper zien? Fail-closed: geen grant = niet in de lijst. Negeert p_user voor role=authenticated (dan is auth.uid() de waarheid). Aanroeper zonder identiteit krijgt alleen org_baseline-spaces, dus nooit een restricted space.';

-- ─── 6. Grants herberekenen ──────────────────────────────────────────────────
create or replace function public.confluence_recompute_grants()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  v_rows integer;
BEGIN
  -- Handmatige grants blijven staan; de afgeleide worden opnieuw opgebouwd.
  DELETE FROM public.confluence_space_grants WHERE via <> 'manual';

  INSERT INTO public.confluence_space_grants (user_id, space_key, via, synced_at)
  SELECT i.user_id,
         s.space_key,
         CASE WHEN i.atlassian_account_id = ANY (s.direct_account_ids) THEN 'user' ELSE 'group' END,
         now()
    FROM public.confluence_identities i
    JOIN public.confluence_spaces s
      ON i.atlassian_account_id = ANY (s.read_account_ids)
   WHERE s.status = 'current'
  ON CONFLICT (user_id, space_key) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $function$;

comment on function public.confluence_recompute_grants() is
  'Bouwt confluence_space_grants opnieuw op uit confluence_spaces.read_account_ids × confluence_identities. via=''manual'' blijft ongemoeid. Aangeroepen door confluence-acl-sync.';

-- ─── 7. Debug / bewijsmateriaal ──────────────────────────────────────────────
-- Bestaat zodat de ACL te TESTEN is zonder Atlassian erbij te halen, en zodat
-- een audit kan zien waarom iemand iets wel of niet ziet.
create or replace function public.confluence_acl_debug(p_user uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'asked_for', p_user,
    'effective_user', case when coalesce(auth.role(), '') = 'authenticated' then auth.uid()
                           else coalesce(p_user, auth.uid()) end,
    'caller_role', coalesce(auth.role(), 'none'),
    'has_identity', exists (
      select 1 from public.confluence_identities i
       where i.user_id = case when coalesce(auth.role(), '') = 'authenticated' then auth.uid()
                              else coalesce(p_user, auth.uid()) end),
    'allowed_spaces', public.confluence_allowed_spaces(p_user),
    'mirrored_spaces', (select coalesce(array_agg(space_key order by space_key), '{}')
                          from public.confluence_spaces where is_mirrored),
    'restricted_spaces', (select coalesce(array_agg(space_key order by space_key), '{}')
                            from public.confluence_spaces
                           where is_mirrored and visibility = 'restricted'),
    'visible_pages', (select count(*) from public.confluence_pages p
                       where p.is_archived = false
                         and p.space_key = ANY (public.confluence_allowed_spaces(p_user))),
    'visible_chunks', (select count(*) from public.chunks c
                        where c.source = 'confluence'
                          and c.source_id in (
                            select p.page_id from public.confluence_pages p
                             where p.is_archived = false
                               and p.space_key = ANY (public.confluence_allowed_spaces(p_user))))
  );
$function$;

grant execute on function public.confluence_allowed_spaces(uuid) to authenticated, service_role;
grant execute on function public.confluence_acl_debug(uuid)      to authenticated, service_role;
grant execute on function public.confluence_recompute_grants()   to service_role;

-- ─── 8. Seed: de 8 gespiegelde spaces, gemeten 2026-09-05 ────────────────────
-- Zodat de ACL vanaf de migratie klopt in plaats van pas na de eerste
-- acl-sync-ronde. `read_account_ids` blijft hier LEEG — die klapt acl-sync uit;
-- de grants komen dus uit de echte Confluence-rechten, niet uit deze seed.
insert into public.confluence_spaces
  (space_key, space_id, name, space_type, status, visibility, read_group_names, is_mirrored, org_baseline)
values
  ('LM',        '18612403',  'Legal Mind',      'global',         'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('LM1',       '20971526',  'Legal Mind',      'global',         'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('LE',        '136511491', 'Legal Mind',      'global',         'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('LE1',       '524746764', 'Legal Engineer',  'knowledge_base', 'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('AI',        '378732548', 'AI',              'collaboration',  'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('BI',        '305528847', 'Data',            'collaboration',  'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  ('Marketing', '466911236', 'Marketing',       'collaboration',  'current', 'open',       array['confluence-users-bg-intelligence'], true, true),
  -- Geen enkele groep in de read-permissies: dit is de restricted space.
  ('MT',        '509116420', 'MT',              'collaboration',  'current', 'restricted', array[]::text[],                           true, false)
on conflict (space_key) do nothing;

-- ─── 9. Het HANDHAVEN staat NIET in deze migratie ────────────────────────────
-- Deze migratie is bewust puur additief: tabellen, resolver, seed. Zolang
-- `confluence_identities` leeg is geeft de resolver namelijk een LEGE lijst —
-- fail-closed werkt, maar zou Jelle's eigen wiki-toegang afsnijden op het
-- moment dat de migratie landt en vóór de eerste acl-sync-ronde.
--
-- De volgorde die daarom geldt bij uitrollen:
--   1. deze migratie          (tabellen + resolver, niets handhaaft nog)
--   2. confluence-acl-sync    (spaces + identiteiten + grants vullen)
--   3. verifiëren             (confluence_acl_debug: Jelle heeft zijn spaces)
--   4. 20260905140500 + 140600 (match_chunks-patch + RLS: nú gaat het gelden)
--
-- Stap 4 omdraaien met stap 2 geeft een venster waarin de chat "geen
-- Confluence-fragmenten" zegt terwijl er 1009 chunks staan. Stilte is geen
-- error, dus dat venster zou niemand opvallen — precies de faalmodus uit de
-- P0 van 2026-06-02.
