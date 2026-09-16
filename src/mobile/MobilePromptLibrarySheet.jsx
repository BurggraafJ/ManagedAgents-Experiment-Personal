import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import MIcon from './MIcon'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { PROMPT_LIBRARY } from '../lib/promptLibrary'

// =============================================================================
// MobilePromptLibrarySheet — de promptbibliotheek op de telefoon (v1.226)
// =============================================================================
// Desktop had de "Voorbeelden"-tag in de composer-bar al; mobiel had geen
// ingang. Dit is die ingang: het boek-icoon rechts naast de klok opent deze
// sheet met de acht vragen uit lib/promptLibrary. Tik = de vraag staat in de
// composer, nog niet verstuurd, zodat je [kantoor] en [onderwerp] eerst invult.
//
// Zelfde schil als MobileHistorySheet: portal naar `.shell--m` (daar staan de
// --m-*-tokens en ligt de tabbar), sleepbaar greepje, `m-modal-open` voor de
// scroll-lock. De rijen hergebruiken .m-qhist__row — geen nieuwe CSS.
// =============================================================================

const sheetHost = () => (typeof document === 'undefined'
  ? null
  : document.querySelector('.shell--m') || document.body)

export default function MobilePromptLibrarySheet({ open, onClose, onPick }) {
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [open])

  const drag = useSheetDrag({ onClose, enabled: open })
  const host = open ? sheetHost() : null
  if (!open || !host) return null

  return createPortal(
    <>
      <div className="m-scrim" onClick={onClose} />
      <div
        className={`m-sheet m-hist ${drag.dragging ? 'is-dragging' : ''}`}
        style={drag.dragStyle}
        role="dialog"
        aria-modal="true"
        aria-label="Promptbibliotheek"
      >
        <div className="m-sheet__drag" {...drag.handleProps}>
          <div className="m-drawer__grab" />
          <div className="m-hist__head">
            <div className="m-hist__titlerow">
              <span className="m-hist__title">Promptbibliotheek</span>
              <div className="m-hist__headacts">
                <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
                  <MIcon name="close" size={16} />
                </button>
              </div>
            </div>
            <div className="m-hist__sub">{PROMPT_LIBRARY.length} voorbeelden · tik vult je vraag in, versturen doe je zelf</div>
          </div>
        </div>

        <div className="m-sheet__body m-hist__body">
          {PROMPT_LIBRARY.map(item => (
            <button key={item.id} type="button" className="m-qhist__row" onClick={() => onPick?.(item.prompt)}>
              <span className="m-qhist__ico"><MIcon name={item.stress ? 'zap' : 'book'} size={13} /></span>
              <span className="m-qhist__q">
                <strong>{item.label}</strong>
                <br />
                {item.prompt}
              </span>
              {item.stress && <span className="m-qhist__time">stresstest</span>}
            </button>
          ))}
        </div>
      </div>
    </>,
    host,
  )
}
