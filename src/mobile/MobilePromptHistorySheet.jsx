import { useEffect } from 'react'
import MIcon from './MIcon'
import { relTime } from '../lib/rag'

// Bottom-sheet met de vragen die je zelf stelde (localStorage, nieuwste eerst —
// zie lib/promptHistory.js). Tik op een regel → hij staat in de composer, nog
// niet verstuurd. Zelfde sheet-schil als de Nieuwe-taak-sheet.
export default function MobilePromptHistorySheet({ open, items, onPick, onClear, onClose }) {
  // Zelfde vergrendeling als MobileNewTask: `m-modal-open` verbergt tabbar + FAB
  // en lockt de achtergrond-scroll. Zonder dit valt de tabbar over de onderste
  // rijen heen — die zijn dan niet aan te tikken.
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])

  if (!open) return null
  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Eerdere vragen">
        <div className="m-drawer__grab" />
        <div className="m-sheet__head">
          <span className="m-drawer__title">Eerdere vragen</span>
          <div className="m-qhist__headacts">
            {items.length > 0 && (
              <button
                type="button"
                className="m-qhist__clear"
                onClick={() => { if (window.confirm('Alle eerdere vragen wissen?')) onClear?.() }}
              >
                Wissen
              </button>
            )}
            <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
              <MIcon name="close" size={16} />
            </button>
          </div>
        </div>

        <div className="m-sheet__body m-qhist__body">
          {items.length === 0 ? (
            <div className="m-qhist__empty">
              <div className="m-qhist__emptyico"><MIcon name="clock" size={20} /></div>
              <div className="m-qhist__emptytitle">Nog geen vragen gesteld</div>
              <div className="m-qhist__emptysub">Wat je aan Maestro vraagt komt hier vanzelf te staan — ook na een reload.</div>
            </div>
          ) : items.map(item => (
            <button key={item.ts} type="button" className="m-qhist__row" onClick={() => onPick?.(item.q)}>
              <span className="m-qhist__ico"><MIcon name="clock" size={13} /></span>
              <span className="m-qhist__q">{item.q}</span>
              <span className="m-qhist__time">{relTime(item.ts)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
