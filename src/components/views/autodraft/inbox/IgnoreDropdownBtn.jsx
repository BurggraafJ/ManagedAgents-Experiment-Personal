import { useState, useRef, useEffect } from 'react'
import DropdownItem from './DropdownItem'
import ReasonModal from '../modals/ReasonModal'
import styles from '../autodraft.module.css'

export default function IgnoreDropdownBtn({ mail, busy, onIgnore, onIgnoreWithRule, onMarkProcessed }) {
  const [open, setOpen] = useState(false)
  const [reasonModal, setReasonModal] = useState(null)
  const ref = useRef(null)
  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  const fromEmail = mail.from_email || ''

  function openWithReason(opts) {
    setOpen(false)
    setReasonModal(opts)
  }

  return (
    <div ref={ref} className={styles.inlineRelWrap}>
      <button type="button" disabled={!!busy}
        onClick={() => setOpen(v => !v)}
        className="ot-btn"
        title="Afhandelen — kies hoe">
        <span className="ot-btn__icon" aria-hidden>📂</span>
        <span className="ot-btn__label">{busy === 'ignore' ? 'Bezig…' : 'Afhandelen ▾'}</span>
      </button>
      {open && (
        <div className={styles.dropdownPanel}>
          <DropdownItem
            icon="📂"
            title="Afhandelen"
            subtitle="Verplaats naar gekozen map — geen leerregel."
            onClick={() => { setOpen(false); onIgnore() }}
          />
          <DropdownItem
            icon="✏"
            title="Afhandelen + eigen leerregel"
            subtitle="Typ zelf wat in dit type mail zit (bv. 'teams meeting'). Skill leert dit te skippen."
            onClick={() => openWithReason({
              pattern_type: 'subject_keyword',
              pattern_value: '',
              reason_kind: 'unwanted',
              prompt: 'Wat zit er in deze mails dat je voortaan wil overslaan? (deel van onderwerp of inhoud, bv. "teams meeting" of "uitnodiging")',
              askPattern: true,
            })}
          />
          <DropdownItem
            icon="👥"
            title="Afgehandeld door collega"
            subtitle="Logt alleen — geen leerregel."
            onClick={() => openWithReason({
              pattern_type: 'sender',
              pattern_value: fromEmail,
              reason_kind: 'handled_by_colleague',
              prompt: 'Welke collega heeft hem opgepakt? (optioneel — wordt alleen gelogd)',
              skipPattern: true,
            })}
          />
        </div>
      )}
      {reasonModal && (
        <ReasonModal
          opts={reasonModal}
          onCancel={() => setReasonModal(null)}
          onConfirm={async (extra) => {
            setReasonModal(null)
            await onIgnoreWithRule({
              pattern_type: reasonModal.pattern_type,
              pattern_value: reasonModal.skipPattern ? null : (extra.pattern || reasonModal.pattern_value),
              reason_kind: reasonModal.reason_kind,
              reason: extra.text,
            })
          }}
        />
      )}
    </div>
  )
}
