-- =============================================================================
-- SECURITY PR-D · S7 — agent_config: van "alles behalve secrets" naar een
--                      sleutel-allowlist voor members
-- =============================================================================
--
-- Wat er stond
-- ------------
--   policy agent_config_read_authenticated on public.agent_config
--     for select to authenticated
--     using (session_mfa_ok() and (not is_secret))
--
-- `is_secret` is op dit project voor **elke** rij `false` (gemeten 2026-09-15:
-- 101 rijen, 0 secret). De `not is_secret`-arm doet dus niets, en elke member
-- mét tweede factor las de hele tabel: de Composio-identifiers van het
-- kantoorpostvak, de Vercel- en GitHub-projectnamen, de auth-config-id's van de
-- connectors, het `spend_ok_token` van de evalcron, en een handvol resten van
-- producten die in v1.135 zijn gestript.
--
-- Geen van die rijen is een sleutel — de tokens staan in Vault en bij Composio,
-- nooit hier (`mail-account.ts` en `connector-composio.ts` halen ze daar op).
-- Het is ook geen incident: er is nog nooit een member ingelogd
-- (`invite_sent_at` is NULL voor alle zeven). Het is de soort lijst waarmee je
-- een omgeving leert kennen, en hij hoort dicht vóór de eerste collega binnen is.
--
-- Wat er nu staat
-- ---------------
-- Dezelfde policy, met één extra voorwaarde: een member ziet alleen de sleutels
-- die een member-scherm ook echt leest. De owner/admin-tak blijft ongemoeid —
-- deze migratie maakt NIETS opener.
--
--   * `is_secret` wordt niet versoepeld; de arm blijft staan.
--   * `session_mfa_ok()` blijft de eerste voorwaarde (geheugen
--     `has-capability-has-no-mfa-arm`: de tweede factor mag nooit stil wegvallen).
--   * De allowlist staat in een tabel mét verplichte reden, net als
--     `acl_poort_config` — niet als literal in de policy. Eén bron, en
--     `multi_user_acl_eval.cjs` leest dezelfde rijen (M15).
--
-- Waarom een tabel en geen lijst in de policy: een lijst in de policy zou de
-- tweede kopie van dezelfde regel zijn zodra de poort hem ook moet kennen
-- (geheugen `doc12-definition-lives-in-three-places`). De poort stelt een ándere
-- vraag — "ziet een member wat een member nodig heeft, en niets daarbuiten" —
-- en mag die niet uit dezelfde zin afleiden.
--
-- Bron van de allowlist: elke `src/`-call-site die `agent_config` LEEST,
-- geïnventariseerd op 2026-09-15 (zeven stuks, zie SECURITY-PRD-IMPL-NOTES §3).
--
-- Idempotent: create table if not exists / drop policy if exists / on conflict.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. De allowlist
-- -----------------------------------------------------------------------------
create table if not exists public.agent_config_member_keys (
  -- '*' = elke agent. Gebruikt voor sleutels die per agent bestaan
  -- (`custom_instructions`), waar de lezende hook geen agent-filter heeft.
  agent_name text not null,
  config_key text not null,
  -- Verplicht en niet leeg: een uitzondering zonder reden is een bug, geen
  -- uitzondering (zelfde regel als acl_poort_config).
  reden      text not null check (length(btrim(reden)) > 0),
  -- Welke call-site dit nodig heeft. Wie de call-site weghaalt, hoort deze rij
  -- ook weg te halen; zonder dit veld weet niemand meer waarvoor hij openstond.
  call_site  text not null check (length(btrim(call_site)) > 0),
  created_at timestamptz not null default now(),
  primary key (agent_name, config_key)
);

comment on table public.agent_config_member_keys is
  'Allowlist: welke agent_config-sleutels een member (met tweede factor) mag lezen. '
  'agent_name = ''*'' betekent elke agent. Leeg = member ziet niets; de owner leest ongefilterd. '
  'Eén bron: de RLS-policy op agent_config en assertie M15 in multi_user_acl_eval.cjs lezen deze rijen.';

alter table public.agent_config_member_keys enable row level security;

-- Catalogus, geen persoonsgegeven: de lijst bevat sléutelnamen, nooit waarden.
-- Hij moet leesbaar zijn voor `authenticated`, want de policy op agent_config
-- doet de subquery als de aanroepende rol. Zelfde emmer als `capabilities` en
-- `role_capabilities` (Emmer C, bewust open).
drop policy if exists agent_config_member_keys_read on public.agent_config_member_keys;
create policy agent_config_member_keys_read on public.agent_config_member_keys
  for select to authenticated
  using (true);

-- Schrijven uitsluitend via een migratie of service_role: dit is een
-- security-lijst, geen instelling.
drop policy if exists agent_config_member_keys_service on public.agent_config_member_keys;
create policy agent_config_member_keys_service on public.agent_config_member_keys
  for all to service_role using (true) with check (true);

revoke all on public.agent_config_member_keys from anon, authenticated;
grant select on public.agent_config_member_keys to authenticated;
grant all    on public.agent_config_member_keys to service_role;

-- -----------------------------------------------------------------------------
-- 2. De vijf rijen — precies de lees-call-sites van een member-scherm
-- -----------------------------------------------------------------------------
insert into public.agent_config_member_keys (agent_name, config_key, reden, call_site) values
  ('*', 'custom_instructions',
   'Vrije-tekst instructies per agent. Geen identifier, geen credential; de Postvak- en '
   'Agenda-schermen van een member laden ze bij elke render. Geen agent-filter, want de hook '
   'haalt ze in één query voor alle agents op.',
   'src/hooks/useAutoDraft.js:138 · src/hooks/useAgentInstructions.js:14'),

  ('*', 'reminder_style',
   'Zelfde query als custom_instructions (één .in() op twee sleutels). Bestaat vandaag als rij '
   'nog niet; staat erbij zodat het aanmaken ervan geen lege Postvak-instelling geeft.',
   'src/hooks/useAutoDraft.js:138'),

  ('auto-draft', 'postvak_signature',
   'De handtekening die onder elke mail komt. Wordt in Postvak en in de mobiele composer '
   'getoond; zonder deze rij schrijft een member zonder handtekening.',
   'src/hooks/usePv2Outlook.js:107'),

  ('auto-draft', 'spelcheck_default_instruction',
   'Default-instructie in de spelcheck-modal van Postvak. Bestaat vandaag als rij nog niet; '
   'de modal valt dan terug op zijn eigen tekst.',
   'src/components/views/postvak2/Pv2Modals.jsx:144'),

  ('rag-chat', 'system_prompt',
   'De mobiele Instellingen-hub toont "Chat-assistent" aan iedereen (de rij is niet op '
   'instellingen.beheer gepoort, anders dan de desktop-pagina). Zonder deze rij ziet een member '
   'daar de ingebouwde DEFAULT_CHAT_PROMPT in plaats van de echte — een verzonnen tekst is '
   'erger dan een zichtbare. Zodra de mobiele hub die rij wél poort, mag deze regel weg.',
   'src/hooks/useChatSystemPrompt.js:24 · src/mobile/screens/MobileSettingsChat.jsx')
on conflict (agent_name, config_key) do update
  set reden = excluded.reden, call_site = excluded.call_site;

-- -----------------------------------------------------------------------------
-- 3. De policy
-- -----------------------------------------------------------------------------
-- Vervangt de bestaande met dezelfde naam. Volgorde van de voorwaarden is niet
-- toevallig: eerst de tweede factor, dan `is_secret` (ongewijzigd), dan pas de
-- rol-of-allowlist-tak. Wie hier later een OR bovenaan zet, haalt de tweede
-- factor eruit.
drop policy if exists agent_config_read_authenticated on public.agent_config;
create policy agent_config_read_authenticated on public.agent_config
  for select to authenticated
  using (
    (select public.session_mfa_ok())
    and (not is_secret)
    and (
      -- Owner/admin: ongewijzigd. is_admin_or_higher() eist zelf al een geldige
      -- tweede factor (2026-09-02), dus dit is geen tweede, zwakkere poort.
      (select public.is_admin_or_higher())
      or exists (
        select 1 from public.agent_config_member_keys k
         where k.config_key = agent_config.config_key
           and (k.agent_name = '*' or k.agent_name = agent_config.agent_name)
      )
    )
  );

comment on policy agent_config_read_authenticated on public.agent_config is
  'Member met tweede factor: alleen de sleutels uit agent_config_member_keys. '
  'Owner/admin: alle non-secret rijen, ongewijzigd. Secrets blijven voor iedereen dicht.';

-- -----------------------------------------------------------------------------
-- 4. Restanten van een gestript product opruimen
-- -----------------------------------------------------------------------------
-- `linkedin-connect` is in v1.135 uit het product gehaald
-- (`migrations/strip_concepts_infra_drop_2026_09_02.sql`): de schedules zijn
-- toen verwijderd, de agent_config-rijen niet. Wat overbleef zijn drie rijen,
-- waaronder een live browser-sessie-URL van een agent die niet meer bestaat.
--
-- De allowlist hierboven sluit ze al af voor members. Dat is niet genoeg reden
-- om ze te laten staan: een sessie-URL van een opgeheven product is geen
-- configuratie, het is afval. Niets in `src/`, `supabase/functions/` of
-- `scripts/` leest `linkedin-connect.*` (nagegrepen 2026-09-15).
--
-- Dit is GEEN productherleving en geen aanzet daartoe: het is de opruiming die
-- bij de strip had gehoord.
delete from public.agent_config where agent_name = 'linkedin-connect';

commit;

-- =============================================================================
-- Verificatie (los uitvoeren):
--
--   -- Wat ziet een member? (verwacht: alleen de allowlist-sleutels)
--   select a.agent_name, a.config_key
--     from public.agent_config a
--    where exists (select 1 from public.agent_config_member_keys k
--                   where k.config_key = a.config_key
--                     and (k.agent_name = '*' or k.agent_name = a.agent_name));
--
--   -- Wat ziet de owner? (verwacht: alle non-secret rijen, ongewijzigd)
--   select count(*) from public.agent_config where not is_secret;
--
--   -- En met een echte member-JWT + tweede factor:
--   node scripts/multi_user_acl_eval.cjs      -- M15
-- =============================================================================
