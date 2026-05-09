import { useState } from 'react'
import Modal from '../../../ui/Modal'
import styles from '../autodraft.module.css'

export default function ReasonModal({ opts, onCancel, onConfirm }) {
  const [text, setText] = useState('')
  const [pattern, setPattern] = useState('')
  const askPattern = !!opts.askPattern
  const canSubmit = askPattern ? pattern.trim().length >= 2 : true
  const title = opts.skipPattern ? '👥 Afgehandeld door collega'
              : askPattern        ? '✏ Eigen leerregel'
              : '🚫 Leerregel toevoegen'

  return (
    <Modal open onClose={onCancel} title={title} size="md">
      <p className={styles.modalIntro}>{opts.prompt}</p>

      {askPattern && (
        <>
          <label className={styles.modalLabel}>
            Sleutelwoord in onderwerp / inhoud
          </label>
          <input
            type="text"
            value={pattern}
            onChange={e => setPattern(e.target.value)}
            autoFocus
            placeholder="bv. teams meeting, uitnodiging, factuur"
            className={styles.modalInput}
            style={{ marginBottom: 12 }}
          />
        </>
      )}

      <label className={styles.modalLabel}>
        Toelichting {askPattern ? '(optioneel)' : ''}
      </label>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        autoFocus={!askPattern}
        rows={3}
        placeholder={opts.skipPattern
          ? 'bv. "Mark heeft hem opgepakt"'
          : askPattern
            ? 'bv. "is een teams meeting, wil ik niet meer hebben"'
            : 'Korte uitleg waarom (wordt later getoond bij Regels)…'}
        className={styles.modalTextarea}
      />

      <Modal.Footer>
        <button type="button" onClick={onCancel} className={styles.modalBtn}>
          Annuleer
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ text, pattern: pattern.trim() })}
          disabled={!canSubmit}
          className={styles.modalBtnPrimary}
          style={{
            background: canSubmit ? 'var(--accent)' : '#9CC2E5',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
            fontWeight: 600,
          }}
        >
          {opts.skipPattern ? 'Afhandelen' : 'Afhandelen + onthoud'}
        </button>
      </Modal.Footer>
    </Modal>
  )
}
