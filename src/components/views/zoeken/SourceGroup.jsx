import { useState } from 'react'
import { SOURCE_LABEL, SOURCE_ICONS, fmtPct } from '../../../lib/rag'
import ResultRow from './ResultRow'

// SourceGroup — collapsible per source-type.
export default function SourceGroup({ source, matches, onFeedback, feedbackState, linkedEntities, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  const label = SOURCE_LABEL[source] || source
  const icon = SOURCE_ICONS[source] || '·'
  const avgSim = matches.reduce((s, m) => s + (m.similarity ?? 0), 0) / matches.length
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 14px', background: 'transparent',
          border: 'none', borderBottom: open ? '1px solid var(--border)' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-muted)', minWidth: 14 }}>
          {open ? '▾' : '▸'}
        </span>
        <span style={{ fontSize: 16, color: 'var(--text-muted)' }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {matches.length} hit{matches.length === 1 ? '' : 's'}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          gem {fmtPct(avgSim)}
        </span>
      </button>
      {open && (
        <div>
          {matches.map((m, i) => (
            <ResultRow
              key={m.chunk_id || `${m.source}-${m.id}-${i}`}
              match={m}
              onFeedback={onFeedback}
              feedbackState={feedbackState}
              linked={linkedEntities?.[m.chunk_id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
