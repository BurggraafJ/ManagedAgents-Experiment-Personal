import { useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { relTime } from '../../../lib/rag'

// "Eerdere vragen" — de losse prompts die je zelf verstuurde, nieuwste eerst.
// Los van het Geschiedenis-paneel in de topbar: dat toont hele gesprekken uit
// rag_chat_sessions, dit toont losse vragen om er snel één terug te halen.
// Klik vult de composer (verstuurt niet) zodat je hem nog kunt bijschaven.
export default function PromptHistoryPopover({ open, items, onPick, onClear, onClose, anchorRef }) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  if (!open) return null
  return (
    <div ref={popRef} className={s.libPopover} role="menu" aria-label="Eerdere vragen">
      <div className={s.qhistHead}>
        <span>Eerdere vragen{items.length > 0 ? ` · ${items.length}` : ''}</span>
        {items.length > 0 && (
          <button
            type="button"
            className={s.qhistClear}
            onClick={() => { if (window.confirm('Alle eerdere vragen wissen?')) onClear?.() }}
          >
            Wissen
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <div className={s.qhistEmpty}>
          Nog geen vragen gesteld.<br />
          Wat je verstuurt komt hier vanzelf te staan — ook na een reload.
        </div>
      ) : items.map(item => (
        <button
          key={item.ts}
          type="button"
          className={s.qhistItem}
          onClick={() => onPick?.(item.q)}
          role="menuitem"
          title={item.q}
        >
          <span className={s.qhistIco}>{Ico.clock}</span>
          <span className={s.qhistQ}>{item.q}</span>
          <span className={s.qhistTime}>{relTime(item.ts)}</span>
        </button>
      ))}
    </div>
  )
}
