import {
  TYPE_BADGE,
  formatTimeRange,
  eventVisibleMinutes,
  toLocalDateKey,
} from '../../../lib/agenda'

/* v3: lokale hour-height (mockup gebruikt 48px). Zo ontkoppelen
 * we de V2 visuele schaal van V1's 56px zonder /agenda te raken. */
export const AG_HOUR_HEIGHT = 48

/* AgendaEventCard — gepositioneerd event-blok voor één ag-grid__daycol.
 * Spiegel van AgendaEventCard, maar:
 *   - eigen ag-event class-set (geen class-collisie met index.css !important)
 *   - kleur-mapping volgt mockup-palet: teams (cream) / fysiek (blauw) /
 *     aandeel (rood) / internal (cream) / admin & blocked (grijs)
 *   - 48px hour-height
 */
function mapColorKey(classified, ev) {
  if (classified?.is_physical) return 'fysiek'
  const subj = (ev?.subject || '').toLowerCase()
  if (subj.includes('aandeel') || subj.includes('board meeting')) return 'aandeel'
  switch (classified?.color_key) {
    case 'client':
    case 'external':
    case 'demo':
      return 'fysiek'
    case 'internal':
    case 'partner':
    case 'recruit':
    case 'prospect':
      return 'teams'
    case 'allday':
    case 'private':
      return 'admin'
    default:
      return 'teams'
  }
}

export default function AgendaEventCard({ ev, classified, day, onClick }) {
  const start = new Date(ev.start_time)
  const end   = new Date(ev.end_time)

  const visMins = eventVisibleMinutes(ev, day)
  if (!visMins) return null
  const { startMin, endMin } = visMins
  const top    = (startMin / 60) * AG_HOUR_HEIGHT
  const height = Math.max(20, ((endMin - startMin) / 60) * AG_HOUR_HEIGHT - 2)

  const variant = mapColorKey(classified, ev)
  const typeBadge = TYPE_BADGE[classified.meeting_type]
  const stats = classified.attendee_stats || { total: 0 }
  const isBlocked = /\bfocus\b|geen meetings/i.test(ev.subject || '')

  return (
    <button
      type="button"
      className={`ag-event ag-event--${isBlocked ? 'blocked' : variant}`}
      style={{ top: `${top}px`, height: `${height}px` }}
      onClick={() => onClick({ ev, classified })}
      title={`${ev.subject || '(geen titel)'} — ${formatTimeRange(start, end)}${stats.total > 0 ? ` · ${stats.total} genodigd (${stats.accepted}✓ ${stats.tentative}? ${stats.declined}✗)` : ''}`}
      key={ev.id + toLocalDateKey(day)}
    >
      <span className="ag-event__title">
        {ev.subject || '(geen titel)'}
      </span>
      {height > 28 && (
        <span className="ag-event__meta">
          <span className="ag-event__time">{formatTimeRange(start, end).split('–')[0]}</span>
          {ev.location_text && (
            <>
              <span className="ag-event__sep">·</span>
              <span className="ag-event__loc">{ev.location_text.length > 22 ? ev.location_text.slice(0, 20) + '…' : ev.location_text}</span>
            </>
          )}
          {stats.total > 0 && height > 44 && (
            <span className="ag-event__people" title={`${stats.accepted} ja · ${stats.tentative} misschien · ${stats.declined} nee · ${stats.none} geen reactie`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3"/>
                <circle cx="16" cy="9" r="2.5"/>
                <path d="M3 20a6 6 0 0112 0M14 20a5 5 0 017-4.5"/>
              </svg>
              {stats.total}
            </span>
          )}
          {stats.total > 0 && height > 44 && (stats.accepted > 0 || stats.declined > 0) && (
            <span className="ag-event__rsvp">
              {stats.accepted > 0 && <span className="ag-event__rsvp-ok">·{stats.accepted}✓</span>}
              {stats.declined > 0 && <span className="ag-event__rsvp-ko">·{stats.declined}✗</span>}
            </span>
          )}
          {classified.is_online && ev.online_meeting_url && (
            <a
              className="ag-event__badge ag-event__badge--teams"
              href={ev.online_meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open in Teams"
            >Teams</a>
          )}
          {classified.is_online && !ev.online_meeting_url && (
            <span className="ag-event__badge">online</span>
          )}
          {classified.is_physical && (
            <span className="ag-event__badge">fysiek</span>
          )}
          {typeBadge && height > 56 && (
            <span className="ag-event__badge">{typeBadge}</span>
          )}
        </span>
      )}
    </button>
  )
}
