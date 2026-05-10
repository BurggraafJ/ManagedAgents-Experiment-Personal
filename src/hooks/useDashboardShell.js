import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useDashboardShell — minimale hook voor de App-shell (sidebar/header/banner).
 *
 * Levert alleen wat de shell nodig heeft: orchestrator-heartbeat, connection-state
 * en lastRefresh-stempel. Vervangt de eerdere monoliet `useDashboard` voor de shell.
 * Per-feature data fetcht elke view zelf via z'n eigen feature-hook.
 *
 * Returns:
 *  - orchestratorAgeMin    minuten sinds laatste orchestrator-poll (null bij geen run)
 *  - orchestratorRun       laatste orchestrator agent_runs-row (of null)
 *  - orchestratorSchedule  agent_schedules-row voor 'orchestrator' (of null)
 *  - online                false zodra laatste fetch faalde
 *  - lastRefresh           Date van laatste succesvolle fetch
 *  - error                 string of null
 *  - refresh()             handmatig opnieuw ophalen
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useDashboardShell() {
  const [orchestratorRun, setOrchestratorRun] = useState(null)
  const [orchestratorSchedule, setOrchestratorSchedule] = useState(null)
  const [orchestratorAgeMin, setOrchestratorAgeMin] = useState(null)
  const [online, setOnline] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    try {
      const [runRes, schedRes] = await Promise.all([
        supabase
          .from('agent_runs')
          .select('*')
          .eq('agent_name', 'orchestrator')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('agent_schedules')
          .select('*')
          .eq('agent_name', 'orchestrator')
          .maybeSingle(),
      ])

      const run = runRes.data || null
      const sched = schedRes.data || null
      setOrchestratorRun(run)
      setOrchestratorSchedule(sched)
      setOrchestratorAgeMin(
        run ? Math.round((Date.now() - new Date(run.started_at).getTime()) / 60000) : null
      )
      setError(null)
      setOnline(true)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message || String(e))
      setOnline(false)
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
    const channel = createRealtimeChannel('shell-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_schedules' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    orchestratorAgeMin,
    orchestratorRun,
    orchestratorSchedule,
    online,
    lastRefresh,
    error,
    refresh: fetchAll,
  }
}
