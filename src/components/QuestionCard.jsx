const URGENCY_LABEL = {
  expired: 'VERLOPEN',
  urgent:  'URGENT',
  warning: '3+ DAGEN',
  ok:      null,
}

export default function QuestionCard({ question }) {
  const u = question.urgency
  const label = URGENCY_LABEL[u]

  return (
    <article className={`inbox-item inbox-item--${u}`}>
      <div className="inbox-item__head">
        <span>
          <span className="inbox-item__agent">{question.agent_name}</span>
          <span className="muted" style={{ marginLeft: 8 }}>
            {question.days_open} dag{question.days_open === 1 ? '' : 'en'} open
          </span>
        </span>
        {label && <span className={`pill s-${u === 'warning' ? 'warning' : u === 'urgent' ? 'warning' : 'error'}`}>{label}</span>}
      </div>

      <div className="inbox-item__body">{question.question}</div>

      {question.context && (
        <div className="inbox-item__context">{question.context}</div>
      )}

      {question.default_action && (
        <div className="inbox-item__default">
          <span className="muted">bij geen antwoord: </span>{question.default_action}
        </div>
      )}
    </article>
  )
}
