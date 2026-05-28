import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAgenda } from '../../hooks/useAgenda'
import MIcon from '../MIcon'

// MobileAgenda — dag-view met week-strip. Geport uit app/mobile-agenda.jsx.
// Hergebruikt useAgenda() (calendar_events). Tap op een event → briefing.
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const DAYS_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7  // ma=0
  x.setDate(x.getDate() - dow)
  return x
}
function isSameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }
function fmtHM(iso) { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }
function dayKey(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

export default function MobileAgenda() {
  const navigate = useNavigate()
  const { events, loading } = useAgenda()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [selected, setSelected] = useState(today)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today))

  const week = useMemo(() => {
    return [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d })
  }, [weekStart])

  const eventsByDay = useMemo(() => {
    const map = new Map()
    for (const e of (events || [])) {
      if (e.is_cancelled) continue
      const k = dayKey(e.start_time)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(e)
    }
    for (const arr of map.values()) arr.sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    return map
  }, [events])

  const selKey = dayKey(selected)
  const dayEvents = eventsByDay.get(selKey) || []
  const now = new Date()
  const past = dayEvents.filter(e => new Date(e.end_time || e.start_time) < now).length
  const upcoming = dayEvents.length - past
  const isTodaySel = isSameDay(selected, today)

  const goPrev = () => { const w = new Date(weekStart); w.setDate(w.getDate() - 7); setWeekStart(w) }
  const goNext = () => { const w = new Date(weekStart); w.setDate(w.getDate() + 7); setWeekStart(w) }
  const goToday = () => { setSelected(today); setWeekStart(startOfWeek(today)) }

  return (
    <div className="m-ag">
      <header className="m-ag__head">
        <div className="m-ag__head-top">
          <div className="m-tk__eyebrow">
            {`${MONTHS[selected.getMonth()].toUpperCase()} ${selected.getFullYear()}`}
            <span>Agenda</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="m-iconbtn" onClick={goPrev} aria-label="Vorige week">
              <span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><MIcon name="chevron" size={16} /></span>
            </button>
            <button type="button" className="m-iconbtn" onClick={goNext} aria-label="Volgende week">
              <MIcon name="chevron" size={16} />
            </button>
            <button type="button" className="m-iconbtn" onClick={goToday} aria-label="Vandaag" title="Vandaag">
              <MIcon name="cal" size={16} />
            </button>
          </div>
        </div>

        <div className="m-ag__weekstrip">
          {week.map(d => {
            const k = dayKey(d)
            const has = (eventsByDay.get(k) || []).length > 0
            const isToday = isSameDay(d, today)
            const isSel = isSameDay(d, selected)
            return (
              <button
                key={k}
                type="button"
                className={`m-ag__day ${isSel ? 'is-sel' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => setSelected(d)}
              >
                <span className="m-ag__day-lbl">{DAYS[d.getDay()]}</span>
                <span className="m-ag__day-num">{d.getDate()}</span>
                {has && <span className="m-ag__day-dot" />}
              </button>
            )
          })}
        </div>

        <h1 className="m-ag__title">
          {DAYS_FULL[selected.getDay()].charAt(0).toUpperCase() + DAYS_FULL[selected.getDay()].slice(1)}{' '}
          <span>{selected.getDate()} {MONTHS_SHORT[selected.getMonth()]}</span>
        </h1>
        <div className="m-greet-sub">
          {dayEvents.length === 0
            ? 'Geen events'
            : <>
                {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
                {past > 0 && ` · ${past} gehad`}
                {isTodaySel && upcoming > 0 && ` · ${upcoming} te gaan`}
              </>}
        </div>
      </header>

      <div className="m-ag__body">
        {dayEvents.length === 0 ? (
          loading ? (
            <div className="m-skel-list">{[0, 1, 2].map(i => <div key={i} className="m-skel m-skel--event" />)}</div>
          ) : (
            <div className="m-tl__empty">Geen events op deze dag.</div>
          )
        ) : (
          dayEvents.map(e => {
            const start = new Date(e.start_time)
            const end = e.end_time ? new Date(e.end_time) : new Date(start.getTime() + 30 * 60000)
            const isPast = end < now
            const isNow = start <= now && now <= end
            const dur = Math.max(0, Math.round((end - start) / 60000))
            const durLbl = dur >= 60 ? `${Math.round(dur / 60)} uur` : `${dur} min`
            return (
              <button
                key={e.id}
                type="button"
                className={`m-ag__event ${isPast ? 'is-past' : ''} ${isNow ? 'is-now' : ''}`}
                onClick={() => navigate(`/agenda/briefing/${e.id}`)}
              >
                <div className="m-ag__event-time">{fmtHM(e.start_time)}<small>{durLbl}</small></div>
                <div className="m-ag__event-body">
                  <div className="m-ag__event-title">{e.subject || '(geen titel)'}</div>
                  <div className="m-ag__event-meta">
                    {e.online_meeting_url
                      ? <span className="m-tl__tag m-tl__tag--info">Online</span>
                      : (e.location_text ? <span className="m-ag__event-loc">{e.location_text}</span> : null)}
                  </div>
                </div>
                {isNow && <span className="m-ag__event-now">NU</span>}
                <span className="m-ag__event-chev"><MIcon name="chevron" size={13} /></span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
