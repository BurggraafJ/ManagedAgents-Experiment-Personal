import {
  getInitials, formatDate, formatDateTime, formatRelative,
  statusFor, inviteStateFor, loginStateFor, canInvite,
} from '../../../../../lib/users'

// Eén rij in de gebruikerstabel. Uit UsersPage.jsx gelicht bij de
// invite-splitsing (v1.158) — de rij kreeg er twee kolommen bij en de pagina
// zat tegen de bestandscap van 400 regels aan.
//
// De drie statussen staan bewust náást elkaar in plaats van samengevat:
//   • Status       — de oude gelaagde pill (geblokkeerd / live / actief / …),
//                    nu met 'Aangemaakt' voor wie nooit is uitgenodigd.
//   • Uitnodiging  — is er ooit een mail verstuurd, en wanneer.
//   • Ingelogd     — nog nooit, nu online, of hoe lang geleden. Met de
//                    aanmaakdatum eronder, want "aangemaakt" is de enige
//                    zekerheid die elke rij heeft.

const Icon = (paths, size = 14) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const EditIcon = Icon(<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" /></>)
const MailIcon = Icon(<><path d="M4 6l8 6 8-6" /><rect x="3" y="5" width="18" height="14" rx="2" /></>)

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

export default function UserRow({ user, isSelf, onEdit, onInvite, inviting, ownerId, ownerLabel, ownerLoading }) {
  const status = statusFor(user)
  const invite = inviteStateFor(user)
  const login = loginStateFor(user)
  const displayName = user.display_name || user.email?.split('@')[0] || 'Onbekend'
  const lastSeen = user.last_seen_at || user.last_sign_in_at
  const statusTitle =
    status.kind === 'live'    ? `${user.active_sessions_count} actieve sessie${user.active_sessions_count === 1 ? '' : 's'}` :
    status.kind === 'created' ? 'Account bestaat, maar er is nooit een uitnodiging verstuurd' :
    status.kind === 'pending' ? 'Uitnodiging verstuurd, nog geen eerste login' :
    status.kind === 'banned'  ? `Geblokkeerd t/m ${formatDate(user.banned_until)}` :
    `Laatste activiteit: ${formatRelative(lastSeen)}`
  const inviteAllowed = canInvite(user)
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
            className="user-pill user-pill--spaced"
            title="Apparaten die de verificatiecode overslaan (14-dagenvenster). Intrekken via Bewerken."
          >
            {user.trusted_device_count} vertrouwd
          </span>
        )}
      </td>
      <td>
        <span className={`user-pill user-pill--invite-${invite.kind}`} title={invite.title}>
          <span className="user-pill__dot" />
          {invite.label}
        </span>
      </td>
      <td>
        <div className="users-cell-stack">
          <span className={`users-cell-stack__main ${login.kind === 'never' ? 'is-muted' : ''}`} title={login.title}>
            {login.label}
          </span>
          <span className="users-cell-stack__sub" title={`Account aangemaakt op ${formatDateTime(user.created_at)}`}>
            aangemaakt {formatDate(user.created_at)}
          </span>
        </div>
      </td>
      <td>
        <HubspotOwnerPill ownerId={ownerId} ownerLabel={ownerLabel} loading={ownerLoading} />
      </td>
      <td>
        <div className="users-actions">
          {inviteAllowed && (
            <button
              type="button"
              className={`admin-btn admin-btn--sm ${invite.kind === 'sent' ? '' : 'admin-btn--primary'}`}
              onClick={() => onInvite(user)}
              disabled={inviting === user.user_id}
              title={invite.kind === 'sent'
                ? 'Stuur de set-wachtwoord-mail nogmaals naar dit adres'
                : 'Stuur nu de uitnodigingsmail — tot dan weet deze gebruiker niets van het account'}
            >
              {MailIcon} {inviting === user.user_id
                ? 'Versturen…'
                : invite.kind === 'sent' ? 'Opnieuw uitnodigen' : 'Uitnodigen'}
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
