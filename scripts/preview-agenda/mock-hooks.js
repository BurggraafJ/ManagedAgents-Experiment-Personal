// Fixture voor de Agenda-preview (v1.183): één werkweek rond vandaag, met op
// vandaag én op de maandag van de week een blok van vijf gelijktijdige events
// (de >3-banen-situatie die Jelle op de telefoon zag), plus een halve overlap
// en solo-events. Alle tijden lokaal.
function at(day, h, m = 0) { const d = new Date(day); d.setHours(h, m, 0, 0); return d.toISOString() }
function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
function plus(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }

const today = new Date(); today.setHours(0, 0, 0, 0)
const mon = mondayOf(today)
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/x'
let n = 0
const ev = (day, s, e, subject, extra = {}) => ({
  id: `ev-${++n}`, subject, start_time: at(day, ...s), end_time: at(day, ...e),
  is_all_day: false, is_cancelled: false, location_text: null, online_meeting_url: null,
  organizer_name: 'Jelle Burggraaf', organizer_email: 'burggraaf@legal-mind.nl', body_preview: '', ...extra,
})

function dayBlock(day) {
  return [
    ev(day, [9, 0], [9, 45], 'Dagstart Maestro', { online_meeting_url: TEAMS }),
    // Vijf tegelijk rond 10:00 — de baan-situatie.
    ev(day, [10, 0], [11, 0], 'Demo Van Dijk Advocaten', { online_meeting_url: TEAMS }),
    ev(day, [10, 0], [11, 0], 'Kennismaking Hofstede & Partners', { location_text: 'Utrecht, Maliebaan 12' }),
    ev(day, [10, 0], [10, 30], 'Intern: sprintplanning'),
    ev(day, [10, 15], [11, 15], 'Evaluatie pilot Brouwer Legal', { online_meeting_url: TEAMS }),
    ev(day, [10, 30], [11, 30], 'Offerte doorspreken Leeuwenstein', { online_meeting_url: TEAMS }),
    // Halve overlap 's middags.
    ev(day, [13, 0], [14, 0], 'Lunchwandeling'),
    ev(day, [13, 30], [14, 30], 'QBR De Ruiter Notarissen', { location_text: 'Amsterdam, Herengracht 500' }),
    ev(day, [16, 0], [17, 0], 'Weekafsluiting CS', { online_meeting_url: TEAMS }),
  ]
}

const events = [
  ...dayBlock(today),
  ...(today.getTime() === mon.getTime() ? [] : dayBlock(mon)),
  ev(plus(mon, 1), [9, 30], [10, 30], 'Kennismaking Peters Legal', { online_meeting_url: TEAMS }),
  ev(plus(mon, 1), [14, 0], [15, 30], 'Workshop legal engineering', { location_text: 'Rotterdam, Blaak 31' }),
  ev(plus(mon, 2), [11, 0], [12, 0], 'Partneroverleg Jira', { online_meeting_url: TEAMS }),
  ev(plus(mon, 2), [11, 30], [12, 30], 'Verlenging Smits & Co', { online_meeting_url: TEAMS }),
  ev(plus(mon, 3), [10, 0], [11, 0], 'Sales weekly', { online_meeting_url: TEAMS }),
  ev(plus(mon, 4), [15, 0], [16, 0], 'Terugkoppeling Academy'),
  { ...ev(plus(mon, 3), [0, 0], [23, 59], 'Interne dag'), is_all_day: true },
]

export function useAgenda() {
  return {
    events, attendees: [], rules: [], suggestions: [], locationForecast: [], voiceNotes: [],
    appointmentProposals: [], cities: [],
    syncState: { last_sync_at: new Date(Date.now() - 7 * 60000).toISOString(), status: 'ok' },
    loading: false, error: null, refresh: () => {},
  }
}

export function useAutoDraft() {
  return { hubspotCustomerEmails: [], agentInstructions: [], awaitingReplyIndex: {}, loading: false }
}
