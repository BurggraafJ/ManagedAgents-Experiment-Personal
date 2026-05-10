import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
}

// Sinds v54 gebruikt het dashboard Supabase Auth als enige login-route.
// De oude PIN-flow had persist/refresh/detect uitgeschakeld (geen behoefte
// aan Supabase-sessies). Voor Auth zijn alle drie nodig:
//
//  - persistSession: true    → localStorage bewaart sessie over refreshes
//  - autoRefreshToken: true  → access-tokens automatisch verlengen
//  - detectSessionInUrl: true → recovery/magic-link hash-tokens worden
//      automatisch omgeruild voor een sessie + PASSWORD_RECOVERY event
//      getriggerd, nodig voor de UpdatePasswordPanel-detectie
//  - flowType: 'pkce' → PKCE-flow i.p.v. implicit, security best-practice
export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
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
