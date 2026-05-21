import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'

// Chat-state voor RagSearchView · Maestro RAG-chat.
//
// Sinds 2026-05-21: persistent sessions in Supabase tabel rag_chat_sessions
// (RLS owner-only). Geen localStorage meer — beter voor security en
// cross-device. Auto-save bij elke message-wijziging (debounced 800ms).
//
// SSE streaming via rag-chat Edge Function v3.5+:
//   data: {"type":"meta", citations: [...], debug_pipeline: {...}, ...}
//   data: {"type":"delta", "text":"..."}    (vele)
//   data: {"type":"done", tokens: {...}, timing_ms: {...}}
//   data: {"type":"error", error: "..."}
//
// Performance: setTimeout-throttle 250ms voor delta-flushes. Markdown
// gebruikt useDeferredValue (zie Markdown.jsx) zodat parse niet UI blokkeert.

export function useRagChat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const pendingDeltaRef = useRef('')
  const timerIdRef = useRef(null)
  const accRef = useRef('')
  const THROTTLE_MS = 250

  const flushPendingDelta = useCallback(() => {
    timerIdRef.current = null
    const flushed = pendingDeltaRef.current
    if (!flushed) return
    pendingDeltaRef.current = ''
    accRef.current += flushed
    const current = accRef.current
    updateLastAssistant(setMessages, prev => ({
      ...prev,
      content: current,
      loading: false,
    }))
  }, [])

  // Laad lijst van bestaande sessies.
  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true)
    const { data, error } = await supabase
      .from('rag_chat_sessions')
      .select('id, title, message_count, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(50)
    if (!error) setSessions(data || [])
    setSessionsLoading(false)
  }, [])

  useEffect(() => { refreshSessions() }, [refreshSessions])

  // Auto-save bij elke wijziging in messages — debounced 800ms.
  // Skip tijdens streaming (te veel mutaties); wacht tot streaming klaar.
  const saveTimerRef = useRef(null)
  useEffect(() => {
    if (messages.length === 0) return
    const lastIsStreaming = messages[messages.length - 1]?.streaming
    if (lastIsStreaming) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      const firstUser = messages.find(m => m.role === 'user')
      const title = firstUser?.content?.slice(0, 80) || '(nieuw gesprek)'
      // Strip alleen wat we willen persistent: role/content/ts/citations/entity.
      const persistable = messages.map(m => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        ...(m.role === 'assistant' && m.citations ? { citations: m.citations } : {}),
        ...(m.role === 'assistant' && m.entity_used ? { entity_used: m.entity_used } : {}),
        ...(m.error ? { error: m.error } : {}),
      }))
      const { data: userData } = await supabase.auth.getUser()
      if (!userData?.user) return
      if (sessionId) {
        await supabase.from('rag_chat_sessions')
          .update({ title, messages: persistable })
          .eq('id', sessionId)
      } else {
        const { data, error } = await supabase.from('rag_chat_sessions')
          .insert({ owner_id: userData.user.id, title, messages: persistable })
          .select('id')
          .single()
        if (!error && data) setSessionId(data.id)
      }
      refreshSessions()
    }, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [messages, sessionId, refreshSessions])

  const send = useCallback(async (msg, opts = {}) => {
    const text = (msg || '').trim()
    if (!text || loading) return
    const userMsg = { role: 'user', content: text, ts: Date.now() }
    const history = messages
      .filter(m => !m.error && !m.loading)
      .map(m => ({
        role: m.role,
        content: m.content,
        ...(m.role === 'assistant' && m.entity_used ? { entity_used: m.entity_used } : {}),
      }))
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true, streaming: true }])
    setLoading(true)
    accRef.current = ''
    pendingDeltaRef.current = ''

    const baseBody = { message: text, history, top_k: opts.top_k ?? 8 }
    if (opts.filter_sources && opts.filter_sources.length > 0) baseBody.filter_sources = opts.filter_sources
    if (opts.filter_after) baseBody.filter_after = opts.filter_after
    if (opts.filter_entity_type && opts.filter_entity_id) {
      baseBody.filter_entity_type = opts.filter_entity_type
      baseBody.filter_entity_id = opts.filter_entity_id
    }
    if (opts.web_search) baseBody.web_search = true

    try {
      await streamingCall(baseBody, setMessages, text, {
        pendingDeltaRef, timerIdRef, accRef, flushPendingDelta, THROTTLE_MS,
      })
    } catch (e) {
      console.warn('[rag-chat] streaming failed, falling back to non-stream', e)
      try { await invokeFallback(baseBody, setMessages, text) }
      catch (e2) {
        updateLastAssistant(setMessages, prev => ({
          ...prev,
          content: prev.content || '',
          error: e2.message || String(e2),
          loading: false,
          streaming: false,
        }))
      }
    } finally {
      if (timerIdRef.current) { clearTimeout(timerIdRef.current); timerIdRef.current = null }
      if (pendingDeltaRef.current) flushPendingDelta()
      setLoading(false)
    }
  }, [messages, loading, flushPendingDelta])

  // Nieuwe sessie — wist huidige messages + sessionId.
  const newSession = useCallback(() => {
    setMessages([])
    setSessionId(null)
    if (timerIdRef.current) { clearTimeout(timerIdRef.current); timerIdRef.current = null }
    pendingDeltaRef.current = ''
    accRef.current = ''
  }, [])

  // Laad sessie uit DB. Replace messages-array.
  const loadSession = useCallback(async (id) => {
    if (!id) return
    const { data, error } = await supabase
      .from('rag_chat_sessions')
      .select('id, messages')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return
    setMessages(Array.isArray(data.messages) ? data.messages : [])
    setSessionId(data.id)
  }, [])

  const deleteSession = useCallback(async (id) => {
    await supabase.from('rag_chat_sessions').delete().eq('id', id)
    if (id === sessionId) { setMessages([]); setSessionId(null) }
    refreshSessions()
  }, [sessionId, refreshSessions])

  return {
    messages, loading, send,
    sessionId, sessions, sessionsLoading,
    newSession, loadSession, deleteSession, refreshSessions,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Streaming via direct fetch + ReadableStream + setTimeout-throttle
// ─────────────────────────────────────────────────────────────────────────
async function streamingCall(baseBody, setMessages, text, refs) {
  const { pendingDeltaRef, timerIdRef, accRef, flushPendingDelta, THROTTLE_MS } = refs
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('supabase_env_missing')
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
    const json = await res.json()
    if (!json.ok) throw new Error(json.error || 'unknown_error')
    applyFinal(setMessages, json, text)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
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
        updateLastAssistant(setMessages, prev => ({
          ...prev,
          ...json,
          loading: true,
          streaming: true,
          user_message: text,
        }))
      } else if (json.type === 'delta') {
        pendingDeltaRef.current += json.text || ''
        if (!timerIdRef.current) {
          timerIdRef.current = setTimeout(flushPendingDelta, THROTTLE_MS)
        }
      } else if (json.type === 'done') {
        if (timerIdRef.current) { clearTimeout(timerIdRef.current); timerIdRef.current = null }
        if (pendingDeltaRef.current) {
          accRef.current += pendingDeltaRef.current
          pendingDeltaRef.current = ''
        }
        const finalContent = accRef.current
        updateLastAssistant(setMessages, prev => ({
          ...prev,
          content: finalContent,
          streaming: false,
          loading: false,
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
