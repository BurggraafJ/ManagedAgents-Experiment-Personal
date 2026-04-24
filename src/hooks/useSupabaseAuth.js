import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Supabase Auth hook — sinds v56 de enige auth-route (PIN-infra is in
 * Fase 4 volledig verwijderd).
 *
 * Exposeert status ('checking' | 'no-session' | 'signed-in'), de sessie
 * + user, busy/error/notice-flags, en alle auth-acties (signIn, signUp,
 * magic link, reset password, update password, signOut).
 *
 * `isRecovery` wordt gezet wanneer Supabase een `PASSWORD_RECOVERY`
 * event stuurt (na klik op reset-link in mail). App.jsx routet dan
 * naar het wachtwoord-reset-paneel i.p.v. dashboard.
 *
 * Sessie-persistentie gaat via de supabase-js SDK (localStorage
 * "sb-<project>-auth-token"). Zie src/lib/supabase.js voor de client-
 * configuratie (persistSession, autoRefresh, detectSessionInUrl, pkce).
 */
export function useSupabaseAuth() {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('checking') // checking | no-session | signed-in
  const [isRecovery, setIsRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let unsub = null
    ;(async () => {
      const { data: { session: initial } } = await supabase.auth.getSession()
      setSession(initial)
      setStatus(initial ? 'signed-in' : 'no-session')

      const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
        setSession(newSession)
        setStatus(newSession ? 'signed-in' : 'no-session')
        // PASSWORD_RECOVERY wordt afgevuurd direct nadat Supabase de
        // recovery-token uit de URL heeft omgeruild voor een sessie.
        // We moeten dan het wachtwoord-reset-form tonen i.p.v. dashboard.
        if (event === 'PASSWORD_RECOVERY') {
          setIsRecovery(true)
        }
        if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
          setIsRecovery(false)
        }
      })
      unsub = data?.subscription
    })()
    return () => { if (unsub) unsub.unsubscribe() }
  }, [])

  const clearRecovery = useCallback(() => setIsRecovery(false), [])

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
    isRecovery,
    clearRecovery,
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
