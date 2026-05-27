import { createClient } from '@supabase/supabase-js'

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
// ─────────────────────────────────────────────────────────────────────────
const PERSIST_MODE_KEY   = 'lm_auth_persist_mode'    // 'local' | 'session'
const REMEMBER_UNTIL_KEY = 'lm_auth_remember_until'  // ms-timestamp, alleen bij remember-me

function persistMode() {
  try { return localStorage.getItem(PERSIST_MODE_KEY) === 'session' ? 'session' : 'local' }
  catch { return 'local' }
}

// Zet vóór signIn: bepaalt waar de sessie landt + opent het 7-dagen venster.
export function setAuthPersistence(remember, days = 7) {
  try {
    if (remember) {
      localStorage.setItem(PERSIST_MODE_KEY, 'local')
      localStorage.setItem(REMEMBER_UNTIL_KEY, String(Date.now() + days * 86400000))
    } else {
      localStorage.setItem(PERSIST_MODE_KEY, 'session')
      localStorage.removeItem(REMEMBER_UNTIL_KEY)
    }
  } catch {}
}

export function clearAuthPersistence() {
  try {
    localStorage.removeItem(PERSIST_MODE_KEY)
    localStorage.removeItem(REMEMBER_UNTIL_KEY)
  } catch {}
}

// Trusted device = 'ingelogd blijven' aangevinkt én het venster nog geldig.
// Gebruikt om de idle-logout uit te zetten op een vertrouwd apparaat.
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

// Hybride storage: leest uit beide stores (session eerst), schrijft naar de
// gekozen store en ruimt de andere op zodat er nooit een stale dubbel staat.
const hybridAuthStorage = {
  getItem(key) {
    try { const s = sessionStorage.getItem(key); if (s !== null) return s } catch {}
    try { return localStorage.getItem(key) } catch { return null }
  },
  setItem(key, value) {
    const useSession = persistMode() === 'session'
    try { (useSession ? sessionStorage : localStorage).setItem(key, value) } catch {}
    try { (useSession ? localStorage : sessionStorage).removeItem(key) } catch {}
  },
  removeItem(key) {
    try { localStorage.removeItem(key) } catch {}
    try { sessionStorage.removeItem(key) } catch {}
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
