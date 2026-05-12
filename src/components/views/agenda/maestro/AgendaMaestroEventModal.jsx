import {
  DOW_NL,
  MONTH_NL,
  TYPE_BADGE,
  formatTimeRange,
} from '../../../../lib/agenda'

/* AgendaMaestroEventModal — detail-modal voor één event in Maestro-stijl.
 * Spiegel van AgendaEventModal met agm-modal__* class-namen. */
export default function AgendaMaestroEventModal({ event, classified, attendees = [], onClose }) {
  const start = new Date(event.start_time)
  const end   = new Date(event.end_time)
  const dayLabel = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]}`
  const onlinePlatform = event.online_meeting_url
    ? (event.online_meeting_url.includes('teams') ? 'Teams' : 'Online')
    : null

  const variant = classified?.is_physical ? 'fysiek'
    : (classified?.color_key === 'client' || classified?.color_key === 'external' || classified?.color_key === 'demo') ? 'fysiek'
    : (classified?.color_key === 'allday' || classified?.color_key === 'private') ? 'admin'
    : 'teams'

  return (
    <div className="agm-modal__backdrop" onClick={onClose}>
      <div className="agm-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="agm-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className={`agm-modal__type-strip agm-modal__type-strip--${variant}`} />
        <div className="agm-modal__head">
          <h2 className="agm-modal__title">{event.subject || '(geen titel)'}</h2>
          <div className="agm-modal__when">{dayLabel} · {formatTimeRange(start, end)}</div>
          <div className="agm-modal__badges">
            <span className={`agm-modal__badge agm-modal__badge--${variant}`}>
              {TYPE_BADGE[classified.meeting_type] || classified.meeting_type}
            </span>
            {onlinePlatform && <span className="agm-modal__badge">{onlinePlatform}</span>}
            {classified.is_physical && <span className="agm-modal__badge">fysiek</span>}
            {event.is_recurring && <span className="agm-modal__badge">terugkerend</span>}
            {event.fireflies_meeting_id && <span className="agm-modal__badge">fireflies</span>}
          </div>
        </div>

        {event.location_text && (
          <div className="agm-modal__row">
            <span className="agm-modal__lbl">Locatie</span>
            <span className="agm-modal__val">{event.location_text}</span>
          </div>
        )}
        {event.organizer_name && (
          <div className="agm-modal__row">
            <span className="agm-modal__lbl">Organisator</span>
            <span className="agm-modal__val">
              {event.organizer_name}{' '}
              {event.organizer_email && (
                <em className="agm-modal__organizer-email">({event.organizer_email})</em>
              )}
            </span>
          </div>
        )}
        {attendees.length > 0 && (
          <div className="agm-modal__row">
            <span className="agm-modal__lbl">Genodigden ({attendees.length})</span>
            <span className="agm-modal__val">
              {attendees.slice(0, 8).map((a, i) => (
                <span key={i} className="agm-modal__attendee" title={a?.email || ''}>{a?.name || a?.email || ''}</span>
              ))}
              {attendees.length > 8 && <span className="agm-modal__attendee">+{attendees.length - 8}</span>}
            </span>
          </div>
        )}
        {event.body_preview && (
          <div className="agm-modal__body">{event.body_preview}</div>
        )}
        {event.online_meeting_url && (
          <a
            className="agm-modal__cta"
            href={event.online_meeting_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in {onlinePlatform || 'online meeting'} →
          </a>
        )}
      </div>
    </div>
  )
}
