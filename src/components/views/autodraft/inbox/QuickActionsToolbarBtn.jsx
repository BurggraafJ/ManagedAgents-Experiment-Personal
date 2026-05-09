import { useState, useRef, useEffect } from 'react'
import { QUICK_ACTIONS } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

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

  return (
    <div ref={ref} className={styles.relWrap}>
      <button type="button" disabled={disabled}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        className="ot-btn"
        title="Snel-acties (forward, voorkeur toevoegen, etc)">
        <span className="ot-btn__icon" aria-hidden>⚡</span>
        <span className="ot-btn__label">{isBusy ? 'Bezig…' : 'Snel ▾'}</span>
      </button>
      {open && (
        <div className={styles.dropdownPanelSm}>
          {/* Voorkeur toevoegen — doet NIETS met de mail, leert wel voor de
              categorie/tone. Eerst zodat 'leren'-acties bovenaan staan. */}
          {onAddPreference && (
            <>
              <button type="button"
                onClick={() => { setOpen(false); onAddPreference() }}
                className={styles.dropdownActionItem}
                onMouseEnter={e => e.currentTarget.style.background = '#F3F2F1'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div className={styles.dropdownActionTitle}>💡 Voorkeur toevoegen</div>
                <div className={styles.dropdownActionSub}>
                  Geen actie op deze mail — voorkeur wordt opgeslagen voor de categorie of draft-stijl.
                </div>
              </button>
              <div className={styles.dropdownDivider} />
            </>
          )}
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} type="button"
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              className={styles.dropdownActionItem}
              onMouseEnter={e => e.currentTarget.style.background = '#F3F2F1'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div className={styles.dropdownActionTitle}>{a.label}</div>
              <div className={styles.dropdownActionSub}>{a.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
