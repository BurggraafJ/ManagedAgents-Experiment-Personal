import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import styles from './zoeken.module.css'
import { supabase } from '../../../lib/supabase'
import { CHAT_SUGGESTIONS, makeAnswerParts } from '../../../lib/rag'
import CitationCard from './CitationCard'
import ChatFeedbackBar from './ChatFeedbackBar'

// RagChatView v1 — conversational RAG over alle bronnen.
// Gebruiker stelt vraag → rag-chat Edge Function doet retrieval + Claude
// Haiku call → antwoord met citations [bron #N]. Sources-panel rechts toont
// welke chunks gebruikt zijn. Geen history-persistence; sessie-only.

function renderAnswer(text, onCiteClick) {
  return makeAnswerParts(text).map((p, i) => {
    if (p.type === 'cite') {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCiteClick(p.n)}
          style={{
            display: 'inline', padding: '0 5px', margin: '0 1px',
            fontSize: 11, fontWeight: 600, color: '#7c3aed',
            background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: 3, cursor: 'pointer', verticalAlign: 'baseline',
            font: 'inherit', lineHeight: 1.2,
          }}
          title={`Spring naar bron #${p.n}`}
        >
          {p.label}
        </button>
      )
    }
    return <span key={i}>{p.value}</span>
  })
}

export default function RagChatView() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [highlightCite, setHighlightCite] = useState(null)
  const inputRef = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const sendMessage = useCallback(async (override) => {
    const msg = (override ?? input).trim()
    if (!msg || loading) return
    setInput('')
    const newUserMsg = { role: 'user', content: msg }
    const history = messages
      .filter(m => !m.error)
      .map(m => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, newUserMsg, { role: 'assistant', content: '', loading: true }])
    setLoading(true)
    try {
      const { data, error } = await supabase.functions.invoke('rag-chat', {
        body: { message: msg, history, top_k: 8 },
      })
      if (error) throw new Error(error.message || 'invoke_error')
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setMessages((prev) => {
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
          user_message: msg,
        }
        return next
      })
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: '',
          error: e.message || String(e),
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [input, loading, messages])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const onCiteClick = (n) => {
    setHighlightCite(n)
    const el = document.getElementById(`citation-${n}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => setHighlightCite(null), 2500)
  }

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && !m.loading && !m.error)

  return (
    <div className={styles.chatGrid}>
      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        <div className={`card ${styles.chatCard}`}>
          <div className={styles.chatMessages}>
            {messages.length === 0 && (
              <div className={styles.chatEmpty}>
                <div className={styles.chatEmptyIcon}>💬</div>
                <div className={styles.chatEmptyTitle}>
                  Stel een vraag over mails, deals, contacten, agenda, Jira en meetings.
                </div>
                <div className={styles.chatEmptySub}>
                  De assistent zoekt zelf de relevante context op en citeert per feit.
                </div>
                <div className={styles.chatSuggestions}>
                  {CHAT_SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => sendMessage(s)}
                      className={styles.chatSuggestionBtn}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div
                  className={styles.msgBubble}
                  style={{
                    background: m.role === 'user'
                      ? 'rgba(124,58,237,0.08)'
                      : m.error ? 'rgba(239,68,68,0.06)' : 'var(--bg-input, rgba(0,0,0,0.03))',
                    border: `1px solid ${m.error ? '#ef4444' : 'var(--border)'}`,
                  }}
                >
                  {m.role === 'assistant' && m.loading && (
                    <em style={{ color: 'var(--text-muted)' }}>Aan het zoeken en denken…</em>
                  )}
                  {m.error && (
                    <span style={{ color: '#ef4444' }}>
                      Fout: {m.error}
                      {(m.error.includes('grok_api_key_missing') || m.error.includes('anthropic_api_key_missing')) && (
                        <span style={{ display: 'block', marginTop: 6, fontSize: 11 }}>
                          Voeg een API-key toe via <Link to="/instellingen/api-keys">Instellingen → API Keys</Link>.
                        </span>
                      )}
                    </span>
                  )}
                  {!m.error && !m.loading && m.role === 'assistant' && m.entity_used && (
                    <div className={styles.entityAwareBadge}>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>● Entity-aware:</span>{' '}
                      {m.entity_used.entity_type} <strong>"{m.entity_used.name}"</strong>{' '}
                      <span style={{ opacity: 0.7 }}>(matched op "{m.entity_used.matched_term}")</span>
                    </div>
                  )}
                  {!m.error && !m.loading && renderAnswer(m.content, onCiteClick)}
                  {!m.error && !m.loading && m.role === 'assistant' && m.tokens && (
                    <ChatFeedbackBar message={m} />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className={styles.chatInputRow}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Stel je vraag — bv. 'wat heb ik recent met Wintertaling besproken'"
              rows={2}
              className={styles.chatTextarea}
            />
            <button
              className="btn btn--accent"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              style={{ minWidth: 90 }}
            >
              {loading ? '…' : 'Stuur'}
            </button>
          </div>
        </div>
      </div>

      <div className={`card ${styles.citationsPanel}`}>
        <div className={styles.citationsPanelTitle}>Bronnen voor laatste antwoord</div>
        {!lastAssistant && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Stel een vraag — hier verschijnen de chunks die de assistent gebruikt heeft.
          </div>
        )}
        {lastAssistant && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(lastAssistant.citations || []).map((c) => (
              <CitationCard key={c.n} cite={c} highlighted={highlightCite === c.n} />
            ))}
            {(lastAssistant.citations?.length ?? 0) === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Geen bronnen gevonden voor deze vraag.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
