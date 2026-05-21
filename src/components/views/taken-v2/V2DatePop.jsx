import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ymd } from './v2-helpers'
import styles from './taken-v2.module.css'

const MONTH_SHORT_NL = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

/**
 * Datepicker popover met twee modes:
 *   - 'day'   : maand-grid, specifieke dag
 *   - 'month' : jaar-grid (12 maanden), pick een hele maand
 *
 * onPick(dateStr, kind) — kind is 'day' of 'month'.
 * Bij maand: dateStr = '<jaar>-<MM>-01' (eerste dag van die maand).
 */
export default function V2DatePop({ anchor, current, currentKind = 'day', onPick, onClose }) {
  const popRef = useRef(null)
  const [mode, setMode] = useState(currentKind === 'month' ? 'month' : 'day')

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
    if (top + 360 > window.innerHeight) top = r.top - 366
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

  const navMonth = (delta) => setView(v => {
    const x = new Date(v); x.setMonth(x.getMonth() + delta); return x
  })
  const navYear = (delta) => setView(v => {
    const x = new Date(v); x.setFullYear(x.getFullYear() + delta); return x
  })

  const handlePickDay   = (dateStr) => { onPick(dateStr, 'day');   onClose() }
  const handlePickMonth = (y, m)    => {
    const iso = y + '-' + String(m).padStart(2, '0') + '-01'
    onPick(iso, 'month'); onClose()
  }
  const handleClear     = () => { onPick('', 'day'); onClose() }

  // Quick chips (day-mode only)
  const now = new Date()
  const nextMonday = (() => {
    const d = new Date(now); const dow = d.getDay()
    let add = (8 - dow) % 7; if (add === 0) add = 7
    d.setDate(d.getDate() + add); return d
  })()
  const quickChips = [
    ['Vandaag',     ymd(now),                                                                                       'day'],
    ['Morgen',      ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),                            'day'],
    ['Volgende ma', ymd(nextMonday),                                                                                 'day'],
    ['+1 week',     ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7)),                            'day'],
    ['Deze maand',  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01',                  'month'],
    ['Volgende mnd',(new Date(now.getFullYear(), now.getMonth() + 1, 1)).toISOString().slice(0, 7) + '-01',         'month'],
  ]

  // Day-mode grid
  const monthName = view.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
  const first = new Date(view); first.setDate(1)
  const startDow = (first.getDay() + 6) % 7
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate()
  const todayStr = ymd(new Date())
  const cells = []
  for (let i = startDow; i > 0; i--) cells.push({ d: prevDays - i + 1, muted: true, dStr: null, dow: 0 })
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = view.getFullYear() + '-' + String(view.getMonth() + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const dd = new Date(view.getFullYear(), view.getMonth(), d)
    const dow = (dd.getDay() + 6) % 7
    cells.push({ d, muted: false, dStr, dow })
  }

  // Month-mode grid
  const currentYearForMonth = view.getFullYear()
  const currentMonthIso = current && currentKind === 'month' ? current.slice(0, 7) : null
  const todayMonthIso = todayStr.slice(0, 7)

  return createPortal(
    <div
      ref={popRef}
      className={styles.dpPop}
      style={{ top: pos.current.top, left: pos.current.left }}
    >
      {/* Mode toggle */}
      <div className={styles.dpModeBar}>
        <button
          className={`${styles.dpModeBtn} ${mode === 'day' ? styles.active : ''}`}
          onClick={() => setMode('day')}
        >Dag</button>
        <button
          className={`${styles.dpModeBtn} ${mode === 'month' ? styles.active : ''}`}
          onClick={() => setMode('month')}
        >Maand</button>
        {current && (
          <button className={styles.dpClearBtn} onClick={handleClear} title="Wis deadline">Wis</button>
        )}
      </div>

      {mode === 'day' && (
        <>
          <div className={styles.dpQuick}>
            {quickChips.filter(c => c[2] === 'day').map(([label, dateStr]) => (
              <button key={label} className={styles.dpChip} onClick={() => handlePickDay(dateStr)}>{label}</button>
            ))}
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
                  c.dStr === current && currentKind === 'day' && styles.dpSelected,
                  c.dow >= 5 && !c.muted && styles.dpWeekend,
                ].filter(Boolean).join(' ')}
                onClick={() => !c.muted && c.dStr && handlePickDay(c.dStr)}
              >{c.d}</button>
            ))}
          </div>
        </>
      )}

      {mode === 'month' && (
        <>
          <div className={styles.dpQuick}>
            {quickChips.filter(c => c[2] === 'month').map(([label, dateStr]) => (
              <button key={label} className={styles.dpChip} onClick={() => {
                const [y, m] = dateStr.split('-').map(Number)
                handlePickMonth(y, m)
              }}>{label}</button>
            ))}
          </div>
          <div className={styles.dpNav}>
            <button onClick={() => navYear(-1)} title="Vorig jaar">‹</button>
            <div className={styles.dpTitle}>{currentYearForMonth}</div>
            <button onClick={() => navYear(1)} title="Volgend jaar">›</button>
          </div>
          <div className={styles.dpMonthGrid}>
            {MONTH_SHORT_NL.map((label, idx) => {
              const m = idx + 1
              const iso = currentYearForMonth + '-' + String(m).padStart(2, '0')
              return (
                <button
                  key={m}
                  className={[
                    styles.dpMonthCell,
                    iso === todayMonthIso && styles.dpToday,
                    iso === currentMonthIso && styles.dpSelected,
                  ].filter(Boolean).join(' ')}
                  onClick={() => handlePickMonth(currentYearForMonth, m)}
                >{label}</button>
              )
            })}
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
