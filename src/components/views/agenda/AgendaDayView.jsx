import {
  HOURS,
  DAY_START,
  toLocalDateKey,
} from '../../../lib/agenda'
import { AllDayRow, DayColumn } from './AgendaWeekView'

/**
 * AgendaDayView — mobiele dag-detail (één DayColumn + all-day strook + tijd-as).
 * Hergebruikt AllDayRow + DayColumn uit AgendaWeekView.
 */
export default function AgendaDayView({ day, eventsByDay, today, rules, showRules, onClickEvent }) {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)
  const dayEvents = eventsByDay[toLocalDateKey(day)] || []

  return (
    <div className="agenda-grid agenda-grid--day">
      <AllDayRow days={[day]} eventsByDay={eventsByDay} onClickEvent={onClickEvent} singleDay />
      <div className="agenda-grid__body">
        <div className="agenda-grid__time-col">
          {hourRows.map(h => (
            <div key={h} className="agenda-grid__hour-label">
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        <DayColumn
          day={day}
          today={today}
          events={dayEvents}
          rules={rules}
          showRules={showRules}
          onClickEvent={onClickEvent}
        />
      </div>
    </div>
  )
}
