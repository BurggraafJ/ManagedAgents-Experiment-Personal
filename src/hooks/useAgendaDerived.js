import { useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  DAYS_PER_WEEK,
  addDays,
  classifyEvent,
  computeLocationForecasts,
  startOfDay,
  toLocalDateKey,
} from '../lib/agenda'

/**
 * useAgendaDerived — derives + side-effects voor de agenda-view.
 * Pure data-transforms uit useAgenda + useAutoDraft, plus de auto-sync
 * van proposals (status='sent' → 'accepted' bij overlap met een event).
 *
 * Returnt:
 *   days, proposalsByDay, locationForecast, customerEmailSet,
 *   attendeesByEvent, eventsByDay, weekEventCount.
 */
export function useAgendaDerived({
  weekStart,
  events,
  attendees,
  rules,
  voiceNotes,
  citiesLookup,
  appointmentProposals,
  dbLocationForecast,
  hubspotCustomerEmails,
}) {
  // Auto-sync: voor elke proposal status='sent' check of er een calendar-event is
  // die overlapt met één van de proposed_slots → markeer proposal als 'accepted'.
  useEffect(() => {
    if (!appointmentProposals.length || !events.length) return
    const overlap = (a, b) => Math.max(a.start, b.start) < Math.min(a.end, b.end)
    const eventRanges = events
      .filter(ev => !ev.is_cancelled)
      .map(ev => ({ start: new Date(ev.start_time).getTime(), end: new Date(ev.end_time).getTime() }))
    const toAccept = []
    for (const p of appointmentProposals) {
      if (p.status !== 'sent') continue
      const slots = Array.isArray(p.proposed_slots) ? p.proposed_slots : []
      const hit = slots.some(s => {
        const r = { start: new Date(s.start).getTime(), end: new Date(s.end).getTime() }
        return eventRanges.some(er => overlap(r, er))
      })
      if (hit) toAccept.push(p.id)
    }
    if (toAccept.length > 0) {
      ;(async () => {
        // eslint-disable-next-line no-console
        console.log('[Agenda] Auto-accepting', toAccept.length, 'proposals (event overlap detected)')
        await supabase.from('agenda_appointment_proposals')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .in('id', toAccept)
      })()
    }
  }, [appointmentProposals, events])

  const days = useMemo(() =>
    Array.from({ length: DAYS_PER_WEEK }, (_, i) => addDays(weekStart, i)),
    [weekStart])

  // Voorstel-slots gegroepeerd per dag (alleen status='sent')
  const proposalsByDay = useMemo(() => {
    const map = {}
    for (const p of appointmentProposals) {
      if (p.status !== 'sent') continue
      const slots = Array.isArray(p.proposed_slots) ? p.proposed_slots : []
      for (const s of slots) {
        if (!s.start || !s.end) continue
        const k = toLocalDateKey(new Date(s.start))
        if (!map[k]) map[k] = []
        map[k].push({ slot: s, proposal: p })
      }
    }
    return map
  }, [appointmentProposals])

  // Combineer DB-forecast (uit skill) met client-side berekening
  const locationForecast = useMemo(() => {
    const map = {}
    const computed = computeLocationForecasts(rules, voiceNotes, events, days, citiesLookup)
    Object.assign(map, computed)
    for (const row of (dbLocationForecast || [])) {
      map[row.forecast_date] = row
    }
    return map
  }, [dbLocationForecast, rules, voiceNotes, events, days, citiesLookup])

  const customerEmailSet = useMemo(() =>
    new Set((hubspotCustomerEmails || []).map(c => (c.email || '').toLowerCase())),
    [hubspotCustomerEmails])

  const attendeesByEvent = useMemo(() => {
    const map = {}
    for (const a of (attendees || [])) {
      const key = a.calendar_event_id
      if (!map[key]) map[key] = []
      map[key].push(a)
    }
    return map
  }, [attendees])

  const eventsByDay = useMemo(() => {
    const byDay = {}
    const wkEnd = addDays(weekStart, 7)
    for (const ev of events) {
      if (ev.is_cancelled) continue
      const start = new Date(ev.start_time)
      const end   = new Date(ev.end_time)
      if (end < weekStart || start >= wkEnd) continue
      const evDayStart = startOfDay(start)
      const evDayEnd   = startOfDay(end)
      let cur = evDayStart < weekStart ? new Date(weekStart) : new Date(evDayStart)
      while (cur < wkEnd && cur <= evDayEnd) {
        const k = toLocalDateKey(cur)
        if (!byDay[k]) byDay[k] = []
        byDay[k].push({ ev, classified: classifyEvent(ev, attendeesByEvent, customerEmailSet) })
        cur = addDays(cur, 1)
      }
    }
    return byDay
  }, [events, weekStart, customerEmailSet, attendeesByEvent])

  const weekEventCount = useMemo(
    () => Object.values(eventsByDay).reduce((sum, arr) => sum + arr.length, 0),
    [eventsByDay])

  return {
    days,
    proposalsByDay,
    locationForecast,
    customerEmailSet,
    attendeesByEvent,
    eventsByDay,
    weekEventCount,
  }
}
