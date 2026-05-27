import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useMeetingBriefing — leest de pre-gegenereerde briefing voor één
 * calendar-event uit `meeting_briefings` (+ het event zelf en de deelnemers).
 *
 * De briefing wordt gegenereerd door de `meeting-briefing` Edge Function
 * (cron/scan). De browser triggert generatie NOOIT direct, maar via de RPC
 * `request_meeting_briefing(p_event_id)` die de rij op status 'queued' zet;
 * de volgende scan pakt 'm op. Daarom: realtime-listener + lichte poll terwijl
 * de status 'queued'/'generating' is, zodat de pagina vanzelf bijwerkt.
 *
 * Returns:
 *  - event        calendar_events-rij (subject/tijd/locatie/online-url)
 *  - briefing     meeting_briefings-rij of null
 *  - attendees    calendar_attendees (fallback voor "Met wie" vóór generatie)
 *  - loading / error
 *  - generating   true zolang status queued|generating
 *  - requestGenerate()  roept de RPC aan + zet optimistic 'queued'
 */
const PENDING = new Set(['queued', 'generating'])
const POLL_MS = 6000

export function useMeetingBriefing(eventId) {
  const [event, setEvent] = useState(null)
  const [briefing, setBriefing] = useState(null)
  const [attendees, setAttendees] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reqError, setReqError] = useState(null)

  const fetchAll = useCallback(async () => {
    if (!eventId) { setLoading(false); return }
    const safe = (q, fb) => Promise.resolve(q).then(r => r).catch(() => fb)
    const [ev, bf, at] = await Promise.all([
      safe(supabase.from('calendar_events')
        .select('id, subject, body_preview, start_time, end_time, location_text, online_meeting_url, organizer_email')
        .eq('id', eventId).maybeSingle(), { data: null }),
      safe(supabase.from('meeting_briefings').select('*').eq('calendar_event_id', eventId).maybeSingle(), { data: null }),
      safe(supabase.from('calendar_attendees')
        .select('email, name, attendee_type, is_organizer').eq('calendar_event_id', eventId), { data: [] }),
    ])
    setEvent(ev.data || null)
    setBriefing(bf.data || null)
    setAttendees(at.data || [])
    setError(ev.data ? null : 'not_found')
    setLoading(false)
  }, [eventId])

  useEffect(() => { setLoading(true); fetchAll() }, [fetchAll])

  // Realtime: ververs zodra de briefing-rij voor dit event verandert.
  useEffect(() => {
    if (!eventId) return
    const channel = createRealtimeChannel('briefing-live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_briefings', filter: `calendar_event_id=eq.${eventId}` },
        fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [eventId, fetchAll])

  // Lichte poll terwijl er nog gegenereerd wordt (realtime mist soms de flip).
  const status = briefing?.status
  useEffect(() => {
    if (!PENDING.has(status)) return
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [status, fetchAll])

  const requestGenerate = useCallback(async () => {
    if (!eventId) return
    setReqError(null)
    // optimistic: toon meteen de 'wordt gegenereerd'-staat
    setBriefing(prev => ({ ...(prev || { calendar_event_id: eventId }), status: 'queued', error_text: null }))
    const { error: rpcErr } = await supabase.rpc('request_meeting_briefing', { p_event_id: eventId })
    if (rpcErr) {
      setReqError(rpcErr.message || 'kon generatie niet aanvragen')
      fetchAll()
    }
  }, [eventId, fetchAll])

  return {
    event,
    briefing,
    attendees,
    loading,
    error,
    reqError,
    generating: PENDING.has(status),
    requestGenerate,
    refresh: fetchAll,
  }
}
