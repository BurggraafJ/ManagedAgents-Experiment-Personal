import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import MIcon from '../MIcon'
import { useSheetDrag } from '../../hooks/useSheetDrag'

// =============================================================================
// MobilePostvakMenu — het overloopmenu van het Postvak (v1.202, spoor 10)
// =============================================================================
// Prioriteit | Overige is de primaire schakelaar; alles wat géén bak is hangt
// hierachter: zoeken en Verzonden. Verzonden stond tot v1.201 als derde
// gelijkwaardige tab náást Inbox en trok daarmee evenveel aandacht als het
// postvak zelf, terwijl je er hooguit een paar keer per dag in kijkt.
//
// Portal naar `.shell--m`, niet naar <body>: alle --m-*-tokens staan op die
// shell en één lege var() maakt de hele declaratie ongeldig. En niet naar de
// header, want die is sticky en dan wint de tabbar van de sheet.
// =============================================================================

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

export default function MobilePostvakMenu({ open, mode, query, onQuery, onMode, onClose, sentCount }) {
  const [draft, setDraft] = useState(query || '')
  useEffect(() => { setDraft(query || '') }, [query, open])
  useEffect(() => {
    if (!open) return undefined
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])

  const drag = useSheetDrag({ onClose, enabled: open })
  const host = open ? sheetHost() : null
  if (!open || !host) return null

  const submit = (e) => {
    e.preventDefault()
    onQuery(draft.trim())
    onClose()
  }

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} aria-hidden />
      <div className={`m-sheet m-pvmenu ${drag.dragging ? 'is-dragging' : ''}`} style={drag.dragStyle}
           role="dialog" aria-label="Meer in Postvak">
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-drawer__grab" aria-hidden />
        </div>
        <div className="m-sheet__body m-pvmenu__body">
          <form className="m-pvmenu__search" onSubmit={submit}>
            <MIcon name="search" size={16} />
            <input value={draft} onChange={e => setDraft(e.target.value)} enterKeyHint="search"
                   placeholder="Zoek in Postvak…" aria-label="Zoek in Postvak" />
            {draft && (
              <button type="button" className="m-pvmenu__clear" aria-label="Wissen"
                      onClick={() => { setDraft(''); onQuery('') }}>
                <MIcon name="close" size={14} />
              </button>
            )}
          </form>
          <div className="m-pvmenu__label">Weergave</div>
          <button type="button" className={`m-pvmenu__item ${mode === 'inbox' ? 'is-on' : ''}`}
                  onClick={() => { onMode('inbox'); onClose() }}>
            <MIcon name="inbox" size={17} /><span>Postvak IN</span>
            {mode === 'inbox' && <MIcon name="check" size={15} />}
          </button>
          <button type="button" className={`m-pvmenu__item ${mode === 'sent' ? 'is-on' : ''}`}
                  onClick={() => { onMode('sent'); onClose() }}>
            <MIcon name="mail" size={17} /><span>Verzonden</span>
            {mode === 'sent'
              ? <MIcon name="check" size={15} />
              : sentCount != null && <span className="m-pvmenu__count">{sentCount}</span>}
          </button>
        </div>
      </div>
    </>,
    host,
  )
}
