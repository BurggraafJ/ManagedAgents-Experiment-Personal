import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Supabase Auth hook — Fase 1 van de PIN → Supabase Auth migratie.
 *
 * Naast de bestaande PinGate. Als er een Supabase-sessie is (gebruiker
 * heeft zich via email/password of magic link aangemeld), is het
 * dashboard ontgrendeld — onafhankelijk van de PIN-tokens.
 *
 * Alternatief gebruik naast useAuth():
 *   - useAuth() geeft PIN-status: 'checking' | 'locked' | 'unlocked'.
 *   - useSupabaseAuth() geeft session: null | Session.
 *   - App.jsx combineert beide: unlocked als óf PIN óf Supabase actief is.
 *
 * Sessie-persistentie wordt afgehandeld door de supabase-js SDK zelf
 * (localStorage "sb-<project>-auth-token"). Geen custom TTL logic nodig.
 */
export function useSupabaseAuth() {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('checking') // checking | no-session | signed-in
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let unsub = null
    ;(async () => {
      const { data: { session: initial } } = await supabase.auth.getSession()
      setSession(initial)
      setStatus(initial ? 'signed-in' : 'no-session')

      const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
        setSession(newSession)
        setStatus(newSession ? 'signed-in' : 'no-session')
      })
      unsub = data?.subscription
    })()
    return () => { if (unsub) unsub.unsubscribe() }
  }, [])

  const signIn = useCallback(async (email, password) => {
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) { setError(err.message); return false }
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const signUp = useCallback(async (email, password) => {
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })
      if (err) { setError(err.message); return false }
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const sendMagicLink = useCallback(async (email) => {
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      })
      if (err) { setError(err.message); return false }
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setStatus('no-session')
  }, [])

  const resetPassword = useCallback(async (email) => {
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      })
      if (err) { setError(err.message); return false }
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  const updatePassword = useCallback(async (newPassword) => {
    setBusy(true); setError(null)
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword })
      if (err) { setError(err.message); return false }
      return true
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    session,
    status,
    user: session?.user || null,
    busy,
    error,
    signIn,
    signUp,
    sendMagicLink,
    signOut,
    resetPassword,
    updatePassword,
  }
}
