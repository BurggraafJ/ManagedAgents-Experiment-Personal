import Skeleton from '../../ui/Skeleton'
import { HOURS, DAY_START } from '../../../lib/agenda'

/**
 * AgendaSkeleton — loading-state voor AgendaView.
 *
 * Mimickt het exacte raster (5 dag-koloms, 60px tijd-as, 48px/uur) zodat de
 * overgang naar echte data geen layout-shift veroorzaakt. Topbar + toolbar
 * blijven echt (knoppen werken meteen), alleen de data-afhankelijke delen
 * (event-blokken, locatie-pills, week-label info) zijn shimmer-placeholders.
 *
 * Gebruik: render in AgendaView zolang `loading === true`.
 */

/* Placeholder event-cards: een vast skelet per dag zodat de visuele
 * "dichtheid" lijkt op een echte week. Geen randomness — voorkomt re-shuffle
 * bij re-render. */
const PLACEHOLDER_EVENTS = [
  [
    { top: 96,  height: 70,  short: false },
    { top: 240, height: 46,  short: true },
  ],
  [
    { top: 54,  height: 90,  short: false },
    { top: 174, height: 42,  short: true },
    { top: 288, height: 70,  short: false },
  ],
  [
    { top: 48,  height: 42,  short: true },
    { top: 96,  height: 90,  short: false },
    { top: 240, height: 46,  short: true },
  ],
  [
    { top: 0,   height: 42,  short: true },
    { top: 78,  height: 120, short: false },
    { top: 240, height: 46,  short: true },
  ],
  [
    { top: 96,  height: 70,  short: false },
    { top: 192, height: 46,  short: true },
  ],
]

export default function AgendaSkeleton() {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <Skeleton.Group label="Agenda wordt geladen — events, regels en locatieprognose ophalen">
      <div className="ag-grid ag-grid--week ag-grid--loading">
        {/* Day-headers */}
        <div className="ag-grid__header">
          <div className="ag-grid__time-col ag-grid__time-col--header" />
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="ag-grid__day-header">
              <div className="ag-grid__day-headtop">
                <Skeleton variant="line" width={22} />
                <Skeleton variant="line" width={28} height={18} className="ag-skel__day-num" />
              </div>
              <Skeleton variant="line" width="65%" className="ag-skel__day-loc" />
              <div className="ag-skel__day-bar"><Skeleton width="100%" height={3} /></div>
            </div>
          ))}
        </div>

        {/* All-day strook */}
        <div className="ag-grid__allday">
          <div className="ag-grid__time-col ag-grid__time-col--allday">hele dag</div>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="ag-grid__allday-cell">
              {i === 2 && <Skeleton variant="pill" width={78} />}
            </div>
          ))}
        </div>

        {/* Body grid */}
        <div className="ag-grid__body">
          <div className="ag-grid__time-col">
            {hourRows.map(h => (
              <div key={h} className="ag-grid__hour-label">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {PLACEHOLDER_EVENTS.map((dayEvents, idx) => (
            <div key={idx} className="ag-grid__daycol">
              {hourRows.map((_, i) => (
                <div
                  key={i}
                  className="ag-grid__hour-line"
                  style={{ top: `${i * 48}px`, height: '48px' }}
                />
              ))}
              {dayEvents.map((ev, evIdx) => (
                <div
                  key={evIdx}
                  className={`ag-skel__event ${ev.short ? 'ag-skel__event--short' : ''}`}
                  style={{ top: `${ev.top}px`, height: `${ev.height}px` }}
                >
                  <Skeleton variant="line" width="78%" />
                  {!ev.short && <Skeleton variant="line" width="48%" className="ag-skel__event-meta" />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Skeleton.Group>
  )
}
