import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import {
  inviteUser, canInvite, saveUser, getInitials, statusFor,
  formatDate, formatDateTime, formatRelative, inviteStateFor, loginStateFor,
} from '../../../../../lib/users'
import { revokeTrustedDevices } from '../../../../../lib/mfa'
import RoleCards from './RoleCards'

// Bewerk-modal voor Gebruikers — gedeeld desktop + mobiel.
// v1.158: aanmaken ≠ uitnodigen (Uitnodigen / Opnieuw sturen hier).
// v1.163 (A Rust): rol als twee keuzekaarten; person-kop; account toont
// Aangemaakt · Uitnodiging · Ingelogd los van elkaar.

export default function EditUserModal({ open, user, currentUserId, onClose, onSaved, ownerMap, canEditOwner = false }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('member')
  const [ownerId, setOwnerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const [revokedNow, setRevokedNow] = useState(null)
  const [inviting, setInviting] = useState(false)
  const [invitedNow, setInvitedNow] = useState(null)

  const initialOwnerId = (user && ownerMap?.byUser?.[user.user_id]) || ''

  useEffect(() => {
    if (open && user) {
      setName(user.display_name || '')
      setRole(user.app_role || 'member')
      setOwnerId((ownerMap?.byUser?.[user.user_id]) || '')
      setError(null)
      setRevokedNow(null)
      setInvitedNow(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user])

  if (!user) return null
  const isSelf = currentUserId && user.user_id === currentUserId

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    try {
      const effectiveRole = isSelf ? user.app_role : role
      await saveUser({ userId: user.user_id, displayName: name, role: effectiveRole })
      if (canEditOwner && ownerMap && ownerId !== initialOwnerId) {
        const res = await ownerMap.setOwnerFor(user.user_id, ownerId || null)
        if (!res.ok) throw new Error(`HubSpot-eigenaar niet opgeslagen: ${res.error}`)
      }
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

  async function handleRevokeDevices() {
    setRevoking(true)
    try {
      const n = await revokeTrustedDevices(user.user_id)
      setRevokedNow(n)
      showToast({
        kind: 'success',
        message: n > 0
          ? `${n} vertrouwd apparaat${n === 1 ? '' : 'en'} ingetrokken`
          : 'Er stonden geen vertrouwde apparaten open',
      })
      onSaved?.()
    } catch (err) {
      showToast({ kind: 'error', message: 'Intrekken mislukt', detail: err.message || String(err) })
    } finally {
      setRevoking(false)
    }
  }

  async function handleInvite() {
    setInviting(true)
    try {
      const res = await inviteUser(user)
      setInvitedNow(res.invite_sent_at || new Date().toISOString())
      showToast({ kind: 'success', message: `Uitnodiging verstuurd naar ${user.email}` })
      onSaved?.()
    } catch (err) {
      showToast({ kind: 'error', message: 'Uitnodigen mislukt', detail: err.message || String(err) })
    } finally {
      setInviting(false)
    }
  }

  const deviceCount = revokedNow !== null ? 0 : (user.trusted_device_count || 0)
  const invite = inviteStateFor(invitedNow ? { ...user, invite_sent_at: invitedNow } : user)
  const login = loginStateFor(user)
  const inviteAllowed = canInvite(user)
  const status = statusFor(invitedNow ? { ...user, invite_sent_at: invitedNow } : user)
  const displayName = user.display_name || user.email?.split('@')[0] || 'Onbekend'

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Lid bewerken" size="md" className="users-modal users-modal--edit">
      <form className="users-form" onSubmit={handleSubmit}>
        <div className="users-person">
          <span className={`users-person__av${user.app_role === 'owner' ? ' is-owner' : ''}`} aria-hidden>
            {getInitials(displayName)}
            {status.live && <i />}
          </span>
          <span className="users-person__txt">
            <span className="users-person__name">{displayName}</span>
            <span className="users-person__mail">{user.email}</span>
          </span>
          <span className={`user-pill user-pill--${status.kind}`}>
            <span className="user-pill__dot" />
            {status.label}
          </span>
        </div>

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
          <div className="users-form__hint">Hoe deze persoon in de app verschijnt.</div>
        </div>

        <div className="users-form__row">
<span className="users-form__label">Rol</span>
          <RoleCards value={role} onChange={setRole} locked={!!isSelf} disabled={busy} />
        </div>

        {ownerMap && (
          <div className="users-form__row">
            <label className="users-form__label" htmlFor="edit-hsowner">HubSpot deal-eigenaar</label>
            {canEditOwner ? (
              <select
                id="edit-hsowner"
                className="users-form__select"
                value={ownerId}
                onChange={e => setOwnerId(e.target.value)}
                disabled={busy || ownerMap.loading}
              >
                <option value="">— niet gekoppeld —</option>
                {ownerMap.owners
                  .filter(o => !ownerMap.takenBy[o.hubspot_owner_id] || ownerMap.takenBy[o.hubspot_owner_id] === user.user_id)
                  .map(o => (
                    <option key={o.hubspot_owner_id} value={o.hubspot_owner_id}>
                      {ownerMap.ownerLabel(o.hubspot_owner_id)}{o.email ? ` · ${o.email}` : ''}{o.active === false ? ' (inactief)' : ''}
                    </option>
                  ))}
              </select>
            ) : (
              <div className="users-form__facts">
                {ownerId ? ownerMap.ownerLabel(ownerId) : 'Niet gekoppeld'}
              </div>
            )}
            <div className="users-form__hint">
              {canEditOwner
                ? 'Waar de app deals aan deze gebruiker toeschrijft. HubSpot blijft één gedeelde koppeling voor de hele organisatie — dit koppelt alleen de identiteit.'
                : 'Alleen een owner kan de HubSpot-koppeling wijzigen.'}
              {ownerMap.error && <> <span className="users-form__errinline">Owner-lijst kon niet geladen worden: {ownerMap.error}</span></>}
            </div>
          </div>
        )}

        <div className="users-form__row users-form__row--account">
          <span className="users-form__label">Account</span>
          <div className="users-account">
            <div className="users-account__row">
              <span>Status</span>
              <span className={`user-pill user-pill--${status.kind}`}><span className="user-pill__dot" />{status.label}</span>
            </div>
            <div className="users-account__row"><span>E-mail</span><span>{user.email}</span></div>
            <div className="users-account__row"><span>Aangemaakt</span><span>{formatDate(user.created_at)}</span></div>
            <div className="users-account__row" title={invite.title}><span>Uitnodiging</span><span>{invite.label}</span></div>
            <div className="users-account__row" title={login.title}><span>Ingelogd</span><span>{login.label}</span></div>
            <div className="users-account__row"><span>Laatste activiteit</span><span>{formatRelative(user.last_seen_at || user.last_sign_in_at)}</span></div>
          </div>
        </div>

        {inviteAllowed && (
          <div className="users-form__row">
            <span className="users-form__label">Uitnodiging</span>
            <div className="users-form__facts">
              {invite.kind === 'sent'
                ? <>Verstuurd op {formatDateTime(invitedNow || user.invite_sent_at)}. Nog niet ingelogd — opnieuw sturen stuurt een nieuwe set-wachtwoord-link.</>
                : <>Er is nog niets verstuurd. Deze gebruiker weet nog niet dat het account bestaat.</>}
            </div>
            <button
              type="button"
              className={`btn btn--spaced ${invite.kind === 'sent' ? '' : 'btn--accent'}`}
              onClick={handleInvite}
              disabled={inviting || busy}
            >
              {inviting ? 'Versturen…' : invite.kind === 'sent' ? 'Opnieuw sturen' : 'Uitnodigen'}
            </button>
            <div className="users-form__hint">
              Dit is de enige plek waar een mail de deur uit gaat. Aanmaken doet dat niet.
            </div>
          </div>
        )}

        <div className="users-form__row">
          <span className="users-form__label">Vertrouwde apparaten ({deviceCount})</span>
          <div className="users-form__facts">
            Apparaten waar &quot;Dit apparaat 14 dagen onthouden&quot; is aangevinkt slaan de
            verificatiecode over tot het venster verloopt.
            {user.trusted_device_last_seen && revokedNow === null && (
              <> Laatst gebruikt: {formatRelative(user.trusted_device_last_seen)}.</>
            )}
          </div>
          <button
            type="button"
            className="btn btn--spaced"
            onClick={handleRevokeDevices}
            disabled={revoking || busy || deviceCount === 0}
          >
            {revoking ? 'Intrekken…' : 'Alles intrekken'}
          </button>
          <div className="users-form__hint">
            Bij een verloren laptop: intrekken dwingt bij de volgende keer weer een code af.
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
