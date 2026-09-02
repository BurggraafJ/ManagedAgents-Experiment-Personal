import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useUsers } from '../../../hooks/useUsers'
import { getInitials, formatRelative, statusFor, sortUsers, userStats } from '../../../lib/users'
import { EditUserModal, InviteModal } from '../../../components/views/settings/pages/users/UserModals'
import MIcon from '../../MIcon'
import { MSetHead, MSetGroup } from '../MobileSettingsBits'

// Gebruikers (niveau 2) — mobiele lijst rond dezelfde data (useUsers) en
// dezelfde flows (EditUserModal / InviteModal) als de desktop UsersPage.
// Owner/Members als inset-groepen; "Member uitnodigen" gedockt boven de
// tabbar (fixed-inset patroon, v1.123).
export default function MobileAdminUsers({ onBack }) {
  const { users, loading, error, refresh } = useUsers()
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

  return (
    <div className="m-dash m-set m-ap m-ap--hasdock">
      <MSetHead back={onBack} backLabel="Admin" title="Gebruikers" sub="Wie mag erin en met welke rol." />
      <div className="m-set__body">
        {sorted.length > 0 && (
          <div className="m-ap-stats">
            <div className="m-ap-stat"><div className="m-ap-stat__lbl">Totaal</div><div className="m-ap-stat__val">{stats.total}</div></div>
            <div className="m-ap-stat"><div className="m-ap-stat__lbl">Live</div><div className={`m-ap-stat__val ${stats.live > 0 ? 'm-ap-stat__val--ok' : ''}`}>{stats.live > 0 && <i className="m-ap-livedot" />}{stats.live}</div></div>
            <div className="m-ap-stat"><div className="m-ap-stat__lbl">Niet actief</div><div className={`m-ap-stat__val ${stats.pending > 0 ? 'm-ap-stat__val--warn' : ''}`}>{stats.pending}</div></div>
          </div>
        )}

        {error && <div className="m-set__errline">⚠ Fout bij ophalen: {error}</div>}
        {!error && loading && sorted.length === 0 && <div className="m-set__empty">Laden…</div>}
        {!error && !loading && sorted.length === 0 && <div className="m-set__empty">Geen gebruikers gevonden.</div>}

        {owners.length > 0 && (
          <MSetGroup label="Owner">
            {owners.map(u => <UserRow key={u.user_id} user={u} isSelf={u.user_id === currentUserId} onEdit={setEditing} />)}
          </MSetGroup>
        )}
        {members.length > 0 && (
          <MSetGroup label={<>Members <span className="m-ap-desk__cnt">{members.length}</span></>}>
            {members.map(u => <UserRow key={u.user_id} user={u} isSelf={u.user_id === currentUserId} onEdit={setEditing} />)}
          </MSetGroup>
        )}

        <p className="m-set__note"><MIcon name="shield" size={18} /><span>Members zien geen Admin en geen Tokens/Infra. Eigen mail- en agenda-sync per member is nog niet gebouwd.</span></p>
      </div>

      <div className="m-ap-dock">
        <button type="button" className="m-ap-dock__btn" onClick={() => setShowInvite(true)}>
          <MIcon name="mail" size={18} stroke={2} /> Member uitnodigen
        </button>
      </div>

      <InviteModal open={showInvite} onClose={() => setShowInvite(false)} onInvited={refresh} />
      <EditUserModal open={!!editing} user={editing} currentUserId={currentUserId} onClose={() => setEditing(null)} onSaved={refresh} />
    </div>
  )
}

function UserRow({ user, isSelf, onEdit }) {
  const status = statusFor(user)
  const name = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const lastSeen = user.last_seen_at || user.last_sign_in_at
  return (
    <button type="button" className="m-inset__row m-ap-user" onClick={() => onEdit(user)}>
      <span className={`m-ap-avatar ${user.app_role === 'owner' ? 'm-ap-avatar--owner' : ''}`} aria-hidden>
        {getInitials(name)}
        {status.live && <i className="m-ap-avatar__live" />}
      </span>
      <span className="m-ap-user__main">
        <span className="m-ap-user__name">{name}{isSelf && <span className="m-ap-pill m-ap-pill--self">jij</span>}</span>
        <span className="m-ap-user__sub">{user.email} · {status.kind === 'pending' || !lastSeen ? 'nooit ingelogd' : formatRelative(lastSeen)}</span>
        <span className="m-ap-pills">
          <span className={`m-ap-pill ${user.app_role === 'owner' ? 'm-ap-pill--owner' : ''}`}>{user.app_role}</span>
          <span className={`m-ap-pill m-ap-pill--${status.kind}`}><i />{status.label}</span>
        </span>
      </span>
      <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
    </button>
  )
}
