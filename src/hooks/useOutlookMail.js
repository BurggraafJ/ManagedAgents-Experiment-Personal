import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

// =============================================================================
// useOutlookMail — de drie Outlook-mutaties die op de mail zelf slaan (v1.205)
// =============================================================================
// Gelezen markeren, naar een map verplaatsen, en pinnen. Alle drie langs
// `outlook-live`: die functie kent de mailbox van de ingelogde gebruiker, heeft
// de capability-poort al, en spiegelt een geslaagde Graph-write meteen naar
// `mail_messages` — zodat de lijst niet tot de volgende mail-sync (±15 min) op
// de oude waarheid staat.
//
// Waarom hier en niet via een RPC: een `set_mail_is_read`-RPC zou een tweede
// deur zijn naar dezelfde kamer, met een eigen SECURITY DEFINER die de
// multi-user-poort (M2) moet bewaken. De Edge Function weet al wie er belt.
//
// **Optimistisch, maar niet liegend.** De aanroeper krijgt `true`/`false` terug
// en houdt zelf een lokale overlay bij (`readIds`, `pinnedIds`); mislukt de
// call, dan draait die overlay terug. Wat er niet gebeurt: een groene toast over
// een mail die in Outlook nog ongelezen staat.

/**
 * outlook-live aanroepen en er het antwoord-object uit halen — ook bij een 4xx.
 *
 * supabase-js maakt van élke niet-2xx een FunctionsHttpError met `data: null`;
 * de body zit dan in `error.context`. Zonder dit uitpakken lees je "Edge
 * Function returned a non-2xx status code" in plaats van de reden die de
 * functie net netjes meegaf — bijvoorbeeld `unknown_action`, precies het
 * antwoord zolang v6 nog niet gedeployd is.
 */
export async function invokeOutlook(body) {
  const { data, error } = await supabase.functions.invoke('outlook-live', { body })
  if (!error) return data || {}
  try {
    const payload = await error.context?.json()
    if (payload && typeof payload === 'object') return payload
  } catch { /* geen JSON-body: dan is de fout zelf het beste dat we hebben */ }
  throw new Error(error.message)
}

/** Redenen die géén storing zijn maar een stand van zaken. */
export const OUTLOOK_NOT_DEPLOYED = 'unknown_action'

export default function useOutlookMail() {
  const [busyId, setBusyId] = useState(null)

  const run = useCallback(async (id, body) => {
    setBusyId(id)
    try {
      const data = await invokeOutlook(body)
      if (!data.ok) {
        const err = new Error(data.reason || 'geweigerd')
        err.reason = data.reason
        throw err
      }
      return data
    } finally {
      setBusyId(null)
    }
  }, [])

  const markRead = useCallback(
    (mailId, isRead = true) => run(mailId, { action: 'mark_read', message_id: mailId, is_read: isRead }),
    [run])

  const moveToFolder = useCallback(
    (mailId, targetFolder) => run(mailId, { action: 'move_message', message_id: mailId, target_folder: targetFolder }),
    [run])

  const setPin = useCallback(
    (mailId, pinned) => run(mailId, { action: 'set_pin', message_id: mailId, pinned }),
    [run])

  return { busyId, markRead, moveToFolder, setPin }
}
