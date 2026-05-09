import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'

// Feedback-bar onder elk antwoord: 👍 / 👎 + optionele comment, schrijft
// naar log_chat_feedback RPC. Idempotent per message-index in sessie.
export default function ChatFeedbackBar({ message }) {
  const [rating, setRating] = useState(null)
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
