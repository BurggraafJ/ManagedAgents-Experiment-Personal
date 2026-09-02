import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import { callInviteFunction, saveUser, formatDate, formatRelative } from '../../../../../lib/users'
import { revokeTrustedDevices } from '../../../../../lib/mfa'

// Edit- en invite-modal voor Gebruikers. Uit UsersPage.jsx gelicht (v1.128)
// zodat de mobiele Gebruikers-lijst dezelfde flows hergebruikt. Gedrag 1:1.
//
// v1.131 (2FA): "Vertrouwde apparaten" met "Alles intrekken". Eén plek, dus
// zowel de desktop-tabel als de mobiele lijst hebben de noodrem.

export function EditUserModal({ open, user, currentUserId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [revoking, setRevoking] = useState(false)
  const [revokedNow, setRevokedNow] = useState(null)

  useEffect(() => {
    if (open && user) {
      setName(user.display_name || '')
      setRole(user.app_role || 'member')
      setError(null)
      setRevokedNow(null)
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

  const deviceCount = revokedNow !== null ? 0 : (user.trusted_device_count || 0)

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

        <div className="users-form__row">
          <span className="users-form__label">Vertrouwde apparaten ({deviceCount})</span>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            Apparaten waar "Dit apparaat 14 dagen onthouden" is aangevinkt slaan de
            verificatiecode over tot het venster verloopt.
            {user.trusted_device_last_seen && revokedNow === null && (
              <> Laatst gebruikt: {formatRelative(user.trusted_device_last_seen)}.</>
            )}
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 8 }}
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

export function InviteModal({ open, onClose, onInvited }) {
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
      await callInviteFunction({ email: email.trim(), displayName: displayName.trim() })
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
          inloggen en ziet de gedeelde views (Administratie, Contacten,
          Zoeken). Postvak / Agenda / Taken blijven leeg
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
