-- =============================================================================
-- Migratie E — server-to-server credentials rechttrekken
-- Security review 2026-09-02 · findings bij F-14 (nieuw gevonden tijdens fix)
-- =============================================================================
-- Twee dingen die tijdens het hardenen boven kwamen:
--
--   1. `mail_enrichment_trigger_backfill_batch()` leest vault-secret
--      'service_role_key'. Die bestaat niet op dit project — vault heeft alleen
--      'skill:*'-namen. `'Bearer '||NULL` is NULL, dus de vier POSTs naar
--      mail-enricher gingen zonder credential. Dat viel niet op omdat
--      mail-enricher geen auth-check had. Nu die er is (v10), moet de caller
--      een echte credential meesturen, anders valt de mail-verrijking stil.
--
--   2. Twee cron-jobs hadden de cron_secret als **letterlijke waarde** in
--      cron.job.command staan in plaats van de vault-lookup die alle andere
--      jobs gebruiken: `chunker-meeting-v2-poll` en `fireflies-categorize-poll`.
--      De command-tekst is leesbaar voor elke rol die cron.job mag lezen —
--      inclusief de read-only rol die de security-scan gebruikt. Dit zet ze op
--      hetzelfde patroon als de rest. De waarde zelf verschijnt nergens in dit
--      bestand; de vervanging gebeurt met een regex op de bestaande command.
--
--      Rotatie van de cron_secret blijft een aparte keuze voor Jelle: de waarde
--      is niet publiek geweest (geen anon-pad), alleen breder leesbaar dan nodig.
--
-- Idempotent: CREATE OR REPLACE + een regex die na de eerste run niets meer vindt.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. De backfill-trigger stuurt de cron_secret mee.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mail_enrichment_trigger_backfill_batch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'vault'
AS $function$
DECLARE
  v_service_key text;
  v_remaining int;
  v_user_id uuid := '0934ffef-f600-4e1c-90c3-9d9bda2e0e42'::uuid;
  v_request_ids int[];
  v_budget jsonb;
BEGIN
  -- 2026-09-02 (security review, F-14): las vault-secret 'service_role_key',
  -- die op dit project niet bestaat. 'Bearer '||NULL werd daarmee NULL en de
  -- POST ging zonder credential de deur uit — wat werkte omdat mail-enricher
  -- geen auth-check had. Sinds mail-enricher v10 wél. Nu de canonieke
  -- server-to-server-credential, net als elke andere cron-caller.
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name='skill:global:cron_secret' LIMIT 1;

  IF v_service_key IS NULL OR length(v_service_key) = 0 THEN
    -- Loud falen: zonder credential geeft mail-enricher 401 en zou de
    -- verrijking stil stilvallen. Dat is precies de storing die niemand ziet.
    RETURN jsonb_build_object('skipped', true, 'reason', 'cron_secret_missing');
  END IF;

  -- Check budget vóór triggers
  SELECT public.check_enrichment_budget(v_user_id) INTO v_budget;
  IF v_budget->>'status' IN ('hard_block','paused','daily_block') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', v_budget->>'status');
  END IF;

  -- Hoeveel mails nog?
  SELECT COUNT(*) INTO v_remaining FROM public.mail_messages m
    WHERE m.user_id = v_user_id
      AND (m.is_deleted IS NULL OR m.is_deleted = false)
      AND NOT EXISTS (SELECT 1 FROM public.mail_enrichment e WHERE e.mail_id = m.id);

  IF v_remaining = 0 THEN
    RETURN jsonb_build_object('done', true, 'remaining', 0);
  END IF;

  -- 4 parallel http_post triggers
  v_request_ids := ARRAY[
    net.http_post(
      url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-enricher',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_key),
      body := '{"mode":"backfill","limit":75}'::jsonb,
      timeout_milliseconds := 180000
    ),
    net.http_post(
      url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-enricher',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_key),
      body := '{"mode":"backfill","limit":75}'::jsonb,
      timeout_milliseconds := 180000
    ),
    net.http_post(
      url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-enricher',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_key),
      body := '{"mode":"backfill","limit":75}'::jsonb,
      timeout_milliseconds := 180000
    ),
    net.http_post(
      url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-enricher',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_service_key),
      body := '{"mode":"backfill","limit":75}'::jsonb,
      timeout_milliseconds := 180000
    )
  ];

  RETURN jsonb_build_object(
    'triggered', true,
    'remaining_before', v_remaining,
    'request_ids', v_request_ids,
    'budget', v_budget,
    'parallel_calls', 4,
    'limit_per_call', 75,
    'estimated_throughput', '600 mails/uur'
  );
END $function$;

-- -----------------------------------------------------------------------------
-- 2. Cron-jobs zonder vault-lookup omzetten.
--
--    In de command staat de credential als complete SQL-stringliteral:
--        'Authorization', 'Bearer <waarde>'
--    De quotes horen dus BIJ de match; die worden vervangen door
--        'Bearer ' || (SELECT decrypted_secret FROM vault... )
--    Patroon en vervanging staan hieronder dollar-quoted ($re$ / $rep$) —
--    met genest gequote quotes was de eerste versie van deze migratie fout en
--    matchte hij niets (gezien op prod 2026-09-02, daarna hersteld).
-- -----------------------------------------------------------------------------
do $migratie_e$
declare
  j record;
  new_cmd text;
  n_changed int := 0;
  re_pattern text := $re$'Bearer [A-Za-z0-9_-]{30,}'$re$;
  re_replace text := $rep$'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'skill:global:cron_secret' LIMIT 1)$rep$;
begin
  for j in
    select jobid, jobname, command
    from cron.job
    where command ~ re_pattern
  loop
    new_cmd := regexp_replace(j.command, re_pattern, re_replace, 'g');
    if new_cmd = j.command or new_cmd !~ 'vault\.decrypted_secrets' then
      raise exception 'Migratie E: vervanging op cron-job % (%) mislukte', j.jobname, j.jobid;
    end if;
    perform cron.alter_job(job_id => j.jobid, command => new_cmd);
    n_changed := n_changed + 1;
    raise notice 'Migratie E.2: cron-job % (%) leest de cron_secret nu uit Vault', j.jobname, j.jobid;
  end loop;
  raise notice 'Migratie E.2: % cron-jobs omgezet', n_changed;
end;
$migratie_e$;

-- -----------------------------------------------------------------------------
-- 3. Vangnet
-- -----------------------------------------------------------------------------
do $verify_e$
declare
  n int;
begin
  select count(*) into n
  from cron.job
  where command ~ $re2$'Bearer [A-Za-z0-9_-]{30,}'$re2$;
  if n > 0 then
    raise exception 'Migratie E: nog % cron-jobs met een letterlijke bearer-waarde', n;
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'mail_enrichment_trigger_backfill_batch'
      and p.prosrc like '%skill:global:cron_secret%'
  ) then
    raise exception 'Migratie E: backfill-trigger leest de cron_secret niet';
  end if;
end;
$verify_e$;

commit;
