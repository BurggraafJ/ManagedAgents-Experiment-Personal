import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { toPersistable } from './ragChatPersist'
import { recordPrompt } from '../lib/promptHistory'
import { useRunFollow, cancelRun, resumeRun, answerRunInput, TERMINAL_STATES } from './useRunFollow'
import { runRowToMessage } from './ragChatRunRow'
import { readLastSessionId, writeLastSessionId, clearLastSessionId } from '../lib/chatSessionPointer'

// Chat-state voor RagSearchView · Maestro RAG-chat.
//
// Sinds 2026-05-21: persistent sessions in Supabase tabel rag_chat_sessions
// (RLS owner-only). Geen localStorage meer — beter voor security en
// cross-device. Auto-save bij elke message-wijziging (debounced 800ms).
//
// v1.151 (spoor 02 I2) — een vraag is een RUN. send() doet één korte POST naar
// rag-chat {run:true} en krijgt binnen ~0,3 s een run_id terug; de rest komt
// via de rij in agent_chat_runs (realtime + poll, zie useRunFollow.js): stappen,
// phase_label, het groeiende antwoord (answer_partial), en aan het eind
// answer_md + envelop + kosten. Het oude SSE-pad en de invokeFallback zijn weg
// (vork V7): een gesloten tab verliest niets meer, want het antwoord staat op de
// server en de hook hecht bij een reload opnieuw aan elke run zonder antwoord.
// De assistent-stub met run_id wordt DIRECT bewaard (de oude "niet opslaan
// tijdens streaming"-uitzondering is verdwenen) — dat is wat de re-attach
// mogelijk maakt.
//
// v1.226 — terugkeer naar hetzelfde gesprek. `initialSessionId` (desktop: de
// tab-wijzer als de URL geen ?session= heeft; mobiel: altijd de wijzer) wordt
// bij mount geladen. De wijzer (lib/chatSessionPointer) volgt sessionId en
// wordt alleen expliciet gewist: Nieuw, verwijderen, of een rij die niet meer
// zichtbaar is. Bij unmount wordt een nog wachtende auto-save direct
// uitgevoerd, anders verdwijnt de eerste vraag als je binnen 800 ms wegklikt.

export function useRagChat({ initialSessionId = null } = {}) {
  const [messages, setMessages] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  // Alleen waar tijdens het herstel-laden bij mount: de UI laat dan even niets
  // zien in plaats van het lege-gesprek-scherm dat meteen weer verdwijnt.
  const [restoring, setRestoring] = useState(Boolean(initialSessionId))
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId

  // Loading = er loopt nog een run (ook één die na een reload is hervat).
  const loading = useMemo(() => messages.some(m => m.role === 'assistant' && m.streaming), [messages])

  // Alle runs die nog niet terminaal zijn: nieuw gestart óf na een reload/loadSession
  // teruggevonden met run_id maar zonder antwoord. Stabiele key zodat useRunFollow
  // niet bij elke render opnieuw abonneert.
  const activeKey = messages
    .filter(m => m.role === 'assistant' && m.run_id && !TERMINAL_STATES.has(m.run_state))
    .map(m => m.run_id).join(',')
  const activeRunIds = useMemo(() => (activeKey ? activeKey.split(',') : []), [activeKey])

  const applyRunRow = useCallback((row) => {
    setMessages(prev => {
      let changed = false
      const next = prev.map(m => {
        if (m.role !== 'assistant' || m.run_id !== row.id) return m
        changed = true
        return runRowToMessage(row, m)
      })
      return changed ? next : prev
    })
  }, [])
  useRunFollow(activeRunIds, applyRunRow)

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

  // Auto-save — debounced 800ms — op elke wijziging die de sessie ná een reload
  // nodig heeft: een bericht erbij, een run_id erbij, een toestandswissel van een
  // run, een fout. De ~400 ms-tussenstanden van het antwoord tellen niet als
  // wijziging (die zouden de rij elke seconde herschrijven); het slotbericht
  // (state done) draagt het volledige antwoord.
  const saveKey = messages.map(m => `${m.role}:${m.run_id || ''}:${m.run_state || ''}:${m.error ? 1 : 0}:${m.ts || ''}`).join('|')
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const saveTimerRef = useRef(null)
  // Staat er nog een save te wachten? Dan voert de unmount-effect hem direct
  // uit (zie onder). Leest alles uit refs zodat hij ook ná unmount klopt.
  const savePendingRef = useRef(false)
  const persistNow = useCallback(async () => {
    savePendingRef.current = false
    const current = messagesRef.current
    if (current.length === 0) return
    const firstUser = current.find(m => m.role === 'user')
    const title = firstUser?.content?.slice(0, 80) || '(nieuw gesprek)'
    const persistable = current.map(toPersistable)
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) return
    const currentId = sessionIdRef.current
    if (currentId) {
      await supabase.from('rag_chat_sessions')
        .update({ title, messages: persistable })
        .eq('id', currentId)
    } else {
      const { data, error } = await supabase.from('rag_chat_sessions')
        .insert({ owner_id: userData.user.id, title, messages: persistable })
        .select('id')
        .single()
      if (!error && data) {
        // Direct óók de wijzer: na een unmount komt de setState (en dus de
        // wijzer-effect hieronder) niet meer aan.
        sessionIdRef.current = data.id
        writeLastSessionId(data.id)
        setSessionId(data.id)
      }
    }
    refreshSessions()
  }, [refreshSessions])
  useEffect(() => {
    if (!saveKey) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    savePendingRef.current = true
    saveTimerRef.current = setTimeout(persistNow, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [saveKey, persistNow])
  // Flush bij unmount (alleen dan: lege deps). De route-wissel naar een ander
  // onderdeel unmount deze hook; zonder flush ging een vraag van < 800 ms oud
  // verloren voor de sessie — onzichtbaar zolang niets herstelde, zichtbaar nu.
  useEffect(() => () => {
    if (savePendingRef.current) persistNow()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // De wijzer volgt het actieve gesprek. Bewust géén else-tak die wist: bij
  // mount is sessionId altijd even null, en dan zou de wijzer verdwijnen vóór
  // hij gelezen is. Wissen gebeurt expliciet in newSession/deleteSession/miss.
  useEffect(() => { if (sessionId) writeLastSessionId(sessionId) }, [sessionId])

  const send = useCallback(async (msg, opts = {}) => {
    const text = (msg || '').trim()
    if (!text || loading) return
    // Eén plek waar élke verstuurde vraag langskomt — composer, voorbeeld-prompt,
    // geschiedenis, desktop én mobiel. Daarom staat het bijhouden van de
    // prompt-geschiedenis hier en niet in de twee composers apart.
    recordPrompt(text)
    const userMsg = { role: 'user', content: text, ts: Date.now() }
    const history = messages
      .filter(m => !m.error && !m.loading)
      .map(m => ({
        role: m.role,
        content: m.content,
        ...(m.role === 'assistant' && m.entity_used ? { entity_used: m.entity_used } : {}),
      }))
    const stubTs = Date.now() + 1
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', loading: true, streaming: true, user_message: text, ts: stubTs }])

    const body = { message: text, history, top_k: opts.top_k ?? 8, run: true }
    if (sessionId) body.session_id = sessionId
    if (opts.effort) body.effort = opts.effort
    if (opts.filter_sources && opts.filter_sources.length > 0) body.filter_sources = opts.filter_sources
    if (opts.filter_after) body.filter_after = opts.filter_after
    if (opts.filter_entity_type && opts.filter_entity_id) {
      body.filter_entity_type = opts.filter_entity_type
      body.filter_entity_id = opts.filter_entity_id
    }
    if (opts.web_search) body.web_search = true
    if (opts.writing_style) body.writing_style = opts.writing_style
    if (opts.tone) body.tone = opts.tone
    if (opts.focus) body.focus = opts.focus

    try {
      const started = await startRun(body)
      updateLastAssistant(setMessages, prev => ({
        ...prev,
        run_id: started.run_id,
        run_state: started.state || 'queued',
        effort: started.effort || null,
        budget: started.budget || null,
        web_search_enabled: !!opts.web_search,
      }))
    } catch (e) {
      updateLastAssistant(setMessages, prev => ({
        ...prev,
        error: e.message || String(e),
        loading: false,
        streaming: false,
      }))
    }
  }, [messages, loading, sessionId])

  // Annuleren (RPC, eigenaar) · hervatten na failed · antwoord op needs_input.
  const cancel = useCallback(async (runId) => {
    try { await cancelRun(runId) } catch (e) { console.warn('[rag-chat] cancel failed', e.message) }
  }, [])
  const resume = useCallback(async (runId) => {
    setMessages(prev => prev.map(m => (m.run_id === runId ? { ...m, error: null, run_state: 'queued', streaming: true, loading: !m.content } : m)))
    try { await resumeRun(runId, { SUPABASE_URL, SUPABASE_ANON_KEY }) }
    catch (e) { setMessages(prev => prev.map(m => (m.run_id === runId ? { ...m, error: e.message, run_state: 'failed', streaming: false, loading: false } : m))) }
  }, [])
  const answerInput = useCallback(async (runId, answer) => {
    const text = (answer || '').trim()
    if (!text) return
    setMessages(prev => prev.map(m => (m.run_id === runId ? { ...m, input_request: null, input_answer: text, run_state: 'researching' } : m)))
    try { await answerRunInput(runId, text, { SUPABASE_URL, SUPABASE_ANON_KEY }) }
    catch (e) { setMessages(prev => prev.map(m => (m.run_id === runId ? { ...m, error: e.message, run_state: 'failed', streaming: false, loading: false } : m))) }
  }, [])

  // Feedback 👍/👎 op een assistant-antwoord → rag_chat_feedback (sluit F.0-meetlus, RAG v2 F.1f).
  const sendFeedback = useCallback(async (message, rating) => {
    if (!message || message.role !== 'assistant') return false
    try {
      const { error } = await supabase.rpc('log_chat_feedback', {
        p_user_message: message.user_message || '',
        p_assistant_answer: message.content || '',
        p_citations: message.citations || [],
        p_bundle_id: message.bundle_id || null,
        p_retrieval_strategy: message.retrieval_strategy || null,
        p_entity_used: message.entity_used || null,
        p_model: message.model || null,
        p_rating: rating,
        p_comment: null,
        p_tokens_used: ((message.tokens?.chat_in ?? message.tokens?.input ?? 0) + (message.tokens?.chat_out ?? message.tokens?.output ?? 0)) || null,
        p_timing_ms: (typeof message.timing_ms === 'object' ? message.timing_ms?.total : message.timing_ms) ?? null,
      })
      if (error) { console.warn('[rag-chat] feedback failed', error.message); return false }
      return true
    } catch (e) { console.warn('[rag-chat] feedback exception', e); return false }
  }, [])

  // Nieuwe sessie — wist huidige messages + sessionId. Een nog lopende run
  // loopt op de server gewoon door (en staat in de vorige sessie bewaard).
  const newSession = useCallback(() => {
    setMessages([])
    setSessionId(null)
    clearLastSessionId()
  }, [])

  // Laad sessie uit DB. Replace messages-array. Berichten met run_id zonder
  // antwoord worden door useRunFollow automatisch weer gevolgd.
  //
  // Token-guard: alleen het laatst gevraagde gesprek mag landen (twee snelle
  // klikken in Geschiedenis, of StrictMode die de mount-load dubbel doet).
  // `restore` = het stille herstel bij mount: dat mag nooit een gesprek
  // overschrijven dat de gebruiker intussen al is begonnen (§2.4).
  const loadTokenRef = useRef(0)
  const loadSession = useCallback(async (id, { restore = false } = {}) => {
    if (!id) return
    const token = ++loadTokenRef.current
    const { data, error } = await supabase
      .from('rag_chat_sessions')
      .select('id, messages')
      .eq('id', id)
      .maybeSingle()
    if (restore) setRestoring(false)
    if (token !== loadTokenRef.current) return
    if (error) return // tijdelijk (token-refresh, netwerk): wijzer laten staan
    if (!data) {
      // Rij weg of niet (meer) zichtbaar onder RLS: wijzer alleen wissen als
      // hij precies naar dit gesprek wees; het scherm blijft leeg, geen fout.
      if (readLastSessionId() === id) clearLastSessionId()
      return
    }
    if (restore && messagesRef.current.length > 0 && !sessionIdRef.current) return
    const loaded = Array.isArray(data.messages) ? data.messages : []
    setMessages(loaded.map(reviveMessage))
    setSessionId(data.id)
  }, [])

  // Herstel bij mount: de wijzer (of de URL, via de aanroeper) wint alleen als
  // er nog niets in dit gesprek staat. Eén keer, bij de eerste render.
  useEffect(() => {
    if (initialSessionId) loadSession(initialSessionId, { restore: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deleteSession = useCallback(async (id) => {
    await supabase.from('rag_chat_sessions').delete().eq('id', id)
    if (id === sessionId) { setMessages([]); setSessionId(null); clearLastSessionId() }
    refreshSessions()
  }, [sessionId, refreshSessions])

  return {
    messages, loading, restoring, send, sendFeedback, cancel, resume, answerInput,
    sessionId, sessions, sessionsLoading,
    newSession, loadSession, deleteSession, refreshSessions,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// De start-call: één POST, direct 200 {run_id}. Hop 1 draait ná die response.
// ─────────────────────────────────────────────────────────────────────────
async function startRun(body) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('supabase_env_missing')
  const session = (await supabase.auth.getSession()).data.session
  const accessToken = session?.access_token
  if (!accessToken) throw new Error('not_authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/rag-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}`, 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false || !json.run_id) throw new Error(json.error || json.hint || `HTTP ${res.status}`)
  return json
}

// Een bewaard bericht terug in het geheugen: een run zonder antwoord (tab dicht
// midden in de run) krijgt streaming/loading terug zodat de UI hem weer volgt.
function reviveMessage(m) {
  if (m.role !== 'assistant' || !m.run_id || m.error) return m
  const open = !TERMINAL_STATES.has(m.run_state)
  return open ? { ...m, streaming: true, loading: !m.content } : m
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
