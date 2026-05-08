import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './Modal.module.css'

/**
 * Modal — generieke dialog met portal, ESC-close, backdrop-click-close en
 * focus-trap binnen de dialoog. Bouw je composeerbaar op:
 *
 *   <Modal open={open} onClose={() => setOpen(false)} title="Bevestig">
 *     <p>Weet je het zeker?</p>
 *     <Modal.Footer>
 *       <button className="btn" onClick={...}>Annuleer</button>
 *       <button className="btn btn--accent" onClick={...}>OK</button>
 *     </Modal.Footer>
 *   </Modal>
 *
 * Props:
 *  - open       (bool) verplicht — laat unmount toe zodra false
 *  - onClose    () => void — wordt aangeroepen bij ESC en backdrop-click
 *  - title      (string) — optioneel; rendert header met title + close-knop
 *  - size       'sm' | 'md' (default) | 'lg' | 'xl'
 *  - children   body-content
 *  - className  extra klasse op de dialog-container
 *  - closeOnBackdrop  (bool, default true) — uitzetten voor "must answer"-modals
 */
export default function Modal({
  open,
  onClose,
  title,
  size = 'md',
  children,
  className = '',
  closeOnBackdrop = true,
}) {
  const dialogRef = useRef(null)
  const previousActive = useRef(null)

  useEffect(() => {
    if (!open) return
    previousActive.current = document.activeElement
    dialogRef.current?.focus()
    return () => {
      previousActive.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      } else if (e.key === 'Tab') {
        trapFocus(e, dialogRef.current)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const sizeClass = size && size !== 'md' ? styles[`dialog--${size}`] : ''

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.()
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${sizeClass} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        tabIndex={-1}
      >
        {title && (
          <header className={styles.header}>
            <h2 id="modal-title" className={styles.title}>{title}</h2>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Sluiten"
            >
              ×
            </button>
          </header>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  )
}

Modal.Footer = function ModalFooter({ children }) {
  return <div className={styles.footer}>{children}</div>
}

function trapFocus(event, container) {
  if (!container) return
  const focusable = container.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
