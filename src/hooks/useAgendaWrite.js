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
  // v1.216 — annuleren mét of zónder bericht. `notifyAttendees` is de keuze
  // uit de annuleer-kaart; hij gaat alleen mee als het echt een boolean is,
  // zodat de edge-functie bij genodigden kan weigeren als de keuze ontbreekt
  // in plaats van er stilzwijgend een te maken.
  const deleteEvent = useCallback(
    (graphId, { notifyAttendees } = {}) => call({
      action: 'delete_event', graph_id: graphId,
      ...(typeof notifyAttendees === 'boolean' ? { notify_attendees: notifyAttendees } : {}),
    }, 'Afspraak geannuleerd'),
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
 * Wat er de deur uit is gegaan. Dat staat vóór de klik al in het scherm; hier
 * bevestigen we het, zodat de toast niet doet alsof er niets is gebeurd.
 *
 * Drie gevallen, en ze verschillen genoeg om ze uit elkaar te houden:
 *
 *   aanmaken mét genodigden  → uitnodigingen
 *   wijzigen, lijst kleiner  → ook afzeggingen (en dan kán `attendee_count` nul
 *                              zijn terwijl er wél post is verstuurd — vandaar
 *                              dat de edge-functie óók `attendee_count_before`
 *                              teruggeeft)
 *   wijzigen, lijst gelijk   → de gewone wijzigingsmail
 */
function detailFor(data) {
  if (!data) return undefined
  // Annuleren (v1.216): `cancelled` onderscheidt dit van update_event, dat óók
  // `attendees_notified` teruggeeft maar dan een wijzigingsmail bedoelt.
  if (data.cancelled) {
    const n = data.attendee_count || 0
    if (!n) return undefined
    return data.attendees_notified
      ? `Outlook stuurt een afzegging naar ${n} ${n === 1 ? 'genodigde' : 'genodigden'}.`
      : `Zonder bericht: bij ${n} ${n === 1 ? 'genodigde' : 'genodigden'} blijft de afspraak staan.`
  }
  if (data.attendees_invited) {
    const n = data.attendee_count || 0
    return `Outlook heeft ${n === 1 ? 'een uitnodiging' : `${n} uitnodigingen`} verstuurd.`
  }
  if (data.attendees_notified) {
    const after = data.attendee_count || 0
    const before = data.attendee_count_before ?? after
    if (after > before) return `Outlook nodigt ${after - before} ${after - before === 1 ? 'iemand' : 'mensen'} extra uit; de rest krijgt een wijzigingsmail.`
    if (after < before) return `Outlook zegt ${before - after} ${before - after === 1 ? 'genodigde' : 'genodigden'} af; de rest krijgt een wijzigingsmail.`
    return `Outlook stuurt een wijzigingsmail naar ${after} ${after === 1 ? 'genodigde' : 'genodigden'}.`
  }
  return undefined
}
