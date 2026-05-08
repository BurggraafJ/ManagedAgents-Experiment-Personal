import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { deriveAgentsState } from '../lib/agents'

/**
 * useAgents — alle data over agent-runs, schedules, open vragen en feedback.
 *
 * Vervangt het agent-deel van de oude monoliet-`useDashboard`. Gebruikt door
 * NowView (WeekProgress + Agents-sectie) en alle plekken die `latestRuns` /
 * `history` / `weekRuns` / `schedules` / `questions` lezen. Afgeleide views
 * (latestRuns, history-sparkline, weekStats, etc.) worden in lib/agents.js
 * berekend zodat deze hook puur fetch + cache is.
 *
 * Returns:
 *  - runs, schedules, feedback
 *  - latestRuns, history, todayRuns, weekRuns, rangeRuns, recentRuns, weekStart
 *  - overdueSchedules, runningSchedules, nextRun
 *  - weekStats, lastWeekStats
 *  - questions  (met days_open + urgency-veld)
 *  - loading / error / online / lastRefresh / refresh()
 */
const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useAgents() {
  const [runs, setRuns] = useState([])
  const [runHistory, setRunHistory] = useState([])
  const [schedules, setSchedules] = useState([])
  const [questions, setQuestions] = useState([])
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [online, setOnline] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [r, h, s, q, f] = await Promise.all([
        safeQ(supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('agent_runs')
          .select('agent_name,status,started_at')
          .gte('started_at', new Date(now.getTime() - 14 * DAY).toISOString())
          .order('started_at', { ascending: false })),
        safeQ(supabase.from('agent_schedules').select('*').order('agent_name')),
        safeQ(supabase.from('open_questions').select('*').order('expires_at', { ascending: true, nullsFirst: false })),
        safeQ(supabase.from('agent_feedback').select('*').order('created_at', { ascending: false }).limit(50)),
      ])
      setRuns(r.data || [])
      setRunHistory(h.data || [])
      setSchedules(s.data || [])
      setQuestions(q.data || [])
      setFeedback(f.data || [])
      setError(null)
      setOnline(true)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message || String(e))
      setOnline(false)
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
    const channel = supabase
      .channel('agents-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_schedules' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_questions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_feedback' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  const derived = useMemo(
    () => deriveAgentsState({ runs, runHistory, schedules, questions }),
    [runs, runHistory, schedules, questions]
  )

  return {
    runs,
    schedules,
    feedback,
    ...derived,
    loading,
    error,
    online,
    lastRefresh,
    refresh: fetchAll,
  }
}
