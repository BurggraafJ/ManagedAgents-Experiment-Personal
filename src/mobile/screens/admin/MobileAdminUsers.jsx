import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useUsers } from '../../../hooks/useUsers'
import {
  getInitials, statusFor, sortUsers, userStats, canInvite, inviteUser,
} from '../../../lib/users'
import EditUserModal from '../../../components/views/settings/pages/users/EditUserModal'
import InviteModal from '../../../components/views/settings/pages/users/InviteModal'
import CreateUserModal from '../../../components/views/settings/pages/users/CreateUserModal'
import { useHubspotOwnerMap } from '../../../hooks/useHubspotOwnerMap'
import { showToast } from '../../../components/Toast'
import MIcon from '../../MIcon'
import { MSetHead } from '../MobileSettingsBits'
import Modal from '../../../components/ui/Modal'

// Gebruikers (niveau 2) — A Rust (v1.163).
// Groepskoppen OWNERS/MEMBERS, statuswoord rechts, uitnodigen als gestippelde
// rij ónder de lijst, zachte sheets via users-modal. Aanmaken ≠ uitnodigen
// blijft: Aangemaakt / Uitgenodigd / (ingelogd-varianten) + Uitnodigen /
// Opnieuw sturen op de rij én in EditUserModal.
export default function MobileAdminUsers({ onBack }) {
  const { users, loading, error, refresh } = useUsers()
  const ownerMap = useHubspotOwnerMap()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [createFor, setCreateFor] = useState(null)
  const [editing, setEditing] = useState(null)
  const [showInfo, setShowInfo] = useState(false)
  const [invitingId, setInvitingId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data?.user?.id || null))
  }, [])

  const sorted = useMemo(() => sortUsers(users), [users])
  const stats = useMemo(() => userStats(sorted), [sorted])
  const owners = sorted.filter(u => u.app_role === 'owner')
  const members = sorted.filter(u => u.app_role !== 'owner')
  const isOwner = sorted.some(u => u.user_id === currentUserId && u.app_role === 'owner')

  const meta = sorted.length > 0 ? (
    <>
      {stats.total} mensen · {stats.owners} owner{stats.owners === 1 ? '' : 's'} · {stats.members} member{stats.members === 1 ? '' : 's'}
    </>
  ) : null

  const stateLine = sorted.length > 0 ? (
    <p className="m-users-a__state">
      {stats.live > 0 && <><span className="m-users-a__dot" aria-hidden />{stats.live} nu online</>}
      {stats.live > 0 && (stats.notInvited > 0 || stats.invitedNotLoggedIn > 0) && <span className="m-users-a__sep">·</span>}
      {stats.notInvited > 0 && <>{stats.notInvited} aangemaakt</>}
      {stats.notInvited > 0 && stats.invitedNotLoggedIn > 0 && <span className="m-users-a__sep">·</span>}
      {stats.invitedNotLoggedIn > 0 && <>{stats.invitedNotLoggedIn} uitgenodigd</>}
      {stats.live === 0 && stats.notInvited === 0 && stats.invitedNotLoggedIn === 0 && (
        <>{stats.total} ingelogd ooit</>
      )}
    </p>
  ) : null

  async function handleInviteRow(user, e) {
    e?.stopPropagation?.()
    if (!canInvite(user) || invitingId) return
    setInvitingId(user.user_id)
    try {
      await inviteUser(user)
      const again = !!user.invite_sent_at
      showToast({
        kind: 'success',
        message: again
          ? `Uitnodiging opnieuw verstuurd naar ${user.email}`
          : `Uitnodiging verstuurd naar ${user.email}`,
      })
      refresh()
    } catch (err) {
      showToast({ kind: 'error', message: 'Uitnodigen mislukt', detail: err.message || String(err) })
    } finally {
      setInvitingId(null)
    }
  }

  return (
    <div className="m-dash m-set m-ap m-users-a">
      <MSetHead
        back={onBack}
        backLabel="Organisatie"
        title="Gebruikers"
        meta={meta}
        titleRight={(
          <button type="button" className="m-ap-refresh" onClick={refresh} disabled={loading} aria-label="Ververs">
            <MIcon name="refresh" size={17} />
          </button>
        )}
      >
        {stateLine}
      </MSetHead>

      <div className="m-set__body">
        {error && <div className="m-set__errline">⚠ Fout bij ophalen: {error}</div>}
        {!error && loading && sorted.length === 0 && <div className="m-set__empty">Laden…</div>}
        {!error && !loading && sorted.length === 0 && (
          <div className="m-set__empty">Geen gebruikers. Maak er eerst één aan, nodig daarna uit.</div>
        )}

        {owners.length > 0 && (
          <section className="m-users-a__group">
            <div className="m-users-a__glabel">Owners <i>{owners.length}</i></div>
            <div className="m-users-a__card">
              {owners.map(u => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === currentUserId}
                  onEdit={setEditing}
                  onInvite={handleInviteRow}
                  inviting={invitingId === u.user_id}
                />
              ))}
            </div>
          </section>
        )}

        {members.length > 0 && (
          <section className="m-users-a__group">
            <div className="m-users-a__glabel">Members <i>{members.length}</i></div>
            <div className="m-users-a__card">
              {members.map(u => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  isSelf={u.user_id === currentUserId}
                  onEdit={setEditing}
                  onInvite={handleInviteRow}
                  inviting={invitingId === u.user_id}
                />
              ))}
            </div>
          </section>
        )}

        <button type="button" className="m-users-a__invite" onClick={() => setShowInvite(true)}>
          <MIcon name="mail" size={18} /> Member uitnodigen
        </button>
        <button type="button" className="m-users-a__create" onClick={() => setCreateFor('')}>
          <MIcon name="plus" size={16} /> Gebruiker aanmaken <span>(geen mail)</span>
        </button>

        <button type="button" className="m-users-a__info" onClick={() => setShowInfo(true)}>
          <MIcon name="shield" size={17} />
          <span>Wat een member wel en niet ziet</span>
          <span className="m-users-a__chev"><MIcon name="chevron" size={15} /></span>
        </button>
      </div>

      <InviteModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        onInvited={refresh}
        onCreateFirst={(email) => { setShowInvite(false); setCreateFor(email) }}
      />
      <CreateUserModal
        open={createFor !== null}
        initialEmail={createFor || ''}
        onClose={() => setCreateFor(null)}
        onCreated={refresh}
      />
      <EditUserModal
        open={!!editing}
        user={editing}
        currentUserId={currentUserId}
        onClose={() => setEditing(null)}
        onSaved={refresh}
        ownerMap={ownerMap}
        canEditOwner={isOwner}
      />
      <Modal open={showInfo} onClose={() => setShowInfo(false)} title="Wat ziet een member?" size="md" className="users-modal">
        <ul className="users-info__list">
          <li><strong>Wel zichtbaar:</strong> Dashboard · Zoeken · Administratie (HubSpot — gedeeld) · Contacten · Postvak / Agenda (eigen, na Connectors-koppeling) · Taken.</li>
          <li><strong>Niet zichtbaar:</strong> Organisatie (Gebruikers · Health · Security · Skills · Intelligence · Legal AI) en Tokens + Infrastructuur.</li>
          <li><strong>RLS-isolatie:</strong> de member ziet 0 rijen van jouw mail / agenda / taken — alles filtert op <code>user_id = auth.uid()</code>.</li>
        </ul>
        <Modal.Footer>
          <button type="button" className="btn" onClick={() => setShowInfo(false)}>Sluiten</button>
        </Modal.Footer>
      </Modal>
    </div>
  )
}

function UserRow({ user, isSelf, onEdit, onInvite, inviting }) {
  const status = statusFor(user)
  const name = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const inviteAllowed = canInvite(user)
  const pendingLook = status.kind === 'created' || status.kind === 'pending'
  return (
    <div className="m-users-a__row">
      <button type="button" className="m-users-a__rowmain" onClick={() => onEdit(user)}>
        <span
          className={[
            'm-users-a__av',
            user.app_role === 'owner' ? 'm-users-a__av--owner' : '',
            pendingLook ? 'm-users-a__av--pending' : '',
          ].filter(Boolean).join(' ')}
          aria-hidden
        >
          {getInitials(name)}
          {status.live && <i className="m-users-a__live" />}
        </span>
        <span className="m-users-a__txt">
          <span className="m-users-a__name">
            {name}
            {isSelf && <em>jij</em>}
          </span>
          <span className="m-users-a__mail">{user.email}</span>
        </span>
        <span className={`m-users-a__st m-users-a__st--${status.kind}`}>{status.label}</span>
        <span className="m-users-a__chev" aria-hidden><MIcon name="chevron" size={16} /></span>
      </button>
      {inviteAllowed && (
        <button
          type="button"
          className={`m-users-a__mailbtn${status.kind === 'pending' ? ' is-resend' : ''}`}
          onClick={(e) => onInvite(user, e)}
          disabled={inviting}
          title={status.kind === 'pending'
            ? 'Stuur de set-wachtwoord-mail opnieuw'
            : 'Stuur nu de uitnodigingsmail — tot dan weet deze gebruiker niets van het account'}
        >
          <MIcon name="mail" size={16} />
          <span>{inviting ? '…' : status.kind === 'pending' ? 'Opnieuw' : 'Uitnodigen'}</span>
        </button>
      )}
    </div>
  )
}
