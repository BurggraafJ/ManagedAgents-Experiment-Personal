-- =============================================================================
-- Migratie G — DEFAULT van user_id eraf: een vergeten veld faalt LUID
-- Per-user Outlook, fase 1 · MAIL-PIPELINE.md §3.7 (blokkade B1)
-- =============================================================================
-- ⚠️  PAS DEZE MIGRATIE ALS LAATSTE TOE — ná de deploy van mail-sync-etl-v2,
--     mail-backfill en outlook-calendar-sync-etl die user_id expliciet
--     meeschrijven. Zolang die niet live zijn, is de DEFAULT de enige reden
--     dat de insert lukt.
--
-- Waarom:
--   `mail_messages.user_id`, `mail_folders.user_id`, `mail_sync_state.user_id`,
--   `mail_backfill_state.user_id`, `autodraft_folders.user_id`,
--   `calendar_events.user_id` en `calendar_sync_state.user_id` stonden alle op
--   DEFAULT '0934ffef-…' (Jelle). Geen enkele ingest-functie schreef user_id
--   expliciet mee. Een tweede mailbox die door de bestaande ETL ging, werd dus
--   STIL als Jelle's mail gelabeld: geen error, correcte-lijkende rijen,
--   verkeerde eigenaar.
--
--   Zonder DEFAULT faalt een vergeten user_id op de NOT NULL-constraint. Dat is
--   de goedkoopste borging die er is: luid falen i.p.v. stil-verkeerd.
--
-- De kolommen zijn al NOT NULL — hier gaat alleen de DEFAULT eraf. Bestaande
-- rijen veranderen niet.
--
-- Terugdraaien (als een insert-pad toch gemist blijkt):
--   alter table public.<tabel> alter column user_id
--     set default '0934ffef-f600-4e1c-90c3-9d9bda2e0e42'::uuid;
-- =============================================================================

begin;

alter table public.mail_messages       alter column user_id drop default;
alter table public.mail_folders        alter column user_id drop default;
alter table public.mail_sync_state     alter column user_id drop default;
alter table public.mail_backfill_state alter column user_id drop default;
alter table public.autodraft_folders   alter column user_id drop default;
alter table public.calendar_events     alter column user_id drop default;
alter table public.calendar_sync_state alter column user_id drop default;

comment on column public.mail_messages.user_id is
  'Eigenaar van de mailbox. Geen DEFAULT (2026-09-02): een ingest-pad dat dit '
  'veld vergeet faalt luid op NOT NULL i.p.v. stil bij de org-mailbox te landen.';

commit;

-- =============================================================================
-- Verificatie (los uitvoeren) — moet 0 rijen geven:
--   select table_name, column_default
--     from information_schema.columns
--    where table_schema = 'public' and column_name = 'user_id'
--      and column_default is not null
--      and table_name in ('mail_messages','mail_folders','mail_sync_state',
--                         'mail_backfill_state','autodraft_folders',
--                         'calendar_events','calendar_sync_state');
-- =============================================================================
