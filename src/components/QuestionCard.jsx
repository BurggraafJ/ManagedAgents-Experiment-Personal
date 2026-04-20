const URGENCY_LABEL = {
  expired: 'VERLOPEN',
  urgent:  'URGENT',
  warning: '3+ DAGEN',
  ok:      null,
}

function renderContext(ctx) {
  if (ctx === null || ctx === undefined) return null
  if (typeof ctx === 'string') return ctx
  if (Array.isArray(ctx)) {
    return ctx.map((v, i) => <div key={i}>{renderContext(v)}</div>)
  }
  if (typeof ctx === 'object') {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 12px' }}>
        {Object.entries(ctx).map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span className="muted" style={{ fontSize: 11 }}>{k}</span>
            <span>{formatValue(v)}</span>
          </div>
        ))}
      </div>
    )
  }
  return String(ctx)
}

function formatValue(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ')
  return JSON.stringify(v)
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
        <div className="inbox-item__context">{renderContext(question.context)}</div>
      )}

      {question.default_action && (
        <div className="inbox-item__default">
          <span className="muted">bij geen antwoord: </span>{question.default_action}
        </div>
      )}
    </article>
  )
}
