import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'

// Tweede factor — e-mail-OTP ná login (security review 2026-09-02, REPORT §3).
//
// De grens zit in de datalaag: is_admin_or_higher() eist naast de owner-rol ook
// session_mfa_ok(). Zolang die sessie de code niet heeft gehaald, geeft
// PostgREST lege resultaten en weigeren de schrijvende RPC's. Dit bestand is
// dus alleen de bediening — niet de beveiliging.
//
// Het device-token voor "dit apparaat 14 dagen onthouden" staat in
// localStorage; het venster zelf leeft server-side in user_trusted_devices,
// dus een gekopieerd token verloopt of kan ingetrokken worden.

const DEVICE_KEY = 'lm_mfa_device_token'

export function getDeviceToken() {
  try { return localStorage.getItem(DEVICE_KEY) || '' } catch { return '' }
}

export function setDeviceToken(token) {
  try {
    if (token) localStorage.setItem(DEVICE_KEY, token)
    else localStorage.removeItem(DEVICE_KEY)
  } catch { /* private mode — dan gewoon elke keer een code */ }
}

export function clearDeviceToken() {
  setDeviceToken(null)
}

// Rauwe fetch i.p.v. functions.invoke: die geeft bij een 4xx alleen een
// generieke error terug, terwijl we juist de body nodig hebben
// (attempts_left, retry_after_seconds, reason).
async function callMfaFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { status: 401, body: { error: 'no_session' } }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, body: json }
}

/** { enforced, session_ok, break_glass_active, session_id, otp_ttl_seconds, trusted_device_days } */
export async function fetchMfaStatus() {
  const { data, error } = await supabase.rpc('mfa_status')
  if (error) throw new Error(error.message)
  return data || {}
}

/**
 * Vraagt een code aan. Stuurt het device-token mee: klopt dat server-side,
 * dan komt er geen mail en is de sessie direct akkoord ({ skipped: true }).
 */
export async function requestMfaCode() {
  const { status, body } = await callMfaFunction('mfa-email-send', {
    device_token: getDeviceToken() || undefined,
  })
  if (status === 200 && body.status === 'skipped') {
    return { skipped: true }
  }
  if (status === 200) {
    return {
      skipped: false,
      expiresAt: body.expires_at || null,
      ttlSeconds: body.ttl_seconds || 600,
      maxAttempts: body.max_attempts || 5,
      cooldownSeconds: body.cooldown_seconds || 60,
    }
  }
  if (status === 429) {
    const err = new Error('rate_limited')
    err.code = 'rate_limited'
    err.retryAfterSeconds = body.retry_after_seconds || 60
    throw err
  }
  const err = new Error(body.error || `HTTP ${status}`)
  err.code = body.error || 'send_failed'
  err.detail = body.detail || null
  throw err
}

/** Controleert de code. Bij remember=true landt het nieuwe device-token hier. */
export async function verifyMfaCode(code, remember) {
  const { status, body } = await callMfaFunction('mfa-email-verify', {
    code: String(code || '').replace(/\D/g, ''),
    remember: !!remember,
  })
  if (status === 200 && body.ok) {
    if (body.device_token) setDeviceToken(body.device_token)
    return { ok: true, expiresAt: body.session_mfa_expires_at || null }
  }
  const err = new Error(body.error || `HTTP ${status}`)
  err.code = body.error || 'verify_failed'
  err.attemptsLeft = typeof body.attempts_left === 'number' ? body.attempts_left : null
  throw err
}

// ── Vertrouwde apparaten, voor UsersPage / MobileAdminUsers ───────────────

/** [{ user_id, device_count, last_seen_at }] — owner-only (RPC raise't anders). */
export async function fetchTrustedDevices() {
  const { data, error } = await supabase.rpc('mfa_trusted_devices_overview')
  if (error) throw new Error(error.message)
  return data || []
}

/** De noodrem bij een verloren laptop. Geeft het aantal ingetrokken devices terug. */
export async function revokeTrustedDevices(userId) {
  const { data, error } = await supabase.rpc('mfa_revoke_trusted_devices', { p_user_id: userId })
  if (error) throw new Error(error.message)
  return data?.revoked ?? 0
}
