// agenda.js — pure helpers voor AgendaView en sub-components.
// Geëxtraheerd uit AgendaView.jsx in Refactor 10.
//
// Date helpers, classifyEvent, computeLocationForecasts, mergeShadowBlocks,
// eventVisibleMinutes, format helpers + de constanten DAY_START / DAY_END /
// HOURS / HOUR_HEIGHT / DAYS_PER_WEEK / DOW_NL / MONTH_NL.
//
// Geen React, geen Supabase — puur JS.

// ---- Constanten -------------------------------------------------
export const HOUR_HEIGHT = 56
export const DAY_START   = 8           // Toon vanaf 08:00
export const DAY_END     = 22
export const HOURS       = DAY_END - DAY_START  // 14
export const DAYS_PER_WEEK = 6         // Ma t/m Za (zondag weggelaten)

export const DOW_NL   = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
export const MONTH_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
                         'juli', 'augustus', 'september', 'oktober', 'november', 'december']
export const MONTH_NL_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
                               'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

// Outlook-categorie → CSS-suffix mapping (NL + EN namen)
export const CATEGORY_COLOR_MAP = {
  'rode categorie': 'red',    'red category': 'red',    'rood': 'red',
  'oranje categorie': 'orange', 'orange category': 'orange', 'oranje': 'orange',
  'gele categorie': 'yellow', 'yellow category': 'yellow', 'geel': 'yellow',
  'groene categorie': 'green', 'green category': 'green', 'groen': 'green',
  'blauwe categorie': 'blue', 'blue category': 'blue',  'blauw': 'blue',
  'paarse categorie': 'purple', 'purple category': 'purple', 'paars': 'purple',
  'grijze categorie': 'grey', 'grey category': 'grey',  'grijs': 'grey',
}

export function getCategoryClass(ev) {
  const cats = Array.isArray(ev.categories) ? ev.categories : []
  for (const cat of cats) {
    const key = (cat || '').toLowerCase().trim()
    if (CATEGORY_COLOR_MAP[key]) return `agenda-event--cat-${CATEGORY_COLOR_MAP[key]}`
  }
  return null
}

// Korte badge-labels per meeting type
export const TYPE_BADGE = {
  client: 'Klant', internal: 'Intern', external: 'Extern',
  demo: 'Demo', partner: 'Partner', recruitment: 'Recruit',
  allday: null, private: null,
}

// ---- Date helpers ------------------------------------------------
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
export function mondayOf(d) {
  const x = startOfDay(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  return x
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate()
}
export function toLocalDateKey(d) {
  // Lokale datum als sleutel (YYYY-MM-DD) — vermijdt UTC-verschuiving
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function formatWeekLabel(start) {
  const end = addDays(start, 6)
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear  = start.getFullYear() === end.getFullYear()
  if (sameMonth) return `${start.getDate()} – ${end.getDate()} ${MONTH_NL[start.getMonth()]} ${start.getFullYear()}`
  if (sameYear)  return `${start.getDate()} ${MONTH_NL_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_NL_SHORT[end.getMonth()]} ${start.getFullYear()}`
  return `${start.getDate()} ${MONTH_NL_SHORT[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()} ${MONTH_NL_SHORT[end.getMonth()]} ${end.getFullYear()}`
}
export function formatDayHeader(d, today) {
  const isToday = sameDay(d, today)
  return { dow: DOW_NL[(d.getDay() + 6) % 7], date: d.getDate(), isToday }
}
export function formatTimeRange(s, e) {
  const fmt = t => `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  return `${fmt(s)}–${fmt(e)}`
}

// ---- Event classifier (F.2 lite, deterministisch) ----------------
export function classifyEvent(ev, attendeesByEvent, customerEmailSet) {
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
export function computeLocationForecasts(rules, voiceNotes, events, days, citiesLookup) {
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
      const subjMatch = knownCities.find(c => {
        const cLower = c.toLowerCase()
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

// ---- Shadow-block merge: overlappingen wegknippen ---------------
// Hoogste priority wint; bij gelijk wint laatste (hogere idx = nieuwer toegevoegd).
export function mergeShadowBlocks(blocks) {
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
export function eventVisibleMinutes(ev, day) {
  const dayStartMs = startOfDay(day).getTime()
  const dayEndMs   = dayStartMs + 24 * 60 * 60 * 1000
  const evStartMs  = new Date(ev.start_time).getTime()
  const evEndMs    = new Date(ev.end_time).getTime()
  const startMs = Math.max(evStartMs, dayStartMs)
  const endMs   = Math.min(evEndMs, dayEndMs)
  if (endMs <= startMs) return null
  const startFromMidnight = (startMs - dayStartMs) / 60000
  const endFromMidnight   = (endMs - dayStartMs) / 60000
  const visStart = Math.max(DAY_START * 60, startFromMidnight)
  const visEnd   = Math.min(DAY_END * 60, endFromMidnight)
  if (visEnd <= visStart) return null
  return { startMin: visStart - DAY_START * 60, endMin: visEnd - DAY_START * 60 }
}

// HH:MM string → minutes vanaf DAY_START
export function hhmmToMin(s) {
  if (!s) return null
  const [h, m] = s.split(':').map(Number)
  return (h - DAY_START) * 60 + (m || 0)
}
