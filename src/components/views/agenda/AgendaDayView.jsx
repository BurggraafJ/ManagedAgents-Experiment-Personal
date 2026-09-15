import { useRef } from 'react'
import {
  HOURS,
  DAY_START,
  sameDay,
  toLocalDateKey,
} from '../../../lib/agenda'
import { useScrollToNow } from '../../../hooks/useScrollToNow'
import { AllDayRow, DayColumn } from './AgendaWeekView'

/* AgendaDayView — mobiele dag-detail (één DayColumn + all-day strook +
 * tijd-as). Spiegel van AgendaDayView, hergebruikt ag-* sub-components uit
 * AgendaWeekView.
 *
 * v1.216: opent op "nu" in het midden (alleen als de dag vandaag is, één keer
 * per dag die je bekijkt), en neemt de veeg-handlers van AgendaView aan
 * (`swipe`) — veeg links/rechts is een dag verder/terug. */
export default function AgendaDayView({ day, eventsByDay, today, rules, showRules, onClickEvent, onClickSlot, swipe }) {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)
  const dayKey = toLocalDateKey(day)
  const dayEvents = eventsByDay[dayKey] || []
  const isToday = sameDay(day, today)

  const nowRef = useRef(null)
  useScrollToNow(nowRef, dayKey, isToday)

  return (
    <div className="ag-grid ag-grid--day" {...(swipe || {})}>
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
          onClickSlot={onClickSlot}
          nowRef={isToday ? nowRef : undefined}
        />
      </div>
    </div>
  )
}
