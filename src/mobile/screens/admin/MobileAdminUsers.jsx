import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useUsers } from '../../../hooks/useUsers'
import { getInitials, statusFor, inviteStateFor, loginStateFor, sortUsers, userStats } from '../../../lib/users'
import EditUserModal from '../../../components/views/settings/pages/users/EditUserModal'
import InviteModal from '../../../components/views/settings/pages/users/InviteModal'
import CreateUserModal from '../../../components/views/settings/pages/users/CreateUserModal'
import { useHubspotOwnerMap } from '../../../hooks/useHubspotOwnerMap'
import MIcon from '../../MIcon'
import { MSetHead, MSetGroup, MSetRow } from '../MobileSettingsBits'

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
// v1.163: aanmaken ≠ uitnodigen, in de A-Rust-vorm. Onder de lijst twee
// gestippelde rijen — "Gebruiker aanmaken" (verstuurt niets) en "Member
// uitnodigen" (verstuurt de mail) — in plaats van een gedockte knoppenbalk.
// Op de kaart een uitnodigings-pill; uitnodigen pér persoon zit in
// EditUserModal, die een rij opent. Zo staat er geen knop op elke member-rij:
// de lijst blijft een lijst.
export default function MobileAdminUsers({ onBack }) {
  const { users, loading, error, refresh } = useUsers()
  const ownerMap = useHubspotOwnerMap()
  const [currentUserId, setCurrentUserId] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [createFor, setCreateFor] = useState(null)
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
      <b>{stats.total}</b> mensen
      {' · '}{stats.owners} owner{stats.owners === 1 ? '' : 's'}
      {' · '}{stats.members} member{stats.members === 1 ? '' : 's'}
      {stats.live > 0 && <>{' · '}<span className="is-ok">{stats.live} nu online</span></>}
      {stats.notInvited > 0 && <>{' · '}<span className="is-warn">{stats.notInvited} nog niet uitgenodigd</span></>}
      {stats.invitedNotLoggedIn > 0 && <>{' · '}<span className="is-warn">{stats.invitedNotLoggedIn} wacht op activatie</span></>}
    </>
  ) : null

  return (
    <div className="m-dash m-set m-ap">
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

        {/* Twee gestippelde rijen onder de lijst — geen knop op elke member.
            De rij zelf zegt wat er gebeurt: aanmaken stuurt niets, uitnodigen
            stuurt de mail. */}
        <section className="m-set__group m-ap-acts">
          <div className="m-inset">
            <MSetRow
              icon="plus"
              title="Gebruiker aanmaken"
              sub="Zet het account klaar — verstuurt geen mail"
              onClick={() => setCreateFor('')}
            />
            <MSetRow
              icon="mail"
              title="Member uitnodigen"
              sub="Stuurt de mail met de set-wachtwoord-link"
              onClick={() => setShowInvite(true)}
            />
          </div>
        </section>

        <p className="m-set__note"><MIcon name="shield" size={18} /><span>Uitnodigen per persoon doe je in de gebruiker zelf (tik de rij). Members zien Organisatie niet en geen Tokens/Infra.</span></p>
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
        open={!!editing} user={editing} currentUserId={currentUserId}
        onClose={() => setEditing(null)} onSaved={refresh}
        ownerMap={ownerMap} canEditOwner={isOwner}
      />
    </div>
  )
}

function UserRow({ user, isSelf, onEdit, ownerId, ownerLabel }) {
  const status = statusFor(user)
  const invite = inviteStateFor(user)
  const loginState = loginStateFor(user)
  const name = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const login = loginState.kind === 'never' ? 'nooit ingelogd' : `login ${loginState.label.toLowerCase()}`
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
          {/* 'Niet nodig' (al ingelogd) zeggen we niet: een pill die meldt dat
              er niets te melden is, is ruis. */}
          {invite.kind !== 'na' && (
            <span className={`m-ap-pill m-ap-pill--invite-${invite.kind}`}>
              {invite.kind === 'sent' ? `uitnodiging ${invite.label.replace('Verstuurd · ', '')}` : 'uitnodiging: nog niet'}
            </span>
          )}
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
