-- =============================================================================
-- Confluence-spiegel: tabel + sync-state + chunker-bron        (v1.142, 2026-09-04)
-- =============================================================================
-- v1.141 legde de per-user Confluence-KOPPELING aan maar bewust geen spiegel:
-- de kaart zei letterlijk dat de chat er niets mee kon. Dit is de volgende stap
-- uit die kop (`connectors-confluence/index.ts`): tabel → ETL → chunker-bron →
-- en pas dán vindt de chat er iets, uit `chunks`, nooit live.
--
-- ── Waarom een spiegel en geen live-zoektool (gemeten 2026-09-04) ────────────
--
--   • 822 pagina's op de site, 592 in de global/collab-spaces. Wijzigingstempo
--     over 30 dagen: 61 pagina's ≈ 2/dag; de `LM`-space zelf 1 in 30 dagen.
--     Mediaan 8,4 kB storage-XHTML. Dat is ~900-1500 chunks bovenop de 47.100
--     die er staan: ~$0,10 eenmalig, ~$0,01/maand.
--   • `semantic_search` gaat via context-build en dat duurt nu al 17-21 s
--     (v1.141-comment in rag-chat/agentic.ts). Er per chat-turn een live
--     Confluence-call bovenop leggen maakt een bekend traagheidsprobleem erger;
--     uit `chunks` lezen kost nul extra.
--   • Live treffers zijn keyword-only: geen embedding, geen recency-weging,
--     geen RRF, geen contextual prefix. Ze zijn niet vergelijkbaar met de rest
--     van de index en dus niet eerlijk te citeren naast mail en meetings.
--
-- ── Waarom ORG-token en niet de per-user grant ───────────────────────────────
--
-- De inhoud is voor iedereen dezelfde wiki. Zou elke gebruiker met zijn eigen
-- grant spiegelen, dan stond dezelfde pagina N keer in de index. De ETL leest
-- daarom met het bestaande org-token (Vault `skill:global:atlassian_api_token`),
-- en `owner_user_id` op de chunks blijft NULL = org-breed zichtbaar. De
-- per-user Confluence-koppeling blijft wat hij is: een connect-status.
--
-- ── Waarom space-gescopeerd ──────────────────────────────────────────────────
--
-- `bg-intelligence.atlassian.net` is een GEDEELDE site: 50+ spaces, waarvan 39
-- pagina's in persoonlijke spaces (`~…`) en ~200 in spaces van andere teams en
-- leveranciers. Alles spiegelen zou andermans aantekeningen in Jelle's
-- RAG-antwoorden laten opduiken. Welke spaces meedoen staat daarom in
-- `agent_config('confluence-sync-etl','spaces')`; persoonlijke spaces worden
-- door de ETL sowieso geweigerd, ongeacht configuratie.
-- =============================================================================

-- ─── 1. De spiegel ───────────────────────────────────────────────────────────
create table if not exists public.confluence_pages (
  page_id               text        primary key,
  space_key             text        not null,
  title                 text        not null,
  -- Platte tekst, niet storage-XHTML. De chunker embedt tekst; XHTML met
  -- `ac:structured-macro`-rommel strippen op leesmoment zou dezelfde regex op
  -- twee plekken zetten. De ETL is de enige die Confluence-opmaak kent.
  body_text             text,
  -- Confluence's eigen versienummer. Monotoon en ondubbelzinnig — dit is waar
  -- "moet ik opnieuw chunken?" op hangt, niet op een timestamp.
  version               integer     not null default 1,
  confluence_updated_at timestamptz,
  url                   text,
  parent_id             text,
  -- true = niet meer gezien in een volledige ronde (verwijderd of buiten scope).
  -- De ETL ruimt dan ook de chunks op; de rij blijft staan als spoor.
  is_archived           boolean     not null default false,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table  public.confluence_pages is
  'Org-brede Confluence-spiegel (v1.142). Gevuld door confluence-sync-etl met het ORG-Vault-token, space-gescopeerd. Voedt chunks(source=''confluence''); de chat leest nooit live Confluence.';
comment on column public.confluence_pages.version is
  'Confluence version.number. De chunker chunkt een pagina opnieuw zodra dit hoger is dan de versie in chunks.metadata->>''version''.';
comment on column public.confluence_pages.is_archived is
  'true = niet meer gezien in een volledige ronde. confluence-sync-etl verwijdert dan de bijbehorende chunks.';

create index if not exists confluence_pages_space_idx    on public.confluence_pages (space_key);
create index if not exists confluence_pages_updated_idx  on public.confluence_pages (confluence_updated_at desc nulls last);
create index if not exists confluence_pages_archived_idx on public.confluence_pages (is_archived) where is_archived = false;

drop trigger if exists confluence_pages_touch on public.confluence_pages;
create trigger confluence_pages_touch
  before update on public.confluence_pages
  for each row execute function public.set_updated_at();

alter table public.confluence_pages enable row level security;

-- Lezen: zelfde niveau als de andere org-spiegels (hubspot_deals, jira_issues).
drop policy if exists confluence_pages_read on public.confluence_pages;
create policy confluence_pages_read on public.confluence_pages
  for select to authenticated
  using ((select public.is_admin_or_higher()));

-- Schrijven doet alleen de ETL. Geen user-write-policy: een pagina bewerk je in
-- Confluence, niet in de spiegel.
drop policy if exists confluence_pages_service on public.confluence_pages;
create policy confluence_pages_service on public.confluence_pages
  for all to service_role using (true) with check (true);

-- ─── 2. Sync-state (singleton, zoals hubspot_sync_state) ─────────────────────
create table if not exists public.confluence_sync_state (
  id                 smallint    primary key default 1,
  last_full_sync     timestamptz,
  last_delta_sync    timestamptz,
  total_pages        integer     not null default 0,
  last_error         text,
  last_error_at      timestamptz,
  notes              text,
  updated_at         timestamptz not null default now(),
  constraint confluence_sync_state_singleton check (id = 1)
);

alter table public.confluence_sync_state enable row level security;

drop policy if exists confluence_sync_state_read on public.confluence_sync_state;
create policy confluence_sync_state_read on public.confluence_sync_state
  for select to authenticated
  using ((select public.is_admin_or_higher()));

drop policy if exists confluence_sync_state_service on public.confluence_sync_state;
create policy confluence_sync_state_service on public.confluence_sync_state
  for all to service_role using (true) with check (true);

insert into public.confluence_sync_state (id) values (1) on conflict (id) do nothing;

-- ─── 3. Default-scope + cron-registratie in agent_config ─────────────────────
-- Default: de Legal Mind-kennisspaces. `AS` (IT Team, 211 pagina's), `SD` en
-- `PT` (leverancier) staan er bewust NIET in — dat is een besluit van Jelle,
-- één config-rij ver, geen aanname van de ETL.
--
-- Bewust `where not exists` en geen `on conflict (agent_name, config_key)`:
-- die unieke index bestaat op prod wél en op Dev NIET, en een migratie die op
-- Dev klapt is een migratie die je niet meer op Dev kunt testen.
insert into public.agent_config (agent_name, config_key, config_value)
select 'confluence-sync-etl', 'spaces', '["LM","LM1","LE","LE1","AI","MT","BI","Marketing"]'::jsonb
where not exists (
  select 1 from public.agent_config
   where agent_name = 'confluence-sync-etl' and config_key = 'spaces'
);

-- ─── 4. Chunker-bron ─────────────────────────────────────────────────────────
-- De bestaande takken zijn allemaal "chunk één keer": NOT EXISTS op
-- (source, source_id). Een wiki-pagina verandert wél, dus deze tak vergelijkt
-- óók de versie. Zodra Confluence version 5 zegt en de nieuwste chunk versie 4
-- draagt, komt de pagina terug — en de chunker vervangt dan zijn chunks.
--
-- De regex-guard op `~ '^[0-9]+$'` is er omdat een cast op een jsonb-veld dat
-- ooit iets anders bevat de hele RPC zou laten klappen — en dan valt niet één
-- bron stil maar de complete chunker-ronde.
create or replace function public.fetch_unchunked_source_ids(p_source text, p_limit integer default 10)
returns table(source_id text)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
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

  ELSIF p_source = 'confluence' THEN
    RETURN QUERY
      SELECT p.page_id FROM confluence_pages p
      WHERE p.is_archived = false
        AND COALESCE(length(p.body_text), 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM chunks c
           WHERE c.source = 'confluence'
             AND c.source_id = p.page_id
             AND c.metadata->>'version' ~ '^[0-9]+$'
             AND (c.metadata->>'version')::int >= p.version
        )
      ORDER BY p.confluence_updated_at DESC NULLS LAST LIMIT p_limit;

  ELSE
    RAISE EXCEPTION 'unknown_source: %', p_source USING ERRCODE = '22023';
  END IF;
END $function$;
