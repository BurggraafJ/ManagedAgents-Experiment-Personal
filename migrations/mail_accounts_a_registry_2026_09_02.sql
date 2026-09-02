-- =============================================================================
-- Migratie A — mail_accounts registry + claim_next_mail_account()
-- Per-user Outlook, fase 1 (pijplijn-fundament) · MAIL-PIPELINE.md §3.1 + §3.2
-- =============================================================================
-- Waarom:
--   Vandaag halen mail-sync-etl-v2, mail-backfill, mail-reconcile,
--   outlook-calendar-sync-etl en outlook-live alle vijf dezelfde Composio-
--   connectie uit `agent_config` (met hardcoded fallback 'user-jelle'). Er is
--   geen plek waar "app-user → mailbox → credential" staat, dus "één mailbox
--   per keer binnentrekken" is niet uitdrukbaar (blokkade B2).
--
--   Deze migratie zet de registry neer en de claim-lus erboven, in exact
--   dezelfde vorm als het bestaande `claim_next_backfill_bucket()`:
--   FOR UPDATE SKIP LOCKED, round-robin op de oudste claim per doel.
--
-- Gedrag met één account = gedrag van vandaag: de seed onderaan maakt Jelle's
-- bestaande agent_config-connectie rij #1 met scope='org'. Zolang die rij niet
-- bestaat (of composio_connection_id leeg is) vallen de Edge Functions terug
-- op agent_config — geen big-bang.
--
-- Credential-hygiëne: `composio_user_id` / `composio_connection_id` zijn NIET
-- aan `authenticated` gegrant (column-level grant hieronder). De browser kan de
-- registry dus lezen zonder de connectie-identifiers te zien. De Entra-OAuth-UI
-- komt later en krijgt dan een eigen, expliciet gescopeerde view/RPC.
--
-- Idempotent: create table if not exists / create or replace / on conflict.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. De registry-tabel
-- -----------------------------------------------------------------------------
create table if not exists public.mail_accounts (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  mailbox_email            text not null,
  -- Voor is_from_me + de own-domain-check van resolve_party_at_moment.
  own_domains              text[] not null default '{}'::text[],
  provider                 text not null default 'composio'
                             check (provider in ('composio', 'graph_oauth')),
  composio_user_id         text,
  composio_connection_id   text,
  enabled                  boolean not null default true,
  paused                   boolean not null default false,
  paused_reason            text,
  -- 'org'      = het kantoorpostvak; de org-agents (daily-admin, auto-draft,
  --              churn-analytics, klantbase, meeting-briefing, jellemind,
  --              draft-style) mogen hier uit lezen.
  -- 'personal' = een individuele mailbox; mag NOOIT in org-agent-output landen.
  scope                    text not null default 'personal'
                             check (scope in ('org', 'personal')),
  -- Per-mailbox override van DEFAULT_FOLDER_NAMES in mail-sync-etl-v2.
  -- NULL = de default-lijst van de functie. Vorm: ["Inbox","Sent Items",...]
  folder_names             jsonb,
  -- Round-robin-bookkeeping per doel: {"sync":"2026-09-02T…","backfill":…}
  last_claim_at            jsonb not null default '{}'::jsonb,
  last_sync_started_at     timestamptz,
  last_sync_finished_at    timestamptz,
  last_error               text,
  last_error_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, mailbox_email)
);

comment on table public.mail_accounts is
  'Registry: welke Outlook-mailbox hoort bij welke app-user, met welke credential. '
  'Enige bron voor de connectie in mail-sync-etl-v2 / mail-backfill / mail-reconcile / '
  'outlook-calendar-sync-etl / outlook-live. agent_config is nog fallback.';
comment on column public.mail_accounts.scope is
  '''org'' = kantoorpostvak (org-agents mogen eruit lezen); ''personal'' = individuele mailbox.';
comment on column public.mail_accounts.last_claim_at is
  'jsonb per purpose (sync|reconcile|backfill|enrich|calendar) → laatste claim-moment. '
  'claim_next_mail_account() sorteert hierop, zodat de doelen elkaars round-robin niet verstoren.';

create index if not exists idx_mail_accounts_user      on public.mail_accounts (user_id);
create index if not exists idx_mail_accounts_claimable on public.mail_accounts (scope)
  where enabled and not paused;

-- -----------------------------------------------------------------------------
-- 2. RLS — zelfde patroon als de mail-tabellen, minus de credential-kolommen
-- -----------------------------------------------------------------------------
alter table public.mail_accounts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'mail_accounts'
                    and policyname = 'mail_accounts_read_self_or_admin') then
    create policy mail_accounts_read_self_or_admin
      on public.mail_accounts for select to authenticated
      using (session_mfa_ok() and (user_id = (select auth.uid()) or (select is_admin_or_higher())));
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'mail_accounts'
                    and policyname = 'mail_accounts_service_all') then
    create policy mail_accounts_service_all
      on public.mail_accounts for all to service_role
      using (true) with check (true);
  end if;
end $$;

revoke all on public.mail_accounts from anon, authenticated;
grant all on public.mail_accounts to service_role;
-- Column-level: alles behalve composio_user_id / composio_connection_id.
grant select (
  id, user_id, mailbox_email, own_domains, provider, enabled, paused, paused_reason,
  scope, folder_names, last_claim_at, last_sync_started_at, last_sync_finished_at,
  last_error, last_error_at, created_at, updated_at
) on public.mail_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- 3. claim_next_mail_account(p_purpose)
--    Zelfde vorm als claim_next_backfill_bucket(): één rij, FOR UPDATE SKIP
--    LOCKED, oudste claim eerst. Geeft de credential mee zodat de caller nooit
--    zelf agent_config hoeft te raden.
-- -----------------------------------------------------------------------------
create or replace function public.claim_next_mail_account(p_purpose text default 'sync')
returns table (
  account_id             uuid,
  account_user_id        uuid,
  mailbox_email          text,
  own_domains            text[],
  provider               text,
  composio_user_id       text,
  composio_connection_id text,
  scope                  text,
  folder_names           jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_purpose IS NULL
     OR p_purpose NOT IN ('sync', 'reconcile', 'backfill', 'enrich', 'calendar') THEN
    RAISE EXCEPTION 'unknown_purpose: %', p_purpose USING ERRCODE = '22023';
  END IF;

  WITH claimed AS (
    UPDATE public.mail_accounts a
       SET last_claim_at = a.last_claim_at || jsonb_build_object(p_purpose, to_jsonb(now())),
           last_sync_started_at =
             CASE WHEN p_purpose = 'sync' THEN now() ELSE a.last_sync_started_at END,
           updated_at = now()
     WHERE a.id = (
       SELECT t.id
         FROM public.mail_accounts t
        WHERE t.enabled AND NOT t.paused
        -- id als laatste tiebreak: zonder die derde sleutel is de orde bij
        -- gelijke created_at (twee accounts in één insert) niet-deterministisch.
        ORDER BY (t.last_claim_at ->> p_purpose)::timestamptz ASC NULLS FIRST,
                 t.created_at ASC, t.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     RETURNING a.id
  )
  SELECT c.id INTO v_id FROM claimed c;

  IF v_id IS NULL THEN
    RETURN;   -- geen enabled/unpaused account → caller valt terug op agent_config
  END IF;

  RETURN QUERY
    SELECT a.id, a.user_id, a.mailbox_email, a.own_domains, a.provider,
           a.composio_user_id, a.composio_connection_id, a.scope, a.folder_names
      FROM public.mail_accounts a
     WHERE a.id = v_id;
END;
$function$;

comment on function public.claim_next_mail_account(text) is
  'Claimt één mailbox voor één doel (sync|reconcile|backfill|enrich|calendar). '
  'Round-robin op last_claim_at[purpose]. Lege return = geen claimbaar account.';

revoke all on function public.claim_next_mail_account(text) from public;
grant execute on function public.claim_next_mail_account(text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. Afronden van een claim (voor sync-telemetrie / stilval-detectie)
-- -----------------------------------------------------------------------------
create or replace function public.finish_mail_account_claim(
  p_account_id uuid,
  p_error      text default null
)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  UPDATE public.mail_accounts
     SET last_sync_finished_at = now(),
         last_error    = p_error,
         last_error_at = CASE WHEN p_error IS NULL THEN last_error_at ELSE now() END,
         updated_at    = now()
   WHERE id = p_account_id;
$function$;

revoke all on function public.finish_mail_account_claim(uuid, text) from public;
grant execute on function public.finish_mail_account_claim(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4b. Eigenaar van de bestaande mailbox, maar ALLEEN als die eenduidig is.
--     Gebruikt door de Edge Functions zolang de registry nog leeg is (het
--     één-mailbox-tijdperk). Bij nul of meerdere distinct owners: NULL, en dan
--     faalt de caller luid i.p.v. een eigenaar te raden.
-- -----------------------------------------------------------------------------
create or replace function public.single_mail_owner_user_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- min(uuid) bestaat niet in Postgres; array_agg + [1] is de nette variant.
  SELECT CASE WHEN count(DISTINCT m.user_id) = 1
              THEN (array_agg(DISTINCT m.user_id))[1] END
    FROM public.mail_messages m;
$function$;

comment on function public.single_mail_owner_user_id() is
  'Eigenaar van de enige bestaande mailbox, of NULL als dat niet eenduidig is. '
  'Alleen fallback voor de periode dat mail_accounts nog leeg is.';

revoke all on function public.single_mail_owner_user_id() from public;
grant execute on function public.single_mail_owner_user_id() to service_role;

-- -----------------------------------------------------------------------------
-- 5. Seed — Jelle's bestaande connectie wordt rij #1 met scope='org'
--    Geen waarden hardcoded: alles komt uit auth.users + agent_config, zodat
--    dit bestand geen credential-identifier bevat.
-- -----------------------------------------------------------------------------
insert into public.mail_accounts (
  user_id, mailbox_email, own_domains, provider,
  composio_user_id, composio_connection_id, scope, enabled
)
select
  u.id,
  u.email,
  array[lower(split_part(u.email, '@', 2))],
  'composio',
  coalesce(
    (select c.config_value #>> '{}' from public.agent_config c
      where c.agent_name = 'mail-sync-etl-v2' and c.config_key = 'composio_user_id'),
    (select c.config_value #>> '{}' from public.agent_config c
      where c.agent_name = 'global' and c.config_key = 'composio_user_id')
  ),
  (select c.config_value #>> '{}' from public.agent_config c
    where c.agent_name = 'mail-sync-etl-v2' and c.config_key = 'composio_connection_id'),
  'org',
  true
from auth.users u
where u.email is not null
  -- Alleen de user die daadwerkelijk de bestaande mailbox bezit.
  and exists (select 1 from public.mail_messages m where m.user_id = u.id)
  -- Eén org-account per keer: als er al één staat, niets doen.
  and not exists (select 1 from public.mail_accounts a where a.scope = 'org')
on conflict (user_id, mailbox_email) do nothing;

commit;

-- =============================================================================
-- Verificatie (los uitvoeren):
--   select mailbox_email, scope, enabled, provider,
--          composio_connection_id is not null as has_connection
--     from public.mail_accounts;
--   select * from public.claim_next_mail_account('sync');
-- =============================================================================
