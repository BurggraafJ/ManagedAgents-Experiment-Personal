import { createClient } from '@supabase/supabase-js'
import { authLog } from './authLog'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

// Geëxporteerd voor componenten die direct fetch naar Edge Functions doen
// (streaming gebruiken — supabase.functions.invoke ondersteunt geen
// ReadableStream-response). Gebruik deze ipv supabase.supabaseUrl (intern
// veld, niet stabiel in v2).
export const SUPABASE_URL = url
export const SUPABASE_ANON_KEY = key

// ─────────────────────────────────────────────────────────────────────────
// Sessie-persistentie — "ingelogd blijven" (7 dagen) vs. sessie-only.
//
// Supabase-js heeft géén ingebouwde "remember me". We routen de sessie-opslag
// zelf via een hybride storage-adapter die per write kiest tussen localStorage
// en sessionStorage, op basis van de modus die op de login wordt gezet:
//
//   • remember = true  → localStorage (overleeft browser-herstart), trusted
//       device, 7-dagen venster, GÉÉN idle-logout (zie useSupabaseAuth).
//   • remember = false → sessionStorage (weg bij browser sluiten) +
//       30-min idle-logout (zie useSupabaseAuth).
//
// v1.150 — sessie-only geldt alléén nog op een desktop-browsertab. Op een
// geïnstalleerde PWA en op de telefoon dwingen we localStorage af: iOS gooit
// een PWA-webview al na korte tijd in de achtergrond weg, en daarmee de hele
// sessionStorage. Het resultaat was een koude start zonder sessie = het
// loginscherm, zonder dat er iets misging. Bovendien plakte de modus: één keer
// het vinkje uitzetten schreef 'session' in localStorage en dus was élke
// volgende login op dat apparaat óók sessie-only.
// ─────────────────────────────────────────────────────────────────────────
const PERSIST_MODE_KEY   = 'lm_auth_persist_mode'    // 'local' | 'session'
const REMEMBER_UNTIL_KEY = 'lm_auth_remember_until'  // ms-timestamp, alleen bij remember-me

/** Vanaf het beginscherm gestart (iOS `standalone`, of display-mode). */
export function isInstalledPwa() {
  try {
    if (window.navigator?.standalone === true) return true
    return window.matchMedia?.('(display-mode: standalone)').matches === true
  } catch { return false }
}

function isPhoneSized() {
  try { return window.matchMedia?.('(max-width: 768px)').matches === true }
  catch { return false }
}

/**
 * Mag deze context de sessie in sessionStorage zetten? Alleen een gewone
 * desktop-tab: daar is "weg bij browser sluiten" een bewuste keuze en geen
 * verrassing. PWA/telefoon niet — zie de blokcommentaar hierboven.
 */
export function sessionOnlyAllowed() {
  return !isInstalledPwa() && !isPhoneSized()
}

function persistMode() {
  let stored
  try { stored = localStorage.getItem(PERSIST_MODE_KEY) } catch { return 'local' }
  if (stored !== 'session') return 'local'
  return sessionOnlyAllowed() ? 'session' : 'local'
}

/** True = de gebruiker koos expliciet sessie-only én dit apparaat mag dat. */
export function isSessionOnlyMode() {
  return persistMode() === 'session'
}

// Zet vóór signIn: bepaalt waar de sessie landt + opent het 7-dagen venster.
export function setAuthPersistence(remember, days = 7) {
  const forced = !remember && !sessionOnlyAllowed()
  try {
    if (remember || forced) {
      localStorage.setItem(PERSIST_MODE_KEY, 'local')
      localStorage.setItem(REMEMBER_UNTIL_KEY, String(Date.now() + days * 86400000))
    } else {
      localStorage.setItem(PERSIST_MODE_KEY, 'session')
      localStorage.removeItem(REMEMBER_UNTIL_KEY)
    }
  } catch { /* private mode — dan draait alles op de in-memory fallback */ }
  // De 7-dagen bovengrens blijft ook bij de override staan; alleen de opslag
  // verschuift van sessionStorage naar localStorage.
  if (forced) authLog('persist-forced-local', { why: isInstalledPwa() ? 'installed-pwa' : 'phone-sized' })
}

export function clearAuthPersistence() {
  try {
    localStorage.removeItem(PERSIST_MODE_KEY)
    localStorage.removeItem(REMEMBER_UNTIL_KEY)
  } catch {}
}

// Trusted device = 'ingelogd blijven' aangevinkt én het venster nog geldig.
//
// LET OP: dit is sinds v1.150 NIET meer de poort voor de idle-logout. Die
// draait nu op isSessionOnlyMode(). Het verschil is precies waar de bug zat:
// een sessie uit een magic link, wachtwoord-reset of uitnodiging kwam nooit
// langs setAuthPersistence, had dus geen venster, en kreeg via `!isTrustedDevice()`
// stilzwijgend een idle-timer — terwijl de opslag gewoon localStorage was.
export function isTrustedDevice() {
  try {
    const until = Number(localStorage.getItem(REMEMBER_UNTIL_KEY) || 0)
    return until > 0 && Date.now() < until
  } catch { return false }
}

// 7-dagen venster verlopen → forceer re-auth bij het laden van de app.
export function isRememberExpired() {
  try {
    const until = Number(localStorage.getItem(REMEMBER_UNTIL_KEY) || 0)
    return until > 0 && Date.now() >= until
  } catch { return false }
}

// Hybride storage: leest uit de ACTIEVE store en schrijft daarheen; de andere
// store wordt bij elke write geleegd zodat er nooit twee kopieën staan.
//
// v1.150 — de lees-volgorde was "sessionStorage eerst, anders localStorage".
// Dat leek onschuldig maar liet een tweede kopie leven: een tab die de actieve
// store leeg vond, pakte de oude sessie uit de ándere store en refreshte met
// een refresh-token dat elders al geroteerd was. GoTrue antwoordt dan met
// `refresh_token_already_used` (HTTP 400) en auth-js classificeert dat als
// non-retryable → `_removeSession()`. En `removeItem` hieronder wist béide
// stores, dus die ene mislukte refresh sloopte ook de sessie van de tab die
// het wél goed had. Nu lezen we uit één store en verhuizen we een gevonden
// restant éénmalig, zodat er daarna precies één kopie bestaat.
function otherStore(useSession) { return useSession ? localStorage : sessionStorage }
function activeStore(useSession) { return useSession ? sessionStorage : localStorage }

const hybridAuthStorage = {
  getItem(key) {
    const useSession = persistMode() === 'session'
    try {
      const primary = activeStore(useSession).getItem(key)
      if (primary !== null) return primary
    } catch { return null }
    // Migratiepad: de modus is net gewisseld (of dit apparaat dwingt 'local'
    // af) en de sessie staat nog in de andere store. Eenmalig verhuizen.
    try {
      const legacy = otherStore(useSession).getItem(key)
      if (legacy === null) return null
      activeStore(useSession).setItem(key, legacy)
      otherStore(useSession).removeItem(key)
      authLog('storage-migrated', { key, to: useSession ? 'session' : 'local' })
      return legacy
    } catch { return null }
  },
  setItem(key, value) {
    const useSession = persistMode() === 'session'
    try { activeStore(useSession).setItem(key, value) } catch { /* quota/private mode */ }
    try { otherStore(useSession).removeItem(key) } catch { /* idem */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key) } catch { /* idem */ }
    try { sessionStorage.removeItem(key) } catch { /* idem */ }
  },
}

// Sinds v54 gebruikt het dashboard Supabase Auth als enige login-route.
// De oude PIN-flow had persist/refresh/detect uitgeschakeld (geen behoefte
// aan Supabase-sessies). Voor Auth zijn alle vier nodig:
//
//  - persistSession: true    → sessie bewaard over refreshes
//  - autoRefreshToken: true  → access-tokens automatisch verlengen
//  - detectSessionInUrl: true → recovery/magic-link hash-tokens worden
//      automatisch omgeruild voor een sessie + PASSWORD_RECOVERY event
//      getriggerd, nodig voor de UpdatePasswordPanel-detectie
//  - flowType: 'pkce' → PKCE-flow i.p.v. implicit, security best-practice
//  - storage: hybridAuthStorage → routeert localStorage/sessionStorage o.b.v.
//      "ingelogd blijven" (zie hierboven)
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storage: hybridAuthStorage,
  },
})

// ─────────────────────────────────────────────────────────────────────────
// Refresh-token-snapshot — de basis onder src/lib/authRecovery.js.
//
// auth-js wist de opslag vóórdat het SIGNED_OUT uitstuurt (`_removeSession()`
// → `removeItem` → `_notifyAllSubscribers`). Tegen de tijd dat onze
// onAuthStateChange-callback aan de beurt is, is het refresh-token dus al weg
// en kunnen we een mislukte refresh niet meer overdoen. Daarom houden we het
// laatst bekende token in het geheugen — niet extra op schijf, het stond daar
// toch al.
//
// De eerste snapshot moet synchroon bij het laden gebeuren: `_initialize()`
// draait asynchroon en kan de opslag al bij de eerste tick leegmaken (een
// koude PWA-start die op een 429 of 500 stuit). Zonder deze regel is een
// tijdelijke storing bij het opstarten definitief.
// ─────────────────────────────────────────────────────────────────────────
function deriveStorageKey() {
  try { return `sb-${new URL(url).hostname.split('.')[0]}-auth-token` } catch { return null }
}

let lastKnownTokens = null

export function rememberTokens(session) {
  if (session?.refresh_token) {
    lastKnownTokens = { refresh_token: session.refresh_token, access_token: session.access_token || null }
  }
}

export function forgetTokens() { lastKnownTokens = null }
export function getRememberedTokens() { return lastKnownTokens }

;(function snapshotStoredTokens() {
  const storageKey = deriveStorageKey()
  if (!storageKey) return
  try {
    const raw = hybridAuthStorage.getItem(storageKey)
    if (raw) rememberTokens(JSON.parse(raw))
  } catch { /* onleesbaar record — dan is er niets te herstellen */ }
})()

// ─────────────────────────────────────────────────────────────────────────
// Realtime channel-helper — VERPLICHT voor alle hooks die postgres_changes
// callbacks willen subscriben.
//
// HARD-RULE: gebruik NOOIT supabase.channel('vaste-naam') direct.
// Dat crasht in productie en dev zodra dezelfde hook 2x gemount wordt
// (door dubbel-aanroep in component-tree OF React StrictMode).
// Supabase weigert dan callbacks toe te voegen aan een al-subscribed
// channel met dezelfde naam: "cannot add postgres_changes callbacks
// for realtime:<naam> after subscribe()".
//
// Geleerd uit incidenten:
//   • Sessie 12 (2026-05-09): useNavBadges 'nav-badges-live' crashte
//     toen NowView óók de hook aanriep
//   • Sessie 15 (2026-05-10): useDashboardShell 'shell-live' crashte
//     toen NowView's nieuwe topbar de hook óók aanriep
//
// Borging-laag 1 (sterkste): deze helper. Onmogelijk fout te doen.
// Borging-laag 2: CLAUDE.md projectregel "gebruik altijd createRealtimeChannel"
// Borging-laag 3: memory pattern-rule (back-up)
//
// Gebruik:
//   const channel = createRealtimeChannel('shell')
//     .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, cb)
//     .subscribe()
//   return () => supabase.removeChannel(channel)
// ─────────────────────────────────────────────────────────────────────────
export function createRealtimeChannel(prefix) {
  const suffix = Math.random().toString(36).slice(2, 9)
  return supabase.channel(`${prefix}-${suffix}`)
}
