import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useUsers } from '../../../../hooks/useUsers'
import {
  getInitials, formatDate, formatRelative, statusFor, sortUsers, userStats,
  canResendInvite, resendInvite,
} from '../../../../lib/users'
import { EditUserModal, InviteModal } from './users/UserModals'
import { useHubspotOwnerMap } from '../../../../hooks/useHubspotOwnerMap'
import Modal from '../../../ui/Modal'
import { showToast } from '../../../Toast'
import './users.css'

// Gebruikerspagina (desktop, admin-shell). Owner kan naam en rol per user
// wijzigen via directe UPDATE op user_roles (RLS-policy user_roles_owner_full
// staat dit toe). Owner kan zichzelf niet demoten (self-lockout protection,
// in EditUserModal).
//
// v1.128: helpers → lib/users.js, modals → users/UserModals.jsx (gedeeld met
// de mobiele Gebruikers-lijst).
// v1.129 (Chrome A "Register"): kaartgrid → één tabel-kaart; de vier
// stat-tegels → één metaregel in de paginakop; het "Wat de member kan"-blok
// → één voetregel + "Wat ziet een member? →" (modal met dezelfde inhoud);
// acties rechts in de kop (ververs-icoon + inkt "Member uitnodigen"). Nieuw:
// "Opnieuw sturen" bij niet-geactiveerde members (invite-user nogmaals).
// Data (useUsers), modals en self-lockout ongewijzigd.
// v1.131 (2FA): pill met het aantal vertrouwde apparaten per gebruiker; de
// knop "Alles intrekken" zit in EditUserModal, zodat mobiel hem ook heeft.
// v1.136: de losse "HubSpot deal-eigenaar"-tabel onder de lijst is weg. Die
// herhaalde dezelfde gebruikers een tweede keer; de koppeling is nu één kolom
// op de rij zelf (label) plus het veld in EditUserModal (control). Tabel
// hubspot_owner_map en useHubspotOwnerMap blijven ongewijzigd.

const Icon = (paths, size = 14) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const EditIcon    = Icon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></>)
const MailIcon    = Icon(<><path d="M4 6l8 6 8-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></>)
const RefreshIcon = Icon(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>, 15)
const ShieldIcon  = Icon(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />)

// Label voor de HubSpot-koppeling. Eén plek, gedeeld door de tabelrij en de
// mobiele kaart — zodat "gekoppeld" er overal hetzelfde uitziet.
export function HubspotOwnerPill({ ownerId, ownerLabel, loading }) {
  if (loading) return <span className="user-pill user-pill--hs-none">…</span>
  if (!ownerId) {
    return (
      <span className="user-pill user-pill--hs-none" title="Deals van deze HubSpot-eigenaar worden nog niet aan deze gebruiker toegeschreven">
        niet gekoppeld
      </span>
    )
  }
  const label = ownerLabel(ownerId)
  return (
    <span className="user-pill user-pill--hs" title={`HubSpot deal-eigenaar: ${label}`}>
      <span className="user-pill__dot" />
      {label}
    </span>
  )
}

function UserRow({ user, isSelf, onEdit, onResend, resending, ownerId, ownerLabel, ownerLoading }) {
  const status = statusFor(user)
  const displayName = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const lastSeen = user.last_seen_at || user.last_sign_in_at
  const statusTitle =
    status.kind === 'live'    ? `${user.active_sessions_count} actieve sessie${user.active_sessions_count === 1 ? '' : 's'}` :
    status.kind === 'pending' ? 'Heeft de uitnodigingsmail nog niet bevestigd' :
    status.kind === 'banned'  ? `Geblokkeerd t/m ${formatDate(user.banned_until)}` :
    `Laatste activiteit: ${formatRelative(lastSeen)}`
  return (
    <tr className="users-row" data-role={user.app_role} data-self={isSelf ? 'true' : 'false'}>
      <td>
        <div className="users-who">
          <div className="user-avatar-wrap">
            <div className="user-avatar" aria-hidden>{getInitials(displayName)}</div>
            {status.live && <span className="user-avatar__live-dot" aria-label="Nu ingelogd" title="Nu ingelogd" />}
          </div>
          <div className="users-who__text">
            <div className="users-who__name">
              {displayName}
              {isSelf && <span className="users-you">jij</span>}
            </div>
            <div className="users-who__mail">{user.email}</div>
          </div>
        </div>
      </td>
      <td>
        <span
          className={`user-pill ${user.app_role === 'owner' ? 'user-pill--owner' : ''}`}
          title={user.app_role === 'owner' ? 'Volledige toegang incl. Organisatie' : 'Standaard medewerker'}
        >
          {user.app_role}
        </span>
      </td>
      <td>
        <span className={`user-pill user-pill--${status.kind}`} title={statusTitle}>
          <span className="user-pill__dot" />
          {status.label}
        </span>
        {(user.trusted_device_count || 0) > 0 && (
          <span
            className="user-pill"
            style={{ marginLeft: 6 }}
            title="Apparaten die de verificatiecode overslaan (14-dagenvenster). Intrekken via Bewerken."
          >
            {user.trusted_device_count} vertrouwd
          </span>
        )}
      </td>
      <td>
        <HubspotOwnerPill ownerId={ownerId} ownerLabel={ownerLabel} loading={ownerLoading} />
      </td>
      <td
        className="users-table__mono"
        title={`Laatste activiteit: ${formatRelative(lastSeen)} · aangemaakt ${formatDate(user.created_at)}`}
      >
        {formatRelative(user.last_sign_in_at)}
      </td>
      <td>
        <div className="users-actions">
          {canResendInvite(user) && (
            <button
              type="button"
              className="admin-btn admin-btn--sm"
              onClick={() => onResend(user)}
              disabled={resending === user.user_id}
              title="Stuur de uitnodigingsmail nogmaals naar dit adres"
            >
              {MailIcon} {resending === user.user_id ? 'Versturen…' : 'Opnieuw sturen'}
            </button>
          )}
          <button type="button" className="admin-btn admin-btn--sm" onClick={() => onEdit(user)}>
            {EditIcon} Bewerken
          </button>
        </div>
      </td>
    </tr>
  )
}

// Zelfde inhoud als het oude "Wat de member kan en niet kan"-blok, nu op
// aanvraag achter de voetregel-link in plaats van als essay onder de lijst.
function MemberInfoModal({ open, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title="Wat ziet een member?" size="md">
      <ul className="users-info__list">
        <li><strong>Wel zichtbaar:</strong> Dashboard · Zoeken · Administratie (HubSpot — gedeeld) · Contacten · Postvak / Agenda (eigen, na Connectors-koppeling) · Taken (in-app Mijn taken).</li>
        <li><strong>Niet zichtbaar:</strong> Organisatie (Gebruikers · Health · Security · Skills · JelleMind · Intelligence · Legal AI) en Tokens + Infrastructuur in Settings.</li>
        <li><strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda / taken / etc. — alles filtert op <code>user_id = auth.uid()</code>.</li>
        <li><strong>Postvak / Agenda:</strong> na inloggen Instellingen → Connectors → Koppelen (Microsoft). Skills die namens de member schrijven moeten nog user_id-bewust zijn.</li>
      </ul>
      <Modal.Footer>
        <button type="button" className="btn" onClick={onClose}>Sluiten</button>
      </Modal.Footer>
    </Modal>
  )
}

export default function UsersPage() {
  const { users, loading, error, refresh } = useUsers()
  // Eén hook-instantie voor de hele pagina; rij-labels en de modal krijgen 'm
  // via props (pre-flight-regel 4).
  const ownerMap = useHubspotOwnerMap()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [editing, setEditing] = useState(null)
  const [resending, setResending] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])
  // Schrijven op hubspot_owner_map is owner-only (RLS). De UI volgt dat, zodat
  // een member geen control ziet die tóch zou falen.
  const isOwner = useMemo(
    () => sorted.some(u => u.user_id === currentUserId && u.app_role === 'owner'),
    [sorted, currentUserId],
  )

  async function handleResend(user) {
    setResending(user.user_id)
    try {
      await resendInvite(user)
      showToast({ kind: 'success', message: `Uitnodiging opnieuw verstuurd naar ${user.email}` })
      refresh()
    } catch (err) {
      showToast({ kind: 'error', message: 'Opnieuw sturen mislukt', detail: err.message || String(err) })
    } finally {
      setResending(null)
    }
  }

  return (
    <div className="users-app">
      <header className="admin-page-head">
        <div className="admin-page-head__main">
          <h1 className="admin-page-head__title">Gebruikers</h1>
          <p className="admin-page-head__subtitle">Wie mag erin en met welke rol.</p>
          {stats.total > 0 && (
            <p className="admin-page-head__meta">
              <b>{stats.total}</b> gebruiker{stats.total === 1 ? '' : 's'}
              {' · '}{stats.owners} owner{stats.owners === 1 ? '' : 's'}
              {' · '}{stats.members} member{stats.members === 1 ? '' : 's'}
              {stats.live > 0 && <>{' · '}<span className="is-ok">{stats.live} live</span></>}
              {stats.pending > 0 && <>{' · '}<span className="is-warn">{stats.pending} niet geactiveerd</span></>}
            </p>
          )}
        </div>
        <div className="admin-page-head__actions">
          <button
            type="button"
            className={`admin-iconbtn ${loading ? 'is-busy' : ''}`}
            onClick={refresh}
            disabled={loading}
            aria-label="Vernieuwen"
            title="Vernieuwen"
          >
            {RefreshIcon}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => setShowInvite(true)}
            title="Stuur een uitnodigingsmail naar een nieuwe member"
          >
            {MailIcon} Member uitnodigen
          </button>
        </div>
      </header>

      {error && (
        <div className="users-form__notice users-form__notice--error">
          <strong>Fout bij ophalen:</strong> {error}
        </div>
      )}

      {!error && sorted.length === 0 && !loading && (
        <div className="users-empty">
          <p className="users-empty__title">Geen gebruikers gevonden</p>
          <p className="users-empty__hint">Klik <strong>Member uitnodigen</strong> om een collega toe te voegen.</p>
        </div>
      )}

      {!error && sorted.length > 0 && (
        <div className="users-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>Gebruiker</th>
                <th>Rol</th>
                <th>Status</th>
                <th title="Welke HubSpot deal-eigenaar bij deze gebruiker hoort. Wijzigen via Bewerken.">HubSpot</th>
                <th>Laatste login</th>
                <th className="is-right"><span className="sr-only">Acties</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(u => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === currentUserId}
                  onEdit={setEditing}
                  onResend={handleResend}
                  resending={resending}
                  ownerId={ownerMap.byUser[u.user_id] || ''}
                  ownerLabel={ownerMap.ownerLabel}
                  ownerLoading={ownerMap.loading}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="admin-footnote">
        {ShieldIcon}
        <span>
          Members zien Organisatie niet en geen Tokens/Infra. Eigen mail- en agenda-sync per member is nog niet gebouwd.{' '}
          <button type="button" className="admin-linkbtn" onClick={() => setShowInfo(true)}>Wat ziet een member? →</button>
        </span>
      </p>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} onInvited={refresh} />
      <EditUserModal
        open={!!editing}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        ownerMap={ownerMap}
        canEditOwner={isOwner}
      />
      <MemberInfoModal open={showInfo} onClose={() => setShowInfo(false)} />
    </div>
  )
}
