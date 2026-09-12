import { useEffect, useState } from 'react'
import Modal from '../../../../ui/Modal'
import { showToast } from '../../../../Toast'
import { sendInvite } from '../../../../../lib/users'

// Member uitnodigen — v1.158, aanmaken ≠ uitnodigen.
//
// Deze modal verstuurt de mail, en alleen dat: het account moet al bestaan.
// Kent de edge function het adres niet, dan komt er code 'create-first' terug
// en wijzen we door naar Gebruiker aanmaken in plaats van hier stil een
// account aan te maken — dat was precies de vermenging die weg moest.
export default function InviteModal({ open, onClose, onInvited, onCreateFirst }) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Adres bestaat nog niet: dan is dit geen fout maar een verkeerde volgorde.
  // We wijzen door naar Gebruiker aanmaken in plaats van hier stil een account
  // aan te maken — dat is precies de vermenging die we kwijt wilden.
  const [needsCreate, setNeedsCreate] = useState(null)

  // Reset bij open/close zodat oude state niet blijft hangen.
  useEffect(() => {
    if (!open) { setEmail(''); setDisplayName(''); setError(null); setBusy(false); setNeedsCreate(null) }
  }, [open])

  function handleClose() {
    if (busy) return
    onClose?.()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null); setNeedsCreate(null); setBusy(true)
    const address = email.trim().toLowerCase()
    try {
      await sendInvite({ email: address, displayName: displayName.trim() })
      showToast({ kind: 'success', message: `Uitnodiging verstuurd naar ${address}` })
      onInvited?.()
      // Modal sluit automatisch — geen vasthouden meer voor "ack". Reset gebeurt
      // via de useEffect hierboven zodra open=false.
      onClose?.()
    } catch (err) {
      if (err.code === 'create-first' || err.code === 'user-not-found') {
        setNeedsCreate(address)
      } else {
        setError(err.message || String(err))
        showToast({ kind: 'error', message: 'Uitnodigen mislukt', detail: err.message || String(err) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Member uitnodigen" size="md" className="users-modal">
      <form className="users-form" onSubmit={handleSubmit}>
        <div className="users-form__notice">
          <strong>Nu gaat er een mail uit.</strong> De member krijgt een link om
          zijn wachtwoord te zetten. Daarna kan hij inloggen en ziet hij de
          gedeelde views (Administratie, Contacten, Zoeken); voor Postvak en
          Agenda opent hij Instellingen → Connectors → Koppelen (Microsoft). De
          uitnodiging start zelf geen OAuth.
        </div>

        <div className="users-form__row">
          <label className="users-form__label" htmlFor="invite-email">E-mailadres</label>
          <input
            id="invite-email"
            type="email"
            required
            className="users-form__input"
            value={email}
            onChange={e => { setEmail(e.target.value); setNeedsCreate(null) }}
            placeholder="collega@legal-mind.nl"
            disabled={busy}
            autoFocus
            autoComplete="off"
            inputMode="email"
          />
          <div className="users-form__hint">
            Moet een bestaand account zijn. Nog niet aangemaakt? Gebruik eerst
            Gebruiker aanmaken.
          </div>
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
          <div className="users-form__hint">Alleen gebruikt als er nog geen naam bij dit account staat.</div>
        </div>

        {needsCreate && (
          <div className="users-form__notice users-form__notice--warn">
            <strong>{needsCreate} heeft nog geen account.</strong> Uitnodigen
            kan alleen naar een bestaande gebruiker. Maak hem eerst aan — dat
            verstuurt niets — en nodig hem daarna uit.
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => { onCreateFirst?.(needsCreate); onClose?.() }}
              >
                Gebruiker aanmaken
              </button>
            </div>
          </div>
        )}

        {error && <div className="users-form__notice users-form__notice--error">{error}</div>}

        <Modal.Footer>
          <button type="button" className="btn" onClick={handleClose} disabled={busy}>
            Annuleren
          </button>
          <button type="submit" className="btn btn--accent" disabled={busy || !email.trim()}>
            {busy ? 'Uitnodigen…' : 'Verstuur uitnodiging'}
          </button>
        </Modal.Footer>
      </form>
    </Modal>
  )
}
