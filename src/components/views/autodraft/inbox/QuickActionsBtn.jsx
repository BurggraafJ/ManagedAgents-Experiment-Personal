import { useState, useRef, useEffect } from 'react'
import { QUICK_ACTIONS } from '../../../../lib/autodraft'
import { btnStyle } from './ActionBtn'

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
    <div ref={ref} style={{ position: 'relative' }}>
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
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 8,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 6, minWidth: 280,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        }}>
          {QUICK_ACTIONS.map(a => (
            <div key={a.id} role="button" tabIndex={0}
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(false); a.run(mail, submit) }
              }}
              style={{
                padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', userSelect: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>
            </div>
          ))}
          <div style={{
            marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)',
            fontSize: 10.5, color: 'var(--text-muted)', padding: '6px 10px',
          }}>
            Quick-actions schrijven concept-mails — AI verstuurt nooit zelf.
          </div>
        </div>
      )}
    </div>
  )
}
