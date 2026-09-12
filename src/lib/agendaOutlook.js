// agendaOutlook.js — deeplinks naar Outlook Web.
//
// De agenda is lees-only: Outlook blijft bron-van-waarheid en er is (nog) geen
// Graph-write vanuit Legal Mind. Nieuw/wijzig/verwijder gebeurt dus in Outlook
// zelf; deze helpers bouwen de deeplinks die de UI daarvoor aanbiedt.

export const OUTLOOK_CALENDAR_URL = 'https://outlook.office.com/calendar/view/week'
const COMPOSE_URL = 'https://outlook.office.com/calendar/deeplink/compose'

// Compose-deeplink met voorgevulde velden. Outlook slaat pas op als de
// gebruiker daar zelf "Opslaan" kiest — wij schrijven niets.
export function outlookComposeUrl({ subject, start, end, location, body } = {}) {
  const p = new URLSearchParams()
  if (subject) p.set('subject', subject)
  if (start instanceof Date && !Number.isNaN(start.getTime())) p.set('startdt', start.toISOString())
  if (end instanceof Date && !Number.isNaN(end.getTime())) p.set('enddt', end.toISOString())
  if (location) p.set('location', location)
  if (body) p.set('body', body)
  const qs = p.toString()
  return qs ? `${COMPOSE_URL}?${qs}` : COMPOSE_URL
}

export function openOutlook(url) {
  window.open(url || OUTLOOK_CALENDAR_URL, '_blank', 'noopener,noreferrer')
}
