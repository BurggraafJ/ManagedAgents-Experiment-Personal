import {
  HOUR_HEIGHT,
  TYPE_BADGE,
  formatTimeRange,
  getCategoryClass,
  eventVisibleMinutes,
  toLocalDateKey,
} from '../../../lib/agenda'

/**
 * AgendaEventCard — één gepositioneerd event-blok in een DayColumn.
 *
 * Inline-style top/height is data-driven (klok-positie uit minuten →
 * pixels) en daarmee toegestaan; dit zijn geen visuele opmaakkeuzes.
 */
export default function AgendaEventCard({ ev, classified, day, onClick }) {
  const start = new Date(ev.start_time)
  const end   = new Date(ev.end_time)

  // Clamp naar zichtbare day-window (voorkomt overflow bij multi-day of buiten 8-22)
  const visMins = eventVisibleMinutes(ev, day)
  if (!visMins) return null
  const { startMin, endMin } = visMins
  const top    = (startMin / 60) * HOUR_HEIGHT
  const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2)

  const catCls = getCategoryClass(ev)
  const typeBadge = TYPE_BADGE[classified.meeting_type]
  const stats = classified.attendee_stats || { total: 0 }

  return (
    <button
      type="button"
      className={`agenda-event agenda-event--filled agenda-event--${classified.color_key}${classified.is_physical ? ' agenda-event--physical' : ''}${classified.is_online ? ' agenda-event--online' : ''}${catCls ? ' ' + catCls : ''}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      onClick={() => onClick({ ev, classified })}
      title={`${ev.subject || '(geen titel)'} — ${formatTimeRange(start, end)}${stats.total > 0 ? ` · ${stats.total} genodigd (${stats.accepted}✓ ${stats.tentative}? ${stats.declined}✗)` : ''}`}
      key={ev.id + toLocalDateKey(day)}
    >
      <span className="agenda-event__title">
        {ev.subject || '(geen titel)'}
        {stats.total > 0 && (
          <span
            className="agenda-event__people-inline"
            title={`${stats.total} genodigd · ${stats.accepted}✓ ja · ${stats.tentative}? misschien · ${stats.declined}✗ nee · ${stats.none} geen reactie`}
          >{stats.total}</span>
        )}
      </span>
      {height > 28 && (
        <span className="agenda-event__meta">
          {stats.total > 0 && height > 44 && (
            <span className="agenda-event__badge agenda-event__badge--people" title={`${stats.accepted} ja · ${stats.tentative} misschien · ${stats.declined} nee · ${stats.none} geen reactie`}>
              👥 {stats.total}
              {stats.accepted > 0 && <span className="agenda-event__people-yes">{`·${stats.accepted}✓`}</span>}
              {stats.declined > 0 && <span className="agenda-event__people-no">{`·${stats.declined}✗`}</span>}
            </span>
          )}
          {classified.is_online && ev.online_meeting_url && (
            <a
              className="agenda-event__badge agenda-event__badge--teams"
              href={ev.online_meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open in Teams"
            >Teams</a>
          )}
          {classified.is_online && !ev.online_meeting_url && (
            <span className="agenda-event__badge">online</span>
          )}
          {classified.is_physical && (
            <span className="agenda-event__badge agenda-event__badge--phys">fysiek</span>
          )}
          {typeBadge && height > 50 && (
            <span className="agenda-event__badge agenda-event__badge--type">
              {typeBadge}
            </span>
          )}
        </span>
      )}
    </button>
  )
}
