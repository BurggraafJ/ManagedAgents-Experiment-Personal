import { useEffect, useRef, useState } from 'react'
import MIcon from '../MIcon'
import { fromNameOf, subjectOf, bodyPreviewOf, receivedAtOf } from '../../lib/postvakContract'

// =============================================================================
// MobilePostvakRow — één mailrij met veegacties (v1.202, spoor 10)
// =============================================================================
// Veeg naar links en er komen drie acties tevoorschijn: Uitstellen, Verplaats
// (Prioriteit ↔ Overige) en Verwijderen. Precies dezelfde drie die desktop al
// in zijn ⋯-menu heeft; er komt dus geen actie bij die je op de telefoon wél
// en op de laptop niet kunt.
//
// Het ⋯-knopje rechts opent **dezelfde strook** — niet een tweede menu met een
// eigen lijst die uit de pas kan lopen. Eén strook, twee manieren erin: met een
// gebaar voor wie het kent, met een knop voor wie het niet kent.
//
// Bewust géén volledige-veeg-snelkoppeling (doorvegen = meteen uitvoeren): de
// actie die het verst rechts staat is Verwijderen, en die wil je niet per
// ongeluk met een te enthousiaste veeg raken.
// =============================================================================

const ACT_W = 76                 // breedte van één actieknop
const ACTIONS_W = ACT_W * 3      // volledige strook
const OPEN_AT = 0.42             // voorbij deze fractie klapt hij open i.p.v. terug
const RUBBER = 26                // hoeveel je vóórbij de strook mag trekken

const initials = (n) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const hasDraftOf = (m) => (Array.isArray(m.draft_variants) && m.draft_variants.length > 0) || !!m.draft_body

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 3600000
  if (diff < 1) return `${Math.max(1, Math.round(diff * 60))}m`
  if (diff < 24) return `${Math.round(diff)}u`
  if (diff < 48) return 'gist'
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function MobilePostvakRow({
  mail, bucket = 'prio', cat = null, readOnly = false,
  open = false, onSwipe, onOpen,
  onDelete, onMoveBucket, onSnooze,
}) {
  const [dx, setDx] = useState(open ? ACTIONS_W : 0)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)

  // De ouder houdt bij wélke rij open staat (er kan er maar één open zijn).
  // Deze rij volgt die waarheid; hij bewaart hem niet zelf.
  useEffect(() => { if (!dragging) setDx(open ? ACTIONS_W : 0) }, [open, dragging])

  const naar = bucket === 'overig' ? 'Prioriteit' : 'Overige'

  function onTouchStart(e) {
    if (readOnly) return
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, dx, axis: null }
  }
  function onTouchMove(e) {
    const s = start.current
    if (!s) return
    const t = e.touches[0]
    const mx = s.x - t.clientX
    const my = Math.abs(t.clientY - s.y)
    // Eerste beweging bepaalt de as. Verticaal = de lijst scrollt, en dan blijft
    // deze rij van het gebaar af; anders vecht elke scroll met elke veeg.
    if (!s.axis) {
      if (Math.abs(mx) < 6 && my < 6) return
      s.axis = Math.abs(mx) > my ? 'x' : 'y'
      if (s.axis === 'x') setDragging(true)
    }
    if (s.axis !== 'x') return
    const next = Math.max(0, Math.min(ACTIONS_W + RUBBER, s.dx + mx))
    setDx(next)
  }
  function onTouchEnd() {
    const s = start.current
    start.current = null
    if (!s || s.axis !== 'x') { setDragging(false); return }
    setDragging(false)
    const shouldOpen = dx > ACTIONS_W * OPEN_AT
    setDx(shouldOpen ? ACTIONS_W : 0)
    onSwipe && onSwipe(shouldOpen ? mail.mail_id : null)
  }

  function onRowClick() {
    // Staat de strook open, dan is de eerste tik "doe maar dicht" — niet
    // "open de mail". Zelfde afspraak als iOS Mail.
    if (dx > 0) { onSwipe && onSwipe(null); return }
    onOpen && onOpen(mail.mail_id)
  }

  const act = (fn) => (e) => {
    e.stopPropagation()
    onSwipe && onSwipe(null)
    fn && fn(mail)
  }

  return (
    <div className={`m-swipe ${dx > 0 ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`}>
      {!readOnly && (
        <div className="m-swipe__actions" aria-hidden={dx === 0}>
          <button type="button" className="m-swipe__act m-swipe__act--snooze" tabIndex={dx > 0 ? 0 : -1}
                  onClick={act(onSnooze)}>
            <MIcon name="clock" size={17} /><span>Uitstellen</span>
          </button>
          <button type="button" className="m-swipe__act m-swipe__act--move" tabIndex={dx > 0 ? 0 : -1}
                  onClick={act(onMoveBucket)}>
            <MIcon name="swap" size={17} /><span>{naar}</span>
          </button>
          <button type="button" className="m-swipe__act m-swipe__act--del" tabIndex={dx > 0 ? 0 : -1}
                  onClick={act(onDelete)}>
            <MIcon name="trash" size={17} /><span>Verwijder</span>
          </button>
        </div>
      )}
      <div className="m-swipe__row" style={{ transform: `translateX(${-dx}px)` }}
           onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <div className="m-pvrow" role="button" tabIndex={0} onClick={onRowClick}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick() } }}>
          <div className="m-pvrow__av">{initials(fromNameOf(mail))}</div>
          <div className="m-pvrow__main">
            <div className="m-pvrow__top">
              <span className="m-pvrow__name">{fromNameOf(mail)}</span>
              <span className="m-pvrow__time">{timeAgo(receivedAtOf(mail))}</span>
            </div>
            <div className="m-pvrow__subj">{subjectOf(mail)}</div>
            {bodyPreviewOf(mail) && <div className="m-pvrow__snip">{bodyPreviewOf(mail)}</div>}
            {(cat || hasDraftOf(mail) || mail.has_attachments) && (
              <div className="m-pvrow__chips">
                {cat && <span className="m-catpill">{cat}</span>}
                {hasDraftOf(mail) && <span className="m-catpill">Concept klaar</span>}
                {mail.has_attachments && <span className="m-catpill m-catpill--reassessed">Bijlage</span>}
              </div>
            )}
          </div>
          <div className="m-pvrow__side">
            {/* Ongelezen = Outlook's is_read, niet "heeft een voorstel". */}
            {mail.is_read === false ? <span className="m-pvrow__dot" /> : <span className="m-pvrow__dot is-empty" />}
            {!readOnly && (
              <button type="button" className={`m-pvrow__more ${dx > 0 ? 'is-on' : ''}`} aria-label="Acties"
                      onClick={e => { e.stopPropagation(); onSwipe && onSwipe(dx > 0 ? null : mail.mail_id) }}>
                <MIcon name="more" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
