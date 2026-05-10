import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useTasks — leest tasks + task_projects voor TasksView.
 *
 * Returns:
 *  - tasks      laatste 500 tasks (alle statussen)
 *  - projects   task_projects, op sort_order
 *  - loading / error / refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useTasks() {
  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [t, p] = await Promise.all([
        safeQ(supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('task_projects').select('*').order('sort_order')),
      ])
      setTasks(t.data || [])
      setProjects(p.data || [])
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
    const channel = createRealtimeChannel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_projects' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return { tasks, projects, loading, error, refresh: fetchAll }
}
