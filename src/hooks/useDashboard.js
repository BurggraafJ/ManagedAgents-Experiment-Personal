import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const DAY = 86400000
const POLL_MS = 2 * 60 * 1000

export function useDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    try {
      const [runs, questions, feedback, schedules, runHistory, linkedin] = await Promise.all([
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
      ])

      const firstError = [runs, questions, feedback, schedules, runHistory, linkedin].find(r => r.error)
      if (firstError) throw firstError.error

      const latestRuns = {}
      runs.data.forEach(r => { if (!latestRuns[r.agent_name]) latestRuns[r.agent_name] = r })

      const history = {}
      runHistory.data.forEach(r => {
        if (!history[r.agent_name]) history[r.agent_name] = []
        if (history[r.agent_name].length < 7) history[r.agent_name].push(r.status)
      })
      Object.keys(history).forEach(a => {
        history[a].reverse()
        while (history[a].length < 7) history[a].unshift('empty')
      })

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

      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - now.getDay() + 1)
      weekStart.setHours(0, 0, 0, 0)
      const weekStats = { runs: 0, drafts: 0, connects: 0, deals: 0 }
      runs.data.forEach(r => {
        if (new Date(r.started_at) >= weekStart && (r.status === 'success' || r.status === 'warning')) {
          weekStats.runs++
          const s = r.stats || {}
          if (s.drafts_created) weekStats.drafts += Number(s.drafts_created) || 0
          if (s.connects_sent) weekStats.connects += Number(s.connects_sent) || 0
          if (s.deals_updated) weekStats.deals += Number(s.deals_updated) || 0
        }
      })

      setData({
        latestRuns,
        history,
        questions: questionsWithUrgency,
        feedback: feedback.data,
        schedules: schedules.data,
        linkedin: linkedin.data,
        weekStats,
      })
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { data, loading, error, lastRefresh, refresh: fetchAll }
}
