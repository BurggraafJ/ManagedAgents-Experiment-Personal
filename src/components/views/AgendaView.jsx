import { useState, useMemo, useEffect, useCallback } from 'react'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { supabase } from '../../lib/supabase'

// AgendaView — Sprint 2 ronde 8 (build: 2026-05-02 — vanaf 8u, 6 dagen)
const BUILD_TAG = 'r8·2026-05-02'

// F.9:  maandselector · Teams-badge · type-badge · category-kleuren · voor-09 shadow · verkeer alle dagen
// F.3:  rules-pagina (link via ⚙)
// F.10: locatieprognose client-side + day-header pills
// F.11: voice-input knop + modal
// F.13: lunch off · voor-10 · na-19 · verkeer 18-19 · post-meeting buffer
// F.14: di/do Geldermalsen
// R4:   clean visuals · shadow-merge · lijst-overzicht
// R5:   multi-day clamping · vol-gekleurde blokken · refresh-knop · console diagnostics

const HOUR_HEIGHT = 56
const DAY_START   = 8           // Toon vanaf 08:00 (was 07:00)
const DAY_END     = 22
const HOURS       = DAY_END - DAY_START  // 14
const DAYS_PER_WEEK = 6         // Ma t/m Za (zondag weggelaten — Jelle plant nooit op zondag)

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
  // Attendee response stats
  const stats = { total: attendees.length, accepted: 0, tentative: 0, declined: 0, none: 0 }
  for (const a of attendees) {
    const r = (a?.response_status || '').toLowerCase()
    if (r === 'accepted') stats.accepted++
    else if (r === 'tentativelyaccepted' || r === 'tentative') stats.tentative++
    else if (r === 'declined') stats.declined++
    else stats.none++
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

  return { meeting_type, is_online, is_physical, color_key, attendee_stats: stats }
}

// ---- Location forecaster (client-side, deterministisch) ---------
// Combineert: locatieregels (ma/wo/vr Amsterdam) + voice-notes (week-tekst) +
// calendar-events (locatie/cities-lookup) → { date: { location, confidence, source } }
function computeLocationForecasts(rules, voiceNotes, events, days, citiesLookup) {
  const forecasts = {}
  const cities = (citiesLookup || []).map(c => c.city || c.name).filter(Boolean)

  // 1. Default uit location-rule(s)
  const locRules = (rules || []).filter(r => r.rule_type === 'location_rule' && r.enabled)
  for (const day of days) {
    const dowIdx = (day.getDay() + 6) % 7
    for (const rule of locRules) {
      const ruleDays = rule.params?.days || []
      if (ruleDays.includes(dowIdx)) {
        forecasts[toLocalDateKey(day)] = {
          location: rule.params.location || 'Amsterdam',
          confidence: 0.6,
          source: 'rule',
        }
        break
      }
    }
  }

  // 2. Override via calendar-events met fysieke locatie of stad in subject/body
  // Bekende NL-steden waar Jelle vaak komt — ook al niet in cities_lookup. Helpt bij
  // detecteren van uitzonderingen (bijv. "Enschede 6 mei" → niet meer Amsterdam-default).
  const knownCities = [
    ...cities,
    'Enschede', 'Apeldoorn', 'Arnhem', 'Eindhoven', 'Tilburg', 'Breda',
    'Groningen', 'Leeuwarden', 'Zwolle', 'Maastricht', 'Nijmegen',
    'Haarlem', 'Leiden', 'Delft', 'Hilversum', 'Almere', 'Zaandam',
    'Alkmaar', 'Hoorn', 'Hengelo',
  ]
  for (const day of days) {
    const k = toLocalDateKey(day)
    const dayEvents = (events || []).filter(ev => {
      if (ev.is_cancelled) return false
      const start = new Date(ev.start_time)
      return toLocalDateKey(startOfDay(start)) === k
    })
    for (const ev of dayEvents) {
      const loc = (ev.location_text || '').toLowerCase().trim()
      const subject = (ev.subject || '').toLowerCase()
      const onlineWords = ['teams', 'meet.google', 'zoom', 'webinar', '://']
      const isOnline = onlineWords.some(w => loc.includes(w))
      // Kijk eerst naar location_text (sterkste signaal)
      if (loc && !isOnline) {
        const matchedCity = knownCities.find(c => loc.includes(c.toLowerCase()))
        if (matchedCity) {
          forecasts[k] = { location: matchedCity, confidence: 0.85, source: 'calendar' }
          break
        }
        if (loc.length > 0 && loc.length < 30) {
          forecasts[k] = { location: ev.location_text, confidence: 0.75, source: 'calendar' }
          break
        }
      }
      // Anders: kijk in subject (zwakker signaal — "Enschede" mention)
      const subjMatch = knownCities.find(c => {
        const cLower = c.toLowerCase()
        // Whole-word match in subject
        return new RegExp(`\\b${cLower}\\b`).test(subject)
      })
      if (subjMatch) {
        forecasts[k] = { location: subjMatch, confidence: 0.70, source: 'calendar' }
        break
      }
    }
  }

  // 3. Override via voice-notes — simpele regex per dag-naam
  const dayNames = { 'maandag': 0, 'dinsdag': 1, 'woensdag': 2, 'donderdag': 3, 'vrijdag': 4, 'zaterdag': 5, 'zondag': 6 }
  const recentNotes = (voiceNotes || []).slice(0, 5)
  for (const note of recentNotes) {
    const content = (note.content || '').toLowerCase()
    const noteWeekStart = new Date(note.week_start)
    for (const [dayName, dowIdx] of Object.entries(dayNames)) {
      if (!content.includes(dayName)) continue
      const targetDay = addDays(noteWeekStart, dowIdx)
      const k = toLocalDateKey(targetDay)
      const matchedCity = cities.find(c => {
        const cLower = c.toLowerCase()
        const idxDay = content.indexOf(dayName)
        const window = content.slice(idxDay, idxDay + 100)
        return window.includes(cLower)
      })
      if (matchedCity) {
        forecasts[k] = { location: matchedCity, confidence: 0.95, source: 'voice' }
      } else if (content.includes('thuis') && content.indexOf('thuis') > content.indexOf(dayName)) {
        forecasts[k] = { location: 'Thuis', confidence: 0.9, source: 'voice' }
      } else if (content.includes('kantoor') && content.indexOf('kantoor') > content.indexOf(dayName)) {
        forecasts[k] = { location: 'Amsterdam', confidence: 0.9, source: 'voice' }
      }
    }
  }

  return forecasts
}

// ---- Main view ---------------------------------------------------
export default function AgendaView({ data, onNavigate }) {
  const today   = useMemo(() => startOfDay(new Date()), [])
  const isMobile = useMediaQuery('(max-width: 768px)')

  const [weekStart, setWeekStart]       = useState(() => mondayOf(new Date()))
  const [selectedDay, setSelectedDay]   = useState(today)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showRules, setShowRules]       = useState(false)
  const [showVoice, setShowVoice]       = useState(false)

  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    if (selectedDay < weekStart || selectedDay >= wkEnd) {
      setSelectedDay(weekStart < today && today < wkEnd ? today : weekStart)
    }
  }, [weekStart, selectedDay, today])

  const events       = data?.calendarEvents || []
  const rules        = data?.agendaPlannerRules || []
  const voiceNotes   = data?.agendaVoiceNotes || []
  const citiesLookup = data?.citiesLookup || []

  // Days die we tonen — voor location-berekening
  const daysForForecast = useMemo(() =>
    Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i)),
    [weekStart])

  // Combineer DB-forecast (uit skill) met client-side berekening (rules + voice + calendar)
  const locationForecast = useMemo(() => {
    const map = {}
    // 1. Begin met client-side berekening (snel, deterministisch)
    const computed = computeLocationForecasts(rules, voiceNotes, events, daysForForecast, citiesLookup)
    Object.assign(map, computed)
    // 2. DB-forecast (uit skill) overrult — hogere kwaliteit
    for (const row of (data?.agendaLocationForecast || [])) {
      map[row.forecast_date] = row
    }
    return map
  }, [data?.agendaLocationForecast, rules, voiceNotes, events, daysForForecast, citiesLookup])

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

  const days = Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i))

  // Debug: hoeveel events deze week effectief gerenderd worden
  const weekEventCount = useMemo(
    () => Object.values(eventsByDay).reduce((sum, arr) => sum + arr.length, 0),
    [eventsByDay])

  // Diagnostics: log naar console bij week-switch zodat zichtbaar is wat er gebeurt
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    const totalRaw = (data?.calendarEvents || []).filter(ev => {
      if (ev.is_cancelled) return false
      const s = new Date(ev.start_time), e = new Date(ev.end_time)
      return !(e < weekStart || s >= wkEnd)
    }).length
    // eslint-disable-next-line no-console
    console.log(`[AgendaView ${BUILD_TAG}] week ${toLocalDateKey(weekStart)} → ${toLocalDateKey(wkEnd)}: ${totalRaw} events in raw filter, ${weekEventCount} in eventsByDay. Total fetched: ${(data?.calendarEvents || []).length}`)
  }, [weekStart, data?.calendarEvents, weekEventCount])

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
        onOpenSettings={() => onNavigate?.('agenda_rules')}
        onOpenVoice={() => setShowVoice(true)}
        isMobile={isMobile}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        days={days}
        today={today}
        eventCount={weekEventCount}
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

      {!isMobile && (
        <WeekListView
          days={days}
          eventsByDay={eventsByDay}
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

function AgendaToolbar({ weekStart, onPrev, onNext, onToday, onNavigate, showRules, onToggleRules, onOpenSettings, onOpenVoice, isMobile, selectedDay, onSelectDay, days, today, eventCount }) {
  return (
    <div className="agenda-toolbar">
      <div className="agenda-toolbar__nav">
        <MonthSelector weekStart={weekStart} onNavigate={onNavigate} />
        <button type="button" className="btn btn--ghost" onClick={onToday} title="Naar deze week">Vandaag</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onPrev} aria-label="Vorige week">‹</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onNext} aria-label="Volgende week">›</button>
        <span className="agenda-toolbar__label">{formatWeekLabel(weekStart)}</span>
        {typeof eventCount === 'number' && (
          <span className="agenda-toolbar__count" title="Aantal events in deze week">{eventCount}</span>
        )}
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={() => { window.location.reload(true) }}
          title="Hard refresh (cache leeg, data opnieuw ophalen)"
          aria-label="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
        <span className="agenda-toolbar__build" title="Build version">{BUILD_TAG}</span>
      </div>

      <div className="agenda-toolbar__actions">
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenVoice}
          title="Weeknotitie toevoegen"
          aria-label="Weeknotitie toevoegen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="13" rx="3"/>
            <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenSettings}
          title="Spelregels instellingen"
          aria-label="Instellingen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
          </svg>
        </button>
        <label className="agenda-toolbar__toggle" title="Toon shadow-blokken: reistijd, verkeer, interne dag">
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
          const dayCount = (eventsByDay[dayKey] || []).length
          // Woensdag interne dag wordt nu gemarkeerd in de pill, niet meer in achtergrond
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
                  className="agenda-grid__day-bar"
                  style={{
                    color: showInternalPill ? '#7c3aed'
                         : loc?.source === 'voice' ? '#1d4ed8'
                         : loc?.source === 'calendar' ? '#c2410c'
                         : '#15803d',
                  }}
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
            forecastLoc={locationForecast[toLocalDateKey(d)]}
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

// ---- Shadow-block merge: overlappingen wegknippen ---------------
// Hoogste priority wint; bij gelijk wint laatste (hogere idx = nieuwer toegevoegd).
// Resultaat: array non-overlappende segmenten.
function mergeShadowBlocks(blocks) {
  if (!blocks || blocks.length === 0) return []
  const points = new Set()
  for (const b of blocks) { points.add(b.startMin); points.add(b.endMin) }
  const sorted = Array.from(points).sort((a, b) => a - b)
  const segments = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1]
    if (s >= e) continue
    let winner = null
    for (const b of blocks) {
      if (b.startMin <= s && b.endMin >= e) {
        if (!winner) { winner = b; continue }
        if (b.priority > winner.priority) winner = b
        else if (b.priority === winner.priority && b.idx > winner.idx) winner = b
      }
    }
    if (!winner) continue
    const prev = segments[segments.length - 1]
    if (prev && prev.endMin === s && prev.className === winner.className && prev.label === winner.label) {
      prev.endMin = e
    } else {
      segments.push({ startMin: s, endMin: e, className: winner.className, label: winner.label })
    }
  }
  return segments
}

// Helper: clamp event tijden naar de zichtbare day-window (DAY_START..DAY_END).
// Geeft startMin/endMin in minuten vanaf DAY_START, OF null als event buiten window valt.
function eventVisibleMinutes(ev, day) {
  const dayStartMs = startOfDay(day).getTime()
  const dayEndMs   = dayStartMs + 24 * 60 * 60 * 1000
  const evStartMs  = new Date(ev.start_time).getTime()
  const evEndMs    = new Date(ev.end_time).getTime()
  const startMs = Math.max(evStartMs, dayStartMs)
  const endMs   = Math.min(evEndMs, dayEndMs)
  if (endMs <= startMs) return null
  // Minutes from local midnight of `day`
  const startFromMidnight = (startMs - dayStartMs) / 60000
  const endFromMidnight   = (endMs - dayStartMs) / 60000
  // Clamp naar zichtbare window (DAY_START..DAY_END uur)
  const visStart = Math.max(DAY_START * 60, startFromMidnight)
  const visEnd   = Math.min(DAY_END * 60, endFromMidnight)
  if (visEnd <= visStart) return null
  // Convert naar minuten vanaf DAY_START
  return { startMin: visStart - DAY_START * 60, endMin: visEnd - DAY_START * 60 }
}

// ---- Day-column met events --------------------------------------
function DayColumn({ day, today, events, rules, showRules, forecastLoc, onClickEvent }) {
  const isToday    = sameDay(day, today)
  const dowIdx     = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2
  const isTuOrThu  = dowIdx === 1 || dowIdx === 3
  const isWeekday  = dowIdx <= 4
  // Verkeer alleen relevant als Jelle die dag NIET op een kantoor-locatie is.
  // Amsterdam (ma/wo/vr) of Geldermalsen (di/do) → al op kantoor, geen reizen.
  const onWorkLocation = !!(forecastLoc && /amsterdam|geldermalsen/i.test(forecastLoc.location))

  const nowOffset = useMemo(() => {
    if (!isToday) return null
    const now = new Date()
    const mins = (now.getHours() - DAY_START) * 60 + now.getMinutes()
    if (mins < 0 || mins > HOURS * 60) return null
    return (mins / 60) * HOUR_HEIGHT
  }, [isToday])

  const timed = events.filter(({ ev }) => !ev.is_all_day)

  // Helper: HH:MM string → minutes vanaf DAY_START
  const hhmmToMin = (s) => {
    if (!s) return null
    const [h, m] = s.split(':').map(Number)
    return (h - DAY_START) * 60 + (m || 0)
  }

  // Spelregel lookups
  const travelBufferRule = rules.find(r => r.rule_key === 'physical_meeting_buffer_60min' && r.enabled)
  const trafficOldRule   = rules.find(r => r.rule_key === 'traffic_avoid_tue_thu_morning' && r.enabled)
  const trafficAllRule   = rules.find(r => r.rule_key === 'traffic_window_09_10_all_days' && r.enabled)
  const trafficEveRule   = rules.find(r => r.rule_key === 'traffic_window_18_19' && r.enabled)
  const beforeRule       = rules.find(r => r.rule_type === 'no_meetings_window' && r.params?.block_end && r.params?.block_start && r.enabled
                                    && r.params.block_start <= '08:00')
  const eveningRule      = rules.find(r => r.rule_type === 'no_meetings_window' && r.params?.block_start && r.enabled
                                    && r.params.block_start >= '18:00')
  const postBufferRule   = rules.find(r => r.rule_type === 'post_meeting_buffer' && r.enabled)
  const wednesdayRule    = rules.find(r => r.rule_key === 'no_clients_on_wednesday' && r.enabled)

  // Verkeers-window 09-10: nieuwe regel (alle werkdagen) of oude (di/do).
  // Niet tonen als Jelle al op kantoor (Amsterdam) is op deze dag.
  const showTrafficMorning = showRules && isWeekday && !onWorkLocation && (
    trafficAllRule || (trafficOldRule && isTuOrThu)
  )
  const showTrafficEvening = showRules && isWeekday && !onWorkLocation && trafficEveRule

  // Verzamel ALLE shadow-blokken in één array, dan via mergeShadowBlocks()
  // overlappingen wegknippen — hoogste priority wint, bij gelijk hoogste idx (= laatst gedefinieerd, nieuwste).
  const shadowBlocks = []
  let _idx = 0
  if (showRules) {
    if (beforeRule) {
      shadowBlocks.push({
        startMin: 0, endMin: hhmmToMin(beforeRule.params.block_end),
        className: 'agenda-shadow--before9', label: 'Geen meetings',
        priority: beforeRule.priority || 0, idx: _idx++,
      })
    }
    if (showTrafficMorning) {
      shadowBlocks.push({
        startMin: (9 - DAY_START) * 60, endMin: (10 - DAY_START) * 60,
        className: 'agenda-shadow--traffic', label: 'Verkeer',
        priority: trafficAllRule?.priority || trafficOldRule?.priority || 50, idx: _idx++,
      })
    }
    if (showTrafficEvening) {
      shadowBlocks.push({
        startMin: hhmmToMin(trafficEveRule.params.block_start),
        endMin: hhmmToMin(trafficEveRule.params.block_end),
        className: 'agenda-shadow--traffic', label: 'Verkeer',
        priority: trafficEveRule.priority || 50, idx: _idx++,
      })
    }
    if (eveningRule) {
      shadowBlocks.push({
        startMin: hhmmToMin(eveningRule.params.block_start), endMin: HOURS * 60,
        className: 'agenda-shadow--evening', label: `Geen meetings na ${eveningRule.params.block_start}`,
        priority: eveningRule.priority || 50, idx: _idx++,
      })
    }
    if (travelBufferRule) {
      for (const { ev, classified } of timed) {
        if (!classified.is_physical) continue
        // Skip reistijd-buffer als event-locatie matcht met de werkplaats van die dag
        // (Jelle is al op kantoor, geen reizen nodig).
        const evLoc = (ev.location_text || '').toLowerCase()
        const forecastLocLower = (forecastLoc?.location || '').toLowerCase()
        const sameLocation = forecastLocLower && evLoc.includes(forecastLocLower)
        if (sameLocation) continue
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const startMin = (start.getHours() - DAY_START) * 60 + start.getMinutes()
        const endMin   = (end.getHours()   - DAY_START) * 60 + end.getMinutes()
        shadowBlocks.push({
          startMin: startMin - 60, endMin: startMin,
          className: 'agenda-shadow--travel', label: 'Reistijd',
          priority: travelBufferRule.priority || 100, idx: _idx++,
        })
        shadowBlocks.push({
          startMin: endMin, endMin: endMin + 60,
          className: 'agenda-shadow--travel', label: 'Reistijd',
          priority: travelBufferRule.priority || 100, idx: _idx++,
        })
      }
    }
    if (postBufferRule) {
      for (const { ev } of timed) {
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const durationMin = (end - start) / 60000
        const minDuration = postBufferRule.params?.min_duration_minutes ?? 90
        if (durationMin < minDuration) continue
        const bufferMin = postBufferRule.params?.buffer_minutes ?? 15
        const endMin = (end.getHours() - DAY_START) * 60 + end.getMinutes()
        shadowBlocks.push({
          startMin: endMin, endMin: endMin + bufferMin,
          className: 'agenda-shadow--postbuffer', label: 'Speling',
          priority: postBufferRule.priority || 75, idx: _idx++,
        })
      }
    }
  }
  const mergedShadows = mergeShadowBlocks(shadowBlocks)

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
          {mergedShadows.map((b, i) => (
            <ShadowBlock
              key={`shadow-${i}`}
              startMin={b.startMin}
              endMin={b.endMin}
              className={b.className}
              label={b.label}
            />
          ))}
        </>
      )}

      {timed.map(({ ev, classified }) => {
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        // Clamp naar zichtbare day-window (voorkomt overflow bij multi-day events of events buiten 7-22)
        const visMins = eventVisibleMinutes(ev, day)
        if (!visMins) return null
        const { startMin, endMin } = visMins
        const top    = (startMin / 60) * HOUR_HEIGHT
        const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT - 2)
        const catCls = getCategoryClass(ev)
        const typeBadge = TYPE_BADGE[classified.meeting_type]
        const stats = classified.attendee_stats || { total: 0 }

        return (
          <button
            type="button"
            key={ev.id + toLocalDateKey(day)}
            className={`agenda-event agenda-event--filled agenda-event--${classified.color_key}${classified.is_physical ? ' agenda-event--physical' : ''}${classified.is_online ? ' agenda-event--online' : ''}${catCls ? ' ' + catCls : ''}`}
            style={{ top: `${top}px`, height: `${height}px` }}
            onClick={() => onClickEvent({ ev, classified })}
            title={`${ev.subject || '(geen titel)'} — ${formatTimeRange(start, end)}${stats.total > 0 ? ` · ${stats.total} genodigd (${stats.accepted}✓ ${stats.tentative}? ${stats.declined}✗)` : ''}`}
          >
            <span className="agenda-event__title">
              {ev.subject || '(geen titel)'}
              {stats.total > 0 && (
                <span
                  className="agenda-event__people-inline"
                  title={`${stats.total} genodigd · ${stats.accepted}✓ ja · ${stats.tentative}? misschien · ${stats.declined}✗ nee · ${stats.none} geen reactie`}
                >{stats.total}</span>
              )}
            </span>
            {height > 28 && (
              <span className="agenda-event__meta">
                {stats.total > 0 && height > 44 && (
                  <span className="agenda-event__badge agenda-event__badge--people" title={`${stats.accepted} ja · ${stats.tentative} misschien · ${stats.declined} nee · ${stats.none} geen reactie`}>
                    👥 {stats.total}
                    {stats.accepted > 0 && <span className="agenda-event__people-yes">{`·${stats.accepted}✓`}</span>}
                    {stats.declined > 0 && <span className="agenda-event__people-no">{`·${stats.declined}✗`}</span>}
                  </span>
                )}
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
                {typeBadge && height > 50 && (
                  <span className="agenda-event__badge agenda-event__badge--type">
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
