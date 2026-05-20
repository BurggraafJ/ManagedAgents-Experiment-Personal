import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Chat-state voor RagSearchV2View · zk-asst / zk-user thread.
// Houdt history, loading, error en de citations van het laatste antwoord bij.
// Edge Function rag-chat blijft hergebruikt — de UI rond de citations is nieuw.
export function useRagV2Chat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  const send = useCallback(async (msg, opts = {}) => {
    const text = (msg || '').trim()
    if (!text || loading) return
    const userMsg = { role: 'user', content: text, ts: Date.now() }
    const history = messages
      .filter(m => !m.error && !m.loading)
      .map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true }])
    setLoading(true)
    try {
      const body = { message: text, history, top_k: opts.top_k ?? 8 }
      if (opts.filter_sources && opts.filter_sources.length > 0) body.filter_sources = opts.filter_sources
      if (opts.filter_after) body.filter_after = opts.filter_after
      if (opts.filter_entity_type && opts.filter_entity_id) {
        body.filter_entity_type = opts.filter_entity_type
        body.filter_entity_id = opts.filter_entity_id
      }
      const { data, error } = await supabase.functions.invoke('rag-chat', { body })
      if (error) throw new Error(error.message || 'invoke_error')
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: data.answer || '(leeg antwoord)',
          citations: data.citations || [],
          bundle_id: data.bundle_id,
          retrieval_strategy: data.retrieval_strategy,
          entity_used: data.entity_used,
          tokens: data.tokens,
          timing_ms: data.timing_ms,
          model: data.model,
          chunk_count: data.chunk_count ?? (data.citations || []).length,
          confidence: data.confidence ?? null,
          knowledge_lessons: data.knowledge_lessons || [],
          user_message: text,
          ts: Date.now(),
        }
        return next
      })
    } catch (e) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: '',
          error: e.message || String(e),
          ts: Date.now(),
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  const reset = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, loading, send, reset }
}
