import Sparkline from './Sparkline'
import AgentRunSnippet from './AgentRunSnippet'

const STATUS_ICON = {
  success: '●',
  warning: '●',
  error:   '●',
  empty:   '○',
  running: '●',
}

const METRIC_MAP = {
  'auto-draft':           { key: 'drafts_created',  label: 'drafts' },
  'hubspot-daily-sync':   { key: 'deals_updated',   label: 'deals' },
  'linkedin-connect':     { key: 'connects_sent',   label: 'connects' },
  'kilometerregistratie': { key: null,              label: 'maand' },
  'orchestrator':         { key: 'agents_ran',      label: 'agents' },
  'sales-todos':          { key: 'drafts_prepared', label: 'drafts' },
  'sales-on-road':        { key: null,              label: '' },
}

function formatPast(iso) {
  if (!iso) return '—'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins}m geleden`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.round(h / 24)}d geleden`
}

function formatFuture(iso) {
  if (!iso) return '—'
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return 'nu'
  if (mins < 60) return `over ${mins}m`
  const h = Math.floor(mins / 60)
  const remM = mins % 60
  if (h < 24) return remM > 0 ? `over ${h}u ${remM}m` : `over ${h}u`
  return `over ${Math.round(mins / (24 * 60))}d`
}

function CompactQuestion({ q }) {
  const ctx = (q && typeof q.context === 'object' && !Array.isArray(q.context)) ? q.context : null
  const company = ctx?.company || ctx?.bedrijf || null
  const time    = ctx?.meeting_time || ctx?.time || null
  const email   = ctx?.email || (Array.isArray(ctx?.emails) ? ctx.emails[0] : null) || null
  const date    = ctx?.date || null

  // Alleen data-rij tonen als we minstens company OF time hebben; anders fallback naar korte tekst.
  const hasData = company || time || email
  if (!hasData) {
    const text = (q.question || '').split(/[.?!]/)[0].slice(0, 80)
    return (
      <div className={`agent-card__question agent-card__question--${q.urgency}`}>
        {text || '—'}
      </div>
    )
  }

  return (
    <div className={`agent-card__question agent-card__question--${q.urgency}`}>
      <div className="agent-card__question-row">
        {company && <span className="agent-card__question-company">{company}</span>}
        {time && <span className="agent-card__question-meta">{time}</span>}
        {date && !time && <span className="agent-card__question-meta">{date}</span>}
      </div>
      {email && <div className="agent-card__question-email mono">{email}</div>}
    </div>
  )
}

export default function AgentCard({ agent, schedule, latestRun, history, openQuestions = [], extras = {} }) {
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const statusClass = isRunning ? 's-running'
                    : status === 'success' && openQuestions.length > 0 ? 's-warning'
                    : `s-${status === 'empty' ? 'idle' : status}`

  const metric = METRIC_MAP[agent] || { key: null, label: '' }
  const metricValue = metric.key ? latestRun?.stats?.[metric.key] : undefined

  return (
    <div className={`agent-card ${isRunning ? 'is-running' : ''}`}>
      <div className="agent-card__head">
        <div className="agent-card__title">
          <span className={statusClass} style={{ fontSize: 10 }}>
            {isRunning ? <span className="dot dot--pulse" /> : STATUS_ICON[status]}
          </span>
          <span className="agent-card__name">{schedule?.display_name || agent}</span>
          {schedule?.slack_channel && (
            <span className="agent-card__channel">#{schedule.slack_channel}</span>
          )}
        </div>
        <Sparkline history={history} />
      </div>

      <div className="agent-card__summary">
        {isRunning
          ? <em className="dim">Draait nu…</em>
          : (latestRun || agent === 'sales-on-road')
            ? <AgentRunSnippet agent={agent} run={latestRun} extras={extras} />
            : <span className="muted">geen runs</span>}
      </div>

      <div className="agent-card__footer">
        <span>laatste {formatPast(latestRun?.started_at)}</span>
        {schedule?.next_run_at && !isRunning && (
          <span>volgende {formatFuture(schedule.next_run_at)}</span>
        )}
        {metricValue !== undefined && metricValue !== null && (
          <span className="agent-card__metric">
            {metricValue}<span className="agent-card__metric-label">{metric.label}</span>
          </span>
        )}
      </div>

      {openQuestions.length > 0 && (
        <div className="agent-card__questions">
          {openQuestions.slice(0, 3).map(q => (
            <CompactQuestion key={q.id} q={q} />
          ))}
          {openQuestions.length > 3 && (
            <div className="muted" style={{ fontSize: 11 }}>
              +{openQuestions.length - 3} meer — zie {agent === 'hubspot-daily-sync' ? 'HubSpot-pagina' : 'detail'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
