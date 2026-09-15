import { useState } from 'react'
import { toLocalDateKey } from '../../../lib/agenda'
import { attendeeDiffText, attendeeInviteText, attendeeNoticeText } from '../../../lib/agendaWrite'
import { OUTLOOK_CALENDAR_URL, openOutlook, outlookComposeUrl } from '../../../lib/agendaOutlook'
import AgendaAttendeeField from './AgendaAttendeeField'

/* AgendaEventForm — de velden van de nieuw/wijzig-stand van de popover.
 *
 * v1.195: het formulier schrijft écht naar Outlook (Edge Function
 * `outlook-calendar-live`).
 *
 * v1.203 — genodigden. Tot nu toe had dit formulier bewust géén
 * genodigden-veld: `attendees_info` meesturen betekent dat Graph de
 * uitnodigingen verstuurt, en dat is volgens Microsoft "can't be configured".
 * Jelle heeft gevraagd het er wél in te zetten (2026-09-15), dus de afweging is
 * verschoven: niet verstoppen, maar zéggen wat er gebeurt — vóór de klik, met
 * het aantal erbij. Zie `attendeeInviteText` / `attendeeDiffText`.
 *
 * Wat er nog steeds NIET in zit:
 *  - body/omschrijving bij UPDATE → sloopt de Teams-deelnamelink;
 *  - terugkeerpatroon en een tweede agenda → die kan Composio niet.
 * Daarvoor blijft de Outlook-deeplink naast de knop staan. */
function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** De bestaande genodigden als bewerkbare lijst (zonder de organisator zelf). */
function attendeesToChips(list) {
  return (list || [])
    .filter(a => a?.email && !a.is_organizer)
    .map(a => ({ email: String(a.email).toLowerCase(), name: a.name || null, type: a.attendee_type || 'required' }))
}

function initialValues({ mode, event, draft }) {
  if (mode === 'edit' && event) {
    const s = new Date(event.start_time)
    const e = new Date(event.end_time)
    return {
      subject: event.subject || '',
      date: toLocalDateKey(s),
      start: hhmm(s),
      end: hhmm(e),
      location: event.location_text || '',
    }
  }
  const s = draft?.start ? new Date(draft.start) : new Date()
  const e = draft?.end ? new Date(draft.end) : new Date(s.getTime() + 30 * 60000)
  return {
    subject: '',
    date: toLocalDateKey(s),
    start: hhmm(s),
    end: hhmm(e),
    location: '',
  }
}

function toDate(dateStr, timeStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  const [hh, mm] = (timeStr || '').split(':').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0)
}

export default function AgendaEventForm({
  mode, event, draft, attendees = [], write, onCancel, onSaved,
}) {
  const [v, setV] = useState(() => initialValues({ mode, event, draft }))
  const [guests, setGuests] = useState(() => attendeesToChips(attendees))
  // v1.216 — Teams-vergadering, standaard UIT (Jelle, 2026-09-15). Alleen bij
  // aanmaken: een bestaande Teams-link laat de update met rust (val 2 in
  // _shared/outlook-calendar.ts), dus bij wijzigen is er niets te kiezen.
  const [teams, setTeams] = useState(false)
  const set = (key) => (e) => setV(prev => ({ ...prev, [key]: e.target.value }))
  const isCreate = mode === 'create'
  const busy = write?.busy
  const before = attendeesToChips(attendees).length

  const openInOutlook = () => {
    if (!isCreate) return openOutlook(OUTLOOK_CALENDAR_URL)
    return openOutlook(outlookComposeUrl({
      subject: v.subject,
      start: toDate(v.date, v.start),
      end: toDate(v.date, v.end),
      location: v.location,
    }))
  }

  // De tijden gaan als losse velden mee (datum + "HH:mm"), niet als Date of
  // ISO-string. Graph wil een naïeve tijd plus een aparte zone; een
  // `toISOString()` zou de zone dubbel meesturen en de afspraak twee uur
  // verschuiven. De omzetting gebeurt op één plek, in `_shared/outlook-calendar.ts`.
  const fields = {
    subject: v.subject, date: v.date, start: v.start, end: v.end, location: v.location,
    attendees: guests,
    ...(isCreate ? { online_meeting: teams } : {}),
  }
  const invalid = !v.date || !v.start || !v.end || v.end <= v.start

  const onSave = async () => {
    if (invalid || busy) return
    const res = isCreate
      ? await write.createEvent(fields)
      : await write.updateEvent(event.graph_id, fields)
    if (res) onSaved?.()
  }

  // Drie mededelingen die elkaar uitsluiten, in volgorde van wat er de deur
  // uitgaat. Ze staan er vóór de klik, niet erna: het gaat om verstuurde post.
  //
  //  1. aanmaken mét genodigden → uitnodigingen
  //  2. wijzigen én de lijst is veranderd → uitnodigingen en/of afzeggingen
  //  3. wijzigen met een ongewijzigde lijst → de gewone wijzigingsmail
  const notice = isCreate
    ? attendeeInviteText(guests.length)
    : (attendeeDiffText(before, guests.length) || attendeeNoticeText(guests.length))

  return (
    <>
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">{isCreate ? 'Nieuw event' : 'Event wijzigen'}</h2>
        <div className="ag-pop__when">
          {isCreate ? 'Wordt aangemaakt in je Outlook-agenda' : (event?.subject || '(geen titel)')}
        </div>
      </div>

      {/* `lang="nl-NL"` voor spellingcontrole en voorleessoftware. Let op wat het
          NIET doet: Chrome leidt de weergave van `input[type=date|time]` af uit
          de browsertaal en niet uit dit attribuut. Een Amerikaans "09/14/2026"
          in een screenshot is dus een eigenschap van de headless browser, niet
          van dit formulier — daarom staat `--lang=nl-NL` in capture.sh. */}
      <div className="ag-pop__body" lang="nl-NL">
        <label className="ag-pop__field">
          <span>Titel</span>
          <input
            type="text"
            value={v.subject}
            onChange={set('subject')}
            placeholder="Waar gaat het over?"
            autoFocus
          />
        </label>
        {/* Datum op een eigen regel, Van en Tot samen. Datum, Van en Tot op ÉÉN
            regel is geprobeerd (v1.203-concept) en weer teruggedraaid: drie
            native kiezers naast elkaar passen in 380 px alleen als de tijd
            24-uurs is. Een browser met een en-US-locale rendert "11:00 AM" plus
            klokicoon en kapt dan het derde veld af. Eén bespaarde regel is dat
            niet waard — en het is nu dezelfde indeling als op de telefoon. */}
        <label className="ag-pop__field">
          <span>Datum</span>
          <input type="date" value={v.date} onChange={set('date')} />
        </label>
        <div className="ag-pop__field-row">
          <label className="ag-pop__field">
            <span>Van</span>
            <input type="time" step="900" value={v.start} onChange={set('start')} />
          </label>
          <label className="ag-pop__field">
            <span>Tot</span>
            <input type="time" step="900" value={v.end} onChange={set('end')} />
          </label>
        </div>
        <label className="ag-pop__field">
          <span>Locatie</span>
          <input
            type="text"
            value={v.location}
            onChange={set('location')}
            placeholder="Teams, kantoor, adres…"
          />
        </label>

        <AgendaAttendeeField value={guests} onChange={setGuests} disabled={busy} />

        {isCreate ? (
          <label className="ag-pop__toggle">
            <input
              type="checkbox"
              checked={teams}
              onChange={e => setTeams(e.target.checked)}
              disabled={busy}
            />
            <span className="ag-pop__toggle-track" aria-hidden />
            <span className="ag-pop__toggle-text">
              <strong>Teams-vergadering</strong>
              <em>{teams ? 'Outlook maakt een deelnamelink aan.' : 'Uit — gewone afspraak zonder link.'}</em>
            </span>
          </label>
        ) : event?.online_meeting_url ? (
          <p className="ag-pop__note">Dit is een Teams-vergadering. De deelnamelink blijft staan.</p>
        ) : null}

        {invalid && (
          <p className="ag-pop__note ag-pop__note--warn">
            De eindtijd moet ná de begintijd liggen.
          </p>
        )}
        {notice && <p className="ag-pop__note ag-pop__note--warn">{notice}</p>}
        {!notice && (
          <p className="ag-pop__note">
            {isCreate
              ? 'Opslaan zet de afspraak meteen in je Outlook-agenda. Zonder genodigden gaat er geen bericht de deur uit.'
              : 'Opslaan past de afspraak aan in Outlook. Categorieën en de Teams-link blijven staan.'}
          </p>
        )}
      </div>

      {/* Opslaan is sinds v1.195 de échte actie; "Openen in Outlook" is de
          uitwijkroute voor wat hier niet kan (terugkeer, tweede agenda). De
          hiërarchie stond andersom — primair zwart, uitwijk als tekstknop. */}
      <div className="ag-pop__actions">
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-pop__link"
          onClick={openInOutlook}
          title={isCreate ? 'Openen in Outlook met deze velden voorgevuld' : 'Outlook blijft bron-van-waarheid'}
        >
          Outlook ↗
        </button>
        {/* v1.216: heette "Annuleren", maar dat woord is nu de snelknop die
            de afspráák annuleert (detail-stand). Hier verlaat je alleen het
            formulier: terug naar detail bij wijzigen, dicht bij nieuw. */}
        <button type="button" className="ag-btn ag-btn--xs ag-pop__spacer" onClick={onCancel} disabled={busy}>
          {isCreate ? 'Sluiten' : 'Terug'}
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-btn--primary"
          onClick={onSave}
          disabled={busy || invalid}
        >
          {busy ? 'Bezig…' : 'Opslaan'}
        </button>
      </div>
    </>
  )
}
