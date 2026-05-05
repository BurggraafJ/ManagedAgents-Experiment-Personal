import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// =====================================================================
// RagChatView v1 — conversational RAG over alle bronnen
// =====================================================================
// Gebruiker stelt vraag → rag-chat Edge Function doet retrieval + Claude
// Haiku call → antwoord met citations [bron #N]. Sources-panel rechts toont
// welke chunks gebruikt zijn. Geen history-persistence; sessie-only.
//
// System prompt is editable via Settings → Chat-instructies (rij in
// agent_config 'rag-chat' / 'system_prompt').
// =====================================================================

const SOURCE_LABEL = {
  mail: 'Mail', engagement: 'Engagement', jira: 'Jira',
  deal: 'Deal', company: 'Bedrijf', contact: 'Contact',
  meeting: 'Meeting', event: 'Event', lesson: 'Lesson',
}
const SOURCE_ICONS = {
  mail: '✉', engagement: '◆', jira: '◑',
  deal: '★', company: '⌂', contact: '☻',
  meeting: '◐', event: '◇', lesson: '✦',
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

const SUGGESTIONS = [
  'Wat besprak ik recent met Wintertaling?',
  'Welke openstaande offertes zijn er deze maand?',
  'Welke klanten zitten momenteel in proefperiode?',
  'Wat moet ik nog opvolgen voor de SLA bij Kneppelhout?',
]

// Render-helper: vervang [bron #N] door subtiel highlightje + click-to-scroll naar citation-card.
function renderAnswer(text, onCiteClick) {
  if (!text) return null
  const parts = text.split(/(\[(?:bron|mail|engagement|jira|deal|company|contact|meeting|event)\s*#\d+\])/gi)
  return parts.map((p, i) => {
    const m = p.match(/^\[(?:bron|mail|engagement|jira|deal|company|contact|meeting|event)\s*#(\d+)\]$/i)
    if (m) {
      const n = parseInt(m[1], 10)
      return (
        <button
          key={i}
          type="button"
          onClick={() => onCiteClick(n)}
          style={{
            display: 'inline', padding: '0 5px', margin: '0 1px',
            fontSize: 11, fontWeight: 600, color: '#7c3aed',
            background: 'rgba(124,58,237,0.10)', border: '1px solid rgba(124,58,237,0.25)',
            borderRadius: 3, cursor: 'pointer', verticalAlign: 'baseline',
            font: 'inherit', lineHeight: 1.2,
          }}
          title={`Spring naar bron #${n}`}
        >
          {p}
        </button>
      )
    }
    return <span key={i}>{p}</span>
  })
}

// Feedback-bar onder elk antwoord: 👍 / 👎 + optionele comment, schrijft
// naar log_chat_feedback RPC. Idempotent per message-index in sessie.
function FeedbackBar({ message }) {
  const [rating, setRating] = useState(null)             // 'up' | 'down' | null
  const [comment, setComment] = useState('')
  const [showComment, setShowComment] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  const submit = useCallback(async (rt, withComment = false) => {
    if (submitting || submitted) return
    if (withComment && !comment.trim() && rt === 'down') {
      setShowComment(true); return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { error: e } = await supabase.rpc('log_chat_feedback', {
        p_user_message: message.user_message || '',
        p_assistant_answer: message.content || '',
        p_citations: message.citations ?? null,
        p_bundle_id: message.bundle_id ?? null,
        p_retrieval_strategy: message.retrieval_strategy ?? null,
        p_entity_used: message.entity_used ?? null,
        p_model: message.model ?? null,
        p_rating: rt,
        p_comment: comment.trim() || null,
        p_tokens_used: (message.tokens?.chat_in ?? 0) + (message.tokens?.chat_out ?? 0),
        p_timing_ms: message.timing_ms?.total ?? null,
      })
      if (e) throw new Error(e.message)
      setRating(rt)
      setSubmitted(true)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }, [submitting, submitted, comment, message])

  const handleThumb = (rt) => {
    if (submitted) return
    setRating(rt)
    if (rt === 'down') {
      setShowComment(true)
    } else {
      submit('up')
    }
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
        <span>{message.timing_ms?.total}ms</span>
        <span>·</span>
        <span>{message.citations?.length || 0} bronnen</span>
        <span>·</span>
        <span>{(message.tokens?.chat_in ?? 0) + (message.tokens?.chat_out ?? 0)} tokens</span>
        {message.model && <><span>·</span><span>{message.model}</span></>}
        <span style={{ flex: 1 }} />
        {!submitted && (
          <>
            <button type="button" onClick={() => handleThumb('up')} disabled={submitting}
              title="Nuttig antwoord"
              style={{
                padding: '2px 8px', fontSize: 13, cursor: 'pointer',
                background: rating === 'up' ? 'rgba(34,197,94,0.15)' : 'transparent',
                border: `1px solid ${rating === 'up' ? '#22c55e' : 'var(--border)'}`,
                borderRadius: 4, color: rating === 'up' ? '#22c55e' : 'var(--text-muted)',
              }}>👍</button>
            <button type="button" onClick={() => handleThumb('down')} disabled={submitting}
              title="Onnauwkeurig of onbruikbaar"
              style={{
                padding: '2px 8px', fontSize: 13, cursor: 'pointer',
                background: rating === 'down' ? 'rgba(239,68,68,0.10)' : 'transparent',
                border: `1px solid ${rating === 'down' ? '#ef4444' : 'var(--border)'}`,
                borderRadius: 4, color: rating === 'down' ? '#ef4444' : 'var(--text-muted)',
              }}>👎</button>
          </>
        )}
        {submitted && (
          <span style={{ color: rating === 'up' ? '#22c55e' : '#ef4444' }}>
            {rating === 'up' ? '✓ Bedankt — feedback opgeslagen' : '✓ Feedback opgeslagen'}
          </span>
        )}
      </div>
      {showComment && !submitted && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Wat klopt er niet aan dit antwoord? (optioneel)"
            rows={2}
            style={{
              flex: 1, fontSize: 12, padding: '6px 8px',
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg-input, var(--bg))', color: 'var(--text)',
              fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          <button
            type="button"
            onClick={() => submit(rating || 'down', true)}
            disabled={submitting}
            style={{
              padding: '4px 12px', fontSize: 12, cursor: 'pointer',
              background: '#ef4444', color: 'white',
              border: 'none', borderRadius: 4,
            }}
          >
            {submitting ? '…' : 'Opslaan'}
          </button>
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: '#ef4444' }}>Fout bij opslaan: {error}</div>
      )}
    </div>
  )
}

function CitationCard({ cite, highlighted }) {
  return (
    <div
      id={`citation-${cite.n}`}
      style={{
        padding: '10px 12px', borderRadius: 6, fontSize: 12,
        border: `1px solid ${highlighted ? '#7c3aed' : 'var(--border)'}`,
        background: highlighted ? 'rgba(124,58,237,0.06)' : 'var(--bg-input, transparent)',
        display: 'flex', flexDirection: 'column', gap: 4,
        transition: 'border-color 200ms, background 200ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#7c3aed',
          fontFamily: 'var(--font-mono)',
        }}>#{cite.n}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {SOURCE_ICONS[cite.source] || '·'} {SOURCE_LABEL[cite.source] || cite.source}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {fmtDate(cite.occurred_at)}
        </span>
      </div>
      <div style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cite.subject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
      </div>
      {cite.preview && (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden' }}>
          {cite.preview}
        </div>
      )}
    </div>
  )
}

export default function RagChatView() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])   // [{role, content, citations?, bundle_id?, error?}]
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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 'var(--s-4)', alignItems: 'start' }}>
      {/* Chat-kolom */}
      <div className="stack" style={{ gap: 'var(--s-4)' }}>
        <div className="card" style={{ padding: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', minHeight: 480 }}>
          {/* Messages */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 320, flex: 1 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: 'var(--s-6)', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 12 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                  Stel een vraag over mails, deals, contacten, agenda, Jira en meetings.
                </div>
                <div style={{ fontSize: 12, marginBottom: 16 }}>
                  De assistent zoekt zelf de relevante context op en citeert per feit.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: 540, margin: '0 auto' }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => sendMessage(s)}
                      style={{
                        padding: '6px 12px', fontSize: 12, color: 'var(--text-muted)',
                        background: 'var(--bg-input, rgba(0,0,0,0.03))',
                        border: '1px solid var(--border)', borderRadius: 16, cursor: 'pointer',
                      }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: m.role === 'user'
                    ? 'rgba(124,58,237,0.08)'
                    : m.error ? 'rgba(239,68,68,0.06)' : 'var(--bg-input, rgba(0,0,0,0.03))',
                  border: `1px solid ${m.error ? '#ef4444' : 'var(--border)'}`,
                  fontSize: 13, lineHeight: 1.6,
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
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
                    <div style={{
                      marginBottom: 8, padding: '6px 10px',
                      background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.30)',
                      borderRadius: 4, fontSize: 11, color: 'var(--text-muted)',
                    }}>
                      <span style={{ color: '#22c55e', fontWeight: 600 }}>● Entity-aware:</span>{' '}
                      {m.entity_used.entity_type} <strong>"{m.entity_used.name}"</strong>{' '}
                      <span style={{ opacity: 0.7 }}>(matched op "{m.entity_used.matched_term}")</span>
                    </div>
                  )}
                  {!m.error && !m.loading && renderAnswer(m.content, onCiteClick)}
                  {!m.error && !m.loading && m.role === 'assistant' && m.tokens && (
                    <FeedbackBar message={m} index={i} />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Stel je vraag — bv. 'wat heb ik recent met Wintertaling besproken'"
              rows={2}
              style={{
                flex: 1, fontSize: 14, padding: '10px 12px',
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-input, var(--bg))', color: 'var(--text)',
                resize: 'vertical', fontFamily: 'inherit',
              }}
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

      {/* Sources-panel */}
      <div className="card" style={{ padding: 'var(--s-4)', position: 'sticky', top: 'var(--s-4)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 'var(--s-3)' }}>
          Bronnen voor laatste antwoord
        </div>
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
