import { supabase, SUPABASE_URL } from './supabase'

// Gebruikers-helpers — gedeeld door de desktop UsersPage (admin-shell) en de
// mobiele Gebruikers-lijst (v1.128). Uit UsersPage.jsx gelicht; gedrag 1:1.
//
// v1.158 — aanmaken ≠ uitnodigen. Een account kan bestaan zonder dat er ooit
// een mail is verstuurd; de mail gaat pas als de owner op Uitnodigen klikt.
// Daarom drie los uitleesbare statussen (statusFor / inviteStateFor /
// loginStateFor) en twee losse calls (createUserAccount / sendInvite).

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

// Zelfde datum, zonder het jaar als dat het huidige jaar is — scheelt breedte
// in de tabel en leest natuurlijker ("12 sep" i.p.v. "12 sep 2026").
export function formatDateShort(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    })
  } catch { return '—' }
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('nl-NL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
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
//   2. nooit ingelogd, geen uitnodiging verstuurd → 'created' (Aangemaakt)
//   3. nooit ingelogd, wél uitnodiging verstuurd → 'pending' (Uitgenodigd)
//   4. email_confirmed_at IS NULL → 'pending' (uitnodiging niet bevestigd)
//   5. active_sessions_count > 0 → 'live' (browser-tab is ingelogd)
//   6. last_seen_at / last_sign_in_at binnen 7d → 'active'
//   7. binnen 30d → 'idle' (met dagen-counter)
//   8. anders → 'inactive'
//
// Stap 2 en 3 zijn nieuw (v1.158): "nooit ingelogd" zei hiervoor 'Niet
// geactiveerd', wat suggereert dat er een mail ligt te wachten. Voor een
// account dat met createUser is klaargezet is er juist nog niets verstuurd.
export function statusFor(u) {
  if (u?.banned_until && new Date(u.banned_until) > new Date()) {
    return { kind: 'banned', label: 'Geblokkeerd' }
  }
  if (!u?.last_sign_in_at) {
    return u?.invite_sent_at
      ? { kind: 'pending', label: 'Uitgenodigd' }
      : { kind: 'created', label: 'Aangemaakt' }
  }
  if (!u?.email_confirmed_at) {
    return { kind: 'pending', label: 'Niet geactiveerd' }
  }
  if ((u?.active_sessions_count || 0) > 0) {
    return { kind: 'live', label: 'Live', live: true }
  }
  const ref = u?.last_seen_at || u?.last_sign_in_at
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)
  if (days < 1) return { kind: 'active', label: 'Vandaag actief' }
  if (days < 7) return { kind: 'active', label: 'Recent actief' }
  if (days < 30) return { kind: 'idle', label: `${days}d geleden` }
  return { kind: 'inactive', label: 'Inactief' }
}

// inviteStateFor — is er ooit een uitnodigingsmail verstuurd? Bron:
// user_roles.invite_sent_at (alleen gezet door de edge function invite-user).
export function inviteStateFor(u) {
  if (u?.invite_sent_at) {
    return {
      kind: 'sent',
      label: `Verstuurd · ${formatRelative(u.invite_sent_at)}`,
      title: `Uitnodiging verstuurd op ${formatDateTime(u.invite_sent_at)}`,
    }
  }
  if (u?.last_sign_in_at) {
    return {
      kind: 'na',
      label: 'Niet nodig',
      title: 'Deze gebruiker is al ingelogd; een uitnodiging is niet meer nodig.',
    }
  }
  return {
    kind: 'none',
    label: 'Nog niet',
    title: 'Het account bestaat, maar er is nooit een uitnodiging verstuurd.',
  }
}

// loginStateFor — heeft hij ooit ingelogd, en hoe lang is dat geleden?
export function loginStateFor(u) {
  if (!u?.last_sign_in_at) {
    return { kind: 'never', label: 'Nog nooit ingelogd', title: 'Geen enkele login op dit account.' }
  }
  const ref = u.last_seen_at || u.last_sign_in_at
  if ((u.active_sessions_count || 0) > 0) {
    return {
      kind: 'live',
      label: 'Nu ingelogd',
      live: true,
      title: `${u.active_sessions_count} actieve sessie${u.active_sessions_count === 1 ? '' : 's'} · eerste login ${formatDateTime(u.last_sign_in_at)}`,
    }
  }
  return {
    kind: 'seen',
    label: formatRelative(ref),
    title: `Laatste login: ${formatDateTime(u.last_sign_in_at)} · laatste activiteit: ${formatDateTime(ref)}`,
  }
}

async function callUserFunction(slug, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Geen actieve sessie — log opnieuw in.')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': session.access_token,
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || data?.warning || `HTTP ${res.status}`)
    err.code = data?.code || data?.error || null
    err.status = res.status
    throw err
  }
  return data
}

// Aanmaken — edge function create-user. Verstuurt géén mail: het account
// bestaat daarna wel, maar de gebruiker weet er nog niets van.
export async function createUserAccount({ email, displayName, dryRun = false }) {
  return callUserFunction('create-user', {
    email,
    display_name: displayName || '',
    dry_run: dryRun || undefined,
  })
}

// Uitnodigen — edge function invite-user. Alleen voor een account dat al
// bestaat; voor een onbekend adres komt code 'create-first' terug. redirect_to
// stuurt de gebruiker na het zetten van zijn wachtwoord terug naar deze app
// (?reset=1 is de marker die useSupabaseAuth als recovery-flow herkent).
export async function sendInvite({ email, displayName, dryRun = false }) {
  return callUserFunction('invite-user', {
    email,
    display_name: displayName || '',
    redirect_to: typeof window !== 'undefined' ? `${window.location.origin}/?reset=1` : undefined,
    dry_run: dryRun || undefined,
  })
}

// Uitnodigen mag zolang de gebruiker nog nooit heeft ingelogd. Daarna is de
// mail overbodig en zou hij een ongevraagde wachtwoord-reset zijn (de edge
// function weigert dat geval ook zelf, met 409). Owners nodigen we niet uit.
export function canInvite(u) {
  return !!u && !u.last_sign_in_at && u.app_role !== 'owner'
}

export async function inviteUser(u) {
  if (!canInvite(u)) throw new Error('Alleen voor members die nog nooit hebben ingelogd.')
  return sendInvite({ email: u.email, displayName: u.display_name || '' })
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
  // v1.158: twee losse tellers in plaats van één "niet geactiveerd". Wie is
  // aangemaakt en wacht nog op een uitnodiging, en wie heeft de mail gehad
  // maar is nog nooit binnen geweest?
  const neverLoggedIn = sorted.filter(u => !u.last_sign_in_at)
  const notInvited = neverLoggedIn.filter(u => !u.invite_sent_at).length
  const invitedNotLoggedIn = neverLoggedIn.length - notInvited
  const inactive30 = sorted.filter(u => {
    const ref = u.last_seen_at || u.last_sign_in_at
    if (!ref) return true
    const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000)
    return days >= 30
  }).length
  return {
    owners, members, total: sorted.length, live, pending, inactive30,
    neverLoggedIn: neverLoggedIn.length, notInvited, invitedNotLoggedIn,
  }
}
