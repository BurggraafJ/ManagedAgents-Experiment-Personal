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
 *  - loading / error / refresh() / refreshCalendar()
 *
 * v1.216 — twee banen in plaats van één. Tot v1.215 was er één `fetchAll` met
 * negen queries in één Promise.all, en die draaide bij mount, elke twee
 * minuten, na elke realtime-wijziging op acht tabellen én na elke schrijfactie.
 * Het scherm wachtte daardoor op de traagste van de negen (cities_lookup is
 * een `select *` over een hele tabel) voordat er één event te zien was.
 *
 *   calendar  — events, genodigden, sync-stand. Dit is wat je ziet. Eerste
 *               paint zodra dit binnen is; dit pollt; dit ververst na een
 *               schrijfactie en na realtime-wijzigingen op de agenda-tabellen.
 *   planner   — regels, suggesties, prognose, voice-notes, voorstellen, steden.
 *               Bij mount en bij realtime-wijzigingen op díé tabellen. Geen
 *               poll: ze veranderen alleen als een agent of Jelle ze aanraakt,
 *               en dan zegt realtime het.
 *
 * De poll slaat over als het tabblad verborgen is en haalt in zodra het weer
 * zichtbaar wordt — een agenda op een tweede scherm hoeft niet elke twee
 * minuten negen queries te kosten. De kwartier-sync (ETL) blijft ongemoeid: dit
 * is alleen hoe vaak de spiegel wordt gelezen, niet hoe vaak hij wordt gevuld.
 */
const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500
/** Na terugkeer naar het tabblad: alleen opnieuw lezen als de vorige lezing ouder is dan dit. */
const STALE_MS = 45 * 1000

const CALENDAR_TABLES = ['calendar_events', 'calendar_attendees', 'calendar_sync_state']
const PLANNER_TABLES = [
  'agenda_planner_rules', 'agenda_planner_suggestions', 'agenda_location_forecast',
  'agenda_voice_notes', 'agenda_appointment_proposals', 'cities_lookup',
]

const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))

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
  const calDebounce = useRef(null)
  const planDebounce = useRef(null)
  const lastCalendarAt = useRef(0)

  const fetchCalendar = useCallback(async () => {
    const now = new Date()
    const calFromIso = new Date(now.getTime() - 14 * DAY).toISOString()
    const calToIso = new Date(now.getTime() + 90 * DAY).toISOString()
    try {
      const [ev, at, sy] = await Promise.all([
        safeQ(supabase.from('calendar_events')
          // `is_organizer` stond wél in de tabel maar niet in deze select, en
          // zonder die kolom kan het scherm geen verschil maken tussen
          // "wijzigen" (jouw afspraak) en "afzeggen" (die van iemand anders) —
          // bij Graph is DELETE op andermans event feitelijk afwijzen.
          .select('id,graph_id,subject,body_preview,location_text,start_time,end_time,is_all_day,is_cancelled,is_recurring,is_organizer,response_status,organizer_email,organizer_name,categories,show_as,importance,fireflies_meeting_id,online_meeting_url')
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
        // Géén `.eq('id', 1)`: de ETL upsert op `onConflict: 'user_id'`, dus de
        // rij van de tweede mailbox krijgt een ander id en `id = 1` zou dan de
        // sync-tijd van iemand anders tonen. RLS beperkt deze select al tot de
        // eigen rij(en); we nemen de meest recente. Geen `maybeSingle()` —
        // twee mailboxen zijn twee rijen, en dat is geen fout (PGRST116).
        safeQ(supabase.from('calendar_sync_state').select('*')
          .order('updated_at', { ascending: false, nullsFirst: false }).limit(1)),
      ])
      setEvents(ev.data || [])
      setAttendees(at.data || [])
      setSyncState(Array.isArray(sy.data) ? (sy.data[0] || null) : (sy.data || null))
      setError(null)
      lastCalendarAt.current = Date.now()
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPlanner = useCallback(async () => {
    const now = new Date()
    const fcFromDate = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10)
    const fcToDate = new Date(now.getTime() + 28 * DAY).toISOString().slice(0, 10)
    const propFromIso = new Date(now.getTime() - 60 * DAY).toISOString()
    try {
      const [ru, su, lf, vn, ap, ci] = await Promise.all([
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
      ])
      setRules(ru.data || [])
      setSuggestions(su.data || [])
      setLocationForecast(lf.data || [])
      setVoiceNotes(vn.data || [])
      setAppointmentProposals(ap.data || [])
      setCities(ci.data || [])
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  const fetchAll = useCallback(
    () => Promise.all([fetchCalendar(), fetchPlanner()]).then(() => undefined),
    [fetchCalendar, fetchPlanner],
  )

  const scheduleCalendar = useCallback(() => {
    if (calDebounce.current) clearTimeout(calDebounce.current)
    calDebounce.current = setTimeout(fetchCalendar, REALTIME_DEBOUNCE_MS)
  }, [fetchCalendar])
  const schedulePlanner = useCallback(() => {
    if (planDebounce.current) clearTimeout(planDebounce.current)
    planDebounce.current = setTimeout(fetchPlanner, REALTIME_DEBOUNCE_MS)
  }, [fetchPlanner])

  useEffect(() => {
    fetchAll()
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      fetchCalendar()
    }
    const id = setInterval(tick, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCalendarAt.current > STALE_MS) fetchCalendar()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchAll, fetchCalendar])

  useEffect(() => {
    let channel = createRealtimeChannel('agenda-live')
    for (const table of CALENDAR_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleCalendar)
    }
    for (const table of PLANNER_TABLES) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedulePlanner)
    }
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (calDebounce.current) clearTimeout(calDebounce.current)
      if (planDebounce.current) clearTimeout(planDebounce.current)
    }
  }, [scheduleCalendar, schedulePlanner])

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
    refreshCalendar: fetchCalendar,
  }
}
