import { useState, useRef, useEffect } from 'react'
import { QUICK_ACTIONS } from '../../../../lib/autodraft'
import { btnStyle } from './ActionBtn'
import styles from '../autodraft.module.css'

// QuickActionsBtn — dropdown met snelle pre-baked acties (forward-to-finance etc).
// Ontworpen om uitbreidbaar te zijn: voeg gewoon een nieuw item toe aan de QUICK_ACTIONS array.
export default function QuickActionsBtn({ mail, submit, busy, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  const isBusy = !!busy && QUICK_ACTIONS.some(a => busy === a.id)
  const baseStyle = btnStyle('ghost')

  return (
    <div ref={ref} className={styles.relWrap}>
      <div role="button" tabIndex={disabled ? -1 : 0}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        onKeyDown={e => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v) }
        }}
        style={{
          ...baseStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
        }}
        title="Snel-acties (forward, etc)">
        <span>{isBusy ? 'Bezig…' : '⚡ Snel'}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </div>
      {open && (
        <div className={styles.dropdownPanelSm} style={{ background: 'var(--surface-1)', borderRadius: 8, padding: 6, minWidth: 280 }}>
          {QUICK_ACTIONS.map(a => (
            <div key={a.id} role="button" tabIndex={0}
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(false); a.run(mail, submit) }
              }}
              className={styles.dropdownActionItem}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div className={styles.dropdownActionTitle}>{a.label}</div>
              <div className={styles.dropdownActionSub}>{a.description}</div>
            </div>
          ))}
          <div className={styles.dropdownNote}>
            Quick-actions schrijven concept-mails — AI verstuurt nooit zelf.
          </div>
        </div>
      )}
    </div>
  )
}
