import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [online, setOnline] = useState(true)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    weekStart.setHours(0, 0, 0, 0)
    const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY)

    try {
      const [runs, questions, feedback, schedules, runHistory, linkedin, salesEvents, salesTodos] = await Promise.all([
        supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(500),
        supabase.from('open_questions').select('*').order('expires_at', { ascending: true, nullsFirst: false }),
        supabase.from('agent_feedback').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('agent_schedules').select('*').order('agent_name'),
        supabase.from('agent_runs').select('agent_name,status,started_at')
          .gte('started_at', new Date(now - 14 * DAY).toISOString())
          .order('started_at', { ascending: false }),
        supabase.from('linkedin_progress').select('*')
          .eq('year', now.getFullYear())
          .order('week_number', { ascending: false })
          .limit(30),
        supabase.from('sales_on_road_events').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('sales_todos').select('*').order('created_at', { ascending: false }).limit(100),
      ])

      // Nieuwe tabellen mogen ontbreken (pas recent aangemaakt)
      const salesEventsSafe = salesEvents?.error ? { data: [] } : salesEvents
      const salesTodosSafe  = salesTodos?.error  ? { data: [] } : salesTodos
      const firstError = [runs, questions, feedback, schedules, runHistory, linkedin].find(r => r.error)
      if (firstError) throw firstError.error

      // Latest run per agent
      const latestRuns = {}
      runs.data.forEach(r => { if (!latestRuns[r.agent_name]) latestRuns[r.agent_name] = r })

      // 7-slot sparkline history per agent
      const history = {}
      runHistory.data.forEach(r => {
        if (!history[r.agent_name]) history[r.agent_name] = []
        if (history[r.agent_name].length < 7) history[r.agent_name].push(r.status)
      })
      Object.keys(history).forEach(a => {
        history[a].reverse()
        while (history[a].length < 7) history[a].unshift('empty')
      })

      // Today's runs (nog gebruikt elders) + deze-week runs voor de week-timeline
      const todayRuns = runs.data.filter(r => new Date(r.started_at) >= dayStart)
      const weekRuns  = runs.data.filter(r => new Date(r.started_at) >= weekStart)

      // Open questions + urgency
      const questionsWithUrgency = questions.data.map(q => {
        const asked = new Date(q.asked_at)
        const expires = q.expires_at ? new Date(q.expires_at) : null
        const daysOpen = Math.floor((now - asked) / DAY)
        let urgency = 'ok'
        if (expires && now > expires) urgency = 'expired'
        else if (expires && now > new Date(expires - DAY)) urgency = 'urgent'
        else if (daysOpen >= 3) urgency = 'warning'
        return { ...q, days_open: daysOpen, urgency }
      })

      // KPI: this week + last week for trend
      const weekStats = emptyStats()
      const lastWeekStats = emptyStats()
      runs.data.forEach(r => {
        // Orchestrator-polls tellen niet mee in werk-output-metrics
        if (r.agent_name === 'orchestrator') return
        const t = new Date(r.started_at)
        if (r.status !== 'success' && r.status !== 'warning') return
        if (t >= weekStart) addStats(weekStats, r)
        else if (t >= lastWeekStart && t < weekStart) addStats(lastWeekStats, r)
      })

      // Orchestrator heartbeat
      const orchRun = latestRuns['orchestrator']
      let orchestratorAgeMin = null
      if (orchRun) {
        orchestratorAgeMin = Math.round((now - new Date(orchRun.started_at)) / 60000)
      }

      // Overdue schedules: next_run_at in the past and still enabled, not is_running
      const overdueSchedules = (schedules.data || []).filter(s => {
        if (!s.enabled || s.is_running) return false
        if (!s.next_run_at) return false
        return new Date(s.next_run_at) < now
      })

      // Currently running
      const runningSchedules = (schedules.data || []).filter(s => s.is_running)

      // Next upcoming run
      const nextRun = (schedules.data || [])
        .filter(s => s.enabled && s.next_run_at && new Date(s.next_run_at) > now)
        .sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0] || null

      // Orchestrator eigen schedule row (voor "volgende poll over X")
      const orchestratorSchedule = (schedules.data || []).find(s => s.agent_name === 'orchestrator') || null

      setData({
        latestRuns,
        history,
        todayRuns,
        weekRuns,
        weekStart,
        questions: questionsWithUrgency,
        feedback: feedback.data || [],
        schedules: schedules.data || [],
        linkedin: linkedin.data || [],
        salesEvents: salesEventsSafe.data || [],
        salesTodos:  salesTodosSafe.data  || [],
        weekStats,
        lastWeekStats,
        orchestratorAgeMin,
        orchestratorRun: orchRun || null,
        orchestratorSchedule,
        overdueSchedules,
        runningSchedules,
        nextRun,
      })
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

  // Initial load + polling fallback
  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  // Realtime subscriptions (best-effort — if publication not set up, no harm)
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' },            scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_questions' },        scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_feedback' },        scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_schedules' },       scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_events' },  scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_todos' },           scheduleRefetch)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return { data, loading, error, online, lastRefresh, refresh: fetchAll }
}

function emptyStats() {
  return { runs: 0, drafts: 0, connects: 0, deals: 0 }
}

function addStats(acc, run) {
  acc.runs++
  const s = run.stats || {}
  if (s.drafts_created) acc.drafts   += Number(s.drafts_created) || 0
  if (s.connects_sent)  acc.connects += Number(s.connects_sent)  || 0
  if (s.deals_updated)  acc.deals    += Number(s.deals_updated)  || 0
}
