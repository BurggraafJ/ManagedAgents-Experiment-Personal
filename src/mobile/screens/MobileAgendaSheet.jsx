import { useEffect, useState } from 'react'
import MIcon from '../MIcon'
import { OUTLOOK_CALENDAR_URL, openOutlook, outlookComposeUrl } from '../../lib/agendaOutlook'

/* MobileAgendaSheet — de mobiele tegenhanger van de desktop-popover (design A
 * "Luchtlijn", 2026-09-12). Op de telefoon is een bottom-sheet de popover:
 * zelfde vier standen (detail / wijzig / verwijder / nieuw), zelfde eerlijke
 * boodschap dat Legal Mind niet naar Outlook schrijft.
 *
 * Hergebruikt `.m-scrim` + `.m-sheet` uit mobile.css, inclusief de
 * `m-modal-open`-vergrendeling die de tabbar verbergt zolang de sheet open is. */
const DAYS_FULL = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function toDate(dateStr, timeStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number)
  const [hh, mm] = (timeStr || '').split(':').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0)
}
function whenLabel(d, end) {
  return `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} · ${hhmm(d)}${end ? `–${hhmm(end)}` : ''}`
}

export default function MobileAgendaSheet({ mode: initialMode, event, draft, onClose }) {
  const [mode, setMode] = useState(initialMode || 'detail')
  const isCreate = mode === 'create'
  const base = event ? new Date(event.start_time) : (draft?.start ? new Date(draft.start) : new Date())
  const baseEnd = event?.end_time
    ? new Date(event.end_time)
    : (draft?.end ? new Date(draft.end) : new Date(base.getTime() + 30 * 60000))

  const [form, setForm] = useState(() => ({
    subject: event?.subject || '',
    date: dateKey(base),
    start: hhmm(base),
    end: hhmm(baseEnd),
    location: event?.location_text || '',
  }))
  const set = key => e => setForm(prev => ({ ...prev, [key]: e.target.value }))

  useEffect(() => {
    const root = document.documentElement
    root.classList.add('m-modal-open')
    return () => root.classList.remove('m-modal-open')
  }, [])

  const openInOutlook = () => {
    if (!isCreate) return openOutlook(OUTLOOK_CALENDAR_URL)
    return openOutlook(outlookComposeUrl({
      subject: form.subject,
      start: toDate(form.date, form.start),
      end: toDate(form.date, form.end),
      location: form.location,
    }))
  }

  const title = isCreate ? 'Nieuw event'
    : mode === 'edit' ? 'Event wijzigen'
    : mode === 'delete' ? 'Event verwijderen?'
    : (event?.subject || '(geen titel)')

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-sheet m-agsheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-drawer__grab" />
        <div className="m-sheet__head">
          <span className="m-drawer__title">{title}</span>
          <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
            <MIcon name="close" size={16} />
          </button>
        </div>

        <div className="m-sheet__body m-agsheet__body">
          {mode === 'detail' && event && (
            <>
              <div className="m-agsheet__when">{whenLabel(base, baseEnd)}</div>
              <div className="m-agsheet__chips">
                <span className={`m-agl__tag ${event.online_meeting_url ? 'is-online' : ''}`}>
                  {event.online_meeting_url ? 'Online' : 'In persoon'}
                </span>
                {event.is_recurring && <span className="m-agl__tag">Terugkerend</span>}
                {event.fireflies_meeting_id && <span className="m-agl__tag">Fireflies</span>}
              </div>
              {event.location_text && (
                <div className="m-agsheet__row"><span>Locatie</span><strong>{event.location_text}</strong></div>
              )}
              {event.organizer_name && (
                <div className="m-agsheet__row">
                  <span>Organisator</span>
                  <strong>{event.organizer_name}</strong>
                </div>
              )}
              {event.body_preview && <p className="m-agsheet__preview">{event.body_preview}</p>}
              {event.online_meeting_url && (
                <a className="m-agsheet__link" href={event.online_meeting_url} target="_blank" rel="noopener noreferrer">
                  Open de online meeting ↗
                </a>
              )}
              <div className="m-agsheet__acties">
                <button type="button" className="m-admbtn" onClick={() => setMode('edit')}>Wijzigen</button>
                <button type="button" className="m-admbtn m-admbtn--warn" onClick={() => setMode('delete')}>Verwijderen</button>
              </div>
            </>
          )}

          {(mode === 'edit' || isCreate) && (
            <>
              <div className="m-field">
                <div className="m-field__label">Titel</div>
                <input className="m-agsheet__input" type="text" value={form.subject} onChange={set('subject')} placeholder="Waar gaat het over?" />
              </div>
              <div className="m-field">
                <div className="m-field__label">Datum</div>
                <input className="m-agsheet__input" type="date" value={form.date} onChange={set('date')} />
              </div>
              <div className="m-field m-agsheet__times">
                <label>
                  <div className="m-field__label">Van</div>
                  <input className="m-agsheet__input" type="time" step="900" value={form.start} onChange={set('start')} />
                </label>
                <label>
                  <div className="m-field__label">Tot</div>
                  <input className="m-agsheet__input" type="time" step="900" value={form.end} onChange={set('end')} />
                </label>
              </div>
              <div className="m-field">
                <div className="m-field__label">Locatie</div>
                <input className="m-agsheet__input" type="text" value={form.location} onChange={set('location')} placeholder="Teams, kantoor, adres…" />
              </div>
              <p className="m-agsheet__note">
                {isCreate
                  ? 'Opslaan kan nog niet vanuit Legal Mind. "Openen in Outlook" neemt deze velden mee; daar leg je het event vast.'
                  : 'Wijzigen kan nog niet vanuit Legal Mind. Outlook blijft bron-van-waarheid — pas het daar aan, de agenda volgt bij de volgende sync.'}
              </p>
            </>
          )}

          {mode === 'delete' && (
            <>
              <div className="m-agsheet__when">{whenLabel(base, baseEnd)}</div>
              <p className="m-agsheet__note">
                Legal Mind schrijft nog niet naar je agenda. Er gaat dus géén afzegging
                naar de genodigden en het event blijft in Outlook staan. Annuleer de
                afspraak in Outlook; de agenda-spiegel volgt bij de volgende sync.
              </p>
              <div className="m-agsheet__acties">
                <button type="button" className="m-admbtn" onClick={() => setMode('detail')}>Terug</button>
                <button type="button" className="m-admbtn m-admbtn--icon" disabled title="Schrijf-API volgt">Verwijderen volgt (API)</button>
              </div>
            </>
          )}
        </div>

        <div className="m-sheet__cta m-agsheet__cta">
          {(mode === 'edit' || isCreate) && (
            <button type="button" className="m-admbtn" disabled title="Schrijf-API volgt">Opslaan volgt (API)</button>
          )}
          <button type="button" className="m-sheet__add" onClick={openInOutlook}>
            {isCreate ? 'Openen in Outlook ↗' : 'Outlook-agenda openen ↗'}
          </button>
        </div>
      </div>
    </>
  )
}
