import { useState, useRef, useEffect } from 'react'
import { QUICK_ACTIONS } from '../../../../lib/autodraft'

// QuickActions als toolbar-knop met dropdown (zelfde icon-boven-label-stijl).
export default function QuickActionsToolbarBtn({ mail, submit, busy, disabled, onAddPreference }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])
  const isBusy = !!busy && QUICK_ACTIONS.some(a => busy === a.id)

  const itemStyle = {
    display: 'block', width: '100%', padding: '8px 10px', borderRadius: 4,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: 'transparent', color: 'var(--text)', textAlign: 'left',
  }
  const itemHover = {
    onMouseEnter: e => e.currentTarget.style.background = '#F3F2F1',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        className="ot-btn"
        title="Snel-acties (forward, voorkeur toevoegen, etc)">
        <span className="ot-btn__icon" aria-hidden>⚡</span>
        <span className="ot-btn__label">{isBusy ? 'Bezig…' : 'Snel ▾'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 8,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 4, minWidth: 300,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        }}>
          {/* Voorkeur toevoegen — doet NIETS met de mail, leert wel voor de
              categorie/tone. Eerst zodat 'leren'-acties bovenaan staan. */}
          {onAddPreference && (
            <>
              <button type="button"
                onClick={() => { setOpen(false); onAddPreference() }}
                style={itemStyle}
                {...itemHover}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>💡 Voorkeur toevoegen</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Geen actie op deze mail — voorkeur wordt opgeslagen voor de categorie of draft-stijl.
                </div>
              </button>
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            </>
          )}
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} type="button"
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              style={itemStyle}
              {...itemHover}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
