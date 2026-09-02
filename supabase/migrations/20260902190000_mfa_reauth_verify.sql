-- =============================================================================
-- mfa_reauth_verify — controleert de 6-cijferige code uit de reauthenticatie-mail.
-- Hotfix 2026-09-02 · de tweede-factor-mail was een Magic Link i.p.v. een code.
-- =============================================================================
--
-- WAAROM EEN EIGEN RPC EN NIET GOTRUE'S EIGEN ENDPOINT
--
-- De code die GoTrue mailt via GET /auth/v1/reauthenticate is géén login-token:
-- hij leeft in auth.users.reauthentication_token en is met opzet niet inwisselbaar
-- voor een sessie. Dat is precies wat we willen voor een tweede factor ná login.
-- Maar daardoor is hij ook nergens los te controleren:
--
--   * POST /auth/v1/verify kent geen type 'reauthentication' (api/verify.go kent
--     alleen signup, invite, recovery, magiclink, email_change, email, sms,
--     phone_change). Het oude type 'email' leest een ándere tokenkolom én levert
--     een nieuwe sessie op die we daarna weer moesten opruimen.
--
--   * PUT /auth/v1/user roept verifyReauthentication() alleen aan wanneer er óók
--     een nieuw wachtwoord in de payload zit, én SECURITY_UPDATE_PASSWORD_
--     REQUIRE_REAUTHENTICATION aanstaat, én de sessie ouder is dan 24 uur
--     (api/user.go regel 153-164). Een lege PUT met alleen { nonce } raakt die
--     tak dus nooit en geeft 200 terug — óók bij een foute code. Daarmee zou de
--     tweede factor stilzwijgend een no-op worden.
--
-- Daarom vergelijken we hier zelf, byte voor byte zoals gotrue het opslaat:
--
--   auth.users.reauthentication_token = hex(sha224(email || code))
--
-- (crypto.GenerateTokenHash → sha256.Sum224, internal/crypto/crypto.go; gezet in
-- sendReauthenticationOtp, internal/api/mail.go). Postgres' sha224 is bit-identiek
-- aan Go's Sum224 — geverifieerd vóór deploy.
--
-- Na een geldige code ruimen we het token op, net als user.ConfirmReauthentication()
-- (internal/models/user.go): token leegmaken en de one-time-token-rij weggooien,
-- zodat dezelfde code geen tweede keer werkt. We raken alleen de rijen van type
-- 'reauthentication_token' aan — een lopende recovery of invite van dezelfde
-- gebruiker blijft staan (gotrue gooit daar alles weg; dat is hier niet nodig).
--
-- TTL en het pogingen-plafond zitten al in mfa_challenge_attempt
-- (user_mfa_email_otp: expires_at + max_attempts uit app_mfa_config). De controle
-- op reauthentication_sent_at hieronder is de tweede sluitpost, voor het geval een
-- challenge-rij en het GoTrue-token uit de pas lopen.
-- =============================================================================

create or replace function public.mfa_reauth_verify(p_user_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  cfg      public.app_mfa_config;
  v_email  text;
  v_token  text;
  v_sent   timestamptz;
  v_expect text;
begin
  perform public.assert_service_role();
  select * into cfg from public.app_mfa_config where id = 1;

  select u.email, coalesce(u.reauthentication_token, ''), u.reauthentication_sent_at
    into v_email, v_token, v_sent
  from auth.users u
  where u.id = p_user_id;

  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'user_not_found');
  end if;

  -- Geen openstaand token: nooit een code aangevraagd, of deze code is al
  -- gebruikt. Beide gevallen zijn voor de aanroeper hetzelfde.
  if v_token = '' or v_sent is null then
    return jsonb_build_object('ok', false, 'reason', 'no_reauth_token');
  end if;

  if v_sent < now() - make_interval(secs => cfg.otp_ttl_seconds) then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if p_code is null or p_code !~ '^[0-9]+$' then
    return jsonb_build_object('ok', false, 'reason', 'code_incorrect');
  end if;

  v_expect := encode(extensions.digest(v_email || p_code, 'sha224'), 'hex');

  -- Beide kanten zijn een hex-hash van vaste lengte (56 tekens), dus deze
  -- vergelijking kost altijd evenveel werk; er lekt geen prefix-informatie.
  -- Los daarvan is brute force hier niet de route: 5 pogingen per challenge en
  -- 3 codes per 15 minuten (app_mfa_config).
  if v_expect <> v_token then
    return jsonb_build_object('ok', false, 'reason', 'code_incorrect');
  end if;

  -- Eenmalig gebruik — spiegelt user.ConfirmReauthentication().
  update auth.users
  set reauthentication_token = ''
  where id = p_user_id;

  delete from auth.one_time_tokens
  where user_id = p_user_id
    and token_type = 'reauthentication_token';

  return jsonb_build_object('ok', true);
end;
$function$;

-- Alleen de Edge Function (service-role) mag dit aanroepen; assert_service_role()
-- is de tweede grendel voor het geval een grant ooit ruimer wordt gezet.
revoke all on function public.mfa_reauth_verify(uuid, text) from public;
revoke all on function public.mfa_reauth_verify(uuid, text) from anon, authenticated;
grant execute on function public.mfa_reauth_verify(uuid, text) to service_role;

comment on function public.mfa_reauth_verify(uuid, text) is
  'Controleert de 6-cijferige reauthenticatie-code uit GET /auth/v1/reauthenticate tegen auth.users.reauthentication_token (sha224(email||code)) en maakt hem daarna eenmalig ongeldig. Service-role only.';
