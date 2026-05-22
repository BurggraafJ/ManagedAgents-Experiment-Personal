import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useAdmin — data voor de Administratie-views (HubSpotInbox + Toekomst).
 *
 * Bundelt agent-proposals, daily-admin-filtered-records, hubspot pipelines/users
 * en de calendar-spiegel (events + attendees) — alle bronnen die de admin-views
 * tonen of waar voorstellen aan refereren.
 *
 * Returns:
 *  - proposals           agent_proposals (laatste 200)
 *  - filtered            daily_admin_filtered_records (laatste 100)
 *  - pipelines           hubspot_pipelines (gesorteerd op sort_order)
 *  - hubspotUsers        actieve hubspot_users
 *  - calendarEvents      calendar_events binnen 14d-90d window
 *  - calendarAttendees   bijbehorende attendees (joined op event window)
 *  - schedules           agent_schedules (voor "next run" badge in Future-view)
 *  - loading / error / refresh()
 */
const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useAdmin() {
  const [proposals, setProposals] = useState([])
  const [filtered, setFiltered] = useState([])
  const [pipelines, setPipelines] = useState([])
  const [hubspotUsers, setHubspotUsers] = useState([])
  const [calendarEvents, setCalendarEvents] = useState([])
  const [calendarAttendees, setCalendarAttendees] = useState([])
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    const fromIso = new Date(now.getTime() - 14 * DAY).toISOString()
    const toIso = new Date(now.getTime() + 90 * DAY).toISOString()
    try {
      const [p, f, pl, hu, ce, ca, s] = await Promise.all([
        safeQ(supabase.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200)),
        safeQ(supabase.from('daily_admin_filtered_records').select('*').order('scanned_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('hubspot_pipelines').select('*').order('sort_order')),
        safeQ(supabase.from('hubspot_users')
          .select('hubspot_owner_id,email,first_name,last_name,full_name,active,is_primary')
          .eq('active', true)
          .order('is_primary', { ascending: false })
          .order('full_name')),
        safeQ(supabase.from('calendar_events')
          .select('id,graph_id,subject,body_preview,location_text,start_time,end_time,is_all_day,is_cancelled,is_recurring,response_status,organizer_email,organizer_name,categories,show_as,importance,fireflies_meeting_id,online_meeting_url')
          .eq('is_deleted', false)
          .gte('start_time', fromIso)
          .lte('start_time', toIso)
          .order('start_time', { ascending: true })
          .limit(2000)),
        safeQ(supabase.from('calendar_attendees')
          .select('calendar_event_id,email,name,attendee_type,response_status,is_organizer,calendar_events!inner(start_time)')
          .gte('calendar_events.start_time', fromIso)
          .lte('calendar_events.start_time', toIso)
          .limit(8000)),
        safeQ(supabase.from('agent_schedules').select('*').order('agent_name')),
      ])
      setProposals(p.data || [])
      setFiltered(f.data || [])
      setPipelines(pl.data || [])
      setHubspotUsers(hu.data || [])
      setCalendarEvents(ce.data || [])
      setCalendarAttendees(ca.data || [])
      setSchedules(s.data || [])
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

  // Optimistic-update voor een enkele proposal-rij. Wordt aangeroepen door
  // useProposalActions na een succesvolle accept/reject/amend RPC zodat de kaart
  // direct uit de Pending-lijst verdwijnt — niet wachten op de 1.5s realtime-debounce.
  // Revert-pad: als de RPC alsnog faalt, kan caller dezelfde functie met de oude
  // status aanroepen om terug te zetten.
  const mutateProposal = useCallback((id, patch) => {
    if (!id || !patch) return
    setProposals(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  useEffect(() => {
    const channel = createRealtimeChannel('admin-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_admin_filtered_records' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hubspot_pipelines' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hubspot_users' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_attendees' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    proposals,
    filtered,
    pipelines,
    hubspotUsers,
    calendarEvents,
    calendarAttendees,
    schedules,
    loading,
    error,
    refresh: fetchAll,
    mutateProposal,
  }
}
