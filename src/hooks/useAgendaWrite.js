import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'
import { writeErrorText } from '../lib/agendaWrite'

/**
 * useAgendaWrite — aanmaken, wijzigen en verwijderen in de Outlook-agenda,
 * via Edge Function `outlook-calendar-live`.
 *
 * Naar het model van `usePv2Drafts`: de browser praat nooit rechtstreeks met
 * Composio, en kan ook niet zelf naar `calendar_events` schrijven — die tabel
 * heeft alleen een SELECT-policy voor gebruikers. De edge-functie schrijft de
 * spiegel in dezelfde call bij, dus `onDone()` (een refresh) laat het scherm
 * meteen kloppen in plaats van over een kwartier.
 *
 * Géén optimistische update: bij mail kun je een verkeerde bucket terugdraaien,
 * maar een half aangemaakte afspraak in het grid is erger dan een seconde
 * wachten. De knop is zolang `busy`.
 */
export function useAgendaWrite(onDone) {
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (body, okMessage) => {
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('outlook-calendar-live', { body })
      if (error) {
        // FunctionsHttpError bij elke non-2xx. `error.message` is dan de
        // generieke "non-2xx status code"; de échte reden (`has_attendees`,
        // `not_organizer`, …) staat in de response-body. Zonder deze stap
        // krijgt de gebruiker bij een dicht hek een nietszeggende fout.
        let body = null
        try { body = await error.context?.json() } catch { /* geen json-body */ }
        throw new Error(messageFor(body) || error.message)
      }
      if (!data || data.ok !== true) throw new Error(messageFor(data) || 'Onbekende fout')
      showToast({ message: okMessage, detail: detailFor(data) })
      await onDone?.()
      return data
    } catch (e) {
      showToast({ kind: 'error', message: 'Agenda bijwerken mislukt', detail: e.message })
      return null
    } finally {
      setBusy(false)
    }
  }, [onDone])

  const createEvent = useCallback(
    (fields) => call({ action: 'create_event', ...fields }, 'Afspraak aangemaakt'),
    [call],
  )
  const updateEvent = useCallback(
    (graphId, fields) => call({ action: 'update_event', graph_id: graphId, ...fields }, 'Afspraak gewijzigd'),
    [call],
  )
  const deleteEvent = useCallback(
    (graphId) => call({ action: 'delete_event', graph_id: graphId }, 'Afspraak verwijderd'),
    [call],
  )

  return { busy, createEvent, updateEvent, deleteEvent }
}

/**
 * Twee antwoordvormen, want er zitten twee lagen voor de deur.
 *
 * De capability-poort uit `_shared/user-gate.ts` antwoordt met
 * `{ error, melding }` — `melding` is al Nederlands en voor de gebruiker
 * bedoeld ("Je hebt het recht … niet"). De functie zelf antwoordt met
 * `{ reason }`, een sleutel die hier vertaald wordt. Wie alleen `reason` leest
 * krijgt bij een rechten-weigering een lege melding.
 */
function messageFor(body) {
  if (!body) return null
  if (typeof body.melding === 'string' && body.melding) return body.melding
  if (body.reason) return writeErrorText(body.reason)
  if (body.error) return writeErrorText(body.error)
  return null
}

/**
 * Bij een wijziging van een afspraak mét genodigden stuurt Outlook een
 * update-mail. Dat staat vóór de klik al in het scherm; hier bevestigen we het,
 * zodat de toast niet doet alsof er niets is gebeurd.
 */
function detailFor(data) {
  if (data?.attendees_notified) {
    const n = data.attendee_count || 0
    return `Outlook stuurt een wijzigingsmail naar ${n} ${n === 1 ? 'genodigde' : 'genodigden'}.`
  }
  return undefined
}
