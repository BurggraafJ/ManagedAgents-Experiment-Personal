import { useState } from 'react'
import { toLocalDateKey } from '../../../lib/agenda'
import { OUTLOOK_CALENDAR_URL, openOutlook, outlookComposeUrl } from '../../../lib/agendaOutlook'

/* AgendaEventForm — de velden van de nieuw/wijzig-stand van de popover.
 *
 * Design-first (2026-09-12): er is geen schrijf-pad naar Outlook. De velden
 * zijn echt bewerkbaar zodat de interactie te beoordelen is, maar niets wordt
 * opgeslagen. Wie het écht wil vastleggen gaat naar Outlook — bij "nieuw" met
 * de ingevulde velden als voorvulling, bij "wijzig" naar de agenda zelf. */
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

export default function AgendaEventForm({ mode, event, draft, onCancel }) {
  const [v, setV] = useState(() => initialValues({ mode, event, draft }))
  const set = (key) => (e) => setV(prev => ({ ...prev, [key]: e.target.value }))
  const isCreate = mode === 'create'

  const openInOutlook = () => {
    if (!isCreate) return openOutlook(OUTLOOK_CALENDAR_URL)
    return openOutlook(outlookComposeUrl({
      subject: v.subject,
      start: toDate(v.date, v.start),
      end: toDate(v.date, v.end),
      location: v.location,
    }))
  }

  return (
    <>
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">{isCreate ? 'Nieuw event' : 'Event wijzigen'}</h2>
        <div className="ag-pop__when">
          {isCreate ? 'Concept — nog niet in je agenda' : (event?.subject || '(geen titel)')}
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

        <p className="ag-pop__note">
          {isCreate
            ? 'Opslaan kan nog niet vanuit Legal Mind. "Openen in Outlook" neemt deze velden mee; daar leg je het event vast.'
            : 'Wijzigen kan nog niet vanuit Legal Mind. Outlook blijft bron-van-waarheid — pas het daar aan, de agenda volgt bij de volgende sync.'}
        </p>
      </div>

      <div className="ag-pop__actions">
        <button type="button" className="ag-btn ag-btn--xs" onClick={onCancel}>Annuleren</button>
        <button type="button" className="ag-btn ag-btn--xs" disabled title="Schrijf-API volgt">
          Opslaan volgt (API)
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-btn--primary ag-pop__spacer"
          onClick={openInOutlook}
        >
          {isCreate ? 'Openen in Outlook ↗' : 'Outlook ↗'}
        </button>
      </div>
    </>
  )
}
