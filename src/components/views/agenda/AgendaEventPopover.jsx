import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DOW_NL,
  MONTH_NL,
  TYPE_BADGE,
  formatTimeRange,
} from '../../../lib/agenda'
import AgendaEventForm from './AgendaEventForm'
import { OUTLOOK_CALENDAR_URL, openOutlook } from '../../../lib/agendaOutlook'

/* AgendaEventPopover — één popover die aan het event-blok (of aan de
 * "Nieuw event"-knop) hangt, met vier standen:
 *
 *   detail  — alle velden van het event: tijd, badges, locatie, organisator,
 *             genodigden, body-preview en de Teams/online-CTA. Dit is de
 *             lees-route die eerder in AgendaEventModal zat (design A
 *             "Luchtlijn", 2026-09-12): dezelfde inhoud, nu aan het blok.
 *   edit    — dezelfde velden als formulier. Geen schrijf-pad: Outlook blijft
 *             bron-van-waarheid, de Graph-write-API volgt later.
 *   delete  — bevestig-stand die eerlijk vertelt dat Legal Mind niets afzegt.
 *   create  — nieuw event vanaf een leeg tijdvak of de topbar-knop.
 */
const POP_W = 344
const GAP = 10

function place(anchor, height) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = Math.min(height || 320, vh - 2 * GAP)
  if (!anchor) {
    return { top: Math.max(GAP, (vh - h) / 2), left: Math.max(GAP, (vw - POP_W) / 2) }
  }
  let left = anchor.right + GAP
  if (left + POP_W > vw - GAP) left = anchor.left - GAP - POP_W
  if (left < GAP) left = Math.min(Math.max(GAP, anchor.left), Math.max(GAP, vw - POP_W - GAP))
  let top = anchor.top - 6
  if (top + h > vh - GAP) top = vh - GAP - h
  if (top < GAP) top = GAP
  return { top, left }
}

export default function AgendaEventPopover({
  mode: initialMode = 'detail',
  event,
  classified,
  attendees = [],
  anchor,
  draft,
  onClose,
}) {
  const [mode, setMode] = useState(initialMode)
  const [pos, setPos] = useState(() => place(anchor, 320))
  const boxRef = useRef(null)

  useEffect(() => setMode(initialMode), [initialMode, event?.id])

  useLayoutEffect(() => {
    const measure = () => setPos(place(anchor, boxRef.current?.offsetHeight))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [anchor, mode])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isForm = mode === 'edit' || mode === 'create'
  const start = event ? new Date(event.start_time) : null
  const end = event ? new Date(event.end_time) : null

  return (
    <div className="ag-pop__scrim" onMouseDown={onClose}>
      <div
        ref={boxRef}
        className={`ag-pop ag-pop--${mode}`}
        style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${POP_W}px` }}
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-label={mode === 'create' ? 'Nieuw event' : (event?.subject || 'Event')}
      >
        <button type="button" className="ag-pop__close" onClick={onClose} aria-label="Sluiten">×</button>

        {isForm ? (
          <AgendaEventForm
            mode={mode}
            event={event}
            draft={draft}
            onCancel={() => (mode === 'edit' ? setMode('detail') : onClose())}
          />
        ) : mode === 'delete' ? (
          <DeletePane event={event} onBack={() => setMode('detail')} />
        ) : (
          <DetailPane
            event={event}
            classified={classified}
            attendees={attendees}
            start={start}
            end={end}
            onEdit={() => setMode('edit')}
            onDelete={() => setMode('delete')}
          />
        )}
      </div>
    </div>
  )
}

function DetailPane({ event, classified, attendees, start, end, onEdit, onDelete }) {
  const dayLabel = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]}`
  const onlinePlatform = event.online_meeting_url
    ? (event.online_meeting_url.includes('teams') ? 'Teams' : 'Online')
    : null
  const variant = classified?.is_physical ? 'fysiek'
    : (classified?.color_key === 'client' || classified?.color_key === 'external' || classified?.color_key === 'demo') ? 'fysiek'
    : (classified?.color_key === 'allday' || classified?.color_key === 'private') ? 'admin'
    : 'teams'

  return (
    <>
      <div className={`ag-pop__strip ag-pop__strip--${variant}`} />
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">{event.subject || '(geen titel)'}</h2>
        <div className="ag-pop__when">{dayLabel} · {formatTimeRange(start, end)}</div>
        <div className="ag-modal__badges">
          <span className={`ag-modal__badge ag-modal__badge--${variant}`}>
            {TYPE_BADGE[classified.meeting_type] || classified.meeting_type}
          </span>
          {onlinePlatform && <span className="ag-modal__badge">{onlinePlatform}</span>}
          {classified.is_physical && <span className="ag-modal__badge">fysiek</span>}
          {event.is_recurring && <span className="ag-modal__badge">terugkerend</span>}
          {event.fireflies_meeting_id && <span className="ag-modal__badge">fireflies</span>}
        </div>
      </div>

      <div className="ag-pop__body">
        {event.location_text && (
          <div className="ag-modal__row">
            <span className="ag-modal__lbl">Locatie</span>
            <span className="ag-modal__val">{event.location_text}</span>
          </div>
        )}
        {event.organizer_name && (
          <div className="ag-modal__row">
            <span className="ag-modal__lbl">Organisator</span>
            <span className="ag-modal__val">
              {event.organizer_name}{' '}
              {event.organizer_email && (
                <em className="ag-modal__organizer-email">({event.organizer_email})</em>
              )}
            </span>
          </div>
        )}
        {attendees.length > 0 && (
          <div className="ag-modal__row">
            <span className="ag-modal__lbl">Genodigden ({attendees.length})</span>
            <span className="ag-modal__val">
              {attendees.slice(0, 8).map((a, i) => (
                <span key={i} className="ag-modal__attendee" title={a?.email || ''}>{a?.name || a?.email || ''}</span>
              ))}
              {attendees.length > 8 && <span className="ag-modal__attendee">+{attendees.length - 8}</span>}
            </span>
          </div>
        )}
        {event.body_preview && (
          <div className="ag-modal__body">{event.body_preview}</div>
        )}
        {event.online_meeting_url && (
          <a
            className="ag-modal__cta"
            href={event.online_meeting_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in {onlinePlatform || 'online meeting'} →
          </a>
        )}
      </div>

      <div className="ag-pop__actions">
        <button type="button" className="ag-btn ag-btn--xs" onClick={onEdit}>Wijzigen</button>
        <button type="button" className="ag-btn ag-btn--xs ag-pop__danger" onClick={onDelete}>Verwijderen</button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-pop__spacer"
          onClick={() => openOutlook(OUTLOOK_CALENDAR_URL)}
          title="Outlook blijft bron-van-waarheid"
        >
          Outlook ↗
        </button>
      </div>
    </>
  )
}

function DeletePane({ event, onBack }) {
  const start = new Date(event.start_time)
  const label = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]} · ${formatTimeRange(start, new Date(event.end_time))}`

  return (
    <>
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">Event verwijderen?</h2>
        <div className="ag-pop__when">{event.subject || '(geen titel)'} — {label}</div>
      </div>
      <div className="ag-pop__body">
        <p className="ag-pop__note">
          Legal Mind schrijft nog niet naar je agenda. Er gaat dus géén afzegging
          naar de genodigden en het event blijft in Outlook staan. Annuleer de
          afspraak in Outlook; de agenda-spiegel volgt bij de eerstvolgende sync.
        </p>
      </div>
      <div className="ag-pop__actions">
        <button type="button" className="ag-btn ag-btn--xs" onClick={onBack}>Terug</button>
        <button type="button" className="ag-btn ag-btn--xs ag-pop__danger" disabled title="Schrijf-API volgt">
          Verwijderen volgt (API)
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-pop__spacer"
          onClick={() => openOutlook(OUTLOOK_CALENDAR_URL)}
        >
          Outlook ↗
        </button>
      </div>
    </>
  )
}
