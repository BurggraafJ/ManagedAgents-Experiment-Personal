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
