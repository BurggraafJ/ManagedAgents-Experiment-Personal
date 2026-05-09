import {
  DOW_NL,
  MONTH_NL,
  TYPE_BADGE,
  formatTimeRange,
} from '../../../lib/agenda'
import styles from './AgendaView.module.css'

/**
 * AgendaEventModal — detail-modal voor één event. Toont titel, badges,
 * locatie/organisator/genodigden, body-preview en eventueel teams-link.
 */
export default function AgendaEventModal({ event, classified, attendees = [], onClose }) {
  const start = new Date(event.start_time)
  const end   = new Date(event.end_time)
  const dayLabel = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]}`
  const onlinePlatform = event.online_meeting_url
    ? (event.online_meeting_url.includes('teams') ? 'Teams' : 'Online')
    : null

  return (
    <div className="agenda-modal__backdrop" onClick={onClose}>
      <div className="agenda-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="agenda-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className={`agenda-modal__type-strip agenda-event--${classified.color_key}`} />
        <div className="agenda-modal__head">
          <h2 className="agenda-modal__title">{event.subject || '(geen titel)'}</h2>
          <div className="agenda-modal__when">{dayLabel} · {formatTimeRange(start, end)}</div>
          <div className="agenda-modal__badges">
            <span className={`agenda-modal__badge agenda-modal__badge--${classified.color_key}`}>
              {TYPE_BADGE[classified.meeting_type] || classified.meeting_type}
            </span>
            {onlinePlatform && <span className="agenda-modal__badge">{onlinePlatform}</span>}
            {classified.is_physical && <span className="agenda-modal__badge">fysiek</span>}
            {event.is_recurring && <span className="agenda-modal__badge">terugkerend</span>}
            {event.fireflies_meeting_id && <span className="agenda-modal__badge">fireflies</span>}
          </div>
        </div>

        {event.location_text && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Locatie</span>
            <span className="agenda-modal__val">{event.location_text}</span>
          </div>
        )}
        {event.organizer_name && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Organisator</span>
            <span className="agenda-modal__val">
              {event.organizer_name}{' '}
              {event.organizer_email && (
                <em className={styles.attendeeOrgEmail}>({event.organizer_email})</em>
              )}
            </span>
          </div>
        )}
        {attendees.length > 0 && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Genodigden ({attendees.length})</span>
            <span className="agenda-modal__val">
              {attendees.slice(0, 8).map((a, i) => (
                <span key={i} className="agenda-modal__attendee" title={a?.email || ''}>{a?.name || a?.email || ''}</span>
              ))}
              {attendees.length > 8 && <span className="agenda-modal__attendee">+{attendees.length - 8}</span>}
            </span>
          </div>
        )}
        {event.body_preview && (
          <div className="agenda-modal__body">{event.body_preview}</div>
        )}
        {event.online_meeting_url && (
          <a
            className={`btn btn--ghost ${styles.openMeetingBtn}`}
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
