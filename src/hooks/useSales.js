import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useSales — sales-on-road events, sales-todos en road-notes inbox.
 *
 * Returns:
 *  - events           sales_on_road_events (laatste 50)
 *  - todos            sales_todos (laatste 100)
 *  - inbox            sales_on_road_inbox (laatste 50, dashboard quick-capture)
 *  - loading / error / refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useSales() {
  const [events, setEvents] = useState([])
  const [todos, setTodos] = useState([])
  const [inbox, setInbox] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [e, t, i] = await Promise.all([
        safeQ(supabase.from('sales_on_road_events').select('*').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('sales_todos').select('*').order('created_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('sales_on_road_inbox').select('*').order('created_at', { ascending: false }).limit(50)),
      ])
      setEvents(e.data || [])
      setTodos(t.data || [])
      setInbox(i.data || [])
      setError(null)
    } catch (err) {
      setError(err.message || String(err))
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
    const channel = createRealtimeChannel('sales-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_events' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_todos' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_inbox' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return { events, todos, inbox, loading, error, refresh: fetchAll }
}
