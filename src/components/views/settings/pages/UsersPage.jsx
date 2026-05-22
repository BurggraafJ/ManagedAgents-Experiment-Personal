import { useEffect, useState, useMemo } from 'react'
import Modal from '../../../ui/Modal'
import { showToast } from '../../../Toast'
import { useUsers } from '../../../../hooks/useUsers'
import { supabase, SUPABASE_URL } from '../../../../lib/supabase'
import './users.css'

// Gebruikerspagina — bewerkbare user-center met card-grid, edit-modal en
// invite-flow. Owner kan naam en rol per user wijzigen via directe UPDATE
// op user_roles (RLS-policy user_roles_owner_full staat dit toe). Owner
// kan zichzelf niet demoten (self-lockout protection).

function getInitials(text) {
  if (!text) return '?'
  const parts = String(text).trim().split(/[\s.@]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('nl-NL', {
      year: 'numeric', month: 'short', day: 'numeric',
    })
  } catch { return '—' }
}

function formatRelative(iso) {
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
function statusFor(u) {
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

async function callInviteFunction({ email, displayName }) {
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

async function saveUser({ userId, displayName, role }) {
  const { error } = await supabase
    .from('user_roles')
    .upsert({
      user_id: userId,
      app_role: role,
      display_name: displayName?.trim() || null,
    }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

// ----------------------------- Edit modal -----------------------------

function EditUserModal({ open, user, currentUserId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open && user) {
      setName(user.display_name || '')
      setRole(user.app_role || 'member')
      setError(null)
    }
  }, [open, user])

  if (!user) return null
  const isSelf = currentUserId && user.user_id === currentUserId

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      // Self-lockout-protection: owner mag zichzelf niet naar member zetten.
      const effectiveRole = isSelf ? user.app_role : role
      await saveUser({ userId: user.user_id, displayName: name, role: effectiveRole })
      showToast({ kind: 'success', message: `${name || user.email} opgeslagen` })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
      showToast({ kind: 'error', message: 'Opslaan mislukt', detail: err.message || String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={`Bewerk ${user.email}`} size="md">
      <form className="users-form" onSubmit={handleSubmit}>
        <div className="users-form__row">
          <label className="users-form__label" htmlFor="edit-name">Naam</label>
          <input
            id="edit-name"
            type="text"
            className="users-form__input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Voor + Achternaam"
            disabled={busy}
            autoFocus
          />
          <div className="users-form__hint">Hoe deze gebruiker in de UI verschijnt.</div>
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="edit-role">Rol</label>
          <select
            id="edit-role"
            className="users-form__select"
            value={role}
            onChange={e => setRole(e.target.value)}
            disabled={busy || isSelf}
          >
            <option value="owner">Owner — volledige toegang incl. admin</option>
            <option value="member">Member — standaard medewerker</option>
          </select>
          {isSelf ? (
            <div className="users-form__hint" style={{ color: 'var(--warning, #c87f10)' }}>
              Je kunt je eigen rol niet wijzigen (zou je uitsluiten).
            </div>
          ) : (
            <div className="users-form__hint">
              Owners zien admin (Security/Health/Intelligence/JelleMind/Legal AI/Gebruikers) + Tokens/Infra in Settings.
            </div>
          )}
        </div>

        <div className="users-form__row">
          <span className="users-form__label">Account-info</span>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            <div><strong>E-mail:</strong> <code>{user.email}</code></div>
            <div><strong>Aangemaakt:</strong> {formatDate(user.created_at)}</div>
            <div><strong>Laatste login:</strong> {formatRelative(user.last_sign_in_at)}</div>
          </div>
        </div>

        {error && <div className="users-form__notice users-form__notice--error">{error}</div>}

        <Modal.Footer>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

// ----------------------------- Invite modal -----------------------------

function InviteModal({ open, onClose, onInvited }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Reset bij open/close zodat oude state niet blijft hangen.
  useEffect(() => {
    if (!open) { setEmail(''); setDisplayName(''); setError(null); setBusy(false) }
  }, [open])

  function handleClose() {
    if (busy) return
    onClose?.()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const result = await callInviteFunction({ email: email.trim(), displayName: displayName.trim() })
      showToast({ kind: 'success', message: `Uitnodiging verstuurd naar ${email.trim()}` })
      onInvited?.()
      // Modal sluit automatisch — geen vasthouden meer voor "ack". Reset gebeurt
      // via de useEffect hierboven zodra open=false.
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
      showToast({ kind: 'error', message: 'Uitnodigen mislukt', detail: err.message || String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Member uitnodigen" size="md">
      <form className="users-form" onSubmit={handleSubmit}>
        <div className="users-form__notice users-form__notice--warn">
          <strong>Let op — eigen data-sync ontbreekt nog.</strong> De member kan
          inloggen en ziet de gedeelde views (Administratie, Contacten, LinkedIn,
          Zoeken). Postvak / Agenda / Taken / Kilometers / Road Notes blijven leeg
          tot z'n eigen mail- en agenda-sync is opgezet (per-user Composio OAuth
          is nog niet geïmplementeerd). Stem dit eerst af met de member.
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="invite-email">E-mailadres</label>
          <input
            id="invite-email"
            type="email"
            required
            className="users-form__input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="collega@legal-mind.nl"
            disabled={busy}
            autoFocus
            autoComplete="off"
          />
          <div className="users-form__hint">Krijgt direct een uitnodigingsmail van Supabase met een set-password-link.</div>
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="invite-name">Naam (optioneel)</label>
          <input
            id="invite-name"
            type="text"
            className="users-form__input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Naam Collega"
            disabled={busy}
            autoComplete="off"
          />
        </div>

        {error && <div className="users-form__notice users-form__notice--error">{error}</div>}

        <Modal.Footer>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy || !email.trim()}>
            {busy ? 'Uitnodigen…' : 'Verstuur invite'}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}

// ----------------------------- User card -----------------------------

const EditIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/>
  </svg>
)

function UserCard({ user, isSelf, onEdit }) {
  const status = statusFor(user)
  const displayName = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const lastSeen = user.last_seen_at || user.last_sign_in_at
  return (
    <article className="user-card" data-role={user.app_role} data-self={isSelf ? 'true' : 'false'}>
      <header className="user-card__head">
        <div className="user-avatar-wrap">
          <div className="user-avatar" aria-hidden>{getInitials(displayName)}</div>
          {status.live && <span className="user-avatar__live-dot" aria-label="Nu ingelogd" title="Nu ingelogd" />}
        </div>
        <div className="user-card__heading">
          <h3 className="user-card__name">{displayName}</h3>
          <p className="user-card__email">{user.email}</p>
        </div>
      </header>

      <div className="user-card__meta">
        <span
          className={`user-pill ${user.app_role === 'owner' ? 'user-pill--owner' : ''}`}
          title={user.app_role === 'owner' ? 'Volledige toegang incl. admin' : 'Standaard medewerker'}
        >
          {user.app_role}
        </span>
        <span
          className={`user-pill user-pill--${status.kind}`}
          title={
            status.kind === 'live'    ? `${user.active_sessions_count} actieve sessie${user.active_sessions_count === 1 ? '' : 's'}` :
            status.kind === 'pending' ? 'Heeft de uitnodigingsmail nog niet bevestigd' :
            status.kind === 'banned'  ? `Geblokkeerd t/m ${formatDate(user.banned_until)}` :
            `Laatste activiteit: ${formatRelative(lastSeen)}`
          }
        >
          <span className="user-pill__dot" />
          {status.label}
        </span>
      </div>

      <dl className="user-card__details">
        <dt>Laatste login</dt>
        <dd>{formatRelative(user.last_sign_in_at)}</dd>
        <dt>Laatste activiteit</dt>
        <dd>{formatRelative(lastSeen)}</dd>
        <dt>Aangemaakt</dt>
        <dd>{formatDate(user.created_at)}</dd>
      </dl>

      <div className="user-card__actions">
        <button type="button" className="user-card__btn user-card__btn--primary" onClick={() => onEdit(user)}>
          {EditIcon} Bewerken
        </button>
      </div>
    </article>
  )
}

// ----------------------------- Main page -----------------------------

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  // Sorteer owners eerst, dan op laatste login (recentste eerst).
  const sorted = useMemo(() => {
    const list = [...(users || [])]
    list.sort((a, b) => {
      if (a.app_role !== b.app_role) return a.app_role === 'owner' ? -1 : 1
      const at = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0
      const bt = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0
      return bt - at
    })
    return list
  }, [users])

  const stats = useMemo(() => {
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
  }, [sorted])

  return (
    <div className="users-app">
      <div className="users-toolbar">
        <div className="users-toolbar__meta">
          <strong style={{ fontSize: 14, color: 'var(--text)' }}>
            {stats.total} gebruiker{stats.total === 1 ? '' : 's'}
          </strong>
          {stats.total > 0 && (
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>{stats.owners}</strong> owner{stats.owners === 1 ? '' : 's'}
              {' · '}<strong>{stats.members}</strong> member{stats.members === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="users-toolbar__actions">
          <button type="button" className="set-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Laden…' : 'Vernieuwen'}
          </button>
          <button
            type="button"
            className="users-invite-btn"
            onClick={() => setShowInvite(true)}
            title="Stuur een uitnodigingsmail naar een nieuwe member"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 6l8 6 8-6" /><rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M19 14v6M16 17h6" stroke="currentColor" />
            </svg>
            Member uitnodigen
          </button>
        </div>
      </div>

      {sorted.length > 0 && (
        <div className="users-stats">
          <div className="users-stat">
            <div className="users-stat__label">Totaal</div>
            <div className="users-stat__value">{stats.total}</div>
            <div className="users-stat__hint">{stats.owners} owner · {stats.members} member</div>
          </div>
          <div className="users-stat">
            <div className="users-stat__label">Live</div>
            <div className="users-stat__value users-stat__value--live">
              {stats.live > 0 && <span className="user-avatar__live-dot" style={{ position: 'static', width: 10, height: 10, border: 'none' }} />}
              {stats.live}
            </div>
            <div className="users-stat__hint">{stats.live === 0 ? 'niemand actief' : `nu ingelogd`}</div>
          </div>
          <div className="users-stat">
            <div className="users-stat__label">Niet geactiveerd</div>
            <div className={`users-stat__value ${stats.pending > 0 ? 'users-stat__value--warn' : ''}`}>{stats.pending}</div>
            <div className="users-stat__hint">{stats.pending === 0 ? 'iedereen bevestigd' : 'mail nog niet bevestigd'}</div>
          </div>
          <div className="users-stat">
            <div className="users-stat__label">Inactief</div>
            <div className="users-stat__value">{stats.inactive30}</div>
            <div className="users-stat__hint">geen activiteit ≥ 30 dagen</div>
          </div>
        </div>
      )}

      {error && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {error}
        </div>
      )}

      {!error && sorted.length === 0 && !loading && (
        <div className="users-empty">
          <p className="users-empty__title">Geen gebruikers gevonden</p>
          <p className="users-empty__hint">Klik <strong>+ Member uitnodigen</strong> om een collega toe te voegen.</p>
        </div>
      )}

      {!error && sorted.length > 0 && (
        <div className="users-grid">
          {sorted.map(u => (
            <UserCard
              key={u.user_id}
              user={u}
              isSelf={u.user_id === currentUserId}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      <div className="users-info">
        <div className="users-info__title">Wat de member kan en niet kan</div>
        <ul className="users-info__list">
          <li><strong>Wel zichtbaar:</strong> Dashboard · Zoeken · Administratie (HubSpot — gedeeld) · Contacten · LinkedIn · Postvak / Agenda / Taken / Kilometers / Road Notes (eigen data — leeg tot eigen sync draait).</li>
          <li><strong>Niet zichtbaar:</strong> Admin (Security · Health · Intelligence · JelleMind · Legal AI · Gebruikers) en Tokens + Infrastructuur in Settings.</li>
          <li><strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda / taken / etc. — alles filtert op <code>user_id = auth.uid()</code>.</li>
          <li><strong>Nog te bouwen:</strong> per-user Composio OAuth voor mail- en calendar-sync, anders blijven de eigen mirrors leeg. Skills schrijven momenteel default jouw UUID.</li>
        </ul>
      </div>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} onInvited={refresh} />
      <EditUserModal
        open={!!editing}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
    </div>
  )
}
