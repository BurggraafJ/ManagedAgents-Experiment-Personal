function urgencyClass(u) {
  if (u === 'expired') return 'action-row--expired'
  if (u === 'urgent')  return 'action-row--urgent'
  if (u === 'warning') return 'action-row--warning'
  return ''
}

function formatDue(q) {
  if (q.urgency === 'expired') return 'verlopen'
  if (q.expires_at) {
    const mins = Math.round((new Date(q.expires_at) - new Date()) / 60000)
    if (mins < 60)       return `over ${mins}m`
    if (mins < 24 * 60)  return `over ${Math.round(mins / 60)}u`
    return `over ${Math.round(mins / (24 * 60))}d`
  }
  return `${q.days_open}d open`
}

export default function ActionRail({ questions, feedback, overdueSchedules, onJump }) {
  const openQ = questions.filter(q => q.status === 'open')
  const openF = feedback.filter(f => !f.status || f.status === 'open')

  const total = openQ.length + openF.length + overdueSchedules.length

  if (total === 0) {
    return (
      <section id="actie">
        <div className="section__head">
          <h2 className="section__title">Actie</h2>
          <span className="section__hint">alles onder controle</span>
        </div>
        <div className="empty">Geen openstaande vragen, feedback of overdue agents.</div>
      </section>
    )
  }

  // Sort questions by urgency
  const order = { expired: 0, urgent: 1, warning: 2, ok: 3 }
  const sortedQ = [...openQ].sort((a, b) => (order[a.urgency] ?? 4) - (order[b.urgency] ?? 4))

  return (
    <section id="actie">
      <div className="section__head">
        <h2 className="section__title">
          Actie <span className="section__count">{total}</span>
        </h2>
        <button className="btn btn--ghost" onClick={() => onJump('inbox')}>bekijk inbox →</button>
      </div>

      <div className="action-rail">
        {overdueSchedules.map(s => (
          <div key={`overdue-${s.agent_name}`} className="action-row action-row--urgent">
            <span className="action-row__agent">{s.agent_name}</span>
            <span className="action-row__text">Scheduled run overdue</span>
            <span className="action-row__meta">gepland {formatPast(s.next_run_at)}</span>
          </div>
        ))}
        {sortedQ.slice(0, 6).map(q => (
          <div key={q.id} className={`action-row ${urgencyClass(q.urgency)}`}>
            <span className="action-row__agent">{q.agent_name}</span>
            <span className="action-row__text" title={q.question}>{q.question}</span>
            <span className="action-row__meta">{formatDue(q)}</span>
          </div>
        ))}
        {openF.slice(0, 3).map(f => (
          <div key={`fb-${f.id}`} className="action-row action-row--warning">
            <span className="action-row__agent">feedback</span>
            <span className="action-row__text" title={f.feedback_text}>{f.feedback_text}</span>
            <span className="action-row__meta">{f.agent_name || f.source || ''}</span>
          </div>
        ))}
        {(sortedQ.length > 6 || openF.length > 3) && (
          <button className="btn btn--ghost" onClick={() => onJump('inbox')} style={{ alignSelf: 'flex-start' }}>
            + {Math.max(0, sortedQ.length - 6) + Math.max(0, openF.length - 3)} meer in inbox
          </button>
        )}
      </div>
    </section>
  )
}

function formatPast(iso) {
  if (!iso) return '—'
  const mins = Math.round((new Date() - new Date(iso)) / 60000)
  if (mins < 60)       return `${mins}m geleden`
  if (mins < 24 * 60)  return `${Math.round(mins / 60)}u geleden`
  return `${Math.round(mins / (24 * 60))}d geleden`
}
