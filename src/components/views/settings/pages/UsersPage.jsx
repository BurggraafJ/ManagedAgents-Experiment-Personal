import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useUsers } from '../../../../hooks/useUsers'
import { getInitials, formatDate, formatRelative, statusFor, sortUsers, userStats } from '../../../../lib/users'
import { EditUserModal, InviteModal } from './users/UserModals'
import './users.css'

// Gebruikerspagina (desktop, admin-shell) — bewerkbare user-center met
// card-grid, edit-modal en invite-flow. Owner kan naam en rol per user
// wijzigen via directe UPDATE op user_roles (RLS-policy user_roles_owner_full
// staat dit toe). Owner kan zichzelf niet demoten (self-lockout protection).
//
// v1.128: helpers → lib/users.js, modals → users/UserModals.jsx (gedeeld met
// de mobiele Gebruikers-lijst). Render hier ongewijzigd.

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

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])

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
