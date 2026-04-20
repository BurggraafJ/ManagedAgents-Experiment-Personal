import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'lm-dashboard-auth'

/**
 * PIN-gate met profiel-selector + 24u-token + rate-limiting.
 *
 * Flow:
 *   1. Token in localStorage → valideer via RPC.
 *   2. Valid? → unlocked + profile data.
 *   3. Invalid / ontbreekt? → lock, toon profile-selector + PIN.
 *   4. PIN correct → nieuwe token opgeslagen.
 *
 * Tokens + profielen zitten achter SECURITY DEFINER RPCs; tabellen zijn
 * niet direct leesbaar voor anon.
 */
export function useAuth() {
  const [status, setStatus] = useState('checking')  // checking | locked | unlocked
  const [profile, setProfile] = useState(null)
  const [expiresAt, setExpiresAt] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [errorCode, setErrorCode] = useState(null)

  // Eerste load: check bestaande token
  useEffect(() => {
    (async () => {
      const stored = readStored()
      if (!stored?.token) {
        setStatus('locked')
        return
      }
      if (stored.expiresAt && new Date(stored.expiresAt) <= new Date()) {
        localStorage.removeItem(STORAGE_KEY)
        setStatus('locked')
        return
      }
      const { data, error: rpcError } = await supabase.rpc('validate_dashboard_token', {
        token_input: stored.token,
      })
      if (rpcError || !data?.ok) {
        localStorage.removeItem(STORAGE_KEY)
        setStatus('locked')
        return
      }
      setProfile(data.profile || null)
      setExpiresAt(new Date(data.expires_at))
      setStatus('unlocked')
    })()
  }, [])

  const submitPin = useCallback(async (profileName, pin) => {
    setSubmitting(true)
    setError(null)
    setErrorCode(null)
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : null
      const { data, error: rpcError } = await supabase.rpc('verify_dashboard_pin', {
        profile_input: profileName,
        pin_input: pin,
        ua,
      })
      if (rpcError) {
        setError('Verbindingsfout: ' + rpcError.message)
        return false
      }
      if (!data?.ok) {
        setErrorCode(data?.error || 'unknown')
        setError(friendlyError(data?.error, data?.retry_after_min))
        return false
      }
      const payload = { token: data.token, expiresAt: data.expires_at, profile: data.profile }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setProfile(data.profile)
      setExpiresAt(new Date(data.expires_at))
      setStatus('unlocked')
      return true
    } finally {
      setSubmitting(false)
    }
  }, [])

  const logout = useCallback(async () => {
    const stored = readStored()
    if (stored?.token) {
      // Best-effort server-side revoke; faalt stil als offline
      try {
        await supabase.rpc('revoke_dashboard_token', { token_input: stored.token })
      } catch { /* ignore */ }
    }
    localStorage.removeItem(STORAGE_KEY)
    setProfile(null)
    setExpiresAt(null)
    setError(null)
    setErrorCode(null)
    setStatus('locked')
  }, [])

  return { status, submitPin, submitting, error, errorCode, expiresAt, profile, logout }
}

function friendlyError(code, retryAfter) {
  switch (code) {
    case 'rate_limited':
      return `Te veel pogingen. Probeer het over ${retryAfter ?? 10} minuten opnieuw.`
    case 'profile_not_activated':
      return 'Dit profiel is nog niet geactiveerd — vraag Jelle om een code te zetten.'
    case 'unknown_profile':
      return 'Onbekend profiel.'
    case 'invalid_pin':
      return 'Onjuiste code.'
    default:
      return 'Inloggen mislukt.'
  }
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
