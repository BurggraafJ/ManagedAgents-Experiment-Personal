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

// Korte variant voor in een pill: "3 d", "2 wk", "6 mnd", "1 jr". De volledige
// datum staat altijd in het title-attribuut ernaast, dus hier mag het kort —
// de lange vorm liet de gebruikerstabel in de Organisatie-pane uitlopen.
export function formatRelativeShort(iso) {
  if (!iso) return 'nooit'
  try {
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (days < 1) return 'vandaag'
    if (days === 1) return 'gisteren'
    if (days < 7) return `${days} d`
    if (days < 30) return `${Math.floor(days / 7)} wk`
    if (days < 365) return `${Math.floor(days / 30)} mnd`
    return `${Math.floor(days / 365)} jr`
  } catch { return '—' }
}

// Kalenderdagen tussen toen en nu, in de tijdzone van de kijker. Het verschil
// met een deling door 86.400.000 is precies de bug die Jelle meldde: dat is een
// ROLLEND venster van 24 uur, en gisteravond 20:00 valt er vanochtend om 09:00
// nog binnen. "Vandaag" is een datum, geen etmaal.
function kalenderDagen(iso) {
  const d = new Date(iso)
  const nu = new Date()
  const toen = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const vandaag = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate())
  return Math.round((vandaag - toen) / 86400000)
}

// Heeft dit account ooit een MENS gezien? `last_active_at` telt alleen echte
// activiteit (een ververste sessie, een sessie van een browser, of een gehaalde
// tweede factor) — zie migratie 20260914161000.
//
// ⚠ `last_sign_in_at` is hier met opzet geen bron. Onze eigen meetscripts
// minten JWT's via generate_link + verify, en GoTrue zet die kolom dan alsof er
// iemand inlogde. Julia stond daardoor op "Vandaag actief" terwijl haar enige
// sessie een mint van 11:51 uur was; Jay Alberts had er dertien.
export function ooitGebruikt(u) {
  return Boolean(u?.last_active_at)
}

// Uit dienst (v1.222). Eén zacht veld op user_roles: NULL = actief, gezet =
// de persoon werkt hier niet meer. Geen ban en geen delete in auth.users —
// de historie (wie stuurde die mail, wie was deal-eigenaar) hangt aan het
// user_id en moet blijven staan.
//
// ⚠ Niet te verwarren met de status 'inactive' hieronder. Die zegt "30 dagen
// niets gedaan" en gaat vanzelf weer weg zodra iemand inlogt; deze is een
// besluit van de owner en blijft staan tot hij hem terugdraait.
export function isGedeactiveerd(u) {
  return Boolean(u?.deactivated_at)
}

// statusFor — gelaagde status-detectie:
//   0. deactivated_at gezet → 'deactivated' (Uit dienst)
//   1. banned_until > now → 'banned'
//   2. nooit écht gebruikt, geen uitnodiging verstuurd → 'created' (Aangemaakt)
//   3. nooit écht gebruikt, wél uitnodiging verstuurd → 'pending' (Uitgenodigd)
//   4. email_confirmed_at IS NULL → 'pending' (uitnodiging niet bevestigd)
//   5. active_sessions_count > 0 → 'live' (een sessie die net nog een token haalde)
//   6. last_active_at vandaag / gisteren / binnen 7 kalenderdagen → 'active'
//   7. binnen 30 → 'idle' (met dagen-counter)
//   8. anders → 'inactive'
//
// Stap 2 en 3 zijn van v1.158: "nooit ingelogd" zei hiervoor 'Niet geactiveerd',
// wat suggereert dat er een mail ligt te wachten. Voor een account dat met
// createUser is klaargezet is er juist nog niets verstuurd.
export function statusFor(u) {
  // Uit dienst staat bóven geblokkeerd. Allebei "deze persoon komt er niet
  // in", maar alleen dit zegt wáárom, en dat is wat de owner zoekt als hij de
  // lijst doorloopt. Is iemand ook geblokkeerd, dan staat dat in de tooltip —
  // twee pillen naast elkaar leest als twee losse problemen.
  if (isGedeactiveerd(u)) {
    const ookGeblokkeerd = !!(u?.banned_until && new Date(u.banned_until) > new Date())
    return { kind: 'deactivated', label: 'Uit dienst', since: u.deactivated_at, ookGeblokkeerd }
  }
  if (u?.banned_until && new Date(u.banned_until) > new Date()) {
    return { kind: 'banned', label: 'Geblokkeerd' }
  }
  if (!ooitGebruikt(u)) {
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
  const days = kalenderDagen(u.last_active_at)
  if (days <= 0) return { kind: 'active', label: 'Vandaag actief' }
  if (days === 1) return { kind: 'active', label: 'Gisteren actief' }
  if (days < 7) return { kind: 'active', label: 'Recent actief' }
  if (days < 30) return { kind: 'idle', label: `${days}d geleden` }
  return { kind: 'inactive', label: 'Inactief' }
}

// Waarom staat er "Aangemaakt" terwijl er een login-datum is? Omdat die datum
// van ons gereedschap komt. Eén zin, alleen als het geval zich voordoet — en hij
// noemt het aantal, zodat het een meting blijft en geen vermoeden.
export function statusUitleg(u) {
  if (ooitGebruikt(u) || !u?.last_sign_in_at) return null
  const n = u?.tool_sessions_count || 0
  return `Er staat wel een sessie op dit account (${formatDateTime(u.last_sign_in_at)}), maar geen van een browser en geen met een tweede factor${
    n > 0 ? ` — ${n} ${n === 1 ? 'sessie komt' : 'sessies komen'} van meetgereedschap` : ''
  }. Dat telt niet als gebruik.`
}

// inviteStateFor — is er ooit een uitnodigingsmail verstuurd? Bron:
// user_roles.invite_sent_at (alleen gezet door de edge function invite-user).
export function inviteStateFor(u) {
  if (u?.invite_sent_at) {
    return {
      kind: 'sent',
      label: `Verstuurd · ${formatRelativeShort(u.invite_sent_at)}`,
      title: `Uitnodiging verstuurd op ${formatDateTime(u.invite_sent_at)}`,
    }
  }
  // Op `ooitGebruikt` en niet op `last_sign_in_at`: anders zegt deze kolom
  // "Niet nodig" over iemand die nog nooit een mail heeft gehad, alleen omdat
  // een meetscript ooit een JWT voor hem heeft gemint.
  if (ooitGebruikt(u)) {
    return {
      kind: 'na',
      label: 'Niet nodig',
      title: 'Deze gebruiker heeft de app al gebruikt; een uitnodiging is niet meer nodig.',
    }
  }
  return {
    kind: 'none',
    label: 'Nog niet',
    title: 'Het account bestaat, maar er is nooit een uitnodiging verstuurd.',
  }
}

// loginStateFor — heeft hij de app ooit écht gebruikt, en hoe lang is dat
// geleden? Zelfde bron als statusFor; `last_sign_in_at` staat alleen nog in de
// tooltip, met erbij wat hij wel en niet bewijst.
export function loginStateFor(u) {
  if (!ooitGebruikt(u)) {
    return {
      kind: 'never',
      label: 'Nog nooit gebruikt',
      title: statusUitleg(u) || 'Geen enkele sessie van een browser of met een tweede factor op dit account.',
    }
  }
  if ((u.active_sessions_count || 0) > 0) {
    return {
      kind: 'live',
      label: 'Nu ingelogd',
      live: true,
      title: `${u.active_sessions_count} sessie${u.active_sessions_count === 1 ? '' : 's'} die binnen twee uur nog een token ophaalde${u.active_sessions_count === 1 ? '' : 'n'} · laatste activiteit ${formatDateTime(u.last_active_at)}`,
    }
  }
  return {
    kind: 'seen',
    label: formatRelative(u.last_active_at),
    title: `Laatste echte activiteit: ${formatDateTime(u.last_active_at)}. Een ververste sessie, een sessie van een browser of een gehaalde tweede factor — een aangemaakte sessie alleen telt niet mee.`,
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

// Uitnodigen mag zolang de gebruiker de app nog nooit écht heeft gebruikt.
// Daarna is de mail overbodig en zou hij een ongevraagde wachtwoord-reset zijn
// (de edge function weigert dat geval ook zelf, met 409). Owners nodigen we
// niet uit.
//
// Op `ooitGebruikt` en niet op `last_sign_in_at`: die kolom staat gevuld zodra
// een meetscript een JWT heeft gemint, en dan verdween de Uitnodigen-knop bij
// iemand die nog nooit een mail had gehad. De edge function blijft de poort —
// komt er onverhoopt toch een 409, dan is dat een nette fout en geen kapotte
// knop.
//
// v1.213: die edge-poort stond zelf nog wél op `last_sign_in_at` en weigerde
// dus precies de gevallen waarvoor de knop hier aanstond ("al eens ingelogd",
// 409). Sinds de migratie 20260915150000 lezen knop en poort dezelfde meting:
// `user_last_active_at()`.
//
// v1.222: en niet als de persoon uit dienst is. Dat geval is hier geen theorie
// — alle vijf de mensen die bij de invoering uit dienst gingen hadden de app
// nog nooit écht gebruikt, dus stónd de knop bij alle vijf aan. Zonder deze
// regel is de kortste weg in dit scherm een set-wachtwoord-mail naar iemand die
// hier niet meer werkt.
export function canInvite(u) {
  return !!u && !ooitGebruikt(u) && !isGedeactiveerd(u) && u.app_role !== 'owner'
}

export async function inviteUser(u) {
  if (!canInvite(u)) throw new Error('Alleen voor members die de app nog nooit hebben gebruikt.')
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

// De drie bakken van het Gebruikers-scherm (v1.222). Eén gebruiker zit in
// precies één bak — de volgorde hieronder ís de partitie:
//
//   gedeactiveerd — uit dienst. Blijft zichtbaar, maar in zijn eigen tab.
//   uitnodiging   — bestaat wel, maar heeft de app nog nooit écht gebruikt.
//                   Dat is één bak voor drie tussenstanden die allemaal op
//                   dezelfde handeling wachten: aangemaakt-zonder-mail,
//                   uitnodiging-verstuurd-nog-niet-binnen, en uitgesteld.
//   actief        — de rest: mensen die de app daadwerkelijk gebruiken.
//
// `invite_deferred` krijgt geen eigen tak. Dat vlaggetje staat op accounts die
// nog niets gebruikt hebben, dus het valt al onder ooitGebruikt; zou het ooit
// op een actieve gebruiker blijven staan, dan hoort die bij Actief te staan en
// niet bij een uitnodiging die allang is ingelost.
export const USER_TABS = [
  { id: 'actief',        label: 'Actief' },
  { id: 'uitnodiging',   label: 'Uitnodiging' },
  { id: 'gedeactiveerd', label: 'Gedeactiveerd' },
]

export const DEFAULT_USER_TAB = 'actief'

export function bucketFor(u) {
  if (isGedeactiveerd(u)) return 'gedeactiveerd'
  if (!ooitGebruikt(u)) return 'uitnodiging'
  return 'actief'
}

export function bucketCounts(users) {
  const counts = { actief: 0, uitnodiging: 0, gedeactiveerd: 0 }
  for (const u of users || []) counts[bucketFor(u)] += 1
  return counts
}

// Sorteer owners eerst, dan op laatste échte activiteit (recentste eerst).
// Op last_sign_in_at sorteren gaf een volgorde die met elke meetrun verschoof:
// het script mint de member met de nieuwste login en zet hem daarmee opnieuw
// bovenaan.
export function sortUsers(users) {
  const list = [...(users || [])]
  list.sort((a, b) => {
    if (a.app_role !== b.app_role) return a.app_role === 'owner' ? -1 : 1
    const at = a.last_active_at ? new Date(a.last_active_at).getTime() : 0
    const bt = b.last_active_at ? new Date(b.last_active_at).getTime() : 0
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
  // v1.222 — wie uit dienst is telt niet mee in de twee tellers die om een
  // handeling vragen. "3 nog niet uitgenodigd" in de paginakop is een opdracht
  // aan de owner; iemand die hier niet meer werkt hoort daar niet in te staan,
  // net zomin als de Uitnodigen-knop bij hem aan hoort te staan (canInvite).
  const deactivated = sorted.filter(isGedeactiveerd).length
  const teNodigen = sorted.filter(u => !ooitGebruikt(u) && !isGedeactiveerd(u))
  const notInvited = teNodigen.filter(u => !u.invite_sent_at).length
  const invitedNotLoggedIn = teNodigen.length - notInvited
  const inactive30 = sorted.filter(u => {
    if (isGedeactiveerd(u)) return false
    if (!ooitGebruikt(u)) return true
    return kalenderDagen(u.last_active_at) >= 30
  }).length
  return {
    owners, members, total: sorted.length, live, pending, inactive30, deactivated,
    neverLoggedIn: teNodigen.length, notInvited, invitedNotLoggedIn,
  }
}
