import { useMemo, useState } from 'react'
import {
  HOURS,
  DAY_START,
  DOW_NL,
  MONTH_NL_SHORT,
  formatDayHeader,
  formatTimeRange,
  toLocalDateKey,
  sameDay,
} from '../../../lib/agenda'
import AgendaEventCard, { AG_HOUR_HEIGHT } from './AgendaEventCard'
import AgendaRulesOverlay from './AgendaRulesOverlay'

/* AgendaWeekView — desktop 5-koloms week-grid (ma-vr) volgens mockup
 * Agenda.html. Geen import meer uit ../AgendaWeekView — alle sub-components
 * leven binnen maestro/ folder zodat V2 een spiegel-structuur heeft van V1.
 *
 * Eigen AllDayRow + DayColumn met ag-grid__* classes. Hour-height = 48px
 * (mockup) ipv V1's 56px. */
export default function AgendaWeekView({
  days,
  eventsByDay,
  today,
  rules,
  showRules,
  showProposals,
  proposalsByDay,
  locationForecast,
  onClickEvent,
}) {
  const days5 = days.slice(0, 5)
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <>
      <div className="ag-grid ag-grid--week">
        <div className="ag-grid__header">
          <div className="ag-grid__time-col ag-grid__time-col--header" />
          {days5.map(d => {
            const { dow, date, isToday } = formatDayHeader(d, today)
            const dowIdx = (d.getDay() + 6) % 7
            const isWednesday = dowIdx === 2
            const dayKey = toLocalDateKey(d)
            const loc = locationForecast[dayKey]
            const dayCount = (eventsByDay[dayKey] || []).length
            const showInternalDay = isWednesday && (!loc || /amsterdam/i.test(loc.location || ''))
            return (
              <div
                key={d.toISOString()}
                className={`ag-grid__day-header ${isToday ? 'is-today' : ''}`}
              >
                <div className="ag-grid__day-headtop">
                  <span className="ag-grid__day-dow">
                    {dow}
                    {isToday && <span className="ag-grid__day-today-tag"> · vandaag</span>}
                  </span>
                  <span className="ag-grid__day-num">{date}</span>
                  {dayCount > 0 && (
                    <span className="ag-grid__day-count" title={`${dayCount} events`}>{dayCount}</span>
                  )}
                </div>
                {showInternalDay ? (
                  <>
                    <span className="ag-grid__day-loc ag-grid__day-loc--internal" title="Woensdag = interne dag">
                      <GridIcon /> Intern
                      <span className="ag-grid__day-conf">regel</span>
                    </span>
                    <div className="ag-grid__day-bar ag-grid__day-bar--internal">
                      <span style={{ width: '100%' }} />
                    </div>
                  </>
                ) : loc ? (
                  <>
                    <span
                      className={`ag-grid__day-loc ag-grid__day-loc--${loc.source}`}
                      title={`${loc.location} (${Math.round(loc.confidence * 100)}% zeker · bron: ${loc.source})`}
                    >
                      <PinIcon /> {loc.location}
                      <span className="ag-grid__day-conf">{Math.round(loc.confidence * 100)}%</span>
                    </span>
                    <div className="ag-grid__day-bar">
                      <span style={{ width: `${Math.round(loc.confidence * 100)}%` }} />
                    </div>
                  </>
                ) : (
                  <>
                    <span className="ag-grid__day-loc ag-grid__day-loc--unknown" title="Geen locatie bekend">
                      <CircleIcon /> Onbekend
                    </span>
                    <div className="ag-grid__day-bar">
                      <span style={{ width: '0%' }} />
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <AllDayRow days={days5} eventsByDay={eventsByDay} onClickEvent={onClickEvent} alwaysVisible />

        <div className="ag-grid__body">
          <div className="ag-grid__time-col">
            {hourRows.map(h => (
              <div key={h} className="ag-grid__hour-label">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days5.map(d => (
            <DayColumn
              key={d.toISOString()}
              day={d}
              today={today}
              events={eventsByDay[toLocalDateKey(d)] || []}
              rules={rules}
              showRules={showRules}
              showProposals={showProposals}
              proposals={proposalsByDay?.[toLocalDateKey(d)] || []}
              forecastLoc={locationForecast[toLocalDateKey(d)]}
              onClickEvent={onClickEvent}
            />
          ))}
        </div>
      </div>

      <WeekListView days={days} eventsByDay={eventsByDay} onClickEvent={onClickEvent} />
    </>
  )
}

/* ---- All-day strook (export voor day-view) ---- */
export function AllDayRow({ days, eventsByDay, onClickEvent, singleDay, alwaysVisible = false }) {
  const hasAny = days.some(d => (eventsByDay[toLocalDateKey(d)] || []).some(({ ev }) => ev.is_all_day))
  if (!hasAny && !alwaysVisible) return null

  return (
    <div className={`ag-grid__allday ${singleDay ? 'ag-grid__allday--single' : ''}`}>
      <div className="ag-grid__time-col ag-grid__time-col--allday">hele dag</div>
      {days.map(d => {
        const k = toLocalDateKey(d)
        const all = (eventsByDay[k] || []).filter(({ ev }) => ev.is_all_day).slice(0, 3)
        const dowIdx = (d.getDay() + 6) % 7
        const isWednesday = dowIdx === 2
        return (
          <div key={d.toISOString()} className="ag-grid__allday-cell">
            {all.map(({ ev, classified }) => (
              <button
                key={ev.id + k}
                type="button"
                className={`ag-event ag-event--allday ag-event--${classified.color_key === 'allday' ? 'admin' : 'teams'}`}
                onClick={() => onClickEvent({ ev, classified })}
                title={ev.subject}
              >
                {ev.subject}
              </button>
            ))}
            {alwaysVisible && all.length === 0 && isWednesday && (
              <div className="ag-grid__internal-pill" title="Woensdag = interne dag">
                Interne dag
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---- Day-kolom (events + shadows + now-line) ---- */
export function DayColumn({ day, today, events, rules, showRules, showProposals, proposals = [], forecastLoc, onClickEvent }) {
  const isToday    = sameDay(day, today)
  const dowIdx     = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2

  const nowOffset = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (mins < 0 || mins > HOURS * 60) return null
    return (mins / 60) * AG_HOUR_HEIGHT
  }, [isToday])

  const timed = events.filter(({ ev }) => !ev.is_all_day)

  return (
    <div className={`ag-grid__daycol ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}>
      {Array.from({ length: HOURS }, (_, i) => (
        <div key={i} className="ag-grid__hour-line" style={{ top: `${i * AG_HOUR_HEIGHT}px`, height: `${AG_HOUR_HEIGHT}px` }} />
      ))}

      <AgendaRulesOverlay
        day={day}
        events={events}
        rules={rules}
        showRules={showRules}
        showProposals={showProposals}
        proposals={proposals}
        forecastLoc={forecastLoc}
      />

      {timed.map(({ ev, classified }) => (
        <AgendaEventCard
          key={ev.id + toLocalDateKey(day)}
          ev={ev}
          classified={classified}
          day={day}
          onClick={onClickEvent}
        />
      ))}

      {nowOffset != null && (
        <div className="ag-now-line" style={{ top: `${nowOffset}px` }} aria-hidden />
      )}
    </div>
  )
}

/* ---- Week list-view (uitklapbaar onder de grid) ---- */
function WeekListView({ days, eventsByDay, onClickEvent }) {
  const [open, setOpen] = useState(false)
  const totalEvents = days.reduce((sum, d) => sum + (eventsByDay[toLocalDateKey(d)] || []).length, 0)

  return (
    <div className={`ag-list ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="ag-list__toggle"
        onClick={() => setOpen(v => !v)}
      >
        <span>{open ? '▾' : '▸'} Lijst-overzicht week</span>
        <span className="ag-list__total">{totalEvents} events</span>
      </button>
      {open && (
        <div className="ag-list__body">
          {days.map(d => {
            const k = toLocalDateKey(d)
            const dayEvents = (eventsByDay[k] || [])
              .filter(({ ev }) => !ev.is_all_day)
              .sort((a, b) => new Date(a.ev.start_time) - new Date(b.ev.start_time))
            const dowIdx = (d.getDay() + 6) % 7
            return (
              <div key={k} className="ag-list__day">
                <div className="ag-list__day-header">
                  <strong>{DOW_NL[dowIdx]} {d.getDate()} {MONTH_NL_SHORT[d.getMonth()]}</strong>
                  <span className="ag-list__day-count">{dayEvents.length}</span>
                </div>
                {dayEvents.length === 0 ? (
                  <div className="ag-list__empty">— geen events —</div>
                ) : (
                  dayEvents.map(({ ev, classified }) => {
                    const start = new Date(ev.start_time)
                    const end   = new Date(ev.end_time)
                    return (
                      <button
                        type="button"
                        key={ev.id}
                        className={`ag-list__row ag-list__row--${classified.color_key}`}
                        onClick={() => onClickEvent({ ev, classified })}
                      >
                        <span className="ag-list__time">{formatTimeRange(start, end)}</span>
                        <span className="ag-list__title">{ev.subject || '(geen titel)'}</span>
                        <span className="ag-list__meta">
                          {classified.attendee_stats?.total > 0 && (
                            <span className="ag-list__people">{classified.attendee_stats.total}👥</span>
                          )}
                          {classified.is_online && <span className="ag-list__tag">Teams</span>}
                          {classified.is_physical && <span className="ag-list__tag">fysiek</span>}
                          {ev.location_text && <span className="ag-list__loc">· {ev.location_text}</span>}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ---- Mini SVG-iconen ---- */
function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function CircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h18M12 3v18" />
    </svg>
  )
}
