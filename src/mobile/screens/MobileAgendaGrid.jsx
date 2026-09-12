import { useMemo } from 'react'
import MIcon from '../MIcon'
import { packLanes } from '../../lib/agenda'

/* MobileAgendaGrid — dag-tijdgrid in de taal van design A "Luchtlijn"
 * (2026-09-12): haarlijn per uur, veel wit, platte blokken met een gekleurde
 * linkerlijn. Vervangt de dagdeel-secties (Vanochtend/Vanmiddag/Vanavond) op
 * de telefoon; de statussen die daar zaten (afgerond, NU) leven verder als
 * modifier op het blok.
 *
 * Hele-dag-events staan boven de grid als chip — die hebben geen tijdvak.
 * Tik op een blok → detail-sheet. Tik op leeg tijdvak → nieuw-event-sheet.
 * Er is geen schrijf-pad; de sheet legt dat uit.
 *
 * Overlap loopt via `packLanes` uit lib/agenda.js — hetzelfde algoritme als de
 * desktop-week (design A "Banen"), zodat twee gelijktijdige events op telefoon
 * en desktop dezelfde indeling krijgen. */
export const M_AG_ROW = 54

const MIN_START = 8
const MIN_END = 19

function hours(events) {
  let start = MIN_START
  let end = MIN_END
  for (const e of events) {
    const s = new Date(e.start_time)
    const x = e.end_time ? new Date(e.end_time) : s
    start = Math.min(start, s.getHours())
    end = Math.max(end, x.getMinutes() > 0 ? x.getHours() + 1 : x.getHours())
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 4)) }
}

function rangeOf(e) {
  const start = new Date(e.start_time).getTime()
  const end = e.end_time ? new Date(e.end_time).getTime() : start + 30 * 60000
  return { start, end }
}

export default function MobileAgendaGrid({ day, events, now, onPickEvent, onPickSlot }) {
  const timed = events.filter(e => !e.is_all_day)
  const allDay = events.filter(e => e.is_all_day)
  const { start: h0, end: h1 } = useMemo(() => hours(timed), [timed])
  const rows = Array.from({ length: h1 - h0 }, (_, i) => h0 + i)
  const packed = useMemo(() => packLanes(timed, rangeOf), [timed])

  const dayStart = new Date(day)
  dayStart.setHours(h0, 0, 0, 0)
  const gridH = (h1 - h0) * M_AG_ROW
  const minsFromTop = (t) => (t - dayStart.getTime()) / 60000
  const isToday = now >= dayStart && minsFromTop(now.getTime()) <= (h1 - h0) * 60
  const nowTop = isToday ? (minsFromTop(now.getTime()) / 60) * M_AG_ROW : null

  const onSlot = (e) => {
    if (!onPickSlot) return
    const box = e.currentTarget.getBoundingClientRect()
    const raw = ((e.clientY - box.top) / M_AG_ROW) * 60
    const mins = Math.max(0, Math.min((h1 - h0) * 60 - 30, Math.round(raw / 15) * 15))
    const start = new Date(dayStart.getTime() + mins * 60000)
    onPickSlot({ start, end: new Date(start.getTime() + 30 * 60000) })
  }

  return (
    <div className="m-agl">
      {allDay.length > 0 && (
        <div className="m-agl__allday">
          <span className="m-agl__allday-lbl">hele dag</span>
          <div className="m-agl__allday-items">
            {allDay.map(e => (
              <button key={e.id} type="button" className="m-agl__chip" onClick={() => onPickEvent(e)}>
                {e.subject || '(geen titel)'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="m-agl__grid" style={{ height: `${gridH}px` }}>
        <div className="m-agl__axis">
          {rows.map(h => (
            <div key={h} className="m-agl__hour" style={{ height: `${M_AG_ROW}px` }}>
              <span>{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        <div className="m-agl__lanes" onClick={onSlot}>
          {rows.map((h, i) => (
            <div key={h} className="m-agl__line" style={{ top: `${i * M_AG_ROW}px`, height: `${M_AG_ROW}px` }} />
          ))}

          {packed.map(({ item: e, start, end, lane, lanes }) => {
            const top = Math.max(0, (minsFromTop(start) / 60) * M_AG_ROW)
            const bottom = Math.min(gridH, (minsFromTop(end) / 60) * M_AG_ROW)
            const height = Math.max(22, bottom - top - 2)
            const laneWidth = 100 / lanes
            const isPast = end < now.getTime()
            const isNow = start <= now.getTime() && now.getTime() <= end
            return (
              <button
                key={e.id}
                type="button"
                className={`m-agl__ev ${e.online_meeting_url ? 'is-online' : 'is-fysiek'} ${isPast ? 'is-past' : ''} ${isNow ? 'is-now' : ''} ${lanes > 1 ? 'is-lane' : ''}`}
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left: `calc(${(lane * laneWidth).toFixed(4)}% + 2px)`,
                  width: `calc(${laneWidth.toFixed(4)}% - 4px)`,
                }}
                onClick={ev => { ev.stopPropagation(); onPickEvent(e) }}
              >
                <span className="m-agl__ev-title">{e.subject || '(geen titel)'}</span>
                {height > 34 && (
                  <span className="m-agl__ev-meta">
                    {isNow && <span className="m-agl__ev-now">NU</span>}
                    <span>{fmt(new Date(start))}</span>
                    {(e.online_meeting_url || e.location_text) && (
                      <>
                        <MIcon name="pin" size={9} />
                        <span className="m-agl__ev-loc">
                          {e.online_meeting_url ? 'Online' : e.location_text}
                        </span>
                      </>
                    )}
                  </span>
                )}
              </button>
            )
          })}

          {nowTop != null && <div className="m-agl__now" style={{ top: `${nowTop}px` }} aria-hidden />}
        </div>
      </div>

      <p className="m-agl__hint">Tik op een leeg tijdvak voor een nieuw event.</p>
    </div>
  )
}

function fmt(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
