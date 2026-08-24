import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useAgenda — alle data voor AgendaView en AgendaRulesView.
 *
 * Calendar-mirror (events + attendees) binnen een 14d-90d window, plus alle
 * planner-tabellen (regels, suggestions, locatieprognose, voice-notes,
 * appointment-proposals) en cities-lookup voor locatieregels.
 *
 * Returns:
 *  - events                  calendar_events (window 14d terug t/m 90d vooruit)
 *  - attendees               calendar_attendees (joined op event-window)
 *  - rules                   agenda_planner_rules (enabled, op priority)
 *  - suggestions             agenda_planner_suggestions (pending)
 *  - locationForecast        agenda_location_forecast (window 7d terug t/m 28d vooruit)
 *  - voiceNotes              agenda_voice_notes (laatste 20)
 *  - appointmentProposals    agenda_appointment_proposals (pending|sent, 60d window)
 *  - cities                  cities_lookup
 *  - loading / error / refresh()
 */
const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useAgenda() {
  const [events, setEvents] = useState([])
  const [attendees, setAttendees] = useState([])
  const [rules, setRules] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [locationForecast, setLocationForecast] = useState([])
  const [voiceNotes, setVoiceNotes] = useState([])
  const [appointmentProposals, setAppointmentProposals] = useState([])
  const [cities, setCities] = useState([])
  const [syncState, setSyncState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    const calFromIso = new Date(now.getTime() - 14 * DAY).toISOString()
    const calToIso = new Date(now.getTime() + 90 * DAY).toISOString()
    const fcFromDate = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10)
    const fcToDate = new Date(now.getTime() + 28 * DAY).toISOString().slice(0, 10)
    const propFromIso = new Date(now.getTime() - 60 * DAY).toISOString()
    try {
      const [ev, at, ru, su, lf, vn, ap, ci, sy] = await Promise.all([
        safeQ(supabase.from('calendar_events')
          .select('id,graph_id,subject,body_preview,location_text,start_time,end_time,is_all_day,is_cancelled,is_recurring,response_status,organizer_email,organizer_name,categories,show_as,importance,fireflies_meeting_id,online_meeting_url')
          .eq('is_deleted', false)
          .gte('start_time', calFromIso)
          .lte('start_time', calToIso)
          .order('start_time', { ascending: true })
          .limit(2000)),
        safeQ(supabase.from('calendar_attendees')
          .select('calendar_event_id,email,name,attendee_type,response_status,is_organizer,calendar_events!inner(start_time)')
          .gte('calendar_events.start_time', calFromIso)
          .lte('calendar_events.start_time', calToIso)
          .limit(8000)),
        safeQ(supabase.from('agenda_planner_rules').select('*').eq('enabled', true).order('priority', { ascending: false })),
        safeQ(supabase.from('agenda_planner_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('agenda_location_forecast')
          .select('*')
          .gte('forecast_date', fcFromDate)
          .lte('forecast_date', fcToDate)
          .order('forecast_date')),
        safeQ(supabase.from('agenda_voice_notes').select('*').order('created_at', { ascending: false }).limit(20)),
        safeQ(supabase.from('agenda_appointment_proposals')
          .select('*')
          .in('status', ['pending', 'sent'])
          .gte('created_at', propFromIso)
          .order('created_at', { ascending: false })
          .limit(200)),
        safeQ(supabase.from('cities_lookup').select('*').order('city')),
        safeQ(supabase.from('calendar_sync_state').select('*').eq('id', 1).maybeSingle()),
      ])
      setEvents(ev.data || [])
      setAttendees(at.data || [])
      setRules(ru.data || [])
      setSuggestions(su.data || [])
      setLocationForecast(lf.data || [])
      setVoiceNotes(vn.data || [])
      setAppointmentProposals(ap.data || [])
      setCities(ci.data || [])
      setSyncState(sy.data || null)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchAll, REALTIME_DEBOUNCE_MS)
  }, [fetchAll])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  useEffect(() => {
    const channel = createRealtimeChannel('agenda-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_attendees' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_planner_rules' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_planner_suggestions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_location_forecast' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_voice_notes' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_appointment_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cities_lookup' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    events,
    attendees,
    rules,
    suggestions,
    locationForecast,
    voiceNotes,
    appointmentProposals,
    cities,
    syncState,
    loading,
    error,
    refresh: fetchAll,
  }
}
