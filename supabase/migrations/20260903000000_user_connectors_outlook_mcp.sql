-- =============================================================================
-- Connectors: per-user Outlook-MCP-koppeling                (v1.136, 2026-09-03)
-- =============================================================================
-- Eén rij per (gebruiker, provider): "heeft deze Maestro-gebruiker zijn eigen
-- Outlook aan Maestro gekoppeld, en zo ja welke Composio-connectie hoort daarbij".
--
-- BEWUST GESCHEIDEN VAN `mail_accounts`. Die registry voedt de sync-ETL's
-- (claim_next_mail_account → mail-sync-etl-v2, mail-backfill, reconcile,
-- calendar-sync). Een rij daarin betekent "haal de mail van deze mailbox
-- periodiek binnen". Een MCP-koppeling betekent alleen "de agent mag namens
-- deze gebruiker live in zijn Outlook kijken" — geen mirror, geen cron, geen
-- kosten. Zou de connector-rij in mail_accounts landen, dan zou het aanzetten
-- van de knop ongevraagd de mailbox van een collega gaan syncen. Vandaar een
-- eigen tabel; de org-mailbox (burggraaf@legal-mind.nl, scope='org') blijft
-- ongemoeid.
--
-- TOKENS STAAN HIER NIET. Composio bewaart de OAuth-tokens; wij bewaren alleen
-- de identifiers (`composio_user_id`, `composio_connection_id`). De browser
-- krijgt ze nooit te zien — alle Composio-calls lopen via de Edge Function
-- `connectors-outlook` met de service-role.
-- =============================================================================

create table if not exists public.user_connectors (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users(id) on delete cascade,
  provider               text        not null,
  -- Composio's eigen user-handle. Namespaced op onze uuid, zodat een nieuwe
  -- koppeling nooit botst met de bestaande org-connectie (die draait op een
  -- 'pg-test-…'-handle uit de Composio-playground).
  composio_user_id       text        not null,
  composio_connection_id text,
  auth_config_id         text,
  status                 text        not null default 'disconnected',
  account_email          text,
  last_error             text,
  connected_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint user_connectors_user_provider_uniq unique (user_id, provider),
  constraint user_connectors_provider_chk check (provider in ('outlook')),
  constraint user_connectors_status_chk
    check (status in ('disconnected', 'pending', 'connected', 'error'))
);

comment on table  public.user_connectors is
  'Per-user koppeling met een externe dienst via Composio (MCP-host = Maestro). Alleen identifiers, nooit tokens. Los van mail_accounts: dat is de sync-registry.';
comment on column public.user_connectors.status is
  'disconnected = nog nooit gekoppeld/losgekoppeld; pending = OAuth gestart, wacht op consent; connected = Composio meldt ACTIVE; error = Composio meldt FAILED/EXPIRED.';
comment on column public.user_connectors.composio_connection_id is
  'Composio connected_account id (ca_…). Bewust GEEN token — die blijft bij Composio.';

create index if not exists user_connectors_user_idx on public.user_connectors (user_id);

drop trigger if exists user_connectors_touch on public.user_connectors;
create trigger user_connectors_touch
  before update on public.user_connectors
  for each row execute function public.set_updated_at();

alter table public.user_connectors enable row level security;

-- Lezen: alleen je eigen rij. De Connectors-pagina toont de status van de
-- ingelogde gebruiker; niemand hoeft de koppeling van een ander te zien.
drop policy if exists user_connectors_read_own on public.user_connectors;
create policy user_connectors_read_own on public.user_connectors
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Schrijven: GEEN policy voor `authenticated`. Elke mutatie loopt via de Edge
-- Function `connectors-outlook` (service-role), want alleen die weet of
-- Composio de connectie echt geaccepteerd heeft. Zonder deze grens zou de
-- browser zichzelf op status='connected' kunnen zetten zonder OAuth.

-- =============================================================================
-- Helper voor de Edge Function: de actieve connectie van één gebruiker.
-- SECURITY DEFINER + service-role-only, zodat rag-chat 'm kan gebruiken zonder
-- de RLS-policy hierboven op te rekken.
-- =============================================================================
create or replace function public.get_user_connector(
  p_user_id  uuid,
  p_provider text default 'outlook'
)
returns table (
  composio_user_id       text,
  composio_connection_id text,
  account_email          text,
  status                 text
)
language sql
security definer
set search_path = public
as $$
  select uc.composio_user_id, uc.composio_connection_id, uc.account_email, uc.status
  from public.user_connectors uc
  where uc.user_id = p_user_id
    and uc.provider = p_provider
    and uc.status = 'connected'
    and uc.composio_connection_id is not null
  limit 1;
$$;

revoke all on function public.get_user_connector(uuid, text) from public, anon, authenticated;
grant execute on function public.get_user_connector(uuid, text) to service_role;

comment on function public.get_user_connector(uuid, text) is
  'Actieve Composio-connectie van één gebruiker. Service-role-only: gebruikt door connectors-outlook en rag-chat om namens de ingelogde gebruiker in diens Outlook te kijken.';
