import { useMemo, useState } from 'react'
import {
  HOUR_HEIGHT,
  HOURS,
  DAY_START,
  DOW_NL,
  MONTH_NL_SHORT,
  formatDayHeader,
  formatTimeRange,
  getCategoryClass,
  toLocalDateKey,
  sameDay,
} from '../../../lib/agenda'
import AgendaEventCard from './AgendaEventCard'
import AgendaRulesOverlay from './AgendaRulesOverlay'
import styles from './AgendaView.module.css'

/**
 * AgendaWeekView — desktop week-grid (ma-za) met header-rij (datum + locatie-pill),
 * all-day strook, hour-grid en lijst-overzicht eronder.
 *
 * Exporteert ook AllDayRow + DayColumn zodat AgendaDayView ze kan hergebruiken.
 */
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
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <>
      <div className="agenda-grid">
        <div className="agenda-grid__header">
          <div className="agenda-grid__time-col agenda-grid__time-col--header" />
          {days.map(d => {
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
                  <span className="agenda-grid__day-dow">{dow}</span>
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
                    Amsterdam
                    <span className="agenda-grid__day-conf">intern</span>
                  </span>
                ) : loc ? (
                  <span
                    className={`agenda-grid__day-loc agenda-grid__day-loc--${loc.source}`}
                    title={`${loc.location} (${Math.round(loc.confidence * 100)}% zeker · bron: ${loc.source})`}
                  >
                    {loc.location}
                    <span className="agenda-grid__day-conf">{Math.round(loc.confidence * 100)}%</span>
                  </span>
                ) : null}
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

        <AllDayRow days={days} eventsByDay={eventsByDay} onClickEvent={onClickEvent} />

        <div className="agenda-grid__body">
          <div className="agenda-grid__time-col">
            {hourRows.map(h => (
              <div key={h} className="agenda-grid__hour-label">
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map(d => (
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

// ---- All-day strook ---------------------------------------------
export function AllDayRow({ days, eventsByDay, onClickEvent, singleDay }) {
  const hasAny = days.some(d => (eventsByDay[toLocalDateKey(d)] || []).some(({ ev }) => ev.is_all_day))
  if (!hasAny) return null

  return (
    <div className={`agenda-grid__allday ${singleDay ? 'agenda-grid__allday--single' : ''}`}>
      <div className="agenda-grid__time-col agenda-grid__time-col--allday">Hele dag</div>
      {days.map(d => {
        const k = toLocalDateKey(d)
        const all = (eventsByDay[k] || []).filter(({ ev }) => ev.is_all_day).slice(0, 3)
        const catCls = all[0] ? getCategoryClass(all[0].ev) : null
        return (
          <div key={d.toISOString()} className="agenda-grid__allday-cell">
            {all.map(({ ev, classified }) => (
              <button
                key={ev.id + k}
                type="button"
                className={`agenda-event agenda-event--allday agenda-event--${classified.color_key}${catCls ? ' ' + catCls : ''}`}
                onClick={() => onClickEvent({ ev, classified })}
                title={ev.subject}
              >
                {ev.subject}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ---- Day-kolom (events + shadows + now-line) --------------------
export function DayColumn({ day, today, events, rules, showRules, showProposals, proposals = [], forecastLoc, onClickEvent }) {
  const isToday    = sameDay(day, today)
  const dowIdx     = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2

  const nowOffset = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (mins < 0 || mins > HOURS * 60) return null
    return (mins / 60) * HOUR_HEIGHT
  }, [isToday])

  const timed = events.filter(({ ev }) => !ev.is_all_day)

  return (
    <div className={`agenda-grid__daycol ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}>
      {Array.from({ length: HOURS }, (_, i) => (
        <div key={i} className="agenda-grid__hour-line" style={{ top: `${i * HOUR_HEIGHT}px` }} />
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
        <div className="agenda-now-line" style={{ top: `${nowOffset}px` }} aria-hidden />
      )}
    </div>
  )
}

// ---- Week list-view (fallback / overzicht) ----------------------
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
