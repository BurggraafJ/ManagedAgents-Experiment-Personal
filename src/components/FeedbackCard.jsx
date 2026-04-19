export default function FeedbackCard({ feedback }) {
  const isDone = feedback.status && feedback.status !== 'open'
  const when = feedback.created_at
    ? new Date(feedback.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div style={{
      background: '#2B2B2B',
      borderRadius: 6,
      padding: '14px 18px',
      border: '1px solid #383838',
      opacity: isDone ? 0.65 : 1,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
        fontSize: 12,
        color: '#888',
      }}>
        <span>
          <span style={{ color: '#E86832', fontWeight: 500 }}>{feedback.agent_name || feedback.source || 'algemeen'}</span>
          <span style={{ marginLeft: 10 }}>{when}</span>
        </span>
        {isDone && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#4caf50',
            padding: '2px 8px',
            border: '1px solid #4caf50',
            borderRadius: 3,
            letterSpacing: '0.5px',
          }}>VERWERKT</span>
        )}
      </div>
      <div style={{ color: '#E0E0E0', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
        {feedback.feedback_text}
      </div>
    </div>
  )
}
