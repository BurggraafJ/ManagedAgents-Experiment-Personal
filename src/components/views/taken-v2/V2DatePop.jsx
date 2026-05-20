import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ymd } from './v2-helpers'
import styles from './taken-v2.module.css'

/**
 * Datepicker popover met quick-chips + maand-grid.
 * 1-op-1 vertaling van mockup dp-pop.
 */
export default function V2DatePop({ anchor, current, onPick, onClose }) {
  const popRef = useRef(null)
  const initialView = useMemo(() => {
    const d = current ? new Date(current + 'T12:00:00') : new Date()
    d.setDate(1)
    return d
  }, [current])
  const [view, setView] = useState(initialView)
  const pos = useRef({ top: 0, left: 0 })

  if (anchor) {
    const r = anchor.getBoundingClientRect()
    let top = r.bottom + 6
    let left = r.right - 286
    if (left < 8) left = 8
    if (top + 320 > window.innerHeight) top = r.top - 326
    pos.current = { top, left }
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

  const monthName = view.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
  const first = new Date(view); first.setDate(1)
  const startDow = (first.getDay() + 6) % 7
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate()
  const todayStr = ymd(new Date())

  const now = new Date()
  const nextMonday = (() => {
    const d = new Date(now); const dow = d.getDay()
    let add = (8 - dow) % 7; if (add === 0) add = 7
    d.setDate(d.getDate() + add); return d
  })()
  const quickChips = [
    ['Vandaag',      ymd(now)],
    ['Morgen',       ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))],
    ['Volgende ma',  ymd(nextMonday)],
    ['+1 week',      ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))],
  ]

  const handlePick = (dateStr) => { onPick(dateStr); onClose() }
  const navMonth = (delta) => setView(v => {
    const x = new Date(v); x.setMonth(x.getMonth() + delta); return x
  })

  // Build day cells
  const cells = []
  for (let i = startDow; i > 0; i--) {
    cells.push({ d: prevDays - i + 1, muted: true, dStr: null, dow: 0 })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = view.getFullYear() + '-' +
      String(view.getMonth() + 1).padStart(2, '0') + '-' +
      String(d).padStart(2, '0')
    const dd = new Date(view.getFullYear(), view.getMonth(), d)
    const dow = (dd.getDay() + 6) % 7
    cells.push({ d, muted: false, dStr, dow })
  }

  return createPortal(
    <div
      ref={popRef}
      className={styles.dpPop}
      style={{ top: pos.current.top, left: pos.current.left }}
    >
      <div className={styles.dpQuick}>
        {quickChips.map(([label, dateStr]) => (
          <button key={label} className={styles.dpChip} onClick={() => handlePick(dateStr)}>{label}</button>
        ))}
        {current && (
          <button className={`${styles.dpChip} ${styles.dpChipClear}`} onClick={() => handlePick('')}>Wis</button>
        )}
      </div>
      <div className={styles.dpNav}>
        <button onClick={() => navMonth(-1)} title="Vorige maand">‹</button>
        <div className={styles.dpTitle}>{monthName}</div>
        <button onClick={() => navMonth(1)} title="Volgende maand">›</button>
      </div>
      <div className={styles.dpGrid}>
        {['ma','di','wo','do','vr','za','zo'].map(d => (
          <div key={d} className={styles.dpDow}>{d}</div>
        ))}
        {cells.map((c, i) => (
          <button
            key={i}
            disabled={c.muted}
            className={[
              styles.dpDay,
              c.muted && styles.dpMuted,
              c.dStr === todayStr && styles.dpToday,
              c.dStr === current && styles.dpSelected,
              c.dow >= 5 && !c.muted && styles.dpWeekend,
            ].filter(Boolean).join(' ')}
            onClick={() => !c.muted && c.dStr && handlePick(c.dStr)}
          >{c.d}</button>
        ))}
      </div>
    </div>,
    document.body
  )
}
