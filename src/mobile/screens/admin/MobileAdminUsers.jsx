import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useUsers } from '../../../hooks/useUsers'
import { getInitials, formatRelative, statusFor, sortUsers, userStats } from '../../../lib/users'
import { EditUserModal, InviteModal } from '../../../components/views/settings/pages/users/UserModals'
import { useHubspotOwnerMap } from '../../../hooks/useHubspotOwnerMap'
import MIcon from '../../MIcon'
import { MSetHead, MSetGroup } from '../MobileSettingsBits'

// Gebruikers (niveau 2) — mobiele lijst rond dezelfde data (useUsers) en
// dezelfde flows (EditUserModal / InviteModal) als de desktop UsersPage.
// Owner/Members als inset-groepen; "Member uitnodigen" gedockt boven de
// tabbar (fixed-inset patroon, v1.123).
//
// v1.131 (2FA): pill met het aantal vertrouwde apparaten; "Alles intrekken"
// zit in EditUserModal (gedeeld met desktop).
// v1.129 (Chrome A): de drie stat-tegels → één metaregel onder de titel,
// ververs-knop rechts van de titel, rijen compacter (pills + login op één
// regel), kortere voetnoot. Dock ongewijzigd.
// v1.136: HubSpot deal-eigenaar als pill in de pills-regel van de kaart;
// wijzigen gebeurt in EditUserModal (gedeeld met desktop).
export default function MobileAdminUsers({ onBack }) {
  const { users, loading, error, refresh } = useUsers()
  const ownerMap = useHubspotOwnerMap()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])
  const owners = sorted.filter(u => u.app_role === 'owner')
  const members = sorted.filter(u => u.app_role !== 'owner')
  // Schrijven op hubspot_owner_map is owner-only (RLS); UI volgt.
  const isOwner = sorted.some(u => u.user_id === currentUserId && u.app_role === 'owner')
  const rowProps = u => ({
    user: u,
    isSelf: u.user_id === currentUserId,
    onEdit: setEditing,
    ownerId: ownerMap.byUser[u.user_id] || '',
    ownerLabel: ownerMap.ownerLabel,
  })

  const meta = sorted.length > 0 ? (
    <>
      <b>{stats.total}</b> gebruiker{stats.total === 1 ? '' : 's'}
      {stats.live > 0 && <>{' · '}<span className="is-ok">{stats.live} live</span></>}
      {stats.pending > 0 && <>{' · '}<span className="is-warn">{stats.pending} niet geactiveerd</span></>}
    </>
  ) : null

  return (
    <div className="m-dash m-set m-ap m-ap--hasdock">
      <MSetHead back={onBack} backLabel="Organisatie" title="Gebruikers" sub="Wie mag erin en met welke rol." meta={meta}
        titleRight={<button type="button" className="m-ap-refresh" onClick={refresh} disabled={loading} aria-label="Ververs"><MIcon name="refresh" size={17} /></button>} />
      <div className="m-set__body">
        {error && <div className="m-set__errline">⚠ Fout bij ophalen: {error}</div>}
        {!error && loading && sorted.length === 0 && <div className="m-set__empty">Laden…</div>}
        {!error && !loading && sorted.length === 0 && <div className="m-set__empty">Geen gebruikers gevonden.</div>}

        {owners.length > 0 && (
          <MSetGroup label="Owner">
            {owners.map(u => <UserRow key={u.user_id} {...rowProps(u)} />)}
          </MSetGroup>
        )}
        {members.length > 0 && (
          <MSetGroup label={<>Members <span className="m-ap-desk__cnt">{members.length}</span></>}>
            {members.map(u => <UserRow key={u.user_id} {...rowProps(u)} />)}
          </MSetGroup>
        )}

        <p className="m-set__note"><MIcon name="shield" size={18} /><span>Members zien Organisatie niet en geen Tokens/Infra. Eigen mail- en agenda-sync per member komt nog.</span></p>
      </div>

      <div className="m-ap-dock">
        <button type="button" className="m-ap-dock__btn" onClick={() => setShowInvite(true)}>
          <MIcon name="mail" size={18} stroke={2} /> Member uitnodigen
        </button>
      </div>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} onInvited={refresh} />
      <EditUserModal
        open={!!editing} user={editing} currentUserId={currentUserId}
        onClose={() => setEditing(null)} onSaved={refresh}
        ownerMap={ownerMap} canEditOwner={isOwner}
      />
    </div>
  )
}

function UserRow({ user, isSelf, onEdit, ownerId, ownerLabel }) {
  const status = statusFor(user)
  const name = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const lastSeen = user.last_seen_at || user.last_sign_in_at
  const login = status.kind === 'pending' || !lastSeen ? 'nooit ingelogd' : `login ${formatRelative(lastSeen)}`
  return (
    <button type="button" className="m-inset__row m-ap-user" onClick={() => onEdit(user)}>
      <span className={`m-ap-avatar ${user.app_role === 'owner' ? 'm-ap-avatar--owner' : ''}`} aria-hidden>
        {getInitials(name)}
        {status.live && <i className="m-ap-avatar__live" />}
      </span>
      <span className="m-ap-user__main">
        <span className="m-ap-user__name">{name}{isSelf && <span className="m-ap-pill m-ap-pill--self">jij</span>}</span>
        <span className="m-ap-user__sub">{user.email}</span>
        <span className="m-ap-pills">
          <span className={`m-ap-pill ${user.app_role === 'owner' ? 'm-ap-pill--owner' : ''}`}>{user.app_role}</span>
          <span className={`m-ap-pill m-ap-pill--${status.kind}`}><i />{status.label}</span>
          {(user.trusted_device_count || 0) > 0 && (
            <span className="m-ap-pill">{user.trusted_device_count} vertrouwd</span>
          )}
          <span className={`m-ap-pill ${ownerId ? 'm-ap-pill--hs' : 'm-ap-pill--hs-none'}`}>
            {ownerId ? `HS · ${ownerLabel(ownerId)}` : 'HS · niet gekoppeld'}
          </span>
          <span className="m-ap-user__login">{login}</span>
        </span>
      </span>
      <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
    </button>
  )
}
