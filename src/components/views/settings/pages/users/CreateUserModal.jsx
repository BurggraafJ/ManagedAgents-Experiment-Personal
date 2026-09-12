import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import { createUserAccount } from '../../../../../lib/users'

// Gebruiker aanmaken — v1.158, aanmaken ≠ uitnodigen.
//
// Deze modal maakt het account aan en verstuurt met opzet GEEN mail: de
// gebruiker weet er daarna nog niets van. Uitnodigen is een tweede, expliciete
// klik (knop Uitnodigen in de lijst, of "Member uitnodigen" in de kop).
//
// Er staat hier dus nergens een invite-call, en die hoort er ook niet bij te
// komen: zodra aanmaken weer mailt, staat er een mail in iemands inbox voordat
// de owner daar klaar voor is.
export default function CreateUserModal({ open, onClose, onCreated, initialEmail = '' }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) { setEmail(initialEmail || ''); setError(null); setBusy(false) }
    else { setEmail(''); setDisplayName(''); setError(null); setBusy(false) }
  }, [open, initialEmail])

  function handleClose() {
    if (busy) return
    onClose?.()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setBusy(true)
    const address = email.trim().toLowerCase()
    try {
      await createUserAccount({ email: address, displayName: displayName.trim() })
      showToast({
        kind: 'success',
        message: `${displayName.trim() || address} aangemaakt`,
        detail: 'Er is geen mail verstuurd. Klik Uitnodigen zodra hij erin mag.',
      })
      onCreated?.()
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
      showToast({ kind: 'error', message: 'Aanmaken mislukt', detail: err.message || String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Gebruiker aanmaken" size="md" className="users-modal">
      <form className="users-form" onSubmit={handleSubmit}>
        <div className="users-form__notice">
          <strong>Zonder mail.</strong> Het account staat klaar — met de rol
          member — maar er gaat niets de deur uit. De gebruiker kan pas inloggen
          nadat je hem uitnodigt; dan krijgt hij een link om zijn wachtwoord te
          zetten.
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="create-email">E-mailadres</label>
          <input
            id="create-email"
            type="email"
            required
            className="users-form__input"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="collega@legal-mind.nl"
            disabled={busy}
            autoFocus
            autoComplete="off"
            inputMode="email"
          />
          <div className="users-form__hint">Krijgt nu nog geen mail.</div>
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="create-name">Naam (optioneel)</label>
          <input
            id="create-name"
            type="text"
            className="users-form__input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Naam Collega"
            disabled={busy}
            autoComplete="off"
          />
          <div className="users-form__hint">Hoe deze gebruiker in de lijst verschijnt.</div>
        </div>

        {error && <div className="users-form__notice users-form__notice--error">{error}</div>}

        <Modal.Footer>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy || !email.trim()}>
            {busy ? 'Aanmaken…' : 'Aanmaken (geen mail)'}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
