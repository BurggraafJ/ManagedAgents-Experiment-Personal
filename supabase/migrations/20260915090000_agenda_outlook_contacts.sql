-- outlook_contacts — de spiegel van het Outlook-adresboek, per gebruiker.
--
-- Waarom een eigen tabel en niet `contact_directory`:
--   `contact_directory` is een view over hubspot_contacts + mail_messages. Hij
--   is er al, hij is per gebruiker gescoped en hij heeft 2.036 rijen — maar hij
--   is GEEN adresboek: hij kent alleen mensen die ooit mail hebben gestuurd of
--   in HubSpot staan, en hij rekent bij élke aanroep een UNION met een
--   seq-scan over hubspot_contacts uit (gemeten 2026-09-15: 93 ms
--   uitvoeringstijd voor één ilike-zoekopdracht). Dat is een prima bron voor
--   een agent, en een slechte bron voor een veld dat per toetsaanslag zoekt.
--
-- Deze tabel is wél het adresboek: wat Jelle zelf in Outlook heeft staan.
-- Vandaag zijn dat er negen (gemeten via OUTLOOK_OUTLOOK_LIST_CONTACTS), dus
-- de genodigden-kiezer zoekt daarnaast óók in `calendar_attendees` — de 609
-- mensen met wie hij daadwerkelijk heeft vergaderd. Twee kleine, geïndexeerde
-- tabellen in plaats van één dure view.
--
-- RLS is exact het model van `mail_accounts` en `calendar_attendees`: eigen
-- rijen of admin, mét tweede factor, plus een ALL-policy voor service_role
-- (alleen de edge-functies schrijven hier). Bewust NIET `has_capability()`:
-- die kent geen tweede factor en zou de MFA-eis stil laten vallen.

create table if not exists public.outlook_contacts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  mailbox_email    text,
  -- Graph's contact-id. Eén contact kan meerdere adressen hebben; die worden
  -- platgeslagen tot één rij per (contact, adres).
  graph_id         text not null,
  email            text not null,
  display_name     text,
  given_name       text,
  surname          text,
  company_name     text,
  job_title        text,
  -- Weggehaald in Outlook → hier zacht verwijderd, niet gewist: dan blijft een
  -- genodigde in een bestaande afspraak herkenbaar.
  is_deleted       boolean not null default false,
  last_synced_at   timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint outlook_contacts_email_not_blank check (email <> ''),
  constraint outlook_contacts_unique unique (user_id, graph_id, email)
);

create index if not exists idx_outlook_contacts_user_email
  on public.outlook_contacts (user_id, email) where not is_deleted;
create index if not exists idx_outlook_contacts_user_name
  on public.outlook_contacts (user_id, lower(display_name)) where not is_deleted;

alter table public.outlook_contacts enable row level security;

drop policy if exists outlook_contacts_read_self_or_admin on public.outlook_contacts;
create policy outlook_contacts_read_self_or_admin
  on public.outlook_contacts for select to authenticated
  using (
    (select public.session_mfa_ok())
    and (user_id = (select auth.uid()) or (select public.is_admin_or_higher()))
  );

drop policy if exists outlook_contacts_service on public.outlook_contacts;
create policy outlook_contacts_service
  on public.outlook_contacts for all to service_role
  using (true) with check (true);

-- De browser leest; schrijven doet alleen de edge-functie (service_role).
--
-- ⚠ De `revoke` op `authenticated` is GEEN overbodige regel. Supabase heeft in
-- schema `public` een default privilege staan die élke nieuwe tabel meteen ALL
-- geeft aan anon, authenticated én service_role. Zonder deze revoke staat er na
-- de CREATE dus INSERT/UPDATE/DELETE/TRUNCATE voor `authenticated` op een tabel
-- die alleen gelezen hoort te worden. RLS houdt het tegen (er is geen
-- schrijf-policy, en geen policy betekent weigeren), maar dan hangt de veiligheid
-- aan de afwezigheid van iets in plaats van aan de aanwezigheid van een grendel.
-- Gemeten na de eerste apply op prod (2026-09-15): authenticated had
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE en UPDATE.
revoke all on public.outlook_contacts from public, anon, authenticated;
grant select on public.outlook_contacts to authenticated;

comment on table public.outlook_contacts is
  'Spiegel van het Outlook-adresboek per gebruiker (OUTLOOK_OUTLOOK_LIST_CONTACTS). '
  'Gevuld bij het koppelen van de mailbox (connectors-outlook) en daarna bijgehouden '
  'door mail-backfill. Voedt de genodigden-kiezer in de Agenda, samen met calendar_attendees.';

-- ── Wanneer is de spiegel toe aan een ronde? ────────────────────────────────
-- mail-backfill draait elke minuut; een adresboek van negen rijen hoeft niet
-- elke minuut opgehaald te worden. Deze kolom op mail_accounts is de klok.
alter table public.mail_accounts
  add column if not exists contacts_synced_at timestamptz;

comment on column public.mail_accounts.contacts_synced_at is
  'Laatste keer dat outlook_contacts voor deze mailbox is ververst. NULL = nog nooit.';
