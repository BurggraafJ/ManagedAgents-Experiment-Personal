// agendaWrite.js — wie mag wat, en hoe heet dat in het Nederlands.
//
// Eén plek voor de hekken, omdat desktop (AgendaEventPopover) en mobiel
// (MobileAgendaSheet) dezelfde vraag stellen. Twee kopieën van een hek lopen
// uit elkaar, en de helft die achterblijft merk je niet — dat is dezelfde les
// als bij de Outlook-slugs.
//
// Deze predicaten zijn een UI-hulp, GEEN beveiliging. De echte hekken staan in
// `supabase/functions/outlook-calendar-live/index.ts` en die controleert het
// LIVE event, niet de spiegel. Een knop die je niet ziet is geen slot.

/**
 * Wijzigen mag als je de organisator bent, het geen reeks is en het geen
 * hele-dag-afspraak is.
 *
 *  - niet-organisator: Graph raakt hooguit je eigen kopie (§5.6)
 *  - terugkerend: een update op de master verzet de HELE reeks en stuurt één
 *    mail per aangepaste instantie (§5.4)
 *  - hele dag: die staan op 00:00 UTC, dus het formulier toont 01:00/02:00 en
 *    opslaan maakt er een afspraak van één uur van (§5.3)
 */
export function canEditEvent(event) {
  if (!event) return { ok: false, reason: 'no_event' }
  if (event.is_organizer === false) return { ok: false, reason: 'not_organizer' }
  if (event.is_recurring) return { ok: false, reason: 'recurring' }
  if (event.is_all_day) return { ok: false, reason: 'all_day' }
  return { ok: true, reason: null }
}

/**
 * Verwijderen mag alleen zonder genodigden. Niet omdat het technisch niet kan,
 * maar omdat het een productgrens is: Maestro stuurt nooit een afzeggingsmail
 * (besluit Jelle 2026-09-14). Voor afspraken mét genodigden blijft de
 * Outlook-deeplink de route.
 *
 * Hele-dag-afspraken mogen hier wél weg: de tijdzone-val zit in het formulier,
 * en verwijderen heeft geen formulier.
 */
export function canDeleteEvent(event, attendeeCount = 0) {
  if (!event) return { ok: false, reason: 'no_event' }
  if (event.is_organizer === false) return { ok: false, reason: 'not_organizer' }
  if (event.is_recurring) return { ok: false, reason: 'recurring' }
  if (attendeeCount > 0) return { ok: false, reason: 'has_attendees' }
  return { ok: true, reason: null }
}

/** Waarom een hek dichtstaat — in de taal van het scherm, niet van de API. */
export const BLOCK_TEXT = {
  no_event: 'Geen event geselecteerd.',
  not_organizer: 'Je bent niet de organisator van deze afspraak. Wijzigen en '
    + 'verwijderen loopt via Outlook — daar is afzeggen ook echt afzeggen.',
  recurring: 'Dit is een terugkerende afspraak. Eén wijziging raakt de hele '
    + 'reeks, dus dat doe je in Outlook, waar je per keer of voor de hele serie kunt kiezen.',
  all_day: 'Hele-dag-afspraken hebben geen begin- en eindtijd om te bewerken. '
    + 'Pas ze aan in Outlook.',
  has_attendees: 'Er zijn genodigden. Legal Mind verstuurt nooit een '
    + 'afzeggingsmail, dus annuleren doe je in Outlook — dan krijgen zij netjes bericht.',
}

/** Foutredenen van de edge-functie → leesbare toast-tekst. */
export const WRITE_ERROR_TEXT = {
  no_mailbox_for_user: 'Geen Outlook-postbus gekoppeld aan dit account.',
  not_organizer: 'Je bent niet de organisator van deze afspraak.',
  recurring_not_supported: 'Terugkerende afspraken kun je alleen in Outlook wijzigen.',
  all_day_not_supported: 'Hele-dag-afspraken kun je alleen in Outlook wijzigen.',
  has_attendees: 'Deze afspraak heeft genodigden — verwijderen gaat via Outlook.',
  event_not_yours: 'Deze afspraak staat niet in jouw agenda.',
  event_not_in_mirror: 'Deze afspraak is nog niet gesynchroniseerd. Probeer het zo opnieuw.',
  end_before_start: 'De eindtijd ligt vóór de begintijd.',
  missing_datetime: 'Vul een datum, begintijd en eindtijd in.',
  login_required: 'Je sessie is verlopen. Log opnieuw in.',
  user_required: 'Deze actie hoort bij een ingelogde gebruiker, niet bij een systeemsleutel.',
  // De capability-poort levert normaal een eigen Nederlandse `melding`; dit is
  // het vangnet als die ooit ontbreekt.
  forbidden: 'Je hebt het recht "agenda" niet. Vraag de owner het aan te vinken '
    + 'bij Organisatie › Rechten.',
}

export function writeErrorText(reason) {
  const key = String(reason || '')
  if (WRITE_ERROR_TEXT[key]) return WRITE_ERROR_TEXT[key]
  if (key.startsWith('bad_date:')) return 'Ongeldige datum.'
  if (key.startsWith('bad_time:')) return 'Ongeldige tijd.'
  return key || 'Onbekende fout'
}

/** "3 genodigden krijgen een wijzigingsmail van Outlook." */
export function attendeeNoticeText(n) {
  if (!n) return null
  return `${n} ${n === 1 ? 'genodigde krijgt' : 'genodigden krijgen'} een `
    + 'wijzigingsmail van Outlook. Dat hoort zo bij een afspraak met genodigden '
    + 'en is niet uit te zetten.'
}
