import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useChat — leest agent_chat_messages voor de ChatView (twee-paneel chat-UI).
 *
 * Levert de laatste 300 berichten, gesorteerd op sent_at desc. ChatView groepeert
 * client-side per session_id en filtert improvements eruit. Realtime via
 * postgres_changes op agent_chat_messages.
 *
 * Returns:
 *  - messages   array van chat-rows
 *  - loading / error / refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useChat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('agent_chat_messages')
        .select('*')
        .order('sent_at', { ascending: false })
        .limit(300)
      if (err) throw err
      setMessages(data || [])
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
    const channel = supabase
      .channel('chat-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_chat_messages' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return { messages, loading, error, refresh: fetchAll }
}
