import { useState } from 'react'
import Modal from '../../../ui/Modal'
import styles from '../autodraft.module.css'

// v3 (2026-05-26): optionele target_folder dropdown wanneer askTargetFolder=true.
// Toekomstige matches op deze rule worden automatisch naar deze map verplaatst
// door auto-draft-execute pass A (skip-by-rule-batch).
const TARGET_FOLDER_PRESETS = [
  { value: 'Archief/Overig',         label: 'Archief / Overig' },
  { value: 'Archief/Notificaties',   label: 'Archief / Notificaties' },
  { value: 'Archief/Nieuwsbrieven',  label: 'Archief / Nieuwsbrieven' },
  { value: 'Archief/Teams',          label: 'Archief / Teams' },
]

export default function ReasonModal({ opts, onCancel, onConfirm }) {
  const [text, setText] = useState('')
  const [pattern, setPattern] = useState('')
  const [targetFolder, setTargetFolder] = useState('Archief/Overig')
  const askPattern = !!opts.askPattern
  const askTargetFolder = !!opts.askTargetFolder
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

      {askTargetFolder && (
        <>
          <label className={styles.modalLabel} style={{ marginTop: 12 }}>
            Verplaats toekomstige matches naar
          </label>
          <select
            value={targetFolder}
            onChange={e => setTargetFolder(e.target.value)}
            className={styles.modalInput}
            style={{ marginBottom: 4 }}
          >
            {TARGET_FOLDER_PRESETS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <p className={styles.modalIntro} style={{ marginTop: 4, fontSize: '0.85em', opacity: 0.7 }}>
            Volgende keer dat een mail matcht op je regel, gaat hij automatisch naar deze map.
          </p>
        </>
      )}

      <Modal.Footer>
        <button type="button" onClick={onCancel} className={styles.modalBtn}>
          Annuleer
        </button>
        <button
          type="button"
          onClick={() => onConfirm({ text, pattern: pattern.trim(), targetFolder })}
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
