import {
  HOURS,
  DAY_START,
  toLocalDateKey,
} from '../../../lib/agenda'
import { AllDayRow, DayColumn } from './AgendaWeekView'

/* AgendaDayView — mobiele dag-detail (één DayColumn + all-day strook +
 * tijd-as). Spiegel van AgendaDayView, hergebruikt ag-* sub-components uit
 * AgendaWeekView. */
export default function AgendaDayView({ day, eventsByDay, today, rules, showRules, onClickEvent }) {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)
  const dayEvents = eventsByDay[toLocalDateKey(day)] || []

  return (
    <div className="ag-grid ag-grid--day">
      <AllDayRow days={[day]} eventsByDay={eventsByDay} onClickEvent={onClickEvent} singleDay alwaysVisible />
      <div className="ag-grid__body">
        <div className="ag-grid__time-col">
          {hourRows.map(h => (
            <div key={h} className="ag-grid__hour-label">
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
