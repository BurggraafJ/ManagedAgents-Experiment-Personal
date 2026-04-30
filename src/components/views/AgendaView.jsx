import { useState, useMemo, useEffect } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'

// AgendaView v1 — Project AI Agenda Planner, F.1
//
// Lean Outlook-stijl week-view die calendar_events 1-op-1 spiegelt + dag-view
// op mobile. Event-classifier (F.2 lite) is hier al deterministisch ingebouwd
// (echte view in Postgres komt in F.2). Toggle "Toon spelregels" rendert
// shadow-blokken voor reistijd-buffers, lunch, na-18, di/do verkeer en
// woensdag-interne-dag-banner — alle uit agenda_planner_rules.
//
// Read-only voor F.1. Drag/create/edit gebeuren niet — Outlook blijft bron-
// van-waarheid. F.4 (planner-skill) en F.6 (mail-quick-action) komen later.

const HOUR_HEIGHT = 56          // px per uur
const DAY_START   = 7           // 07:00
const DAY_END     = 22          // 22:00
const HOURS       = DAY_END - DAY_START  // 15

const DOW_NL  = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const MONTH_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
                  'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTH_NL_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
                        'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// ---- Date helpers (lokale tijdzone) -------------------------------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function mondayOf(d) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7        // 0=ma..6=zo
  x.setDate(x.getDate() - dow)
  return x
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
  }
function formatWeekLabel(start) {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear  = start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${MONTH_NL[start.getMonth()]} ${start.getFullYear()}`
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTH_NL_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_NL_SHORT[end.getMonth()]} ${start.getFullYear()}`
  }
  return `${start.getDate()} ${MONTH_NL_SHORT[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_NL_SHORT[end.getMonth()]} ${end.getFullYear()}`
}
function formatDayHeader(d, today) {
  const isToday = sameDay(d, today)
  return { dow: DOW_NL[(d.getDay() + 6) % 7], date: d.getDate(), isToday }
}
function formatTimeRange(s, e) {
  const fmt = t => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return `${fmt(s)}–${fmt(e)}`
}

// ---- Event classifier (F.2 lite, deterministisch) -----------------
// Returns: { meeting_type, is_online, is_physical, color_key }
function classifyEvent(ev, attendeesByEvent, customerEmailSet) {
  const body  = (ev.body_preview || '').toLowerCase()
  const loc   = (ev.location_text || '').toLowerCase()
  const subj  = (ev.subject || '').toLowerCase()
  const teams = !!ev.online_meeting_url
              || body.includes('teams.microsoft.com')
              || body.includes('teams meeting')
              || loc.includes('microsoft teams')
  const meet  = body.includes('meet.google.com') || loc.includes('meet.google.com')
  const zoom  = body.includes('zoom.us') || loc.includes('zoom.us')
  const is_online = teams || meet || zoom
  const has_physical_location = (ev.location_text || '').trim().length > 0 && !loc.includes('teams') && !loc.includes('meet.google') && !loc.includes('zoom')
  const is_physical = has_physical_location && !is_online

  // Attendee-domains uit calendar_attendees mirror (per-event lookup)
  const attendees = attendeesByEvent[ev.id] || []
  const externalEmails = []
  let hasInternal = false
  let hasCustomer = false
  for (const a of attendees) {
    const email = (a?.email || '').toLowerCase()
    if (!email) continue
    const dom = email.split('@')[1] || ''
    if (dom.endsWith('legal-mind.nl') || dom.endsWith('burggraafgroup.nl')) {
      hasInternal = true
    } else {
      externalEmails.push(email)
      if (customerEmailSet.has(email)) hasCustomer = true
    }
  }

  // Type-bepaling
  let meeting_type = 'internal'
  if (externalEmails.length === 0) meeting_type = 'internal'
  else if (hasCustomer) meeting_type = 'client'
  else if (subj.includes('recruit') || subj.includes('sollicitatie')) meeting_type = 'recruitment'
  else if (subj.includes('partner') || subj.includes('jpr') || subj.includes('whoon')) meeting_type = 'partner'
  else if (subj.includes('demo')) meeting_type = 'demo'
  else meeting_type = 'external'

  if (ev.is_all_day && !hasInternal && externalEmails.length === 0) {
    // All-day zonder attendees = vakantiedag / persoonlijk
    if (meeting_type === 'internal') meeting_type = 'allday'
  }

  // Color-keys mappen op CSS-klassen
  const color_key = meeting_type === 'client'      ? 'client'
                  : meeting_type === 'demo'        ? 'demo'
                  : meeting_type === 'partner'     ? 'partner'
                  : meeting_type === 'recruitment' ? 'recruit'
                  : meeting_type === 'private'     ? 'private'
                  : meeting_type === 'allday'      ? 'allday'
                  : meeting_type === 'external'    ? 'external'
                  : 'internal'

  return { meeting_type, is_online, is_physical, color_key }
}

// ---- Main view ----------------------------------------------------
export default function AgendaView({ data }) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const isMobile = useMediaQuery('(max-width: 768px)')

  const [weekStart, setWeekStart]       = useState(() => mondayOf(new Date()))
  const [selectedDay, setSelectedDay]   = useState(today)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showRules, setShowRules]       = useState(false)

  // Bij switch naar mobile: zorg dat selectedDay binnen huidige week valt
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    if (selectedDay < weekStart || selectedDay >= wkEnd) {
      setSelectedDay(weekStart < today && today < wkEnd ? today : weekStart)
    }
  }, [weekStart, selectedDay, today])

  const events = data?.calendarEvents || []
  const rules  = data?.agendaPlannerRules || []
  const customerEmailSet = useMemo(() =>
    new Set((data?.hubspotCustomerEmails || []).map(c => (c.email || '').toLowerCase())),
    [data?.hubspotCustomerEmails])

  // Attendees mirror is een platte tabel — index per calendar_event_id zodat
  // classifier + modal er O(1) bij kunnen
  const attendeesByEvent = useMemo(() => {
    const map = {}
    for (const a of (data?.calendarAttendees || [])) {
      const key = a.calendar_event_id
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    return map
  }, [data?.calendarAttendees])

  // Filter events op huidige window + classify ineens
  const eventsByDay = useMemo(() => {
    const byDay = {}                                 // 'YYYY-MM-DD' -> [events]
    const wkEnd = addDays(weekStart, 7)
    for (const ev of events) {
      if (ev.is_cancelled) continue
      const start = new Date(ev.start_time)
      const end   = new Date(ev.end_time)
      if (end < weekStart || start >= wkEnd) continue
      // Voor multi-day events: registreer per dag binnen window
      const evDayStart = startOfDay(start)
      const evDayEnd   = startOfDay(end)
      let cur = evDayStart < weekStart ? new Date(weekStart) : new Date(evDayStart)
      while (cur < wkEnd && cur <= evDayEnd) {
        const k = cur.toISOString().slice(0, 10)
        if (!byDay[k]) byDay[k] = []
        byDay[k].push({ ev, classified: classifyEvent(ev, attendeesByEvent, customerEmailSet) })
        cur = addDays(cur, 1)
      }
    }
    return byDay
  }, [events, weekStart, customerEmailSet, attendeesByEvent])

  const goPrev   = () => setWeekStart(addDays(weekStart, -7))
  const goNext   = () => setWeekStart(addDays(weekStart, 7))
  const goToday  = () => setWeekStart(mondayOf(new Date()))

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="agenda-app">
      <AgendaToolbar
        weekStart={weekStart}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        showRules={showRules}
        onToggleRules={() => setShowRules(v => !v)}
        isMobile={isMobile}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        days={days}
        today={today}
      />

      {isMobile ? (
        <DayGrid
          day={selectedDay}
          eventsByDay={eventsByDay}
          today={today}
          rules={rules}
          showRules={showRules}
          onClickEvent={setSelectedEvent}
        />
      ) : (
        <WeekGrid
          days={days}
          eventsByDay={eventsByDay}
          today={today}
          rules={rules}
          showRules={showRules}
          onClickEvent={setSelectedEvent}
        />
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent.ev}
          classified={selectedEvent.classified}
          attendees={attendeesByEvent[selectedEvent.ev.id] || []}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  )
}

// ---- Toolbar ------------------------------------------------------
function AgendaToolbar({ weekStart, onPrev, onNext, onToday, showRules, onToggleRules, isMobile, selectedDay, onSelectDay, days, today }) {
  return (
    <div className="agenda-toolbar">
      <div className="agenda-toolbar__nav">
        <button type="button" className="btn btn--ghost" onClick={onToday} title="Naar deze week">Vandaag</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onPrev} aria-label="Vorige week">‹</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onNext} aria-label="Volgende week">›</button>
        <span className="agenda-toolbar__label">{formatWeekLabel(weekStart)}</span>
      </div>

      <div className="agenda-toolbar__actions">
        <label className="agenda-toolbar__toggle" title="Toon shadow-blokken: reistijd, lunch, verkeer-window, interne dag">
          <input type="checkbox" checked={showRules} onChange={onToggleRules} />
          <span>Toon spelregels</span>
        </label>
      </div>

      {isMobile && (
        <div className="agenda-toolbar__daybar">
          {days.map(d => {
            const { dow, date, isToday } = formatDayHeader(d, today)
            const active = sameDay(d, selectedDay)
            return (
              <button
                key={d.toISOString()}
                type="button"
                className={`agenda-toolbar__daybtn ${active ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => onSelectDay(d)}
              >
                <span className="agenda-toolbar__daybtn-dow">{dow}</span>
                <span className="agenda-toolbar__daybtn-num">{date}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Week-grid (desktop) -----------------------------------------
function WeekGrid({ days, eventsByDay, today, rules, showRules, onClickEvent }) {
  // Ruler met uren
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <div className="agenda-grid">
      {/* Header met dagen */}
      <div className="agenda-grid__header">
        <div className="agenda-grid__time-col agenda-grid__time-col--header" />
        {days.map(d => {
          const { dow, date, isToday } = formatDayHeader(d, today)
          const dowIdx = (d.getDay() + 6) % 7
          const isWednesday = dowIdx === 2
          return (
            <div
              key={d.toISOString()}
              className={`agenda-grid__day-header ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}
            >
              <span className="agenda-grid__day-dow">{dow}</span>
              <span className="agenda-grid__day-num">{date}</span>
              {showRules && isWednesday && (
                <span className="agenda-grid__day-rule" title="Woensdag is interne dag (regel: no_clients_on_wednesday)">Interne dag</span>
              )}
            </div>
          )
        })}
      </div>

      {/* All-day rij */}
      <AllDayRow days={days} eventsByDay={eventsByDay} onClickEvent={onClickEvent} />

      {/* Body — scrollable hour-rows × 7 day-cols */}
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
            events={eventsByDay[d.toISOString().slice(0, 10)] || []}
            rules={rules}
            showRules={showRules}
            onClickEvent={onClickEvent}
          />
        ))}
      </div>
    </div>
  )
}

// ---- Day-grid (mobile) -------------------------------------------
function DayGrid({ day, eventsByDay, today, rules, showRules, onClickEvent }) {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)
  const dayEvents = eventsByDay[day.toISOString().slice(0, 10)] || []

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

// ---- All-day row -------------------------------------------------
function AllDayRow({ days, eventsByDay, onClickEvent, singleDay }) {
  // Toon all-day events bovenaan; max 3 per dag, +N indien meer
  const hasAny = days.some(d => {
    const k = d.toISOString().slice(0, 10)
    return (eventsByDay[k] || []).some(({ ev }) => ev.is_all_day)
  })
  if (!hasAny) return null

  return (
    <div className={`agenda-grid__allday ${singleDay ? 'agenda-grid__allday--single' : ''}`}>
      <div className="agenda-grid__time-col agenda-grid__time-col--allday">Hele dag</div>
      {days.map(d => {
        const k = d.toISOString().slice(0, 10)
        const all = (eventsByDay[k] || []).filter(({ ev }) => ev.is_all_day).slice(0, 3)
        return (
          <div key={d.toISOString()} className="agenda-grid__allday-cell">
            {all.map(({ ev, classified }) => (
              <button
                key={ev.id + k}
                type="button"
                className={`agenda-event agenda-event--allday agenda-event--${classified.color_key}`}
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

// ---- Day-column met events --------------------------------------
function DayColumn({ day, today, events, rules, showRules, onClickEvent }) {
  const isToday = sameDay(day, today)
  const dowIdx = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2
  const isTuOrThu = dowIdx === 1 || dowIdx === 3

  // Now-line
  const nowOffset = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (mins < 0 || mins > HOURS * 60) return null
    return (mins / 60) * HOUR_HEIGHT
  }, [isToday])

  // Timed events (geen all-day)
  const timed = events.filter(({ ev }) => !ev.is_all_day)

  // Reistijd-buffer regels — alleen tonen als showRules en regel actief
  const travelBufferRule = rules.find(r => r.rule_key === 'physical_meeting_buffer_60min' && r.enabled)
  const trafficRule      = rules.find(r => r.rule_key === 'traffic_avoid_tue_thu_morning' && r.enabled)
  const lunchRule        = rules.find(r => r.rule_key === 'lunch_blocked_12_13' && r.enabled)
  const eveningRule      = rules.find(r => r.rule_key === 'no_meetings_after_18' && r.enabled)
  const wednesdayRule    = rules.find(r => r.rule_key === 'no_clients_on_wednesday' && r.enabled)

  return (
    <div className={`agenda-grid__daycol ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}>
      {/* Hour-grid lines */}
      {Array.from({ length: HOURS }, (_, i) => (
        <div key={i} className="agenda-grid__hour-line" style={{ top: `${i * HOUR_HEIGHT}px` }} />
      ))}

      {/* Shadow-blokken (F.5 lite) */}
      {showRules && (
        <>
          {wednesdayRule && isWednesday && (
            <div
              className="agenda-shadow agenda-shadow--internal-day"
              style={{ top: 0, height: `${HOURS * HOUR_HEIGHT}px` }}
              title="Interne dag (woensdag): geen klantafspraken plannen"
            />
          )}
          {trafficRule && isTuOrThu && (
            <ShadowBlock
              startMin={(8 - DAY_START) * 60}
              endMin={(10 - DAY_START) * 60}
              className="agenda-shadow--traffic"
              label="Verkeer-window"
            />
          )}
          {lunchRule && (
            <ShadowBlock
              startMin={(12 - DAY_START) * 60}
              endMin={(13 - DAY_START) * 60}
              className="agenda-shadow--lunch"
              label="Lunch"
            />
          )}
          {eveningRule && (
            <ShadowBlock
              startMin={(18 - DAY_START) * 60}
              endMin={HOURS * 60}
              className="agenda-shadow--evening"
              label="Geen meetings na 18:00"
            />
          )}
          {travelBufferRule && timed.map(({ ev, classified }) => {
            if (!classified.is_physical) return null
            const start = new Date(ev.start_time)
            const end   = new Date(ev.end_time)
            const startMin = (start.getHours() - DAY_START) * 60 + start.getMinutes()
            const endMin   = (end.getHours()   - DAY_START) * 60 + end.getMinutes()
            return (
              <span key={`buf-${ev.id}`}>
                <ShadowBlock
                  startMin={startMin - 60}
                  endMin={startMin}
                  className="agenda-shadow--travel"
                  label="Reistijd"
                />
                <ShadowBlock
                  startMin={endMin}
                  endMin={endMin + 60}
                  className="agenda-shadow--travel"
                  label="Reistijd"
                />
              </span>
            )
          })}
        </>
      )}

      {/* Events */}
      {timed.map(({ ev, classified }) => {
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const startMin = Math.max(0, (start.getHours() - DAY_START) * 60 + start.getMinutes())
        const endMin   = Math.min(HOURS * 60, (end.getHours() - DAY_START) * 60 + end.getMinutes())
        const top     = (startMin / 60) * HOUR_HEIGHT
        const height  = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2)
        return (
          <button
            type="button"
            key={ev.id + day.toISOString().slice(0, 10)}
            className={`agenda-event agenda-event--${classified.color_key} ${classified.is_physical ? 'agenda-event--physical' : ''} ${classified.is_online ? 'agenda-event--online' : ''}`}
            style={{ top: `${top}px`, height: `${height}px` }}
            onClick={() => onClickEvent({ ev, classified })}
            title={`${ev.subject || '(geen titel)'} — ${formatTimeRange(start, end)}`}
          >
            <span className="agenda-event__title">{ev.subject || '(geen titel)'}</span>
            {height > 38 && (
              <span className="agenda-event__meta">
                {ev.location_text && <span className="agenda-event__loc">{ev.location_text}</span>}
                {classified.is_online && <span className="agenda-event__badge">online</span>}
                {classified.is_physical && <span className="agenda-event__badge agenda-event__badge--phys">fysiek</span>}
              </span>
            )}
          </button>
        )
      })}

      {/* Now-line */}
      {nowOffset != null && (
        <div className="agenda-now-line" style={{ top: `${nowOffset}px` }} aria-hidden />
      )}
    </div>
  )
}

function ShadowBlock({ startMin, endMin, className, label }) {
  const top    = (startMin / 60) * HOUR_HEIGHT
  const height = ((endMin - startMin) / 60) * HOUR_HEIGHT
  if (height <= 0) return null
  return (
    <div className={`agenda-shadow ${className}`} style={{ top: `${top}px`, height: `${height}px` }} title={label}>
      {height > 24 && <span className="agenda-shadow__label">{label}</span>}
    </div>
  )
}

// ---- Detail-modal ------------------------------------------------
function EventDetailModal({ event, classified, attendees = [], onClose }) {
  const start = new Date(event.start_time)
  const end   = new Date(event.end_time)
  const dayLabel = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]}`

  return (
    <div className="agenda-modal__backdrop" onClick={onClose}>
      <div className="agenda-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="agenda-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className={`agenda-modal__type-strip agenda-event--${classified.color_key}`} />
        <div className="agenda-modal__head">
          <h2 className="agenda-modal__title">{event.subject || '(geen titel)'}</h2>
          <div className="agenda-modal__when">
            {dayLabel} · {formatTimeRange(start, end)}
          </div>
          <div className="agenda-modal__badges">
            <span className={`agenda-modal__badge agenda-modal__badge--${classified.color_key}`}>{classified.meeting_type}</span>
            {classified.is_online && <span className="agenda-modal__badge">online</span>}
            {classified.is_physical && <span className="agenda-modal__badge">fysiek</span>}
            {event.is_recurring && <span className="agenda-modal__badge">terugkerend</span>}
            {event.fireflies_meeting_id && <span className="agenda-modal__badge">fireflies</span>}
          </div>
        </div>

        {event.location_text && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Locatie</span>
            <span className="agenda-modal__val">{event.location_text}</span>
          </div>
        )}
        {event.organizer_name && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Organisator</span>
            <span className="agenda-modal__val">{event.organizer_name} {event.organizer_email && <em style={{ color: 'var(--text-muted)' }}>({event.organizer_email})</em>}</span>
          </div>
        )}
        {attendees.length > 0 && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Genodigden ({attendees.length})</span>
            <span className="agenda-modal__val">
              {attendees.slice(0, 8).map((a, i) => {
                const email = a?.email || ''
                const name  = a?.name || email
                return <span key={i} className="agenda-modal__attendee" title={email}>{name}</span>
              })}
              {attendees.length > 8 && <span className="agenda-modal__attendee">+{attendees.length - 8}</span>}
            </span>
          </div>
        )}
        {event.body_preview && (
          <div className="agenda-modal__body">{event.body_preview}</div>
        )}
        {event.online_meeting_url && (
          <a
            className="btn btn--ghost"
            href={event.online_meeting_url}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 12 }}
          >
            Open in Teams →
          </a>
        )}
      </div>
    </div>
  )
}
