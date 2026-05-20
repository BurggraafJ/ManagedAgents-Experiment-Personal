import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Chat-state voor RagSearchV2View · zk-asst / zk-user thread.
// Sinds v3.3 van rag-chat Edge Function: streaming via SSE. We doen een
// directe fetch ipv supabase.functions.invoke zodat we de ReadableStream
// kunnen consumeren. Anon-JWT komt via supabase.auth.getSession().
//
// SSE-protocol:
//   data: {"type":"meta", citations: [...], debug_pipeline: {...}, ...}
//   data: {"type":"delta", "text":"..."}    (vele)
//   data: {"type":"done", tokens: {...}, timing_ms: {...}}
//   data: {"type":"error", error: "..."}
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
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true, streaming: true }])
    setLoading(true)

    const body = { message: text, history, top_k: opts.top_k ?? 8, stream: true }
    if (opts.filter_sources && opts.filter_sources.length > 0) body.filter_sources = opts.filter_sources
    if (opts.filter_after) body.filter_after = opts.filter_after
    if (opts.filter_entity_type && opts.filter_entity_id) {
      body.filter_entity_type = opts.filter_entity_type
      body.filter_entity_id = opts.filter_entity_id
    }

    try {
      const session = (await supabase.auth.getSession()).data.session
      const accessToken = session?.access_token
      const url = `${import.meta.env.VITE_SUPABASE_URL || supabase.supabaseUrl}/functions/v1/rag-chat`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': supabase.supabaseKey,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`
        try { const j = await res.json(); errMsg = j.error || j.hint || errMsg } catch { /* keep */ }
        throw new Error(errMsg)
      }
      const ctype = res.headers.get('content-type') || ''
      if (!ctype.includes('text/event-stream')) {
        // Server koos voor non-stream (fallback) — verwerk als JSON
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || 'unknown_error')
        applyFinal(setMessages, json, text)
        return
      }
      // Streaming SSE
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let acc = ''
      let meta = null
      let finalMeta = null
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const ev of events) {
          if (!ev.startsWith('data:')) continue
          const payload = ev.slice(5).trim()
          if (!payload) continue
          let json
          try { json = JSON.parse(payload) } catch { continue }
          if (json.type === 'meta') {
            meta = json
            updateLastAssistant(setMessages, prev => ({ ...prev, ...meta, content: acc, loading: false, streaming: true, user_message: text }))
          } else if (json.type === 'delta') {
            acc += json.text || ''
            updateLastAssistant(setMessages, prev => ({ ...prev, content: acc }))
          } else if (json.type === 'done') {
            finalMeta = json
            updateLastAssistant(setMessages, prev => ({
              ...prev,
              streaming: false,
              tokens: json.tokens,
              timing_ms: json.timing_ms,
              finish_reason: json.finish_reason,
            }))
          } else if (json.type === 'error') {
            throw new Error(json.error)
          }
        }
      }
      void finalMeta
    } catch (e) {
      updateLastAssistant(setMessages, prev => ({ ...prev, content: '', error: e.message || String(e), loading: false, streaming: false }))
    } finally {
      setLoading(false)
    }
  }, [messages, loading])

  const reset = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, loading, send, reset }
}

function updateLastAssistant(setMessages, updater) {
  setMessages(prev => {
    const next = [...prev]
    const idx = next.length - 1
    if (idx < 0 || next[idx].role !== 'assistant') return prev
    next[idx] = updater(next[idx])
    return next
  })
}

function applyFinal(setMessages, json, userText) {
  updateLastAssistant(setMessages, prev => ({
    ...prev,
    role: 'assistant',
    content: json.answer || '(leeg antwoord)',
    citations: json.citations || [],
    bundle_id: json.bundle_id,
    retrieval_strategy: json.retrieval_strategy,
    entity_used: json.entity_used,
    tokens: json.tokens,
    timing_ms: json.timing_ms,
    model: json.model,
    chunk_count: json.chunk_count ?? (json.citations || []).length,
    confidence: json.confidence ?? null,
    knowledge_lessons: json.knowledge_lessons || [],
    debug_pipeline: json.debug_pipeline || null,
    loading: false,
    streaming: false,
    user_message: userText,
    ts: Date.now(),
  }))
}
