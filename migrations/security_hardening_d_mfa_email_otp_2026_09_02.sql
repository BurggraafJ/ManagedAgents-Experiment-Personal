-- =============================================================================
-- Migratie D — tweede factor: e-mail-OTP ná login
-- Security review 2026-09-02 · REPORT §3 (F-11), bouwt op migratie A/B/C
-- =============================================================================
-- Waarom in de datalaag en niet alleen in de UI:
--   na een geslaagd wachtwoord- of magic-link-login is de JWT al geldig en kan
--   de browser PostgREST rechtstreeks bevragen. Een OTP-scherm dat alleen de UI
--   blokkeert is dan cosmetisch. Omdat migratie B alle datatabellen achter één
--   predicate heeft gezet (is_admin_or_higher()), is de tweede factor nu een
--   wijziging in één functie die meteen alle ~136 tabellen dekt.
--
-- Transport van de code:
--   GoTrue's eigen e-mail-OTP (`POST /auth/v1/otp` → `POST /auth/v1/verify`),
--   dus via de SMTP-afzender die al geconfigureerd staat (Resend). Er komt geen
--   nieuw secret bij, en de code zelf wordt nooit in deze database opgeslagen —
--   alleen het feit dát er een challenge liep, voor rate-limiting en pogingen.
--
-- Break-glass (bewust ingebouwd):
--   app_mfa_config.enforce = false, of break_glass_until in de toekomst, zet de
--   tweede factor tijdelijk uit. Alleen service_role kan dat. Zonder deze knop
--   is een storing bij de mailbezorging gelijk aan een dichte database.
--
--   Enforcement start op FALSE. Zet hem pas op true als de UI die het
--   Verificatiecode-scherm rendert daadwerkelijk gedeployed is — anders ziet de
--   owner een leeg dashboard zonder scherm om de code in te typen:
--     select public.mfa_set_enforcement(true);
--
-- Idempotent: create table if not exists / create or replace.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tabellen
-- -----------------------------------------------------------------------------

-- Globale schakelaar + noodpad. Eén rij (id = 1).
create table if not exists public.app_mfa_config (
  id                 smallint     primary key default 1 check (id = 1),
  enforce            boolean      not null default false,
  break_glass_until  timestamptz,
  otp_ttl_seconds    integer      not null default 600,
  max_attempts       integer      not null default 5,
  max_codes_per_window integer    not null default 3,
  window_minutes     integer      not null default 15,
  trusted_device_days integer     not null default 14,
  updated_at         timestamptz  not null default now(),
  updated_by         text
);
insert into public.app_mfa_config (id) values (1) on conflict (id) do nothing;

-- Eén rij per verstuurde challenge. Bevat NOOIT de code zelf — GoTrue houdt die.
create table if not exists public.user_mfa_email_otp (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  session_id   uuid,
  sent_at      timestamptz not null default now(),
  expires_at   timestamptz not null,
  attempts     integer     not null default 0,
  consumed_at  timestamptz,
  ip           text,
  user_agent   text
);
create index if not exists user_mfa_email_otp_user_sent_idx
  on public.user_mfa_email_otp (user_id, sent_at desc);
create index if not exists user_mfa_email_otp_open_idx
  on public.user_mfa_email_otp (user_id, session_id, consumed_at, expires_at);

-- Vertrouwde apparaten. Het 14-dagenvenster leeft hier, server-side —
-- niet in localStorage zoals de oude 7-dagen remember-me (F-12).
create table if not exists public.user_trusted_devices (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  device_token_hash text        not null,
  user_agent        text,
  first_ip          text,
  created_at        timestamptz not null default now(),
  last_seen_at      timestamptz,
  expires_at        timestamptz not null,
  revoked_at        timestamptz
);
create unique index if not exists user_trusted_devices_hash_uidx
  on public.user_trusted_devices (device_token_hash);
create index if not exists user_trusted_devices_user_idx
  on public.user_trusted_devices (user_id, revoked_at, expires_at);

-- Welke sessies de tweede factor hebben gehaald. Dit is wat session_mfa_ok() leest.
create table if not exists public.user_session_mfa (
  session_id  uuid        primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  verified_at timestamptz not null default now(),
  expires_at  timestamptz not null,
  method      text        not null check (method in ('otp', 'trusted_device', 'break_glass')),
  user_agent  text
);
create index if not exists user_session_mfa_user_idx
  on public.user_session_mfa (user_id, expires_at);

alter table public.app_mfa_config      enable row level security;
alter table public.user_mfa_email_otp  enable row level security;
alter table public.user_trusted_devices enable row level security;
alter table public.user_session_mfa    enable row level security;

-- Geen enkele browser-rol komt direct bij deze tabellen; alles loopt via de
-- RPC's hieronder. service_role (Edge Functions) heeft bypassrls maar krijgt
-- voor de duidelijkheid ook een expliciete policy.
do $$
declare t text;
begin
  foreach t in array array['app_mfa_config','user_mfa_email_otp','user_trusted_devices','user_session_mfa'] loop
    execute format('drop policy if exists %I on public.%I', t || '_service', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. session_mfa_ok() — het predicate dat in is_admin_or_higher() wordt gevouwen
-- -----------------------------------------------------------------------------
create or replace function public.session_mfa_ok()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $session_mfa_ok$
declare
  cfg        public.app_mfa_config;
  v_session  uuid;
  v_claims   jsonb;
begin
  select * into cfg from public.app_mfa_config where id = 1;

  -- Nog geen config of enforcement uit → tweede factor niet van toepassing.
  if cfg.id is null or not cfg.enforce then
    return true;
  end if;

  -- Noodpad: break-glass venster open.
  if cfg.break_glass_until is not null and cfg.break_glass_until > now() then
    return true;
  end if;

  -- Interne callers (pg_cron, migraties, psql) en server-to-server met de
  -- service-role key hebben geen browsersessie en dus geen tweede factor.
  if session_user is distinct from 'authenticator' then
    return true;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return true;
  end if;

  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_session := nullif(v_claims ->> 'session_id', '')::uuid;
  if v_session is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_session_mfa m
    where m.session_id = v_session
      and m.user_id    = auth.uid()
      and m.expires_at > now()
  );
end;
$session_mfa_ok$;

comment on function public.session_mfa_ok() is
  'True als de huidige browsersessie de e-mail-OTP-stap heeft gehaald, of als '
  'enforcement/break-glass dat overbodig maakt. Gelezen door is_admin_or_higher().';

-- -----------------------------------------------------------------------------
-- 3. De fold: één predicate dekt rol én tweede factor.
--    Alle ~136 datatabellen uit migratie B en alle guards uit migratie C
--    lopen hier vanaf nu langs.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin_or_higher()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $is_admin$
  select public.current_user_role() = 'owner'
     and public.session_mfa_ok();
$is_admin$;

comment on function public.is_admin_or_higher() is
  'Owner-rol uit user_roles EN een sessie die de tweede factor heeft gehaald '
  '(migratie D, 2026-09-02). Enig autorisatie-predicate op de datatabellen.';

-- -----------------------------------------------------------------------------
-- 4. RPC's voor de Edge Functions (mfa-email-send / mfa-email-verify).
--    Uitsluitend service_role — de browser praat nooit direct met deze.
-- -----------------------------------------------------------------------------

-- Mag er een nieuwe code de deur uit? Registreert de challenge als het mag.
create or replace function public.mfa_challenge_start(
  p_user_id    uuid,
  p_session_id uuid,
  p_ip         text default null,
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  cfg    public.app_mfa_config;
  n_recent int;
  v_row  public.user_mfa_email_otp;
begin
  perform public.assert_service_role();
  select * into cfg from public.app_mfa_config where id = 1;

  select count(*) into n_recent
  from public.user_mfa_email_otp
  where user_id = p_user_id
    and sent_at > now() - make_interval(mins => cfg.window_minutes);

  if n_recent >= cfg.max_codes_per_window then
    return jsonb_build_object(
      'ok', false, 'reason', 'rate_limited',
      'retry_after_seconds', cfg.window_minutes * 60,
      'max_codes_per_window', cfg.max_codes_per_window);
  end if;

  -- Openstaande challenges voor deze sessie sluiten; er is er altijd maar één geldig.
  update public.user_mfa_email_otp
  set consumed_at = now()
  where user_id = p_user_id and consumed_at is null;

  insert into public.user_mfa_email_otp (user_id, session_id, expires_at, ip, user_agent)
  values (p_user_id, p_session_id,
          now() + make_interval(secs => cfg.otp_ttl_seconds), p_ip, p_user_agent)
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'challenge_id', v_row.id,
    'expires_at', v_row.expires_at,
    'ttl_seconds', cfg.otp_ttl_seconds,
    'max_attempts', cfg.max_attempts);
end;
$fn$;

-- Poging registreren. Bij success wordt de challenge geconsumeerd.
create or replace function public.mfa_challenge_attempt(
  p_user_id  uuid,
  p_success  boolean
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  cfg   public.app_mfa_config;
  v_row public.user_mfa_email_otp;
begin
  perform public.assert_service_role();
  select * into cfg from public.app_mfa_config where id = 1;

  select * into v_row
  from public.user_mfa_email_otp
  where user_id = p_user_id and consumed_at is null and expires_at > now()
  order by sent_at desc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_open_challenge');
  end if;

  if v_row.attempts >= cfg.max_attempts then
    update public.user_mfa_email_otp set consumed_at = now() where id = v_row.id;
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  update public.user_mfa_email_otp
  set attempts    = attempts + 1,
      consumed_at = case when p_success then now() else consumed_at end
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'attempts_left', greatest(cfg.max_attempts - v_row.attempts, 0));
end;
$fn$;

-- Challenge weggooien als de mail niet de deur uit kwam. Zonder dit kost een
-- mislukte verzending een van de 3 codes per 15 minuten.
create or replace function public.mfa_challenge_abort(p_challenge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  n int;
begin
  perform public.assert_service_role();
  delete from public.user_mfa_email_otp
  where id = p_challenge_id and consumed_at is null and attempts = 0;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end;
$fn$;

-- Challenge afsluiten na een geslaagde code (de poging is al afgetikt).
create or replace function public.mfa_challenge_consume(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  n int;
begin
  perform public.assert_service_role();
  update public.user_mfa_email_otp
  set consumed_at = now()
  where user_id = p_user_id and consumed_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'closed', n);
end;
$fn$;

-- Sessie als MFA-ok markeren.
create or replace function public.mfa_session_mark_ok(
  p_user_id    uuid,
  p_session_id uuid,
  p_method     text default 'otp',
  p_user_agent text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_expires timestamptz;
begin
  perform public.assert_service_role();
  -- De sessie-JWT leeft maximaal zolang de Auth-sessie (sessions_timebox 14d);
  -- we houden de MFA-markering daar gelijk aan.
  v_expires := now() + interval '14 days';
  insert into public.user_session_mfa (session_id, user_id, expires_at, method, user_agent)
  values (p_session_id, p_user_id, v_expires, p_method, p_user_agent)
  on conflict (session_id) do update
    set verified_at = now(),
        expires_at  = excluded.expires_at,
        method      = excluded.method,
        user_agent  = coalesce(excluded.user_agent, user_session_mfa.user_agent);
  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end;
$fn$;

-- Trusted device controleren (hash-in, boolean-uit; de raw token raakt de DB nooit).
create or replace function public.mfa_trusted_device_check(
  p_user_id    uuid,
  p_token_hash text
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_id uuid;
begin
  perform public.assert_service_role();
  if p_token_hash is null or length(p_token_hash) < 32 then
    return false;
  end if;
  select id into v_id
  from public.user_trusted_devices
  where user_id = p_user_id
    and device_token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now();
  if v_id is null then
    return false;
  end if;
  update public.user_trusted_devices set last_seen_at = now() where id = v_id;
  return true;
end;
$fn$;

create or replace function public.mfa_trusted_device_add(
  p_user_id    uuid,
  p_token_hash text,
  p_user_agent text default null,
  p_ip         text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  cfg       public.app_mfa_config;
  v_expires timestamptz;
begin
  perform public.assert_service_role();
  select * into cfg from public.app_mfa_config where id = 1;
  v_expires := now() + make_interval(days => cfg.trusted_device_days);
  insert into public.user_trusted_devices
    (user_id, device_token_hash, user_agent, first_ip, expires_at, last_seen_at)
  values (p_user_id, p_token_hash, p_user_agent, p_ip, v_expires, now())
  on conflict (device_token_hash) do update
    set expires_at   = excluded.expires_at,
        revoked_at   = null,
        last_seen_at = now();
  return jsonb_build_object('ok', true, 'expires_at', v_expires,
                            'days', cfg.trusted_device_days);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Browser-RPC's
-- -----------------------------------------------------------------------------

-- Mag pre-MFA aangeroepen worden — anders kan de UI niet weten dát er een code
-- nodig is. Leest uitsluitend de eigen sessie-status.
create or replace function public.mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  cfg      public.app_mfa_config;
  v_claims jsonb;
begin
  select * into cfg from public.app_mfa_config where id = 1;
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  return jsonb_build_object(
    'enforced',           coalesce(cfg.enforce, false),
    'break_glass_active', coalesce(cfg.break_glass_until > now(), false),
    'session_ok',         public.session_mfa_ok(),
    'user_id',            auth.uid(),
    'session_id',         nullif(v_claims ->> 'session_id', ''),
    'trusted_device_days', coalesce(cfg.trusted_device_days, 14),
    'otp_ttl_seconds',    coalesce(cfg.otp_ttl_seconds, 600));
end;
$fn$;

-- Owner-view voor UsersPage / MobileAdminUsers.
create or replace function public.mfa_trusted_devices_overview()
returns table (user_id uuid, device_count integer, last_seen_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  if not public.is_admin_or_higher() then
    raise exception 'forbidden: alleen de owner ziet vertrouwde apparaten'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.user_id, count(*)::integer, max(d.last_seen_at)
    from public.user_trusted_devices d
    where d.revoked_at is null and d.expires_at > now()
    group by d.user_id;
end;
$fn$;

-- De noodrem bij een verloren laptop.
create or replace function public.mfa_revoke_trusted_devices(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  n int;
begin
  if not public.is_admin_or_higher() then
    raise exception 'forbidden: alleen de owner trekt vertrouwde apparaten in'
      using errcode = 'insufficient_privilege';
  end if;
  update public.user_trusted_devices
  set revoked_at = now()
  where user_id = p_user_id and revoked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'revoked', n);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 6. Break-glass — uitsluitend service_role (Supabase-console / vault-relay).
--    Zonder dit is een mailstoring gelijk aan een lockout.
-- -----------------------------------------------------------------------------
create or replace function public.assert_service_role()
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  -- Interne callers (psql, migratie, cron) en de service-role key mogen door.
  if session_user is distinct from 'authenticator'
     and current_setting('request.method', true) is null then
    return;
  end if;
  if coalesce(auth.role(), '') = 'service_role' then
    return;
  end if;
  raise exception 'forbidden: service_role vereist'
    using errcode = 'insufficient_privilege';
end;
$fn$;

create or replace function public.mfa_break_glass(p_minutes integer default 60)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_until timestamptz;
begin
  perform public.assert_service_role();
  v_until := now() + make_interval(mins => greatest(coalesce(p_minutes, 60), 1));
  update public.app_mfa_config
  set break_glass_until = v_until, updated_at = now(), updated_by = 'break_glass'
  where id = 1;
  return jsonb_build_object('ok', true, 'break_glass_until', v_until);
end;
$fn$;

create or replace function public.mfa_break_glass_clear()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  perform public.assert_service_role();
  update public.app_mfa_config
  set break_glass_until = null, updated_at = now(), updated_by = 'break_glass_clear'
  where id = 1;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.mfa_set_enforcement(p_enforce boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  perform public.assert_service_role();
  update public.app_mfa_config
  set enforce = coalesce(p_enforce, false), updated_at = now(),
      updated_by = 'mfa_set_enforcement'
  where id = 1;
  return jsonb_build_object('ok', true, 'enforce', coalesce(p_enforce, false));
end;
$fn$;

-- Laatste redmiddel: één sessie handmatig MFA-ok maken vanuit de console.
create or replace function public.mfa_force_session_ok(
  p_session_id uuid,
  p_user_id    uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  perform public.assert_service_role();
  insert into public.user_session_mfa (session_id, user_id, expires_at, method)
  values (p_session_id, p_user_id, now() + interval '14 days', 'break_glass')
  on conflict (session_id) do update
    set verified_at = now(), expires_at = excluded.expires_at, method = 'break_glass';
  return jsonb_build_object('ok', true);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 7. Rechten: anon nergens, service_role op de machine-RPC's, authenticated
--    alleen op de drie browser-RPC's.
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
  service_only text[] := array[
    'assert_service_role()',
    'mfa_challenge_start(uuid,uuid,text,text)',
    'mfa_challenge_attempt(uuid,boolean)',
    'mfa_challenge_consume(uuid)',
    'mfa_challenge_abort(uuid)',
    'mfa_session_mark_ok(uuid,uuid,text,text)',
    'mfa_trusted_device_check(uuid,text)',
    'mfa_trusted_device_add(uuid,text,text,text)',
    'mfa_break_glass(integer)',
    'mfa_break_glass_clear()',
    'mfa_set_enforcement(boolean)',
    'mfa_force_session_ok(uuid,uuid)'
  ];
  browser_ok text[] := array[
    'mfa_status()',
    'mfa_trusted_devices_overview()',
    'mfa_revoke_trusted_devices(uuid)',
    'session_mfa_ok()'
  ];
begin
  foreach f in array service_only loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array browser_ok loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Opruimen: verlopen challenges, sessie-markeringen en devices.
-- -----------------------------------------------------------------------------
create or replace function public.mfa_cleanup()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  n_otp int; n_sess int; n_dev int;
begin
  perform public.assert_service_role();
  delete from public.user_mfa_email_otp where sent_at < now() - interval '30 days';
  get diagnostics n_otp = row_count;
  delete from public.user_session_mfa where expires_at < now() - interval '7 days';
  get diagnostics n_sess = row_count;
  delete from public.user_trusted_devices
  where (expires_at < now() - interval '30 days')
     or (revoked_at is not null and revoked_at < now() - interval '30 days');
  get diagnostics n_dev = row_count;
  return jsonb_build_object('ok', true, 'otp', n_otp, 'sessions', n_sess, 'devices', n_dev);
end;
$fn$;
revoke execute on function public.mfa_cleanup() from public, anon, authenticated;
grant  execute on function public.mfa_cleanup() to service_role;

-- -----------------------------------------------------------------------------
-- 9. Vangnet
-- -----------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin_or_higher'
      and p.prosrc like '%session_mfa_ok%'
  ) then
    raise exception 'Migratie D: session_mfa_ok() zit niet in is_admin_or_higher()';
  end if;
  if (select enforce from public.app_mfa_config where id = 1) then
    raise notice 'Migratie D: enforcement staat AAN — controleer dat de UI live is';
  else
    raise notice 'Migratie D: enforcement staat UIT — aanzetten met select public.mfa_set_enforcement(true)';
  end if;
end;
$verify$;

commit;
