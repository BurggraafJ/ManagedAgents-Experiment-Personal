import { useState } from 'react'
import {
  HOURS,
  DAY_START,
  DOW_NL,
  MONTH_NL_SHORT,
  formatDayHeader,
  formatTimeRange,
  toLocalDateKey,
} from '../../../../lib/agenda'
import { AllDayRow, DayColumn } from '../AgendaWeekView'
import styles from '../AgendaView.module.css'

/**
 * AgendaMaestroWeekView — Maestro-variant van AgendaWeekView (mockup Agenda.html).
 *
 * Verschillen met AgendaWeekView:
 *   1. Toont alleen MA t/m VR (5 dagen) — mockup is 5-koloms grid
 *   2. AllDayRow met `alwaysVisible` zodat "Hele dag"-rij + "Interne dag"-pill
 *      ook zichtbaar zijn zonder all-day events
 *   3. Eigen modifier-class `agenda-grid--maestro` voor 5-koloms CSS-grid
 *
 * Hergebruikt DayColumn, AgendaEventCard, AgendaRulesOverlay 100% — geen
 * functionele duplicatie. Alleen layout-vorm wijzigt.
 */
export default function AgendaMaestroWeekView({
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
  // Mockup heeft 5 dagen (MA-VR). Filter zodat ZA niet rendert.
  const days5 = days.slice(0, 5)
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <>
      <div className="agenda-grid agenda-grid--maestro">
        <div className="agenda-grid__header">
          <div className="agenda-grid__time-col agenda-grid__time-col--header" />
          {days5.map(d => {
            const { dow, date, isToday } = formatDayHeader(d, today)
            const dowIdx = (d.getDay() + 6) % 7
            const isWednesday = dowIdx === 2
            const dayKey = toLocalDateKey(d)
            const loc = locationForecast[dayKey]
            const dayCount = (eventsByDay[dayKey] || []).length
            const showInternalPill = isWednesday && (!loc || /amsterdam/i.test(loc.location || ''))
            return (
              <div
                key={d.toISOString()}
                className={`agenda-grid__day-header ${isToday ? 'is-today' : ''}`}
              >
                <div className="agenda-grid__day-headtop">
                  <span className="agenda-grid__day-dow">
                    {dow}
                    {isToday && <span className="agenda-grid__day-today-tag"> · vandaag</span>}
                  </span>
                  <span className="agenda-grid__day-num">{date}</span>
                  {dayCount > 0 && (
                    <span className="agenda-grid__day-count" title={`${dayCount} events`}>{dayCount}</span>
                  )}
                </div>
                {showInternalPill ? (
                  <span
                    className="agenda-grid__day-loc agenda-grid__day-loc--internal"
                    title="Woensdag = interne dag (Amsterdam, geen klantafspraken)"
                  >
                    <PinIcon /> Amsterdam
                    <span className="agenda-grid__day-conf">intern</span>
                  </span>
                ) : loc ? (
                  <span
                    className={`agenda-grid__day-loc agenda-grid__day-loc--${loc.source}`}
                    title={`${loc.location} (${Math.round(loc.confidence * 100)}% zeker · bron: ${loc.source})`}
                  >
                    <PinIcon /> {loc.location}
                    <span className="agenda-grid__day-conf">{Math.round(loc.confidence * 100)}%</span>
                  </span>
                ) : (
                  <span
                    className="agenda-grid__day-loc agenda-grid__day-loc--unknown"
                    title="Geen locatie bekend voor deze dag"
                  >
                    <CircleIcon /> Onbekend
                  </span>
                )}
                {(showInternalPill || loc) && (
                  <span
                    className={`agenda-grid__day-bar ${styles.dayBar}`}
                    data-internal={showInternalPill ? '1' : '0'}
                    data-source={loc?.source || ''}
                    style={{ '--conf': `${Math.round((loc?.confidence ?? 1) * 100)}%` }}
                  />
                )}
              </div>
            )
          })}
        </div>

        <AllDayRow
          days={days5}
          eventsByDay={eventsByDay}
          onClickEvent={onClickEvent}
          alwaysVisible
        />

        <div className="agenda-grid__body">
          <div className="agenda-grid__time-col">
            {hourRows.map(h => (
              <div key={h} className="agenda-grid__hour-label">
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

      {/* Lijst-overzicht eronder — toon alle 6 dagen incl. zaterdag voor compleetheid */}
      <WeekListView days={days} eventsByDay={eventsByDay} onClickEvent={onClickEvent} />
    </>
  )
}

// ---- Mini SVG-iconen voor day-loc -------------------------------
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

// ---- Week list-view (uitklapbaar onder de grid) -----------------
function WeekListView({ days, eventsByDay, onClickEvent }) {
  const [open, setOpen] = useState(false)
  const totalEvents = days.reduce((sum, d) => sum + (eventsByDay[toLocalDateKey(d)] || []).length, 0)

  return (
    <div className={`agenda-list ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="agenda-list__toggle"
        onClick={() => setOpen(v => !v)}
      >
        <span>{open ? '▾' : '▸'} Lijst-overzicht week</span>
        <span className="agenda-list__total">{totalEvents} events</span>
      </button>
      {open && (
        <div className="agenda-list__body">
          {days.map(d => {
            const k = toLocalDateKey(d)
            const dayEvents = (eventsByDay[k] || [])
              .filter(({ ev }) => !ev.is_all_day)
              .sort((a, b) => new Date(a.ev.start_time) - new Date(b.ev.start_time))
            const dowIdx = (d.getDay() + 6) % 7
            return (
              <div key={k} className="agenda-list__day">
                <div className="agenda-list__day-header">
                  <strong>{DOW_NL[dowIdx]} {d.getDate()} {MONTH_NL_SHORT[d.getMonth()]}</strong>
                  <span className="agenda-list__day-count">{dayEvents.length}</span>
                </div>
                {dayEvents.length === 0 ? (
                  <div className="agenda-list__empty">— geen events —</div>
                ) : (
                  dayEvents.map(({ ev, classified }) => {
                    const start = new Date(ev.start_time)
                    const end   = new Date(ev.end_time)
                    return (
                      <button
                        type="button"
                        key={ev.id}
                        className={`agenda-list__row agenda-list__row--${classified.color_key}`}
                        onClick={() => onClickEvent({ ev, classified })}
                      >
                        <span className="agenda-list__time">{formatTimeRange(start, end)}</span>
                        <span className="agenda-list__title">{ev.subject || '(geen titel)'}</span>
                        <span className="agenda-list__meta">
                          {classified.attendee_stats?.total > 0 && (
                            <span className="agenda-list__people">{classified.attendee_stats.total}👥</span>
                          )}
                          {classified.is_online && <span className="agenda-list__tag">Teams</span>}
                          {classified.is_physical && <span className="agenda-list__tag">fysiek</span>}
                          {ev.location_text && <span className="agenda-list__loc">· {ev.location_text}</span>}
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
