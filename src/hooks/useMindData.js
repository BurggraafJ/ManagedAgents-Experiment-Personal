import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Fetch alle proposals + lessons + bron-meta (meetings + signalen) in één pass.
export function useMindData() {
  const [proposals, setProposals] = useState([])
  const [lessons, setLessons] = useState([])
  const [meetingMap, setMeetingMap] = useState({})
  const [signalMap, setSignalMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [pRes, lRes] = await Promise.all([
        supabase.from('jellemind_lesson_proposals')
          .select('*')
          .eq('status', 'pending')
          .order('confidence', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('jellemind_lessons')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false }),
      ])
      if (pRes.error) throw pRes.error
      if (lRes.error) throw lRes.error
      const props = pRes.data || []
      setProposals(props)
      setLessons(lRes.data || [])

      const meetingIds = [...new Set(props.filter(p => p.source_meeting_id).map(p => p.source_meeting_id))]
      const signalIds = [...new Set(props.flatMap(p => p.signal_ids || []))]

      const [mRes, sRes] = await Promise.all([
        meetingIds.length
          ? supabase.from('fireflies_meetings')
              .select('id, title, date_time, meeting_url, fireflies_id, duration_min')
              .in('id', meetingIds)
          : Promise.resolve({ data: [], error: null }),
        signalIds.length
          ? supabase.from('jellemind_signals')
              .select('id, signal_type, agent_name, before_text, after_text, delta_summary, occurred_at, source_table')
              .in('id', signalIds)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (mRes.error) throw mRes.error
      if (sRes.error) throw sRes.error
      setMeetingMap(Object.fromEntries((mRes.data || []).map(m => [m.id, m])))
      setSignalMap(Object.fromEntries((sRes.data || []).map(s => [s.id, s])))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  return { proposals, lessons, meetingMap, signalMap, loading, error, reload: load }
}
