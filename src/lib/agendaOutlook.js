// agendaOutlook.js — deeplinks naar Outlook Web.
//
// Sinds v1.195 schrijft Legal Mind wél naar de agenda (aanmaken, wijzigen,
// verwijderen — zie `hooks/useAgendaWrite.js`). Deze deeplinks blijven staan als
// TWEEDE route, en ze zijn de ENIGE route voor alles wat de schrijfbaan bewust
// niet doet:
//
//   • genodigden toevoegen of wijzigen (Graph stuurt dan uitnodigingen, en dat
//     is niet uit te zetten)
//   • terugkerende afspraken en losse instanties van een reeks
//   • afspraken van iemand anders, en hele-dag-afspraken
//   • afzeggen mét bericht aan de genodigden
//
// Waar een van die hekken dichtstaat toont de UI geen knop maar de reden, en
// deze link ernaast. Outlook blijft bron-van-waarheid.

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
