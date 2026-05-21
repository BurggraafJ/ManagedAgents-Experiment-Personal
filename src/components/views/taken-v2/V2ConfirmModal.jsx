import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import styles from './taken-v2.module.css'

/**
 * Eigen confirm-modal met portal + backdrop.
 * Vervangt browser-native confirm() voor mooiere UX.
 *
 * Props:
 *   open: bool
 *   title: string
 *   body: string of JSX
 *   confirmLabel: string (default 'Bevestigen')
 *   confirmTone: 'danger' | 'primary' (kleurt confirm-knop)
 *   onConfirm: () => void
 *   onCancel:  () => void
 */
export default function V2ConfirmModal({
  open, title, body,
  confirmLabel = 'Bevestigen',
  confirmTone = 'primary',
  onConfirm, onCancel,
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onConfirm, onCancel])

  if (!open) return null

  return createPortal(
    <div className={styles.modalBackdrop} onClick={onCancel}>
      <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>{title}</h3>
        {body && <div className={styles.modalBody}>{body}</div>}
        <div className={styles.modalActions}>
          <button className={styles.modalBtnGhost} onClick={onCancel}>Annuleer</button>
          <button
            className={confirmTone === 'danger' ? styles.modalBtnDanger : styles.modalBtnPrimary}
            onClick={onConfirm}
            autoFocus
          >{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
