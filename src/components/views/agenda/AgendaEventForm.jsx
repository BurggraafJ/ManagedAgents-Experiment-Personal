import { useState } from 'react'
import { toLocalDateKey } from '../../../lib/agenda'
import { attendeeNoticeText } from '../../../lib/agendaWrite'
import { OUTLOOK_CALENDAR_URL, openOutlook, outlookComposeUrl } from '../../../lib/agendaOutlook'

/* AgendaEventForm — de velden van de nieuw/wijzig-stand van de popover.
 *
 * v1.195: het formulier schrijft nu écht naar Outlook (Edge Function
 * `outlook-calendar-live`). De velden zijn ongewijzigd — titel, datum, van, tot,
 * locatie — en dat is geen toeval: precies die vier zijn zonder risico naar
 * Graph te sturen. Er is geen veld voor genodigden, terugkeer, body of
 * online-meeting, en dat blijft zo:
 *
 *  - genodigden bij CREATE → Graph stuurt uitnodigingen en dat is volgens
 *    Microsoft "can't be configured";
 *  - body bij UPDATE → sloopt de Teams-deelnamelink van een online meeting.
 *
 * De Outlook-deeplink blijft naast de opslaan-knop staan. Hij is de tweede
 * route, en de enige route voor alles wat hierboven niet kan. */
function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  mode, event, draft, attendeeCount = 0, write, onCancel, onSaved,
}) {
  const [v, setV] = useState(() => initialValues({ mode, event, draft }))
  const set = (key) => (e) => setV(prev => ({ ...prev, [key]: e.target.value }))
  const isCreate = mode === 'create'
  const busy = write?.busy

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
  const fields = { subject: v.subject, date: v.date, start: v.start, end: v.end, location: v.location }
  const invalid = !v.date || !v.start || !v.end || v.end <= v.start

  const onSave = async () => {
    if (invalid || busy) return
    const res = isCreate
      ? await write.createEvent(fields)
      : await write.updateEvent(event.graph_id, fields)
    if (res) onSaved?.()
  }

  // Alleen bij wijzigen: Outlook stuurt dan een update-mail en daar is geen
  // parameter voor (Graph heeft er geen). Niet verstoppen — Jelle hoort het te
  // weten vóór hij klikt, niet erna.
  const notice = !isCreate ? attendeeNoticeText(attendeeCount) : null

  return (
    <>
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">{isCreate ? 'Nieuw event' : 'Event wijzigen'}</h2>
        <div className="ag-pop__when">
          {isCreate ? 'Wordt aangemaakt in je Outlook-agenda' : (event?.subject || '(geen titel)')}
        </div>
      </div>

      <div className="ag-pop__body">
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

        {invalid && (
          <p className="ag-pop__note ag-pop__note--warn">
            De eindtijd moet ná de begintijd liggen.
          </p>
        )}
        {notice && <p className="ag-pop__note ag-pop__note--warn">{notice}</p>}
        <p className="ag-pop__note">
          {isCreate
            ? 'Opslaan zet de afspraak meteen in je Outlook-agenda — zonder genodigden. '
              + 'Wil je mensen uitnodigen, gebruik dan "Openen in Outlook".'
            : 'Opslaan past de afspraak aan in Outlook. Genodigden, categorieën en '
              + 'de Teams-link blijven staan.'}
        </p>
      </div>

      <div className="ag-pop__actions">
        <button type="button" className="ag-btn ag-btn--xs" onClick={onCancel} disabled={busy}>
          Annuleren
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-btn--primary"
          onClick={onSave}
          disabled={busy || invalid}
        >
          {busy ? 'Bezig…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-pop__spacer"
          onClick={openInOutlook}
          title={isCreate ? 'Openen in Outlook met deze velden voorgevuld' : 'Outlook blijft bron-van-waarheid'}
        >
          {isCreate ? 'Openen in Outlook ↗' : 'Outlook ↗'}
        </button>
      </div>
    </>
  )
}
