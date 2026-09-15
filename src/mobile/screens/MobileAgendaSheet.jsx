import { useEffect, useState } from 'react'
import MIcon from '../MIcon'
import AgendaAttendeeField from '../../components/views/agenda/AgendaAttendeeField'
import { OUTLOOK_CALENDAR_URL, openOutlook, outlookComposeUrl } from '../../lib/agendaOutlook'
import {
  BLOCK_TEXT, attendeeDiffText, attendeeInviteText, attendeeNoticeText,
  canDeleteEvent, canEditEvent, cancelNoticeText,
} from '../../lib/agendaWrite'

/* MobileAgendaSheet — de mobiele tegenhanger van de desktop-popover (design A
 * "Luchtlijn", 2026-09-12). Op de telefoon is een bottom-sheet de popover:
 * zelfde vier standen (detail / wijzig / verwijder / nieuw).
 *
 * v1.195: schrijft nu écht naar Outlook, via dezelfde `useAgendaWrite` die de
 * desktop gebruikt — de hook komt als prop binnen zodat hij één keer per tree
 * bestaat. De hekken komen uit `lib/agendaWrite.js`, dus mobiel en desktop
 * kunnen niet uit elkaar lopen over wie wat mag.
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

/** De bestaande genodigden als bewerkbare lijst (zonder de organisator zelf). */
function attendeesToChips(list) {
  return (list || [])
    .filter(a => a?.email && !a.is_organizer)
    .map(a => ({ email: String(a.email).toLowerCase(), name: a.name || null, type: a.attendee_type || 'required' }))
}

export default function MobileAgendaSheet({
  mode: initialMode, event, draft, attendees = [], write, onClose,
}) {
  const [mode, setMode] = useState(initialMode || 'detail')
  const isCreate = mode === 'create'
  const attendeeCount = attendees.length
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
  // Eén keer bij het openen: bij 'create' is `attendees` leeg, bij een bestaand
  // event staat de huidige lijst erin. Niet aan `mode` hangen — je kunt vanuit
  // detail naar wijzigen springen en dan moet de lijst er al staan.
  const [guests, setGuests] = useState(() => attendeesToChips(attendees))
  // v1.216 — Teams-vergadering, standaard UIT; alleen bij aanmaken (zelfde
  // regel als AgendaEventForm op de desktop).
  const [teams, setTeams] = useState(false)
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

  const busy = write?.busy
  const edit = canEditEvent(event)
  const del = canDeleteEvent(event, attendeeCount)
  const invalid = !form.date || !form.start || !form.end || form.end <= form.start
  // Dezelfde drie mededelingen als op de desktop, uit dezelfde bron: aanmaken
  // mét genodigden verstuurt uitnodigingen, een gewijzigde lijst verstuurt
  // uitnodigingen én afzeggingen, een ongewijzigde lijst de wijzigingsmail.
  const notice = isCreate
    ? attendeeInviteText(guests.length)
    : (mode === 'edit'
      ? (attendeeDiffText(attendeeCount, guests.length) || attendeeNoticeText(guests.length))
      : null)

  const onSave = async () => {
    if (invalid || busy) return
    const payload = { ...form, attendees: guests, ...(isCreate ? { online_meeting: teams } : {}) }
    const res = isCreate
      ? await write.createEvent(payload)
      : await write.updateEvent(event.graph_id, payload)
    if (res) onClose?.()
  }
  // v1.216 — annuleren mét of zónder bericht (zie AgendaCancelPane voor het
  // waarom). `notifyAttendees` is de keuze; zonder genodigden altijd false.
  const onCancelEvent = async (notifyAttendees) => {
    if (!del.ok || busy) return
    if (await write.deleteEvent(event.graph_id, { notifyAttendees })) onClose?.()
  }

  const title = isCreate ? 'Nieuw event'
    : mode === 'edit' ? 'Event wijzigen'
    : mode === 'delete' ? 'Afspraak annuleren?'
    : (event?.subject || '(geen titel)')

  // Eén regel uitleg als er iets niet kan — geen uitgegrijsde knop zonder reden.
  const blockNote = edit.ok && del.ok
    ? null
    : edit.reason === del.reason
      ? BLOCK_TEXT[edit.reason]
      : [!edit.ok && BLOCK_TEXT[edit.reason], !del.ok && BLOCK_TEXT[del.reason]]
        .filter(Boolean).join(' ')

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
              {attendeeCount > 0 && (
                <div className="m-agsheet__row">
                  <span>Genodigden</span>
                  {/* Een getal zegt niets. Tot vier namen passen er; daarna de
                      rest als telling, zodat de rij niet uitdijt. */}
                  <strong>
                    {attendees.slice(0, 4).map(a => a?.name || a?.email).filter(Boolean).join(', ')}
                    {attendeeCount > 4 && ` +${attendeeCount - 4}`}
                  </strong>
                </div>
              )}
              {event.body_preview && <p className="m-agsheet__preview">{event.body_preview}</p>}
              {event.online_meeting_url && (
                <a className="m-agsheet__link" href={event.online_meeting_url} target="_blank" rel="noopener noreferrer">
                  Open de online meeting ↗
                </a>
              )}
              {blockNote && <p className="m-agsheet__note">{blockNote}</p>}
              {(edit.ok || del.ok) && (
                <div className="m-agsheet__acties">
                  {edit.ok && (
                    <button type="button" className="m-admbtn" onClick={() => setMode('edit')}>Wijzigen</button>
                  )}
                  {del.ok && (
                    <button type="button" className="m-admbtn m-admbtn--warn" onClick={() => setMode('delete')}>
                      Annuleren
                    </button>
                  )}
                </div>
              )}
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
              <div className="m-field">
                <AgendaAttendeeField
                  value={guests} onChange={setGuests} disabled={busy} variant="sheet"
                />
              </div>
              {isCreate ? (
                <label className="m-agsheet__toggle">
                  <input type="checkbox" checked={teams} onChange={e => setTeams(e.target.checked)} disabled={busy} />
                  <span className="m-agsheet__toggle-track" aria-hidden />
                  <span className="m-agsheet__toggle-text">
                    <strong>Teams-vergadering</strong>
                    <em>{teams ? 'Outlook maakt een deelnamelink aan.' : 'Uit — gewone afspraak zonder link.'}</em>
                  </span>
                </label>
              ) : event?.online_meeting_url ? (
                <p className="m-agsheet__note">Dit is een Teams-vergadering. De deelnamelink blijft staan.</p>
              ) : null}
              {invalid && (
                <p className="m-agsheet__note m-agsheet__note--warn">De eindtijd moet ná de begintijd liggen.</p>
              )}
              {notice && <p className="m-agsheet__note m-agsheet__note--warn">{notice}</p>}
              {!notice && (
                <p className="m-agsheet__note">
                  {isCreate
                    ? 'Opslaan zet de afspraak meteen in je Outlook-agenda. Zonder genodigden gaat er geen bericht de deur uit.'
                    : 'Opslaan past de afspraak aan in Outlook. Categorieën en de Teams-link blijven staan.'}
                </p>
              )}
            </>
          )}

          {mode === 'delete' && (
            <>
              <div className="m-agsheet__when">{whenLabel(base, baseEnd)}</div>
              <p className={`m-agsheet__note${del.ok && attendeeCount > 0 ? ' m-agsheet__note--warn' : ''}`}>
                {del.ok ? cancelNoticeText(attendeeCount) : BLOCK_TEXT[del.reason]}
              </p>
              {/* Zonder genodigden: Terug · Annuleren. Mét genodigden: de
                  Outlook-keuze — Zonder bericht (omrand) · Met bericht (gevuld),
                  met Terug erboven als tekstknop zodat de twee keuzes naast
                  elkaar staan en even zwaar zijn. */}
              {del.ok && attendeeCount > 0 ? (
                <>
                  <div className="m-agsheet__acties">
                    <button type="button" className="m-admbtn m-admbtn--warn" onClick={() => onCancelEvent(false)} disabled={busy}>
                      {busy ? 'Bezig…' : 'Zonder bericht'}
                    </button>
                    <button type="button" className="m-admbtn m-admbtn--warn m-admbtn--warn-solid" onClick={() => onCancelEvent(true)} disabled={busy}>
                      {busy ? 'Bezig…' : 'Met bericht'}
                    </button>
                  </div>
                  <button type="button" className="m-agsheet__outlook" onClick={() => setMode('detail')} disabled={busy}>
                    Terug
                  </button>
                </>
              ) : (
                <div className="m-agsheet__acties">
                  <button type="button" className="m-admbtn" onClick={() => setMode('detail')} disabled={busy}>
                    Terug
                  </button>
                  {del.ok && (
                    <button type="button" className="m-admbtn m-admbtn--warn m-admbtn--warn-solid" onClick={() => onCancelEvent(false)} disabled={busy}>
                      {busy ? 'Bezig…' : 'Annuleren'}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* v1.203 — de hiërarchie stond omgekeerd: "Openen in Outlook" was de
            grote zwarte knop en Opslaan de witte eronder. Sinds de schrijfbaan
            werkt is Opslaan de hoofdactie; Outlook is de uitwijkroute voor wat
            hier niet kan (terugkeer, tweede agenda) en hoort dus als tekstknop. */}
        <div className="m-sheet__cta m-agsheet__cta">
          {(mode === 'edit' || isCreate) && (
            <button type="button" className="m-admbtn m-admbtn--primary" onClick={onSave} disabled={busy || invalid}>
              {busy ? 'Bezig…' : 'Opslaan'}
            </button>
          )}
          <button type="button" className="m-agsheet__outlook" onClick={openInOutlook}>
            {isCreate ? 'Openen in Outlook ↗' : 'Outlook-agenda openen ↗'}
          </button>
        </div>
      </div>
    </>
  )
}
