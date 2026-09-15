-- =============================================================================
-- Postvak — verstuur-teller (7 per uur per gebruiker)
-- =============================================================================
-- Jelle's beleid van 2026-09-15 00:44 CEST: Maestro mag versturen, maar alleen
-- naar `@legal-mind.nl` en **maximaal 7 keer per uur per gebruiker**, "hard in
-- edge/DB". Een teller in de Edge Function alleen is geen teller: elke instantie
-- start koud en er draaien er meerdere naast elkaar. Hij hoort dus hier.
--
-- Wie schrijft: alleen `outlook-live` met de service-role-sleutel. Geen enkele
-- browser-rol krijgt EXECUTE op de functie en geen enkele policy geeft
-- `authenticated` toegang tot de tabel — er is dus geen pad waarlangs de
-- aanroeper zijn eigen plafond kan verzetten.
--
-- ⚠ `claim_mail_send_slot` claimt **vóór** de send. Dat is de veilige kant: als
-- de verbinding halverwege afbreekt weet niemand of Graph de mail heeft
-- verstuurd, en dan is een verbruikt slot beter dan een gratis extra. Een send
-- die om een *bekende* reden niet vertrok (geen Mail.Send-grant, extern adres)
-- geeft zijn slot terug via `release_mail_send_slot`.
-- =============================================================================

create table if not exists public.mail_send_log (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  claimed_at      timestamptz not null default now(),
  -- 'claimed' zolang de uitkomst onbekend is, 'sent' na bevestiging.
  -- Beide tellen mee voor het plafond; alleen een vrijgegeven slot verdwijnt.
  status          text not null default 'claimed',
  recipient_count integer not null default 0,
  -- Geen adressen, geen onderwerp: voor een teller is dat niet nodig en de
  -- tabel hoeft geen tweede kopie van de mailbox te worden.
  constraint mail_send_log_status_chk check (status in ('claimed', 'sent'))
);

create index if not exists mail_send_log_user_time_idx
  on public.mail_send_log (user_id, claimed_at desc);

alter table public.mail_send_log enable row level security;

-- Alleen de service-role komt erbij. Geen policy voor `authenticated`: de
-- browser heeft hier niets te zoeken, ook niet lezend.
drop policy if exists "mail_send_log all srv" on public.mail_send_log;
create policy "mail_send_log all srv" on public.mail_send_log
  for all to service_role using (true) with check (true);

-- -----------------------------------------------------------------------------
-- claim_mail_send_slot — atomair een plek in het uur pakken.
-- -----------------------------------------------------------------------------
-- De advisory lock is het verschil tussen een teller en een suggestie: zonder
-- hem kunnen twee gelijktijdige calls allebei 6 tellen en allebei versturen.
create or replace function public.claim_mail_send_slot(
  p_user_id uuid,
  p_limit integer default 7,
  p_recipient_count integer default 1
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_used  integer;
  v_id    uuid;
  v_oldest timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user');
  end if;

  -- Per gebruiker serialiseren, niet globaal: twee mensen die tegelijk mailen
  -- horen niet op elkaar te wachten.
  perform pg_advisory_xact_lock(hashtext('mail_send_slot:' || p_user_id::text));

  select count(*), min(claimed_at) into v_used, v_oldest
    from public.mail_send_log
   where user_id = p_user_id
     and claimed_at > now() - interval '1 hour';

  if v_used >= p_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'send_rate_limited',
      'used', v_used,
      'limit', p_limit,
      -- Wanneer het oudste slot uit het uurvenster valt: dán mag er weer één.
      'retry_after', to_char(v_oldest + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  end if;

  insert into public.mail_send_log (user_id, recipient_count)
  values (p_user_id, greatest(coalesce(p_recipient_count, 1), 0))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'slot_id', v_id, 'used', v_used + 1, 'limit', p_limit);
end;
$function$;

-- -----------------------------------------------------------------------------
-- confirm / release — de uitkomst van de send terugkoppelen.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_mail_send_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  update public.mail_send_log set status = 'sent' where id = p_slot_id;
  return jsonb_build_object('ok', found);
end;
$function$;

-- Alleen voor een send die om een BEKENDE reden niet vertrok. Bij twijfel
-- blijft het slot staan — zie de kop.
create or replace function public.release_mail_send_slot(p_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  delete from public.mail_send_log where id = p_slot_id and status = 'claimed';
  return jsonb_build_object('ok', found);
end;
$function$;

-- -----------------------------------------------------------------------------
-- Rechten — en dit is de helft die je moet meten, niet aannemen.
-- -----------------------------------------------------------------------------
-- `revoke ... from public` is hier NIET genoeg. Dit project heeft een
-- ALTER DEFAULT PRIVILEGES die `authenticated` EXECUTE geeft op nieuwe functies:
-- na de eerste toepassing stond er letterlijk
--     {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- en dan is het plafond geen plafond. Een ingelogde gebruiker had
-- `release_mail_send_slot` kunnen aanroepen om zijn eigen teller leeg te maken,
-- of `claim_mail_send_slot` met andermans uuid om diens uur op te maken.
-- Daarom `anon` en `authenticated` er expliciet bij, en een DO-blok dat de
-- uitkomst controleert in plaats van erop te vertrouwen.
revoke all on function public.claim_mail_send_slot(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.confirm_mail_send_slot(uuid) from public, anon, authenticated;
revoke all on function public.release_mail_send_slot(uuid) from public, anon, authenticated;

grant execute on function public.claim_mail_send_slot(uuid, integer, integer) to service_role;
grant execute on function public.confirm_mail_send_slot(uuid) to service_role;
grant execute on function public.release_mail_send_slot(uuid) to service_role;

do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_mail_send_slot', 'confirm_mail_send_slot', 'release_mail_send_slot')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'verstuur-teller staat open voor de browser: %', v_bad;
  end if;
end $$;

comment on table public.mail_send_log is
  'Verstuur-teller voor Postvak. 7 per uur per gebruiker (Jelle 2026-09-15). Alleen service_role; outlook-live claimt vóór de send.';
