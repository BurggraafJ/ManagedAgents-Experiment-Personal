import { useState } from 'react'
import styles from './LegalAIView.module.css'

/**
 * FeedbackPanel — inline footer onder ArticleHero met textarea om feedback
 * naar legal_ai_voice_notes te schrijven, plus "Maak LinkedIn-post"-knop
 * die een legal_ai_skill_requests-row inserts.
 */
export default function FeedbackPanel({ article, onFeedback, onLinkedIn }) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)
  const [status, setStatus] = useState(null)

  async function submit() {
    if (!onFeedback || !text.trim()) return
    setPending(true); setStatus(null)
    const r = await onFeedback(text, article.id, null)
    setPending(false)
    if (r.ok) {
      setStatus({ tone: 'ok', msg: 'Feedback opgeslagen — legal-ai-vision-update verwerkt hem zo.' })
      setText('')
    } else {
      setStatus({ tone: 'err', msg: r.error || 'Insert mislukt.' })
    }
  }

  async function requestLi() {
    if (!onLinkedIn) return
    setPending(true); setStatus(null)
    const r = await onLinkedIn(article.id)
    setPending(false)
    if (r.ok) {
      setStatus({ tone: 'ok', msg: 'LinkedIn-draft aangevraagd — legal-ai-linkedin-draft schrijft 2 varianten.' })
    } else {
      setStatus({ tone: 'err', msg: r.error || 'Request mislukt.' })
    }
  }

  return (
    <footer className={styles.feedbackFooter}>
      <div className={styles.feedbackLabel}>Reageer op dit artikel</div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Schrijf je gedachten of zet een voice-note om naar tekst en plak hem hier..."
        rows={3}
        className={styles.feedbackTextarea}
      />
      <div className={styles.feedbackActions}>
        <button
          onClick={submit}
          disabled={pending || text.trim().length < 5}
          className={styles.btnPrimary}
        >
          📨 Stuur feedback
        </button>
        <button onClick={requestLi} disabled={pending} className={styles.btnGhost}>
          🔗 Maak LinkedIn-post
        </button>
        {status && (
          <span className={styles.feedbackStatus} data-tone={status.tone}>
            {status.msg}
          </span>
        )}
      </div>
    </footer>
  )
}
