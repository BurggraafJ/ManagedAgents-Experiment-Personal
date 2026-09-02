-- =============================================================================
-- Migratie C — claim_next_backfill_bucket() met account-join + bucket-seeder
-- Per-user Outlook, fase 1 · MAIL-PIPELINE.md §3.3 (blokkade B4)
-- =============================================================================
-- Waarom:
--   `claim_next_backfill_bucket()` pakte de nieuwste `pending` bucket over álle
--   rijen, ongeacht user_id, terwijl mail-backfill met één vaste connectie
--   werkte. Zet je buckets voor mailbox #2 in de tabel, dan wordt een folder-id
--   van mailbox #2 via Jelle's connectie opgehaald → 404 per bucket, of in het
--   slechtste geval mails onder de verkeerde eigenaar.
--
-- Fix: de claim geeft de credential van de bijbehorende mail_accounts-rij mee.
-- De functie kan dan per constructie geen bucket met de verkeerde connectie
-- teruggeven. mail-backfill gebruikt die credential per bucket i.p.v. één
-- globale ctx.
--
-- Gedrag met één account = vandaag. Zolang de registry leeg is (vóór migratie A
-- geseed) valt de WHERE terug op "alle buckets", precies zoals nu.
--
-- Return-type wijzigt (4 kolommen erbij) → DROP + CREATE i.p.v. OR REPLACE.
-- =============================================================================

begin;

drop function if exists public.claim_next_backfill_bucket();

create function public.claim_next_backfill_bucket()
returns table(
  folder_id              text,
  month_bucket           date,
  folder_path            text,
  status                 text,
  messages_fetched       integer,
  pages_done             integer,
  account_user_id        uuid,
  mailbox_email          text,
  composio_user_id       text,
  composio_connection_id text
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
DECLARE
  v_folder_id text; v_month date; v_folder_path text;
  v_status text; v_msgs int; v_pages int; v_user uuid;
BEGIN
  -- Een bucket is claimbaar als er een enabled/unpaused account voor die user
  -- bestaat — OF als de registry nog helemaal leeg is (één-mailbox-tijdperk).
  -- 1) Eerst een stale in_progress bucket (>10 min oud)
  WITH claimed AS (
    UPDATE mail_backfill_state s
       SET status = 'in_progress', last_run_at = now()
     WHERE (s.folder_id, s.month_bucket) IN (
        SELECT t.folder_id, t.month_bucket
          FROM mail_backfill_state t
         WHERE t.status = 'in_progress'
           AND t.last_run_at < now() - interval '10 minutes'
           AND (EXISTS (SELECT 1 FROM mail_accounts a
                         WHERE a.user_id = t.user_id AND a.enabled AND NOT a.paused)
                OR NOT EXISTS (SELECT 1 FROM mail_accounts))
         ORDER BY t.last_run_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
     )
     RETURNING s.folder_id, s.month_bucket, s.folder_path, s.status,
               s.messages_fetched, s.pages_done, s.user_id
  )
  SELECT c.folder_id, c.month_bucket, c.folder_path, c.status,
         c.messages_fetched, c.pages_done, c.user_id
    INTO v_folder_id, v_month, v_folder_path, v_status, v_msgs, v_pages, v_user
    FROM claimed c;

  IF v_folder_id IS NULL THEN
    -- 2) Anders: nieuwste pending (zelfde ORDER BY als v1)
    WITH claimed AS (
      UPDATE mail_backfill_state s
         SET status = 'in_progress', last_run_at = now()
       WHERE (s.folder_id, s.month_bucket) IN (
          SELECT t.folder_id, t.month_bucket
            FROM mail_backfill_state t
           WHERE t.status = 'pending'
             AND (EXISTS (SELECT 1 FROM mail_accounts a
                           WHERE a.user_id = t.user_id AND a.enabled AND NOT a.paused)
                  OR NOT EXISTS (SELECT 1 FROM mail_accounts))
           ORDER BY t.month_bucket DESC, t.folder_path ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
       )
       RETURNING s.folder_id, s.month_bucket, s.folder_path, s.status,
                 s.messages_fetched, s.pages_done, s.user_id
    )
    SELECT c.folder_id, c.month_bucket, c.folder_path, c.status,
           c.messages_fetched, c.pages_done, c.user_id
      INTO v_folder_id, v_month, v_folder_path, v_status, v_msgs, v_pages, v_user
      FROM claimed c;
  END IF;

  IF v_folder_id IS NULL THEN
    RETURN;
  END IF;

  folder_id := v_folder_id;
  month_bucket := v_month;
  folder_path := v_folder_path;
  status := v_status;
  messages_fetched := v_msgs;
  pages_done := v_pages;
  account_user_id := v_user;

  -- Credential van het bijbehorende account. Blijft NULL als de registry nog
  -- leeg is; mail-backfill valt dan terug op agent_config (huidig gedrag).
  SELECT a.mailbox_email, a.composio_user_id, a.composio_connection_id
    INTO mailbox_email, composio_user_id, composio_connection_id
    FROM mail_accounts a
   WHERE a.user_id = v_user AND a.enabled AND NOT a.paused
   ORDER BY a.created_at ASC
   LIMIT 1;

  RETURN NEXT;
END;
$function$;

comment on function public.claim_next_backfill_bucket() is
  'Claimt één (folder × maand)-bucket MET de Composio-credential van het '
  'bijbehorende mail_accounts-record, zodat een bucket nooit met de verkeerde '
  'connectie kan draaien. Lege registry = geen filter (één-mailbox-tijdperk).';

revoke all on function public.claim_next_backfill_bucket() from public;
grant execute on function public.claim_next_backfill_bucket() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Bucket-seeder: per account de (folder × maand)-wachtrij aanmaken.
-- Zelfde granulariteit als de bestaande rijen: één kalendermaand per bucket,
-- nieuwste maand eerst (dat regelt de ORDER BY in de claim al).
--
-- p_since NULL → vanaf de oudste mail die we van deze mailbox al hebben, en
-- als die er niet is vanaf 24 maanden terug. Bewust conservatief: liever een
-- tweede seed-call dan per ongeluk 10 jaar Outlook binnentrekken.
-- -----------------------------------------------------------------------------
create or replace function public.seed_mail_backfill_buckets(
  p_user_id uuid,
  p_since   date default null,
  p_folder_ids text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_from date;
  v_inserted int := 0;
  v_folders int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mail_accounts a WHERE a.user_id = p_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_mail_account_for_user');
  END IF;

  v_from := coalesce(
    p_since,
    (SELECT date_trunc('month', min(m.received_at))::date
       FROM mail_messages m WHERE m.user_id = p_user_id),
    (date_trunc('month', now()) - interval '24 months')::date
  );

  WITH folders AS (
    SELECT f.id, f.full_path
      FROM mail_folders f
     WHERE f.user_id = p_user_id
       AND (p_folder_ids IS NULL OR f.id = ANY(p_folder_ids))
       AND (p_folder_ids IS NOT NULL
            OR EXISTS (SELECT 1 FROM mail_sync_state s
                        WHERE s.folder_id = f.id AND s.enabled))
  ),
  months AS (
    SELECT generate_series(
             date_trunc('month', v_from),
             date_trunc('month', now()),
             interval '1 month'
           )::date AS month_bucket
  ),
  ins AS (
    INSERT INTO mail_backfill_state (folder_id, month_bucket, folder_path, status, user_id)
    SELECT f.id, m.month_bucket, f.full_path, 'pending', p_user_id
      FROM folders f CROSS JOIN months m
    ON CONFLICT (folder_id, month_bucket) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ins), (SELECT count(*) FROM folders)
    INTO v_inserted, v_folders;

  RETURN jsonb_build_object(
    'ok', true, 'user_id', p_user_id, 'from_month', v_from,
    'folders', v_folders, 'buckets_created', v_inserted
  );
END;
$function$;

comment on function public.seed_mail_backfill_buckets(uuid, date, text[]) is
  'Vult mail_backfill_state met (folder × maand)-buckets voor één mailbox. '
  'Zonder p_folder_ids: alleen folders met een enabled mail_sync_state-rij. '
  'Idempotent (ON CONFLICT DO NOTHING).';

revoke all on function public.seed_mail_backfill_buckets(uuid, date, text[]) from public;
grant execute on function public.seed_mail_backfill_buckets(uuid, date, text[]) to service_role;

commit;

-- =============================================================================
-- Verificatie (los uitvoeren):
--   select * from public.claim_next_backfill_bucket();
--   select status, count(*) from public.mail_backfill_state group by 1;
-- =============================================================================
