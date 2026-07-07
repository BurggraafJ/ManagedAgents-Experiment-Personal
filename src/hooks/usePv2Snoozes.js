import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/Toast'

/* usePv2Snoozes — "Stel uit" voor Postvak variant 2. Leest postvak_snoozes
 * (RLS: eigen rijen), levert de set actieve snoozes en een snooze-functie
 * met optimistic update. Mails duiken na snoozed_until vanzelf weer op
 * (client-side filter + minuut-tick). */
export function usePv2Snoozes() {
  const [rows, setRows] = useState([])
  const [tick, setTick] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('postvak_snoozes')
        .select('mail_id,snoozed_until')
        .gt('snoozed_until', new Date().toISOString())
        .limit(500)
      setRows(data || [])
    } catch { /* snooze is nice-to-have; stil falen */ }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(() => { setTick(t => t + 1); refresh() }, 60 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  const snoozedIds = new Set(
    rows.filter(r => new Date(r.snoozed_until) > new Date()).map(r => r.mail_id),
  )

  const snooze = useCallback(async (mailId, until, label) => {
    setRows(prev => [...prev.filter(r => r.mail_id !== mailId), { mail_id: mailId, snoozed_until: until.toISOString() }])
    try {
      const { data, error } = await supabase.rpc('set_mail_snooze', { p_mail_id: mailId, p_until: until.toISOString() })
      if (error || (data && data.ok === false)) throw new Error(error?.message || data?.reason || 'mislukt')
      showToast({ message: 'Uitgesteld', detail: `Komt terug ${label}.` })
    } catch (e) {
      setRows(prev => prev.filter(r => r.mail_id !== mailId))
      showToast({ kind: 'error', message: 'Uitstellen mislukt', detail: e.message })
    }
  }, [])

  return { snoozedIds, snooze, tick }
}

// Handige presets: morgen 09:00 en +1 dag zelfde tijd.
export function tomorrowNine() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}
export function plusOneDay() {
  return new Date(Date.now() + 24 * 3600 * 1000)
}
