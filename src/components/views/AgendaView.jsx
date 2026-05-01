import { useState, useMemo, useEffect, useCallback } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { supabase } from '../../lib/supabase'

// AgendaView v2 — Sprint 2: F.9 + F.3 + F.10 + F.11
// F.9:  maandselector · Teams-badge · type-badge · category-kleuren · voor-09 shadow · verkeer alle dagen
// F.3:  instellingenpagina spelregels (⚙-knop, panel met toggle/edit/add)
// F.10: locatieprognose-labels in day-headers (tabel agenda_location_forecast)
// F.11: voice-input knop + modal (tabel agenda_voice_notes)

const HOUR_HEIGHT = 56
const DAY_START   = 7
const DAY_END     = 22
const HOURS       = DAY_END - DAY_START  // 15

const DOW_NL   = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const MONTH_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
                  'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTH_NL_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
                        'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// Outlook-categorie → CSS-suffix mapping (NL + EN namen)
const CATEGORY_COLOR_MAP = {
  'rode categorie': 'red',    'red category': 'red',    'rood': 'red',
  'oranje categorie': 'orange', 'orange category': 'orange', 'oranje': 'orange',
  'gele categorie': 'yellow', 'yellow category': 'yellow', 'geel': 'yellow',
  'groene categorie': 'green', 'green category': 'green', 'groen': 'green',
  'blauwe categorie': 'blue', 'blue category': 'blue',  'blauw': 'blue',
  'paarse categorie': 'purple', 'purple category': 'purple', 'paars': 'purple',
  'grijze categorie': 'grey', 'grey category': 'grey',  'grijs': 'grey',
}
function getCategoryClass(ev) {
  const cats = Array.isArray(ev.categories) ? ev.categories : []
  for (const cat of cats) {
    const key = (cat || '').toLowerCase().trim()
    if (CATEGORY_COLOR_MAP[key]) return `agenda-event--cat-${CATEGORY_COLOR_MAP[key]}`
  }
  return null
}

// Korte badge-labels per meeting type
const TYPE_BADGE = {
  client: 'Klant', internal: 'Intern', external: 'Extern',
  demo: 'Demo', partner: 'Partner', recruitment: 'Recruit',
  allday: null, private: null,
}

// ---- Date helpers ------------------------------------------------
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function mondayOf(d) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate()
}
function toLocalDateKey(d) {
  // Gebruik lokale datum als sleutel (YYYY-MM-DD) — vermijdt UTC-verschuiving
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatWeekLabel(start) {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear  = start.getFullYear() === end.getFullYear()
  if (sameMonth) return `${start.getDate()} – ${end.getDate()} ${MONTH_NL[start.getMonth()]} ${start.getFullYear()}`
  if (sameYear)  return `${start.getDate()} ${MONTH_NL_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_NL_SHORT[end.getMonth()]} ${start.getFullYear()}`
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

// ---- Event classifier (F.2 lite, deterministisch) ----------------
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
  const has_physical_location = (ev.location_text || '').trim().length > 0
    && !loc.includes('teams') && !loc.includes('meet.google') && !loc.includes('zoom')
  const is_physical = has_physical_location && !is_online

  const attendees = attendeesByEvent[ev.id] || []
  const externalEmails = []
  let hasCustomer = false
  for (const a of attendees) {
    const email = (a?.email || '').toLowerCase()
    if (!email) continue
    const dom = email.split('@')[1] || ''
    if (!dom.endsWith('legal-mind.nl') && !dom.endsWith('burggraafgroup.nl')) {
      externalEmails.push(email)
      if (customerEmailSet.has(email)) hasCustomer = true
    }
  }

  let meeting_type = 'internal'
  if (externalEmails.length > 0) {
    if (hasCustomer) meeting_type = 'client'
    else if (subj.includes('recruit') || subj.includes('sollicitatie')) meeting_type = 'recruitment'
    else if (subj.includes('partner') || subj.includes('jpr') || subj.includes('whoon')) meeting_type = 'partner'
    else if (subj.includes('demo')) meeting_type = 'demo'
    else meeting_type = 'external'
  }
  if (ev.is_all_day && meeting_type === 'internal' && externalEmails.length === 0) meeting_type = 'allday'

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

// ---- Main view ---------------------------------------------------
export default function AgendaView({ data }) {
  const today   = useMemo(() => startOfDay(new Date()), [])
  const isMobile = useMediaQuery('(max-width: 768px)')

  const [weekStart, setWeekStart]       = useState(() => mondayOf(new Date()))
  const [selectedDay, setSelectedDay]   = useState(today)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showRules, setShowRules]       = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showVoice, setShowVoice]       = useState(false)

  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    if (selectedDay < weekStart || selectedDay >= wkEnd) {
      setSelectedDay(weekStart < today && today < wkEnd ? today : weekStart)
    }
  }, [weekStart, selectedDay, today])

  const events       = data?.calendarEvents || []
  const rules        = data?.agendaPlannerRules || []
  const locationForecast = useMemo(() => {
    const map = {}
    for (const row of (data?.agendaLocationForecast || [])) {
      map[row.forecast_date] = row
    }
    return map
  }, [data?.agendaLocationForecast])

  const customerEmailSet = useMemo(() =>
    new Set((data?.hubspotCustomerEmails || []).map(c => (c.email || '').toLowerCase())),
    [data?.hubspotCustomerEmails])

  const attendeesByEvent = useMemo(() => {
    const map = {}
    for (const a of (data?.calendarAttendees || [])) {
      const key = a.calendar_event_id
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    return map
  }, [data?.calendarAttendees])

  const eventsByDay = useMemo(() => {
    const byDay = {}
    const wkEnd = addDays(weekStart, 7)
    for (const ev of events) {
      if (ev.is_cancelled) continue
      const start = new Date(ev.start_time)
      const end   = new Date(ev.end_time)
      if (end < weekStart || start >= wkEnd) continue
      const evDayStart = startOfDay(start)
      const evDayEnd   = startOfDay(end)
      let cur = evDayStart < weekStart ? new Date(weekStart) : new Date(evDayStart)
      while (cur < wkEnd && cur <= evDayEnd) {
        const k = toLocalDateKey(cur)
        if (!byDay[k]) byDay[k] = []
        byDay[k].push({ ev, classified: classifyEvent(ev, attendeesByEvent, customerEmailSet) })
        cur = addDays(cur, 1)
      }
    }
    return byDay
  }, [events, weekStart, customerEmailSet, attendeesByEvent])

  const goPrev  = () => setWeekStart(addDays(weekStart, -7))
  const goNext  = () => setWeekStart(addDays(weekStart, 7))
  const goToday = () => setWeekStart(mondayOf(new Date()))

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div className="agenda-app">
      <AgendaToolbar
        weekStart={weekStart}
        onPrev={goPrev}
        onNext={goNext}
        onToday={goToday}
        onNavigate={setWeekStart}
        showRules={showRules}
        onToggleRules={() => setShowRules(v => !v)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenVoice={() => setShowVoice(true)}
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
          locationForecast={locationForecast}
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

      {showSettings && (
        <AgendaSettingsPanel
          rules={rules}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showVoice && (
        <AgendaVoiceModal
          weekStart={weekStart}
          onClose={() => setShowVoice(false)}
        />
      )}
    </div>
  )
}

// ---- Toolbar -----------------------------------------------------
function MonthSelector({ weekStart, onNavigate }) {
  const now = new Date()
  const months = []
  for (let i = -3; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() })
  }
  const currentKey = `${weekStart.getFullYear()}-${weekStart.getMonth()}`
  return (
    <select
      className="agenda-month-select"
      value={currentKey}
      onChange={e => {
        const [y, m] = e.target.value.split('-').map(Number)
        onNavigate(mondayOf(new Date(y, m, 1)))
      }}
      title="Ga naar maand"
    >
      {months.map(({ year, month }) => (
        <option key={`${year}-${month}`} value={`${year}-${month}`}>
          {MONTH_NL_SHORT[month]} {year}
        </option>
      ))}
    </select>
  )
}

function AgendaToolbar({ weekStart, onPrev, onNext, onToday, onNavigate, showRules, onToggleRules, onOpenSettings, onOpenVoice, isMobile, selectedDay, onSelectDay, days, today }) {
  return (
    <div className="agenda-toolbar">
      <div className="agenda-toolbar__nav">
        <MonthSelector weekStart={weekStart} onNavigate={onNavigate} />
        <button type="button" className="btn btn--ghost" onClick={onToday} title="Naar deze week">Vandaag</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onPrev} aria-label="Vorige week">‹</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onNext} aria-label="Volgende week">›</button>
        <span className="agenda-toolbar__label">{formatWeekLabel(weekStart)}</span>
      </div>

      <div className="agenda-toolbar__actions">
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenVoice}
          title="Weeknotitie toevoegen"
          aria-label="Weeknotitie toevoegen"
        >🎤</button>
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenSettings}
          title="Spelregels instellingen"
          aria-label="Instellingen"
        >⚙</button>
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

// ---- Week-grid (desktop) ----------------------------------------
function WeekGrid({ days, eventsByDay, today, rules, showRules, locationForecast, onClickEvent }) {
  const hourRows = Array.from({ length: HOURS }, (_, i) => DAY_START + i)

  return (
    <div className="agenda-grid">
      <div className="agenda-grid__header">
        <div className="agenda-grid__time-col agenda-grid__time-col--header" />
        {days.map(d => {
          const { dow, date, isToday } = formatDayHeader(d, today)
          const dowIdx = (d.getDay() + 6) % 7
          const isWednesday = dowIdx === 2
          const dayKey = toLocalDateKey(d)
          const loc = locationForecast[dayKey]
          return (
            <div
              key={d.toISOString()}
              className={`agenda-grid__day-header ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}
            >
              <span className="agenda-grid__day-dow">{dow}</span>
              <span className="agenda-grid__day-num">{date}</span>
              {loc && (
                <span
                  className={`agenda-grid__day-loc agenda-grid__day-loc--${loc.source}`}
                  style={{ opacity: 0.4 + loc.confidence * 0.6 }}
                  title={`${loc.location} (${Math.round(loc.confidence * 100)}% zeker · bron: ${loc.source})`}
                >
                  {loc.location.length > 5 ? loc.location.slice(0, 4) + '…' : loc.location}
                </span>
              )}
              {showRules && isWednesday && (
                <span className="agenda-grid__day-rule" title="Woensdag is interne dag">Interne dag</span>
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
            onClickEvent={onClickEvent}
          />
        ))}
      </div>
    </div>
  )
}

// ---- Day-grid (mobile) ------------------------------------------
function DayGrid({ day, eventsByDay, today, rules, showRules, onClickEvent }) {
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

// ---- All-day row ------------------------------------------------
function AllDayRow({ days, eventsByDay, onClickEvent, singleDay }) {
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

// ---- Day-column met events --------------------------------------
function DayColumn({ day, today, events, rules, showRules, onClickEvent }) {
  const isToday    = sameDay(day, today)
  const dowIdx     = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2
  const isTuOrThu  = dowIdx === 1 || dowIdx === 3
  const isWeekday  = dowIdx <= 4

  const nowOffset = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (mins < 0 || mins > HOURS * 60) return null
    return (mins / 60) * HOUR_HEIGHT
  }, [isToday])

  const timed = events.filter(({ ev }) => !ev.is_all_day)

  // Spelregel lookups
  const travelBufferRule = rules.find(r => r.rule_key === 'physical_meeting_buffer_60min' && r.enabled)
  const trafficOldRule   = rules.find(r => r.rule_key === 'traffic_avoid_tue_thu_morning' && r.enabled)
  const trafficAllRule   = rules.find(r => r.rule_key === 'traffic_window_09_10_all_days' && r.enabled)
  const before9Rule      = rules.find(r => r.rule_key === 'no_meetings_before_09' && r.enabled)
  const lunchRule        = rules.find(r => r.rule_key === 'lunch_blocked_12_13' && r.enabled)
  const eveningRule      = rules.find(r => r.rule_key === 'no_meetings_after_18' && r.enabled)
  const wednesdayRule    = rules.find(r => r.rule_key === 'no_clients_on_wednesday' && r.enabled)

  // Verkeers-window: nieuwe regel (alle werkdagen) of oude (di/do)
  const showTraffic = showRules && isWeekday && (
    (trafficAllRule) || (trafficOldRule && isTuOrThu)
  )

  return (
    <div className={`agenda-grid__daycol ${isToday ? 'is-today' : ''} ${showRules && isWednesday ? 'is-internal-day' : ''}`}>
      {Array.from({ length: HOURS }, (_, i) => (
        <div key={i} className="agenda-grid__hour-line" style={{ top: `${i * HOUR_HEIGHT}px` }} />
      ))}

      {showRules && (
        <>
          {wednesdayRule && isWednesday && (
            <div
              className="agenda-shadow agenda-shadow--internal-day"
              style={{ top: 0, height: `${HOURS * HOUR_HEIGHT}px` }}
              title="Interne dag (woensdag): geen klantafspraken plannen"
            />
          )}
          {before9Rule && (
            <ShadowBlock
              startMin={0}
              endMin={(9 - DAY_START) * 60}
              className="agenda-shadow--before9"
              label="Geen meetings"
            />
          )}
          {showTraffic && (
            <ShadowBlock
              startMin={(9 - DAY_START) * 60}
              endMin={(10 - DAY_START) * 60}
              className="agenda-shadow--traffic"
              label="Verkeers-window"
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
                <ShadowBlock startMin={startMin - 60} endMin={startMin} className="agenda-shadow--travel" label="Reistijd" />
                <ShadowBlock startMin={endMin} endMin={endMin + 60} className="agenda-shadow--travel" label="Reistijd" />
              </span>
            )
          })}
        </>
      )}

      {timed.map(({ ev, classified }) => {
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const startMin = Math.max(0, (start.getHours() - DAY_START) * 60 + start.getMinutes())
        const endMin   = Math.min(HOURS * 60, (end.getHours() - DAY_START) * 60 + end.getMinutes())
        const top    = (startMin / 60) * HOUR_HEIGHT
        const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2)
        const catCls = getCategoryClass(ev)
        const typeBadge = TYPE_BADGE[classified.meeting_type]

        return (
          <button
            type="button"
            key={ev.id + toLocalDateKey(day)}
            className={`agenda-event agenda-event--${classified.color_key}${classified.is_physical ? ' agenda-event--physical' : ''}${classified.is_online ? ' agenda-event--online' : ''}${catCls ? ' ' + catCls : ''}`}
            style={{ top: `${top}px`, height: `${height}px` }}
            onClick={() => onClickEvent({ ev, classified })}
            title={`${ev.subject || '(geen titel)'} — ${formatTimeRange(start, end)}`}
          >
            <span className="agenda-event__title">{ev.subject || '(geen titel)'}</span>
            {height > 28 && (
              <span className="agenda-event__meta">
                {classified.is_online && ev.online_meeting_url && (
                  <a
                    className="agenda-event__badge agenda-event__badge--teams"
                    href={ev.online_meeting_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={e => e.stopPropagation()}
                    title="Open in Teams"
                  >Teams</a>
                )}
                {classified.is_online && !ev.online_meeting_url && (
                  <span className="agenda-event__badge">online</span>
                )}
                {classified.is_physical && (
                  <span className="agenda-event__badge agenda-event__badge--phys">fysiek</span>
                )}
                {typeBadge && height > 40 && (
                  <span className={`agenda-event__badge agenda-event__badge--type agenda-event__badge--${classified.color_key}`}>
                    {typeBadge}
                  </span>
                )}
              </span>
            )}
          </button>
        )
      })}

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

// ---- Detail-modal -----------------------------------------------
function EventDetailModal({ event, classified, attendees = [], onClose }) {
  const start = new Date(event.start_time)
  const end   = new Date(event.end_time)
  const dayLabel = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]}`
  const onlinePlatform = event.online_meeting_url
    ? (event.online_meeting_url.includes('teams') ? 'Teams' : 'Online')
    : null

  return (
    <div className="agenda-modal__backdrop" onClick={onClose}>
      <div className="agenda-modal" onClick={e => e.stopPropagation()}>
        <button type="button" className="agenda-modal__close" onClick={onClose} aria-label="Sluiten">×</button>
        <div className={`agenda-modal__type-strip agenda-event--${classified.color_key}`} />
        <div className="agenda-modal__head">
          <h2 className="agenda-modal__title">{event.subject || '(geen titel)'}</h2>
          <div className="agenda-modal__when">{dayLabel} · {formatTimeRange(start, end)}</div>
          <div className="agenda-modal__badges">
            <span className={`agenda-modal__badge agenda-modal__badge--${classified.color_key}`}>
              {TYPE_BADGE[classified.meeting_type] || classified.meeting_type}
            </span>
            {onlinePlatform && <span className="agenda-modal__badge">{onlinePlatform}</span>}
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
            <span className="agenda-modal__val">
              {event.organizer_name} {event.organizer_email && <em style={{ color: 'var(--text-muted)' }}>({event.organizer_email})</em>}
            </span>
          </div>
        )}
        {attendees.length > 0 && (
          <div className="agenda-modal__row">
            <span className="agenda-modal__lbl">Genodigden ({attendees.length})</span>
            <span className="agenda-modal__val">
              {attendees.slice(0, 8).map((a, i) => (
                <span key={i} className="agenda-modal__attendee" title={a?.email || ''}>{a?.name || a?.email || ''}</span>
              ))}
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
            Open in {onlinePlatform || 'online meeting'} →
          </a>
        )}
      </div>
    </div>
  )
}

// ---- Settings panel (F.3) ---------------------------------------
function AgendaSettingsPanel({ rules: enabledRules, onClose }) {
  const [allRules, setAllRules] = useState(null)
  const [saving, setSaving]     = useState(null)
  const [newRule, setNewRule]   = useState({ rule_key: '', rule_type: 'custom', description: '', priority: 50 })
  const [adding, setAdding]     = useState(false)
  const [addError, setAddError] = useState('')

  // Laad alle rules (ook disabled) bij openen panel
  const loadRules = useCallback(async () => {
    const { data } = await supabase
      .from('agenda_planner_rules')
      .select('*')
      .order('priority', { ascending: false })
    setAllRules(data || [])
  }, [])

  useEffect(() => { loadRules() }, [loadRules])

  const toggleRule = async (rule) => {
    setSaving(rule.id)
    await supabase
      .from('agenda_planner_rules')
      .update({ enabled: !rule.enabled })
      .eq('id', rule.id)
    await loadRules()
    setSaving(null)
  }

  const deleteRule = async (rule) => {
    if (!window.confirm(`Spelregel "${rule.label}" verwijderen?`)) return
    setSaving(rule.id)
    await supabase.from('agenda_planner_rules').delete().eq('id', rule.id)
    await loadRules()
    setSaving(null)
  }

  const addRule = async () => {
    setAddError('')
    if (!newRule.rule_key.trim() || !newRule.label.trim()) {
      setAddError('Sleutel en label zijn verplicht.')
      return
    }
    setSaving('new')
    const { error } = await supabase.from('agenda_planner_rules').insert({
      rule_key: newRule.rule_key.trim().toLowerCase().replace(/\s+/g, '_'),
      rule_type: newRule.rule_type.trim() || 'custom',
      description: newRule.description.trim(),
      priority: Number(newRule.priority) || 50,
      enabled: true,
    })
    if (error) { setAddError(error.message); setSaving(null); return }
    setNewRule({ rule_key: '', label: '', description: '', priority: 50 })
    setAdding(false)
    await loadRules()
    setSaving(null)
  }

  // Default rule keys die niet verwijderd mogen worden
  const DEFAULT_KEYS = new Set([
    'physical_meeting_buffer_60min', 'traffic_avoid_tue_thu_morning',
    'lunch_blocked_12_13', 'no_meetings_after_18', 'no_clients_on_wednesday',
    'no_meetings_before_09', 'traffic_window_09_10_all_days', 'location_mon_wed_fri_amsterdam',
  ])

  return (
    <div className="agenda-settings__backdrop" onClick={onClose}>
      <div className="agenda-settings__panel" onClick={e => e.stopPropagation()}>
        <div className="agenda-settings__header">
          <h2>Spelregels agenda</h2>
          <button type="button" className="agenda-modal__close" onClick={onClose}>×</button>
        </div>

        {!allRules ? (
          <p className="agenda-settings__loading">Laden…</p>
        ) : (
          <div className="agenda-settings__list">
            {allRules.map(rule => (
              <div key={rule.id} className={`agenda-settings__rule ${rule.enabled ? 'is-enabled' : 'is-disabled'}`}>
                <label className="agenda-settings__toggle-wrap">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    disabled={saving === rule.id}
                    onChange={() => toggleRule(rule)}
                  />
                  <span className="agenda-settings__rule-info">
                    <strong>{rule.rule_key.replace(/_/g, ' ')}</strong>
                    <span className="agenda-settings__rule-key">{rule.rule_key} · {rule.rule_type}</span>
                    {rule.description && <span className="agenda-settings__rule-desc">{rule.description}</span>}
                  </span>
                  <span className="agenda-settings__rule-prio">p{rule.priority}</span>
                </label>
                {!DEFAULT_KEYS.has(rule.rule_key) && (
                  <button
                    type="button"
                    className="agenda-settings__delete"
                    disabled={saving === rule.id}
                    onClick={() => deleteRule(rule)}
                    title="Verwijder regel"
                  >×</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="agenda-settings__add-section">
          {!adding ? (
            <button type="button" className="btn btn--ghost" onClick={() => setAdding(true)}>+ Nieuwe spelregel</button>
          ) : (
            <div className="agenda-settings__add-form">
              <h3>Nieuwe spelregel</h3>
              <label>
                Sleutel (rule_key)
                <input
                  type="text"
                  value={newRule.rule_key}
                  placeholder="bijv. no_meetings_friday"
                  onChange={e => setNewRule(p => ({ ...p, rule_key: e.target.value }))}
                />
              </label>
              <label>
                Type (rule_type)
                <input
                  type="text"
                  value={newRule.rule_type}
                  placeholder="bijv. no_meetings_window"
                  onChange={e => setNewRule(p => ({ ...p, rule_type: e.target.value }))}
                />
              </label>
              <label>
                Beschrijving
                <input
                  type="text"
                  value={newRule.description}
                  placeholder="optioneel"
                  onChange={e => setNewRule(p => ({ ...p, description: e.target.value }))}
                />
              </label>
              <label>
                Prioriteit (0–100)
                <input
                  type="number"
                  value={newRule.priority}
                  min="0"
                  max="100"
                  onChange={e => setNewRule(p => ({ ...p, priority: e.target.value }))}
                />
              </label>
              {addError && <p className="agenda-settings__error">{addError}</p>}
              <div className="agenda-settings__add-actions">
                <button type="button" className="btn btn--ghost" onClick={() => { setAdding(false); setAddError('') }}>Annuleren</button>
                <button type="button" className="btn btn--primary" disabled={saving === 'new'} onClick={addRule}>
                  {saving === 'new' ? 'Opslaan…' : 'Opslaan'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Voice-input modal (F.11) -----------------------------------
function AgendaVoiceModal({ weekStart, onClose }) {
  const [text, setText]     = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [listening, setListening] = useState(false)
  const recognitionRef = useState(null)

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return
    const rec = new SpeechRecognition()
    rec.lang = 'nl-NL'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = e => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ')
      setText(transcript)
    }
    rec.onend = () => setListening(false)
    rec.start()
    recognitionRef[0] = rec
    setListening(true)
  }

  const stopListening = () => {
    recognitionRef[0]?.stop()
    setListening(false)
  }

  const submit = async () => {
    if (!text.trim()) return
    setSaving(true)
    const weekStartStr = toLocalDateKey(mondayOf(weekStart))
    await supabase.from('agenda_voice_notes').insert({
      content: text.trim(),
      week_start: weekStartStr,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(onClose, 1200)
  }

  const hasSpeech = !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  return (
    <div className="agenda-voice__backdrop" onClick={onClose}>
      <div className="agenda-voice__modal" onClick={e => e.stopPropagation()}>
        <div className="agenda-voice__header">
          <h2>Weeknotitie — {formatWeekLabel(weekStart)}</h2>
          <button type="button" className="agenda-modal__close" onClick={onClose}>×</button>
        </div>
        <p className="agenda-voice__hint">
          Vertel hoe je week eruit ziet — bijv. "maandag ben ik bij klant in Den Bosch, dinsdag thuis".
          De AI gebruikt dit bij de locatieprognose.
        </p>
        <textarea
          className="agenda-voice__textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Typ of spreek je weekplanning in…"
          rows={5}
          autoFocus
        />
        <div className="agenda-voice__actions">
          {hasSpeech && (
            <button
              type="button"
              className={`btn btn--ghost agenda-voice__mic ${listening ? 'is-listening' : ''}`}
              onClick={listening ? stopListening : startListening}
            >
              {listening ? '■ Stop' : '🎤 Spreken'}
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || !text.trim()}
            onClick={submit}
          >
            {saved ? '✓ Opgeslagen' : saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>
    </div>
  )
}
