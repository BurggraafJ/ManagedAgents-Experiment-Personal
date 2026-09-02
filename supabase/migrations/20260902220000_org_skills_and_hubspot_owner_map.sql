-- =============================================================================
-- Organisatie: HubSpot owner-map + in-app Skills            (v1.134, 2026-09-02)
-- =============================================================================
-- Twee org-brede tabellen achter het owner-portaal (Organisatie, ex-Admin):
--
--   1. hubspot_owner_map — welke Maestro-gebruiker is welke HubSpot deal-owner.
--      HubSpot blijft één org-brede mirror (hubspot_deals.hubspot_owner_id);
--      deze map vertelt de app alleen WIE die owner is in Maestro-termen.
--      GEEN per-user HubSpot-MCP, geen tweede sync.
--
--   2. org_skills — door Jelle in de app te bewerken pijplijn-/lead-kennis die
--      de vragenbak (rag-chat) in de system-prompt injecteert. Optioneel
--      gebonden aan één tool (`tool_binding`) → dan hangt de tekst als
--      tool_guidance onder die tool-beschrijving. Org-breed, dus geen
--      user_id-kolom en geen per-user variant.
--
-- Bewust GEEN foreign key van hubspot_owner_map.hubspot_owner_id naar
-- hubspot_users: die tabel is een ETL-mirror (hubspot-sync-etl upsert,
-- hubspot-reconcile flipt alleen `active`). Zou een toekomstige opruiming
-- daar wél hard deleten, dan zou een FK die cron laten falen — en een
-- stilgevallen cron is precies de onzichtbare storing uit CLAUDE.md. De UI
-- kiest de owner uit een dropdown op hubspot_users, dat is de validatie.
-- =============================================================================

-- ─── 1. HubSpot owner-map ────────────────────────────────────────────────────
create table if not exists public.hubspot_owner_map (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  hubspot_owner_id text        not null,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users(id) on delete set null,
  constraint hubspot_owner_map_owner_uniq unique (hubspot_owner_id)
);

comment on table  public.hubspot_owner_map          is 'Maestro-gebruiker ⇄ HubSpot deal-owner. Org-breed, beheerd in Organisatie › Gebruikers. Eén owner per gebruiker en vice versa.';
comment on column public.hubspot_owner_map.hubspot_owner_id is 'hubspot_users.hubspot_owner_id — bewust zonder FK (ETL-mirror, zie migratie-kop).';

create index if not exists hubspot_owner_map_owner_idx on public.hubspot_owner_map (hubspot_owner_id);

drop trigger if exists hubspot_owner_map_touch on public.hubspot_owner_map;
create trigger hubspot_owner_map_touch
  before update on public.hubspot_owner_map
  for each row execute function public.set_updated_at();

alter table public.hubspot_owner_map enable row level security;

-- Lezen: elke ingelogde gebruiker mag de map zien (de app toont "eigenaar:
-- <naam>" bij deals). Schrijven: alleen admin/owner mét geldige MFA-sessie.
drop policy if exists hubspot_owner_map_read on public.hubspot_owner_map;
create policy hubspot_owner_map_read on public.hubspot_owner_map
  for select to authenticated
  using (true);

drop policy if exists hubspot_owner_map_admin_write on public.hubspot_owner_map;
create policy hubspot_owner_map_admin_write on public.hubspot_owner_map
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists hubspot_owner_map_service on public.hubspot_owner_map;
create policy hubspot_owner_map_service on public.hubspot_owner_map
  for all to service_role
  using (true) with check (true);


-- ─── 2. In-app Skills (org-brede kennis voor de vragenbak) ───────────────────
create table if not exists public.org_skills (
  id           uuid primary key default gen_random_uuid(),
  slug         text        not null unique,
  title        text        not null,
  category     text        not null default 'pijplijn',
  body         text        not null,
  tool_binding text,
  applies_to   text[]      not null default array['*']::text[],
  active       boolean     not null default true,
  sort_order   integer     not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  constraint org_skills_category_chk check (category in ('pijplijn', 'lead', 'klant', 'algemeen')),
  constraint org_skills_slug_chk     check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  constraint org_skills_body_chk     check (length(btrim(body)) between 1 and 8000),
  constraint org_skills_title_chk    check (length(btrim(title)) between 1 and 120)
);

comment on table  public.org_skills              is 'Org-brede, in-app te bewerken kennis (pijplijn/lead/klant) die rag-chat in de system-prompt injecteert. CRUD in Organisatie › Skills.';
comment on column public.org_skills.tool_binding is 'Optionele tool-naam (bv. count_by_stage, calendar_search). Gezet = de tekst hangt als tool_guidance onder die tool-beschrijving; leeg = algemene organisatie-kennis in de system-prompt.';
comment on column public.org_skills.applies_to   is 'Voor welke agents/routes de regel geldt. {*} = alles.';

create index if not exists org_skills_active_idx  on public.org_skills (active, sort_order);
create index if not exists org_skills_binding_idx on public.org_skills (tool_binding) where tool_binding is not null;

drop trigger if exists org_skills_touch on public.org_skills;
create trigger org_skills_touch
  before update on public.org_skills
  for each row execute function public.set_updated_at();

alter table public.org_skills enable row level security;

-- Lezen: elke ingelogde gebruiker (de kennis stuurt hún chat-antwoorden).
-- Schrijven: alleen admin/owner mét geldige MFA-sessie.
drop policy if exists org_skills_read on public.org_skills;
create policy org_skills_read on public.org_skills
  for select to authenticated
  using (true);

drop policy if exists org_skills_admin_write on public.org_skills;
create policy org_skills_admin_write on public.org_skills
  for all to authenticated
  using ((select public.is_admin_or_higher()))
  with check ((select public.is_admin_or_higher()));

drop policy if exists org_skills_service on public.org_skills;
create policy org_skills_service on public.org_skills
  for all to service_role
  using (true) with check (true);
