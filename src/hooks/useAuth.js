import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const STORAGE_KEY = 'lm-dashboard-auth'

/**
 * PIN-gate met 24u-token.
 *
 * Flow:
 *   1. Token staat in localStorage → valideer via Supabase RPC.
 *   2. Valid? → unlocked.
 *   3. Invalid / ontbreekt? → toon PIN-invoer.
 *   4. PIN correct → nieuwe token opgeslagen.
 *
 * Token validatie gebeurt via SECURITY DEFINER RPCs zodat de tokens-tabel zelf
 * onder RLS blijft (niet direct leesbaar voor anon).
 */
export function useAuth() {
  const [status, setStatus] = useState('checking')  // 'checking' | 'locked' | 'unlocked'
  const [expiresAt, setExpiresAt] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Eerste load: check bestaande token
  useEffect(() => {
    (async () => {
      const stored = readStored()
      if (!stored?.token) {
        setStatus('locked')
        return
      }
      // Expiry client-side eerst checken (goedkoper)
      if (stored.expiresAt && new Date(stored.expiresAt) <= new Date()) {
        localStorage.removeItem(STORAGE_KEY)
        setStatus('locked')
        return
      }
      // Server-side valideren
      const { data, error: rpcError } = await supabase.rpc('validate_dashboard_token', { token_input: stored.token })
      if (rpcError || !data?.ok) {
        localStorage.removeItem(STORAGE_KEY)
        setStatus('locked')
        return
      }
      setExpiresAt(new Date(data.expires_at))
      setStatus('unlocked')
    })()
  }, [])

  const submitPin = useCallback(async (pin) => {
    setSubmitting(true)
    setError(null)
    try {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : null
      const { data, error: rpcError } = await supabase.rpc('verify_dashboard_pin', {
        pin_input: pin,
        ua,
      })
      if (rpcError) {
        setError('Verbindingsfout: ' + rpcError.message)
        return false
      }
      if (!data?.ok) {
        setError('Onjuiste code')
        return false
      }
      // Sla token op
      const payload = { token: data.token, expiresAt: data.expires_at }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setExpiresAt(new Date(data.expires_at))
      setStatus('unlocked')
      return true
    } finally {
      setSubmitting(false)
    }
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setExpiresAt(null)
    setStatus('locked')
  }, [])

  return { status, submitPin, submitting, error, expiresAt, logout }
}

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
