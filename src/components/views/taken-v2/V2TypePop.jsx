import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './taken-v2.module.css'

export const TASK_TYPES = [
  { id: 'uitvoeren', label: 'Uitvoeren',  icon: '⚡' },
  { id: 'mail',      label: 'Mail',       icon: '📧' },
  { id: 'analyse',   label: 'Analyse',    icon: '📊' },
  { id: 'bespreken', label: 'Bespreken',  icon: '💬' },
  { id: 'opvolgen',  label: 'Opvolgen',   icon: '🔁' },
  { id: 'onderzoek', label: 'Onderzoek',  icon: '🔍' },
  { id: 'anders',    label: 'Anders',     icon: '•' },
]

export const TYPE_BY_ID = Object.fromEntries(TASK_TYPES.map(t => [t.id, t]))

/**
 * Dropdown popover om task_type te kiezen.
 */
export default function V2TypePop({ anchor, current, onPick, onClose }) {
  const popRef = useRef(null)
  const pos = useRef({ top: 0, left: 0 })

  if (anchor) {
    const r = anchor.getBoundingClientRect()
    pos.current = { top: r.bottom + 6, left: Math.max(8, r.left) }
  }

  useEffect(() => {
    const onDown = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose()
    }
    const onEsc = (e) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => document.addEventListener('mousedown', onDown, true), 0)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  return createPortal(
    <div ref={popRef} className={styles.typePop} style={{ top: pos.current.top, left: pos.current.left }}>
      {TASK_TYPES.map(t => (
        <button
          key={t.id}
          className={styles.typePopItem}
          onClick={() => { onPick(t.id); onClose() }}
        >
          <span className={styles.typePopIcon}>{t.icon}</span>
          <span>{t.label}</span>
          {current === t.id && <span style={{ marginLeft: 'auto', color: 'var(--tv2-neutral-400)' }}>✓</span>}
        </button>
      ))}
      {current && (
        <>
          <div className={styles.typePopDivider} />
          <button
            className={styles.typePopItem}
            onClick={() => { onPick(null); onClose() }}
            style={{ color: 'var(--tv2-neutral-500)' }}
          >
            <span className={styles.typePopIcon}>×</span>
            <span>Geen type</span>
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
