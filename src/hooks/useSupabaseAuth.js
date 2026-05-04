import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

// Frontend Security F.1.3 — idle logout drempel.
// Geen user-activity (mouse/keyboard/scroll/touch) gedurende deze duur
// triggert auth.signOut(). 30 min default; tweak hier voor anders.
const IDLE_LOGOUT_MS = 30 * 60 * 1000

// F.1.4 — BroadcastChannel-naam voor logout-on-all-tabs.
// Eén tab signOut → alle andere tabs ook uitgelogd.
const AUTH_BROADCAST_CHANNEL = 'lm-auth'

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
// URL-marker die de reset-link meekrijgt zodat we na PKCE exchange nog
// kunnen detecteren dat dit een wachtwoord-reset is (ipv gewone login).
// Supabase's PASSWORD_RECOVERY event werkt alleen bij implicit flow;
// PKCE firet SIGNED_IN zonder recovery-marker, dus we zetten 'm zelf.
const RECOVERY_PARAM = 'reset'
const RECOVERY_VALUE = '1'

function detectRecoveryInUrl() {
  if (typeof window === 'undefined') return false
  try {
    const p = new URLSearchParams(window.location.search)
    return p.get(RECOVERY_PARAM) === RECOVERY_VALUE
  } catch {
    return false
  }
}

export function useSupabaseAuth() {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('checking') // checking | no-session | signed-in
  const [isRecovery, setIsRecovery] = useState(detectRecoveryInUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // BroadcastChannel-handle voor cross-tab logout (F.1.4).
  const authBroadcastRef = useRef(null)

  useEffect(() => {
    let unsub = null
    ;(async () => {
      const { data: { session: initial } } = await supabase.auth.getSession()
      setSession(initial)
      setStatus(initial ? 'signed-in' : 'no-session')

      const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
        setSession(newSession)
        setStatus(newSession ? 'signed-in' : 'no-session')
        // Implicit flow stuurt PASSWORD_RECOVERY event; PKCE stuurt alleen
        // SIGNED_IN. Beide paden respecteren — URL-marker is leading.
        if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
        if (detectRecoveryInUrl())         setIsRecovery(true)
        if (event === 'SIGNED_OUT')        setIsRecovery(false)
      })
      unsub = data?.subscription
    })()
    return () => { if (unsub) unsub.unsubscribe() }
  }, [])

  // F.1.4 — Cross-tab logout via BroadcastChannel.
  // Eén tab roept signOut → broadcast 'logout' → andere tabs cleanen lokale state.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(AUTH_BROADCAST_CHANNEL)
    authBroadcastRef.current = ch
    ch.onmessage = (msg) => {
      if (msg?.data?.type === 'logout') {
        // Andere tab heeft uitgelogd — wij synchroniseren state.
        // We roepen NIET signOut() opnieuw aan (zou een echo-loop maken).
        setSession(null)
        setStatus('no-session')
        setIsRecovery(false)
      }
    }
    return () => { try { ch.close() } catch {} ; authBroadcastRef.current = null }
  }, [])

  // F.1.3 — Idle logout. Reset-timer op user-activity events.
  // Alleen actief als signed-in; bij no-session/checking doen we niets.
  useEffect(() => {
    if (status !== 'signed-in') return
    let timerId = null
    const resetTimer = () => {
      if (timerId) clearTimeout(timerId)
      timerId = setTimeout(() => {
        // Stilte (geen events) gedurende IDLE_LOGOUT_MS = uitloggen.
        // We loggen voor zichtbaarheid in console; geen user-prompt — direct uit.
        if (typeof console !== 'undefined') {
          console.info(`[auth] idle ${IDLE_LOGOUT_MS / 60000} min → signing out`)
        }
        supabase.auth.signOut().catch(() => {})
        // Broadcast direct vanaf hier; signOut-callback kan timing-misser hebben
        // omdat onAuthStateChange asynchroon is.
        try {
          authBroadcastRef.current?.postMessage({ type: 'logout', reason: 'idle' })
        } catch {}
      }, IDLE_LOGOUT_MS)
    }
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    for (const ev of events) {
      window.addEventListener(ev, resetTimer, { passive: true })
    }
    resetTimer() // start meteen — anders moet eerst event vóór timer telt
    return () => {
      if (timerId) clearTimeout(timerId)
      for (const ev of events) {
        window.removeEventListener(ev, resetTimer)
      }
    }
  }, [status])

  const clearRecovery = useCallback(() => {
    setIsRecovery(false)
    // Verwijder de ?reset=1 marker uit URL zodat F5 niet weer in recovery
    // modus komt. History.replaceState voorkomt een extra navigatie.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href)
      url.searchParams.delete(RECOVERY_PARAM)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
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
    // F.1.4 — broadcast naar andere tabs zodat die ook uitloggen.
    try {
      authBroadcastRef.current?.postMessage({ type: 'logout', reason: 'manual' })
    } catch {}
  }, [])

  const resetPassword = useCallback(async (email) => {
    setBusy(true); setError(null)
    try {
      // Redirect met ?reset=1 zodat na PKCE-exchange de app detecteert
      // dat dit een recovery-flow is en het update-password-paneel toont.
      const redirect = typeof window !== 'undefined'
        ? `${window.location.origin}/?${RECOVERY_PARAM}=${RECOVERY_VALUE}`
        : undefined
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: redirect,
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
      // Direct URL-marker weghalen + isRecovery=false zetten — dit moet
      // syncrhoon gebeuren voordat de volgende render de dashboard-check
      // doet. Anders blijft isRecovery true (race met USER_UPDATED event
      // dat detectRecoveryInUrl opnieuw aanroept zolang ?reset=1 er nog
      // staat).
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.delete(RECOVERY_PARAM)
        window.history.replaceState(null, '', url.pathname + url.search + url.hash)
      }
      setIsRecovery(false)
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
