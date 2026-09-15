import { DOW_NL, MONTH_NL, formatTimeRange } from '../../../lib/agenda'
import { OUTLOOK_CALENDAR_URL, openOutlook } from '../../../lib/agendaOutlook'
import { BLOCK_TEXT, canDeleteEvent, cancelNoticeText } from '../../../lib/agendaWrite'

/* AgendaCancelPane — de annuleer-stand van de desktop-popover (v1.216).
 *
 * Tot v1.215 heette dit `DeletePane` en verdween de knop zodra er genodigden
 * waren: Maestro stuurde nooit een afzeggingsmail. Jelle wil het zoals Outlook
 * (2026-09-15): één snelknop Annuleren, en bij genodigden de keuze mét of
 * zónder bericht. Die keuze staat hier als twee knoppen, niet als een
 * schakelaar met een standaardwaarde — een standaard is een keuze die iemand
 * anders voor je maakte, en bij verstuurde post wil je die zelf maken.
 *
 *   zonder genodigden → één gevulde knop "Annuleren" (lichte bevestiging)
 *   mét genodigden    → "Zonder bericht" (omrand) en "Met bericht" (gevuld)
 *
 * De echte controle zit in de edge-functie: die weigert een delete mét
 * genodigden waarbij de keuze ontbreekt (`notify_choice_required`). */
export default function AgendaCancelPane({ event, attendeeCount, write, onBack, onDeleted }) {
  const start = new Date(event.start_time)
  const label = `${DOW_NL[(start.getDay() + 6) % 7]} ${start.getDate()} ${MONTH_NL[start.getMonth()]} · ${formatTimeRange(start, new Date(event.end_time))}`
  const del = canDeleteEvent(event, attendeeCount)
  const busy = write?.busy
  const withGuests = attendeeCount > 0

  const cancel = async (notifyAttendees) => {
    if (!del.ok || busy) return
    if (await write.deleteEvent(event.graph_id, { notifyAttendees })) onDeleted?.()
  }

  return (
    <>
      <div className="ag-pop__head">
        <h2 className="ag-pop__title">Afspraak annuleren?</h2>
        <div className="ag-pop__when">{event.subject || '(geen titel)'} — {label}</div>
      </div>
      <div className="ag-pop__body">
        <p className={`ag-pop__note${withGuests && del.ok ? ' ag-pop__note--warn' : ''}`}>
          {del.ok ? cancelNoticeText(attendeeCount) : BLOCK_TEXT[del.reason]}
        </p>
      </div>
      <div className="ag-pop__actions">
        <button
          type="button"
          className="ag-btn ag-btn--xs ag-pop__link"
          onClick={() => openOutlook(OUTLOOK_CALENDAR_URL)}
        >
          Outlook ↗
        </button>
        <button type="button" className="ag-btn ag-btn--xs ag-pop__spacer" onClick={onBack} disabled={busy}>
          Terug
        </button>
        {del.ok && withGuests && (
          <button
            type="button"
            className="ag-btn ag-btn--xs ag-pop__danger"
            onClick={() => cancel(false)}
            disabled={busy}
            title="Stil verwijderen: de genodigden krijgen geen afzegging"
          >
            Zonder bericht
          </button>
        )}
        {del.ok && (
          <button
            type="button"
            className="ag-btn ag-btn--xs ag-pop__danger ag-pop__danger--solid"
            onClick={() => cancel(withGuests)}
            disabled={busy}
            title={withGuests ? 'Outlook stuurt de genodigden een afzegging' : undefined}
          >
            {busy ? 'Bezig…' : (withGuests ? 'Met bericht' : 'Annuleren')}
          </button>
        )}
      </div>
    </>
  )
}
