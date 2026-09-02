-- =============================================================================
-- Migratie D — verrijking per account: trigger loopt over mail_accounts en
--              stuurt user_id mee in de POST-body
-- Per-user Outlook, fase 1 · MAIL-PIPELINE.md §3.4 (blokkade B5)
-- =============================================================================
-- Waarom:
--   De hele verrijkingsketen is al per user (mail_enrichment_claim_batch filtert
--   op mail_messages.user_id, mail_enrichment_budget is per user, mail-enricher
--   accepteert body.user_id). Alleen de cron-trigger was single-tenant: hij had
--   Jelle's uuid hardcoded en stuurde `{"mode":"backfill","limit":75}` zonder
--   user_id, waardoor mail-enricher terugviel op zijn eigen default-uuid.
--
-- Nu:
--   • per enabled/unpaused mail_accounts-rij: budget-check, resterende mails
--     tellen, en 4 parallelle POSTs met user_id in de body;
--   • 4 calls binnen één mailbox, niet over mailboxen heen — dan blijft de
--     kostenattributie schoon en de check_enrichment_budget-gate zinvol;
--   • mailboxen zonder werk of met een dichte budget-gate worden overgeslagen
--     met vermelding in de return, niet stil;
--   • per run maximaal MAX_ACCOUNTS_PER_RUN mailboxen (round-robin op
--     last_claim_at['enrich']), zodat de cron-cadence niet ontploft bij N > 4.
--
-- Ook opgelost: de edge-URL was hardcoded op het prod-project, óók in de
-- Dev-kopie van deze functie. edge_functions_base_url() leest
-- agent_config('global','functions_base_url') met de prod-URL als fallback,
-- zodat een Dev-run niet ongemerkt naar prod POST't.
--
-- Gedrag met één account = vandaag: één mailbox, 4 calls, limit 75.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Elke mailbox heeft een budget-rij nodig, anders geeft
--    check_enrichment_budget iets onbepaalds terug en valt verrijking stil.
--    (Prod heeft hiervoor een trigger op auth.users; Dev niet.)
-- -----------------------------------------------------------------------------
insert into public.mail_enrichment_budget (user_id)
select distinct a.user_id from public.mail_accounts a
on conflict (user_id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Basis-URL voor server-side edge-calls, per project instelbaar.
-- -----------------------------------------------------------------------------
create or replace function public.edge_functions_base_url()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT coalesce(
    (SELECT c.config_value #>> '{}' FROM public.agent_config c
      WHERE c.agent_name = 'global' AND c.config_key = 'functions_base_url'),
    'https://ezxihctobrqoklufawim.supabase.co'
  );
$function$;

comment on function public.edge_functions_base_url() is
  'Basis-URL voor net.http_post naar Edge Functions. Zet agent_config '
  '(global, functions_base_url) per project; fallback is prod.';

revoke all on function public.edge_functions_base_url() from public;
grant execute on function public.edge_functions_base_url() to service_role;

-- -----------------------------------------------------------------------------
-- 3. De trigger zelf
-- -----------------------------------------------------------------------------
create or replace function public.mail_enrichment_trigger_backfill_batch()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'vault'
as $function$
DECLARE
  MAX_ACCOUNTS_PER_RUN constant int := 2;
  PARALLEL_CALLS       constant int := 4;
  LIMIT_PER_CALL       constant int := 75;

  v_service_key text;
  v_base_url    text;
  v_acc         record;
  v_remaining   int;
  v_budget      jsonb;
  v_request_ids int[];
  v_results     jsonb := '[]'::jsonb;
  v_triggered   int := 0;
  v_i           int;
BEGIN
  -- 2026-09-02 (security review, F-14): las vault-secret 'service_role_key',
  -- die op dit project niet bestaat. 'Bearer '||NULL werd daarmee NULL en de
  -- POST ging zonder credential de deur uit — wat werkte omdat mail-enricher
  -- geen auth-check had. Sinds mail-enricher v10 wél. Nu de canonieke
  -- server-to-server-credential, net als elke andere cron-caller.
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    -- Loud falen: zonder credential geeft mail-enricher 401 en zou de
    -- verrijking stil stilvallen. Dat is precies de storing die niemand ziet.
    RETURN jsonb_build_object('skipped', true, 'reason', 'cron_secret_missing');
  END IF;

  v_base_url := public.edge_functions_base_url();

  -- Round-robin over de mailboxen: oudste 'enrich'-claim eerst.
  FOR v_acc IN
    SELECT a.id, a.user_id, a.mailbox_email
      FROM public.mail_accounts a
     WHERE a.enabled AND NOT a.paused
     ORDER BY (a.last_claim_at ->> 'enrich')::timestamptz ASC NULLS FIRST,
              a.created_at ASC, a.id ASC
     LIMIT MAX_ACCOUNTS_PER_RUN
  LOOP
    -- Hoeveel mails van déze mailbox wachten nog op verrijking?
    SELECT count(*) INTO v_remaining
      FROM public.mail_messages m
     WHERE m.user_id = v_acc.user_id
       AND (m.is_deleted IS NULL OR m.is_deleted = false)
       AND NOT EXISTS (SELECT 1 FROM public.mail_enrichment e WHERE e.mail_id = m.id);

    IF v_remaining = 0 THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'mailbox', v_acc.mailbox_email, 'done', true, 'remaining', 0));
      CONTINUE;
    END IF;

    SELECT public.check_enrichment_budget(v_acc.user_id) INTO v_budget;
    IF v_budget->>'status' IN ('hard_block', 'paused', 'daily_block') THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'mailbox', v_acc.mailbox_email, 'skipped', true,
        'reason', v_budget->>'status', 'remaining', v_remaining));
      CONTINUE;
    END IF;

    v_request_ids := ARRAY[]::int[];
    FOR v_i IN 1..PARALLEL_CALLS LOOP
      v_request_ids := v_request_ids || net.http_post(
        url     := v_base_url || '/functions/v1/mail-enricher',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_service_key),
        body    := jsonb_build_object(
                     'mode', 'backfill',
                     'limit', LIMIT_PER_CALL,
                     'user_id', v_acc.user_id),
        timeout_milliseconds := 180000
      );
    END LOOP;

    UPDATE public.mail_accounts
       SET last_claim_at = last_claim_at || jsonb_build_object('enrich', to_jsonb(now())),
           updated_at    = now()
     WHERE id = v_acc.id;

    v_triggered := v_triggered + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'mailbox', v_acc.mailbox_email,
      'triggered', true,
      'remaining_before', v_remaining,
      'request_ids', v_request_ids,
      'budget', v_budget));
  END LOOP;

  IF v_triggered = 0 AND jsonb_array_length(v_results) = 0 THEN
    -- Geen enkel account in de registry: het één-mailbox-tijdperk is voorbij
    -- zodra migratie A geseed is, dus dit is een echte configuratiefout.
    RETURN jsonb_build_object('skipped', true, 'reason', 'no_mail_accounts');
  END IF;

  RETURN jsonb_build_object(
    'triggered_accounts', v_triggered,
    'accounts', v_results,
    'parallel_calls', PARALLEL_CALLS,
    'limit_per_call', LIMIT_PER_CALL,
    'max_accounts_per_run', MAX_ACCOUNTS_PER_RUN,
    'base_url', v_base_url
  );
END;
$function$;

comment on function public.mail_enrichment_trigger_backfill_batch() is
  'Cron mail-enricher-backfill (*/5). Loopt round-robin over mail_accounts, per '
  'mailbox budget-check + 4 parallelle POSTs mét user_id in de body. Geen '
  'hardcoded uuid meer.';

revoke all on function public.mail_enrichment_trigger_backfill_batch() from public;
grant execute on function public.mail_enrichment_trigger_backfill_batch() to authenticated, service_role;

commit;

-- =============================================================================
-- Verificatie (los uitvoeren; POST't echt):
--   select public.edge_functions_base_url();
--   select public.mail_enrichment_trigger_backfill_batch();
-- =============================================================================
