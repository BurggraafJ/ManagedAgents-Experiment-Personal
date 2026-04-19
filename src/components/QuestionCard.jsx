const URGENCY_STYLE = {
  expired: { color: '#d9534f', label: 'VERLOPEN' },
  urgent: { color: '#e0a800', label: 'URGENT' },
  warning: { color: '#7a5f00', label: '3+ dagen' },
  ok: { color: '#666', label: '' },
}

export default function QuestionCard({ question }) {
  const u = URGENCY_STYLE[question.urgency] || URGENCY_STYLE.ok
  return (
    <div style={{
      background: '#2B2B2B',
      borderRadius: 6,
      padding: '16px 18px',
      border: '1px solid #383838',
      borderLeft: `3px solid ${u.color}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: '#888' }}>
          <span style={{ color: '#E86832', fontWeight: 500 }}>{question.agent_name}</span>
          <span style={{ marginLeft: 10 }}>{question.days_open} dag{question.days_open === 1 ? '' : 'en'} open</span>
        </div>
        {u.label && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: u.color,
            padding: '2px 8px',
            border: `1px solid ${u.color}`,
            borderRadius: 3,
            letterSpacing: '0.5px',
          }}>{u.label}</span>
        )}
      </div>
      <div style={{ color: '#E0E0E0', fontSize: 14, lineHeight: 1.55, marginBottom: 8 }}>
        {question.question}
      </div>
      {question.context && (
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {question.context}
        </div>
      )}
      {question.default_action && (
        <div style={{
          marginTop: 10,
          padding: '8px 10px',
          background: '#1E1E1E',
          borderRadius: 4,
          fontSize: 12,
          color: '#bbb',
        }}>
          <span style={{ color: '#666' }}>bij geen antwoord: </span>{question.default_action}
        </div>
      )}
    </div>
  )
}
