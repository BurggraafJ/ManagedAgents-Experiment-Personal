export default function FeedbackCard({ feedback }) {
  const isDone = feedback.status && feedback.status !== 'open'
  const when = feedback.created_at
    ? new Date(feedback.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <article className={`inbox-item ${isDone ? 'inbox-item--done' : ''}`}>
      <div className="inbox-item__head">
        <span>
          <span className="inbox-item__agent">{feedback.agent_name || feedback.source || 'algemeen'}</span>
          <span className="muted" style={{ marginLeft: 8 }}>{when}</span>
        </span>
        {isDone && <span className="pill s-success">VERWERKT</span>}
      </div>
      <div className="inbox-item__body">{feedback.feedback_text}</div>
    </article>
  )
}
