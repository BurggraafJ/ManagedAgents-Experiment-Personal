-- =============================================================================
-- Gebruikers: aanmaken ≠ uitnodigen                                  (v1.158)
-- =============================================================================
-- Tot nu toe was "een member toevoegen" één handeling: de edge function
-- invite-user riep inviteUserByEmail() aan, waarmee GoTrue in dezelfde stap
-- het account aanmaakte én de uitnodigingsmail verstuurde. Er was dus geen
-- manier om iemand klaar te zetten zonder mail, en geen manier om te zien of
-- er ooit een mail de deur uit is gegaan: de UI leidde "niet geactiveerd" af
-- uit email_confirmed_at, wat iets ánders is dan "nooit uitgenodigd".
--
-- Sinds 2026-09-12 staan er vier members in auth.users die via admin
-- createUser zijn aangemaakt met email_confirm:true en
-- raw_user_meta_data.invite_deferred = true — bewust zonder mail. Voor hen is
-- email_confirmed_at gezet en last_sign_in_at leeg; de oude UI noemde dat
-- "Nooit ingelogd" en bood geen enkele invite-knop.
--
-- Deze migratie maakt het onderscheid expliciet en persistent:
--   1. user_roles.invite_sent_at — NULL = aangemaakt, nooit uitgenodigd.
--      Wordt alleen gezet door de edge function invite-user, op het moment
--      dat de owner op "Uitnodigen" klikt. Nooit door een script.
--   2. list_users_for_admin() geeft invite_sent_at mee, plus invite_deferred
--      uit de user-metadata als hint voor accounts die bewust zonder mail zijn
--      aangemaakt.
--
-- Geen backfill: bestaande rijen houden NULL. Voor Jelle en Jay (die al eens
-- zijn ingelogd) is de invite-status niet meer relevant — de UI leidt dat af
-- uit last_sign_in_at en toont daar "niet nodig" in plaats van "nog niet".
--
-- Terugdraaien = kolom droppen en de v2-definitie van de RPC terugzetten
-- (migratie 20260522093113 list_users_for_admin_v2_drop_and_recreate).
-- =============================================================================

-- ── 1. De kolom ──────────────────────────────────────────────────────────────
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz;

COMMENT ON COLUMN public.user_roles.invite_sent_at IS
  'Tijdstip van de laatst verstuurde uitnodiging / set-wachtwoord-mail (edge function invite-user, owner-only). NULL = account bestaat wel, maar er is nooit een mail verstuurd. Aanmaken is een andere handeling dan uitnodigen; scripts zetten deze kolom niet.';

-- ── 2. list_users_for_admin v3 ───────────────────────────────────────────────
-- De returns-lijst wijzigt, dus DROP + CREATE (Postgres kan OUT-parameters van
-- een bestaande functie niet herschrijven). Zelfde patroon als de v2-migratie.
-- De EXECUTE-grants zetten we daarna expliciet terug: CREATE FUNCTION geeft
-- standaard EXECUTE aan PUBLIC, en dat wil deze admin-RPC niet.
DROP FUNCTION IF EXISTS public.list_users_for_admin();

CREATE FUNCTION public.list_users_for_admin()
RETURNS TABLE(
  user_id uuid,
  email text,
  app_role text,
  display_name text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  active_sessions_count integer,
  last_seen_at timestamptz,
  invite_sent_at timestamptz,
  invite_deferred boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.is_admin_or_higher() THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT
    au.id::uuid AS user_id,
    au.email::text,
    COALESCE(ur.app_role, 'member')::text AS app_role,
    ur.display_name::text,
    au.last_sign_in_at,
    au.created_at,
    au.email_confirmed_at,
    au.banned_until,
    COALESCE(
      (SELECT COUNT(*)::int FROM auth.sessions s
        WHERE s.user_id = au.id AND s.not_after > now()),
      0
    ) AS active_sessions_count,
    (SELECT MAX(s.refreshed_at)::timestamptz FROM auth.sessions s
       WHERE s.user_id = au.id) AS last_seen_at,
    ur.invite_sent_at,
    -- Tekst-vergelijking, geen ::boolean-cast: metadata is vrij veld en een
    -- rare waarde mag de hele lijst niet laten klappen.
    COALESCE((au.raw_user_meta_data->>'invite_deferred') IN ('true', 't', '1'), false) AS invite_deferred
  FROM auth.users au
  LEFT JOIN public.user_roles ur ON ur.user_id = au.id
  ORDER BY au.created_at ASC;
END $function$;

REVOKE EXECUTE ON FUNCTION public.list_users_for_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_users_for_admin() TO authenticated, service_role;

COMMENT ON FUNCTION public.list_users_for_admin() IS
  'Multi-user (v3 2026-09-12): admin-only RPC met analytics — email_confirmed_at, banned_until, active_sessions_count, last_seen_at uit auth.sessions, plus invite_sent_at (user_roles) en invite_deferred (user-metadata) zodat de UI "aangemaakt" van "uitgenodigd" kan onderscheiden. SECURITY DEFINER + role-check.';
