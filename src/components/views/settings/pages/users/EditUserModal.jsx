import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import {
  inviteUser, canInvite, saveUser,
  formatDate, formatDateTime, formatRelative, inviteStateFor, loginStateFor,
} from '../../../../../lib/users'
import { revokeTrustedDevices } from '../../../../../lib/mfa'

// Bewerk-modal voor Gebruikers. Uit UsersPage.jsx gelicht (v1.128) zodat de
// mobiele Gebruikers-lijst dezelfde flows hergebruikt. Gedrag 1:1.
// (v1.158: InviteModal woont sinds de invite-splitsing in InviteModal.jsx,
// CreateUserModal in CreateUserModal.jsx — bestandscap van 400 regels.)
//
// v1.131 (2FA): "Vertrouwde apparaten" met "Alles intrekken". Eén plek, dus
// zowel de desktop-tabel als de mobiele lijst hebben de noodrem.
//
// v1.136: de HubSpot deal-eigenaar zit hier in plaats van in een aparte
// mapping-tabel onder de lijst. De gebruikerskaart toont het label, dit
// formulier is de plek waar je 'm zet — één keer per gebruiker, niet nog eens
// dezelfde lijst eronder. `ownerMap` is de useHubspotOwnerMap-return; die hook
// draait één keer per pagina en komt via props binnen (pre-flight-regel 4:
// niet dezelfde hook in twee componenten in dezelfde tree).
//
// v1.158 (aanmaken ≠ uitnodigen): het blok "Uitnodiging" hieronder laat zien
// of er ooit gemaild is, en heeft de knop Uitnodigen / Opnieuw sturen. Dat
// is tegelijk de mobiele route naar uitnodigen — daar opent een rij deze modal
// en zit er geen knop op de rij zelf. InviteModal mailt alleen naar een
// bestaand account; een onbekend adres wijst door naar Gebruiker aanmaken.

const ROLE_CHOICES = [
  { value: 'owner', title: 'Owner', sub: 'Volledige toegang, inclusief Organisatie' },
  { value: 'member', title: 'Member', sub: 'Standaard medewerker' },
]

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
    // ownerMap verandert bij elke refresh; alleen op open/user resetten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      // HubSpot-koppeling meeslaan in dezelfde "Opslaan" — schrijven is
      // owner-only (RLS op hubspot_owner_map + canEditOwner in de UI).
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

  // Uitnodigen is een losse handeling, geen onderdeel van Opslaan: één klik,
  // één mail. Daarom hier een eigen knop en niet iets dat in het formulier
  // meelift.
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

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={`Bewerk ${user.email}`} size="md" className="users-modal">
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
          <span className="users-form__label" id="edit-role-label">Rol</span>
          {/* Twee keuzekaarten in plaats van een select (A Rust): op een
              telefoon is een dropdown met twee opties een omweg, en de
              gevolgen van de keuze passen nu naast elkaar op het scherm.
              Zelfde waarden, zelfde self-lockout-slot. */}
          <div className="users-choice" role="radiogroup" aria-labelledby="edit-role-label">
            {ROLE_CHOICES.map(choice => (
              <label
                key={choice.value}
                className={`users-choice__card ${role === choice.value ? 'is-on' : ''}`}
                data-disabled={busy || isSelf ? 'true' : 'false'}
              >
                <input
                  type="radio"
                  name="edit-role"
                  value={choice.value}
                  checked={role === choice.value}
                  onChange={() => setRole(choice.value)}
                  disabled={busy || isSelf}
                />
                <span className="users-choice__title">{choice.title}</span>
                <span className="users-choice__sub">{choice.sub}</span>
              </label>
            ))}
          </div>
          {isSelf ? (
            <div className="users-form__hint" style={{ color: 'var(--warning, #c87f10)' }}>
              Je kunt je eigen rol niet wijzigen (zou je uitsluiten).
            </div>
          ) : (
            <div className="users-form__hint">
              Owners zien admin (Security/Health/Intelligence/Legal AI/Gebruikers) + Tokens/Infra in Settings.
            </div>
          )}
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
                  // Eén eigenaar hoort bij één gebruiker (unique-constraint):
                  // eigenaren die al aan iemand ánders hangen, verbergen we.
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
              {ownerMap.error && <> <span style={{ color: 'var(--error, #b3291f)' }}>Owner-lijst kon niet geladen worden: {ownerMap.error}</span></>}
            </div>
          </div>
        )}

        <div className="users-form__row">
          <span className="users-form__label">Account-info</span>
          <div className="users-form__facts">
            <div><strong>E-mail:</strong> <code>{user.email}</code></div>
            <div><strong>Aangemaakt:</strong> {formatDate(user.created_at)}</div>
            <div title={invite.title}><strong>Uitnodiging:</strong> {invite.label}</div>
            <div title={login.title}><strong>Ingelogd:</strong> {login.label}</div>
            <div><strong>Laatste login:</strong> {formatRelative(user.last_sign_in_at)}</div>
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
            Apparaten waar "Dit apparaat 14 dagen onthouden" is aangevinkt slaan de
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
