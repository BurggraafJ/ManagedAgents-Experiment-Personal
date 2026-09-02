-- =============================================================================
-- Migratie F — calendar_sync_state per mailbox in plaats van één vaste rij
-- Per-user Outlook, fase 1 · hoort bij §3.2 ("mail-reconcile en
-- outlook-calendar-sync-etl krijgen exact dezelfde claim-aanpassing")
-- =============================================================================
-- Waarom:
--   `calendar_sync_state` is `id integer default 1`, PK (id), en de ETL doet
--   `.eq("id", 1)` + `upsert(onConflict: "id")`. Er kan dus per constructie maar
--   één delta-watermark bestaan. Zodra de agenda-ETL per mailbox claimt, zou
--   mailbox #2 de watermark van mailbox #1 overschrijven: geen error, wel een
--   delta-window dat bij de verkeerde agenda hoort → gemiste of dubbel gelezen
--   events. Precies de stille faalmodus die we hier aan het uitbannen zijn.
--
-- Fix: user_id wordt de logische sleutel (unique), `id` krijgt een sequence
-- zodat een tweede rij een eigen id kan krijgen. De bestaande rij (id=1,
-- user_id=Jelle) blijft ongewijzigd staan.
--
-- MOET vóór de nieuwe outlook-calendar-sync-etl gedeployd worden: die upsert't
-- op onConflict user_id.
-- =============================================================================

begin;

-- 1. De singleton-CHECK eraf. `CHECK (id = 1)` maakte een tweede watermark
--    letterlijk onmogelijk. (Staat op prod; ontbreekt op het Dev-project —
--    Dev is een deelkopie, dus constraints altijd op prod verifiëren.)
alter table public.calendar_sync_state
  drop constraint if exists calendar_sync_state_singleton;

-- 2. id uit een sequence i.p.v. de constante 1
create sequence if not exists public.calendar_sync_state_id_seq as integer;
alter sequence public.calendar_sync_state_id_seq owned by public.calendar_sync_state.id;
select setval(
  'public.calendar_sync_state_id_seq',
  greatest(1, coalesce((select max(id) from public.calendar_sync_state), 1))
);
alter table public.calendar_sync_state
  alter column id set default nextval('public.calendar_sync_state_id_seq');

-- 3. user_id wordt de logische sleutel
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.calendar_sync_state'::regclass
       and conname = 'calendar_sync_state_user_id_key'
  ) then
    alter table public.calendar_sync_state
      add constraint calendar_sync_state_user_id_key unique (user_id);
  end if;
end $$;

comment on column public.calendar_sync_state.user_id is
  'Logische sleutel: één delta-watermark per mailbox. outlook-calendar-sync-etl '
  'upsert''t op deze kolom, niet meer op id=1.';

commit;

-- =============================================================================
-- Verificatie (los uitvoeren):
--   select id, user_id, last_delta_sync_at from public.calendar_sync_state;
--   \d public.calendar_sync_state   -- unique (user_id) aanwezig
-- =============================================================================
