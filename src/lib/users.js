import { supabase, SUPABASE_URL } from './supabase'

// Gebruikers-helpers — gedeeld door de desktop UsersPage (admin-shell) en de
// mobiele Gebruikers-lijst (v1.128). Uit UsersPage.jsx gelicht; gedrag 1:1.

export function getInitials(text) {
  if (!text) return '?'
  const parts = String(text).trim().split(/[\s.@]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('nl-NL', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return '—' }
}

export function formatRelative(iso) {
  if (!iso) return 'nooit'
  try {
    const ms = Date.now() - new Date(iso).getTime()
    const days = Math.floor(ms / 86400000)
    if (days < 1) return 'vandaag'
    if (days === 1) return 'gisteren'
    if (days < 7) return `${days} dagen geleden`
    if (days < 30) return `${Math.floor(days / 7)} weken geleden`
    if (days < 365) return `${Math.floor(days / 30)} maanden geleden`
    return `${Math.floor(days / 365)} jaar geleden`
  } catch { return '—' }
}

// statusFor — gelaagde status-detectie:
//   1. banned_until > now → 'banned'
//   2. email_confirmed_at IS NULL → 'pending' (uitnodiging niet bevestigd)
//   3. active_sessions_count > 0 → 'live' (browser-tab is ingelogd)
//   4. last_seen_at / last_sign_in_at binnen 7d → 'active'
//   5. binnen 30d → 'idle' (met dagen-counter)
//   6. anders → 'inactive'
export function statusFor(u) {
  if (u?.banned_until && new Date(u.banned_until) > new Date()) {
    return { kind: 'banned', label: 'Geblokkeerd' }
  }
  if (!u?.email_confirmed_at) {
    return { kind: 'pending', label: 'Niet geactiveerd' }
  }
  if ((u?.active_sessions_count || 0) > 0) {
    return { kind: 'live', label: 'Live', live: true }
  }
  const ref = u?.last_seen_at || u?.last_sign_in_at
  if (!ref) return { kind: 'inactive', label: 'Nooit ingelogd' }
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)
  if (days < 1) return { kind: 'active', label: 'Vandaag actief' }
  if (days < 7) return { kind: 'active', label: 'Recent actief' }
  if (days < 30) return { kind: 'idle', label: `${days}d geleden` }
  return { kind: 'inactive', label: 'Inactief' }
}

export async function callInviteFunction({ email, displayName }) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Geen actieve sessie — log opnieuw in.')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': session.access_token,
    },
    body: JSON.stringify({ email, display_name: displayName }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || data?.warning || `HTTP ${res.status}`)
  return data
}

// Uitnodiging opnieuw sturen (v1.129) — zelfde Edge Function als de eerste
// invite. GoTrue stuurt voor een nog-niet-bevestigde user de invite-mail
// opnieuw; voor een al bevestigde user weigert hij (email_exists). De functie
// upsert daarna user_roles als member met de meegegeven naam — daarom de
// bestaande display_name meegeven, anders wordt die leeggemaakt. Alleen
// aanbieden bij status 'pending' en rol member (owner zou gedemoveerd worden).
export function canResendInvite(u) {
  return !!u && !u.email_confirmed_at && u.app_role !== 'owner'
}

export async function resendInvite(u) {
  if (!canResendInvite(u)) throw new Error('Alleen voor niet-geactiveerde members.')
  return callInviteFunction({ email: u.email, displayName: u.display_name || '' })
}

export async function saveUser({ userId, displayName, role }) {
  const { error } = await supabase
    .from('user_roles')
    .upsert({
      user_id: userId,
      app_role: role,
      display_name: displayName?.trim() || null,
    }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

// Sorteer owners eerst, dan op laatste login (recentste eerst).
export function sortUsers(users) {
  const list = [...(users || [])]
  list.sort((a, b) => {
    if (a.app_role !== b.app_role) return a.app_role === 'owner' ? -1 : 1
    const at = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0
    const bt = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0
    return bt - at
  })
  return list
}

export function userStats(sorted) {
  const owners = sorted.filter(u => u.app_role === 'owner').length
  const members = sorted.length - owners
  const live = sorted.filter(u => (u.active_sessions_count || 0) > 0).length
  const pending = sorted.filter(u => !u.email_confirmed_at).length
  const inactive30 = sorted.filter(u => {
    const ref = u.last_seen_at || u.last_sign_in_at
    if (!ref) return true
    const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)
    return days >= 30
  }).length
  return { owners, members, total: sorted.length, live, pending, inactive30 }
}
