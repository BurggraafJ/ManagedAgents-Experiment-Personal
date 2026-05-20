import { useState, useCallback } from 'react'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'

// Chat-state voor RagSearchV2View · zk-asst / zk-user thread.
// Sinds v3.3 van rag-chat Edge Function: streaming via SSE. We doen een
// directe fetch ipv supabase.functions.invoke zodat we de ReadableStream
// kunnen consumeren. Anon-JWT via supabase.auth.getSession().
//
// SSE-protocol:
//   data: {"type":"meta", citations: [...], debug_pipeline: {...}, ...}
//   data: {"type":"delta", "text":"..."}    (vele)
//   data: {"type":"done", tokens: {...}, timing_ms: {...}}
//   data: {"type":"error", error: "..."}
//
// Bij streaming-fout (400, network drop, of malformed SSE) valt deze hook
// terug op een non-stream call met dezelfde body — zo blijft chat altijd
// werken ook als de Edge Function tijdens deploy/restart kuren heeft.

export function useRagV2Chat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  const send = useCallback(async (msg, opts = {}) => {
    const text = (msg || '').trim()
    if (!text || loading) return
    const userMsg = { role: 'user', content: text, ts: Date.now() }
    const history = messages
      .filter(m => !m.error && !m.loading)
      .map(m => ({
        role: m.role,
        content: m.content,
        // Geef entity_used door als hint zodat rag-chat hem kan erven bij
        // korte vervolgvragen ("wie was in de lead?").
        ...(m.role === 'assistant' && m.entity_used ? { entity_used: m.entity_used } : {}),
      }))
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true, streaming: true }])
    setLoading(true)

    const baseBody = { message: text, history, top_k: opts.top_k ?? 8 }
    if (opts.filter_sources && opts.filter_sources.length > 0) baseBody.filter_sources = opts.filter_sources
    if (opts.filter_after) baseBody.filter_after = opts.filter_after
    if (opts.filter_entity_type && opts.filter_entity_id) {
      baseBody.filter_entity_type = opts.filter_entity_type
      baseBody.filter_entity_id = opts.filter_entity_id
    }

    let usedStreaming = false
    try {
      await streamingCall(baseBody, setMessages, text)
      usedStreaming = true
    } catch (e) {
      console.warn('[rag-chat] streaming failed, falling back to non-stream', e)
      try {
        await invokeFallback(baseBody, setMessages, text)
      } catch (e2) {
        updateLastAssistant(setMessages, prev => ({
          ...prev,
          content: prev.content || '',
          error: e2.message || String(e2),
          loading: false,
          streaming: false,
        }))
      }
    } finally {
      setLoading(false)
      void usedStreaming
    }
  }, [messages, loading])

  const reset = useCallback(() => {
    setMessages([])
  }, [])

  return { messages, loading, send, reset }
}

// ─────────────────────────────────────────────────────────────────────────
// Streaming via direct fetch + ReadableStream
// ─────────────────────────────────────────────────────────────────────────
async function streamingCall(baseBody, setMessages, text) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('supabase_env_missing')
  }
  const session = (await supabase.auth.getSession()).data.session
  const accessToken = session?.access_token
  if (!accessToken) throw new Error('not_authenticated')

  const res = await fetch(`${SUPABASE_URL}/functions/v1/rag-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON_KEY,
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ ...baseBody, stream: true }),
  })

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`
    try { const j = await res.json(); errMsg = j.error || j.hint || errMsg } catch { /* keep */ }
    throw new Error(errMsg)
  }
  const ctype = res.headers.get('content-type') || ''
  if (!ctype.includes('text/event-stream')) {
    // Server koos voor JSON (zonder stream-support) — verwerk als final.
    const json = await res.json()
    if (!json.ok) throw new Error(json.error || 'unknown_error')
    applyFinal(setMessages, json, text)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
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
        const meta = json
        updateLastAssistant(setMessages, prev => ({
          ...prev,
          ...meta,
          content: acc,
          loading: false,
          streaming: true,
          user_message: text,
        }))
      } else if (json.type === 'delta') {
        acc += json.text || ''
        updateLastAssistant(setMessages, prev => ({ ...prev, content: acc }))
      } else if (json.type === 'done') {
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
}

// ─────────────────────────────────────────────────────────────────────────
// Fallback via supabase.functions.invoke (non-stream)
// ─────────────────────────────────────────────────────────────────────────
async function invokeFallback(baseBody, setMessages, text) {
  const { data, error } = await supabase.functions.invoke('rag-chat', {
    body: { ...baseBody, stream: false },
  })
  if (error) throw new Error(error.message || 'invoke_error')
  if (!data?.ok) throw new Error(data?.error || 'unknown_error')
  applyFinal(setMessages, data, text)
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
