import { useState } from 'react'
import Sparkline from './Sparkline'

const STATUS_ICON = { success: '✓', warning: '⚠', error: '✕', empty: '·' }
const STATUS_COLOR = { success: '#4caf50', warning: '#e0a800', error: '#d9534f', empty: '#666' }

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins} min geleden`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} uur geleden`
  return `${Math.round(h / 24)} dagen geleden`
}

export default function AgentCard({
  name,
  displayName,
  slackChannel,
  latestRun,
  history,
  nextRun,
  metricLabel,
  metricValue,
  openQuestions = [],
}) {
  const [expanded, setExpanded] = useState(false)

  let status = 'empty'
  if (latestRun) status = latestRun.status || 'empty'
  if (openQuestions.length > 0 && status === 'success') status = 'warning'

  const icon = STATUS_ICON[status]
  const color = STATUS_COLOR[status]

  return (
    <div style={{
      background: '#2B2B2B',
      borderRadius: 6,
      padding: '18px 20px',
      border: '1px solid #383838',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color, fontSize: 16, fontWeight: 600, width: 18, textAlign: 'center' }}>{icon}</span>
          <span style={{ fontWeight: 500, fontSize: 15 }}>{displayName || name}</span>
          {slackChannel && <span style={{ color: '#666', fontSize: 11 }}>#{slackChannel}</span>}
        </div>
        <Sparkline history={history} />
      </div>

      {latestRun?.summary && (
        <div style={{ color: '#bbb', fontSize: 13, marginBottom: 10, lineHeight: 1.5 }}>
          {latestRun.summary}
        </div>
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        color: '#888',
        borderTop: '1px solid #383838',
        paddingTop: 10,
        marginTop: 10,
      }}>
        <span>laatste: {formatWhen(latestRun?.started_at)}</span>
        {nextRun && <span>volgende: {nextRun}</span>}
        {metricValue !== undefined && (
          <span style={{ color: '#E86832', fontWeight: 500 }}>
            {metricValue} <span style={{ color: '#666', fontWeight: 400 }}>{metricLabel}</span>
          </span>
        )}
      </div>

      {openQuestions.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid #383838', paddingTop: 10 }}>
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: 'transparent',
              color: '#E86832',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            {openQuestions.length} open {openQuestions.length === 1 ? 'vraag' : 'vragen'} {expanded ? '▴' : '▾'}
          </button>
          {expanded && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {openQuestions.map(q => (
                <div key={q.id} style={{
                  background: '#1E1E1E',
                  padding: '10px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  borderLeft: `3px solid ${q.urgency === 'expired' ? '#d9534f' : q.urgency === 'urgent' ? '#e0a800' : q.urgency === 'warning' ? '#7a5f00' : '#666'}`,
                }}>
                  <div style={{ color: '#E0E0E0', lineHeight: 1.5 }}>{q.question}</div>
                  <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
                    {q.days_open} dag{q.days_open === 1 ? '' : 'en'} open · {q.urgency}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
