import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './taken-v2-pops.module.css'

/**
 * Floating popover met 3 prio-opties (Hoog/Middel/Laag).
 * Sluit op outside-click of Escape.
 */
export default function V2PrioPop({ anchor, current, onPick, onClose }) {
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
    <div
      ref={popRef}
      className={styles.prioPop}
      style={{ top: pos.current.top, left: pos.current.left }}
    >
      {[
        { id: 'hoog',   color: 'var(--tv2-error)' },
        { id: 'middel', color: 'var(--tv2-warning)' },
        { id: 'laag',   color: 'var(--tv2-info)' },
      ].map(p => (
        <button
          key={p.id}
          className={styles.prioPopItem}
          onClick={() => { onPick(p.id); onClose() }}
        >
          <span className={styles.prioPopDot} style={{ background: p.color }} />
          {p.id.charAt(0).toUpperCase() + p.id.slice(1)}
          {current === p.id && <span style={{ marginLeft: 'auto', color: 'var(--tv2-neutral-400)' }}>✓</span>}
        </button>
      ))}
    </div>,
    document.body
  )
}
