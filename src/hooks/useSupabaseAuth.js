import { useEffect, useState, useCallback, useRef } from 'react'
import {
  supabase,
  setAuthPersistence,
  clearAuthPersistence,
  isRememberExpired,
  isSessionOnlyMode,
  rememberTokens,
  forgetTokens,
  getRememberedTokens,
} from '../lib/supabase'
import { authLog, authLogout } from '../lib/authLog'
import { tryRecoverSession } from '../lib/authRecovery'

// Frontend Security F.1.3 — idle logout drempel.
// Geen user-activity (mouse/keyboard/scroll/touch) gedurende deze duur
// triggert auth.signOut(). 30 min default; tweak hier voor anders.
const IDLE_LOGOUT_MS = 30 * 60 * 1000
// Wandklok-controle i.p.v. één setTimeout van 30 min — zie de idle-effect.
const IDLE_CHECK_MS = 30 * 1000
// Laatste user-activity, gedeeld over tabs. Een achtergrond-tab ziet zelf geen
// mousemove/keydown en telde daardoor als "niemand doet iets", ook terwijl je
// in de tab ernaast zat te typen.
const LAST_ACTIVITY_KEY = 'lm_auth_last_activity'
// Venster waarin een lege sessie wordt gelezen als "door ons bedoeld".
const INTENTIONAL_WINDOW_MS = 5000
// Hoe vaak de gedeelde activiteits-stempel naar localStorage mag.
const ACTIVITY_WRITE_MS = 5000

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
 * Sessie-persistentie loopt via een hybride storage-adapter (zie
 * src/lib/supabase.js): "ingelogd blijven" = localStorage + 7-dagen venster
 * + geen idle-logout; uitgevinkt = sessionStorage + 30-min idle-logout, en
 * alléén op een desktop-tab (PWA/telefoon krijgen altijd localStorage).
 *
 * Deze hook hoort één keer in de tree te staan. App.jsx doet dat en geeft het
 * resultaat door als prop (o.a. aan Login) — twee mounts betekende twee
 * onAuthStateChange-subscriptions en twee idle-timers.
 *
 * v1.150 — een lege sessie is niet meer automatisch "uitgelogd". auth-js gooit
 * de sessie namelijk al weg na één mislukte refresh zodra de fout buiten zijn
 * smalle retry-lijst valt (429, 500, of een 400 op een geroteerd token). Zie
 * src/lib/authRecovery.js. Elke overgang naar het loginscherm logt bovendien
 * zijn reason — `__lmAuthLog()` in de console geeft de laatste 25 regels.
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

function markActivity(at = Date.now()) {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(at)) } catch { /* private mode */ }
  return at
}

export function useSupabaseAuth() {
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('checking') // checking | no-session | signed-in
  const [isRecovery, setIsRecovery] = useState(detectRecoveryInUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // True zolang we een verdwenen sessie proberen terug te halen. De UI blijft
  // in die seconden gewoon staan; queries kunnen wel tijdelijk 401 geven.
  const [recovering, setRecovering] = useState(false)
  // BroadcastChannel-handle voor cross-tab logout (F.1.4).
  const authBroadcastRef = useRef(null)
  // Tijdstempel tot wanneer een lege sessie "door ons bedoeld" is. Een
  // vlaggetje volstond niet: het SIGNED_OUT-event komt soms vóór en soms ná de
  // regel die de state opruimt, en auth-js herhaalt het over zijn eigen
  // cross-tab kanaal. Een klein venster dekt beide volgordes af.
  const intentionalUntilRef = useRef(0)
  const recoveringRef = useRef(false)
  const statusRef = useRef('checking')
  statusRef.current = status

  const markIntentional = useCallback(() => {
    intentionalUntilRef.current = Date.now() + INTENTIONAL_WINDOW_MS
  }, [])

  const finishLogout = useCallback((reason, detail) => {
    forgetTokens()
    recoveringRef.current = false
    setRecovering(false)
    setSession(null)
    setStatus('no-session')
    setIsRecovery(false)
    authLogout(reason, detail)
  }, [])

  // Een lege sessie die wij niet zelf hebben veroorzaakt: eerst opnieuw
  // proberen, pas daarna het loginscherm.
  const recoverOrLogout = useCallback((event) => {
    if (recoveringRef.current) return
    if (Date.now() < intentionalUntilRef.current) return
    recoveringRef.current = true
    setRecovering(true)
    authLog('session-blank', { event })
    tryRecoverSession().then(({ session: restored, reason }) => {
      recoveringRef.current = false
      setRecovering(false)
      if (restored) {
        rememberTokens(restored)
        setSession(restored)
        setStatus('signed-in')
        authLog('session-restored', { reason })
        return
      }
      finishLogout(reason, { event })
    }).catch((err) => {
      // Nooit blijven hangen in 'recovering': dan zou een lege sessie voor
      // altijd als "nog even wachten" gelden en werkt niets meer.
      finishLogout('recovery-threw', { event, message: err?.message || String(err) })
    })
  }, [finishLogout])

  useEffect(() => {
    let cancelled = false

    // Eerst subscriben, dán getSession(). auth-js kan tijdens de await al een
    // INITIAL_SESSION of SIGNED_OUT sturen en een subscription die pas ná de
    // await bestaat mist die. (Bijkomend: de cleanup draaide voorheen vóór de
    // toewijzing van `unsub`, waardoor er in StrictMode één bleef hangen.)
    //
    // Deze callback moet synchroon blijven: auth-js await't hem binnen zijn
    // eigen lock, dus een `await supabase.auth.…` hierin loopt vast tot de
    // lock-timeout. Herstel gaat daarom via een macrotask.
    const { data } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession) {
        rememberTokens(newSession)
        recoveringRef.current = false
        setRecovering(false)
        setSession(newSession)
        setStatus('signed-in')
        // Implicit flow stuurt PASSWORD_RECOVERY event; PKCE stuurt alleen
        // SIGNED_IN. Beide paden respecteren — URL-marker is leading.
        if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
        if (detectRecoveryInUrl())         setIsRecovery(true)
        return
      }
      // Vanaf hier: geen sessie meer. Was dit een logout die wij zelf startten,
      // dan zet finishLogout de state — hier niets doen.
      if (Date.now() < intentionalUntilRef.current) {
        setIsRecovery(false)
        return
      }
      // Anders: eerst herstellen proberen. Zonder opgeslagen token valt dat
      // meteen terug op het loginscherm, dus een koude start blijft direct.
      setTimeout(() => { if (!cancelled) recoverOrLogout(event) }, 0)
    })

    ;(async () => {
      const { data: { session: initial } } = await supabase.auth.getSession()
      if (cancelled) return
      // 7-dagen "ingelogd blijven"-venster verlopen → forceer re-auth.
      if (initial && isRememberExpired()) {
        markIntentional()
        clearAuthPersistence()
        // scope 'local': alleen dít apparaat. Zie de opmerking bij signOut.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        if (cancelled) return
        finishLogout('remember-window-expired')
        return
      }
      if (initial) {
        rememberTokens(initial)
        setSession(initial)
        setStatus('signed-in')
        return
      }
      if (statusRef.current !== 'checking' || recoveringRef.current) return
      if (getRememberedTokens()?.refresh_token) {
        // Er stond wél een token in de opslag, maar auth-js heeft de sessie
        // tijdens het opstarten al weggegooid — een koude PWA-start die op een
        // 429 of 500 stuitte. Niet meteen het loginscherm tonen.
        recoverOrLogout('boot')
        return
      }
      setSession(null)
      setStatus('no-session')
      authLog('cold-start-no-session')
    })()

    return () => { cancelled = true; data?.subscription?.unsubscribe() }
  }, [finishLogout, recoverOrLogout, markIntentional])

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
        // Dit bericht komt alleen uit een bewuste logout in onze eigen code,
        // dus geen herstelpoging — ook niet op het SIGNED_OUT dat auth-js er
        // zelf achteraan over zijn eigen kanaal stuurt.
        markIntentional()
        finishLogout(`broadcast:${msg.data.reason || 'unknown'}`)
      }
    }
    return () => { try { ch.close() } catch { /* al gesloten */ } ; authBroadcastRef.current = null }
  }, [finishLogout, markIntentional])

  // F.1.3 — Idle logout, alleen bij een expliciete sessie-only login.
  //
  // Twee dingen waren stuk:
  //   1. De poort stond op `!isTrustedDevice()`. Elke sessie zónder het
  //      7-dagen venster (magic link, wachtwoord-reset, uitnodiging) kreeg dus
  //      stilzwijgend een idle-timer, terwijl de opslag gewoon localStorage was.
  //   2. Eén setTimeout van 30 min. Een bevroren pagina (iOS-PWA, laptop-slaap)
  //      vuurt zo'n achterstallige timer meteen af bij het ontwaken — precies
  //      op het moment dat je de app weer openslaat en begint te typen.
  // Nu: alleen sessie-only (en dus per definitie desktop, zie lib/supabase.js),
  // en een wandklok-check die activiteit uit álle tabs meeneemt.
  useEffect(() => {
    if (status !== 'signed-in') return
    if (!isSessionOnlyMode()) return

    let last = markActivity()
    let lastShared = last
    const onActivity = () => {
      last = Date.now()
      // mousemove vuurt tientallen keren per seconde; localStorage is
      // synchroon. Alleen wegschrijven als het iets toevoegt.
      if (last - lastShared < ACTIVITY_WRITE_MS) return
      lastShared = last
      markActivity(last)
    }

    const idleFor = () => {
      let shared = 0
      try { shared = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0) } catch { /* private mode */ }
      return Date.now() - Math.max(last, shared)
    }

    let intervalId = null
    const tick = () => {
      if (idleFor() < IDLE_LOGOUT_MS) return
      clearInterval(intervalId)
      markIntentional()
      // scope 'local' — een idle tab mag nooit de sessie op je telefoon
      // intrekken. De default van supabase-js is 'global' en dat trok élk
      // refresh-token van deze gebruiker in; het andere apparaat vloog er
      // daarna midden in een actie uit.
      supabase.auth.signOut({ scope: 'local' }).catch(() => {})
      try {
        authBroadcastRef.current?.postMessage({ type: 'logout', reason: 'idle' })
      } catch { /* kanaal al dicht */ }
      finishLogout('idle-timeout', { minutes: IDLE_LOGOUT_MS / 60000 })
    }

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    intervalId = setInterval(tick, IDLE_CHECK_MS)

    return () => {
      clearInterval(intervalId)
      for (const ev of events) {
        window.removeEventListener(ev, onActivity)
      }
    }
  }, [status, finishLogout, markIntentional])

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

  const signIn = useCallback(async (email, password, remember = true) => {
    setBusy(true); setError(null)
    // Modus vóór de call zetten zodat de sessie meteen in de juiste store
    // (local vs session) landt. remember=true → 7-dagen trusted device.
    setAuthPersistence(remember)
    markActivity()
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
    // Een magic-link-sessie kwam nooit langs setAuthPersistence en had dus geen
    // 7-dagen venster. Hier wél openen, anders logt de volgende app-start je
    // meteen weer uit (isRememberExpired blijft dan false, maar het venster
    // ontbreekt en de bedoeling — "dit is een gewone login" — was zoek).
    setAuthPersistence(true)
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
    markIntentional()
    // Bewust 'global': de uitlog-knop is de noodrem bij een verloren laptop en
    // trekt élke sessie van deze gebruiker in. Automatische logouts (idle,
    // verlopen venster) gebruiken 'local' — zie het idle-effect.
    await supabase.auth.signOut({ scope: 'global' })
    clearAuthPersistence()
    // F.1.4 — broadcast naar andere tabs zodat die ook uitloggen.
    try {
      authBroadcastRef.current?.postMessage({ type: 'logout', reason: 'manual' })
    } catch { /* kanaal al dicht */ }
    finishLogout('manual-signout')
  }, [finishLogout, markIntentional])

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
      // Een reset-sessie liep nooit langs de login en had daardoor geen
      // 7-dagen venster; alsnog openen zodat dit een normale sessie is.
      setAuthPersistence(true)
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
    recovering,
    signIn,
    signUp,
    sendMagicLink,
    signOut,
    resetPassword,
    updatePassword,
  }
}
