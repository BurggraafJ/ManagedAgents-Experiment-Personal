import { useState } from 'react'
import ProposalCard from './ProposalCard'
import LessonRow from './LessonRow'

export default function ScopeColumn({ scope, proposals, lessons, meetingMap, signalMap, onChanged }) {
  const [tab, setTab] = useState('proposals')
  const list = tab === 'proposals' ? proposals : lessons

  return (
    <div
      className="panel"
      style={{
        padding: 0,
        overflow: 'hidden',
        borderTop: `3px solid ${scope.accent}`,
        display: 'flex', flexDirection: 'column',
      }}
    >
      <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: scope.accent }}>
            {scope.label}
          </h3>
          <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
            {proposals.length} • {lessons.length}
          </span>
        </div>
        <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 11, lineHeight: 1.4 }}>
          {scope.tagline}
        </p>

        <div style={{ display: 'flex', gap: 4, marginTop: 'var(--s-3)' }}>
          <ColumnPill
            label={`Voorstellen${proposals.length ? ` · ${proposals.length}` : ''}`}
            active={tab === 'proposals'}
            accent={scope.accent}
            onClick={() => setTab('proposals')}
          />
          <ColumnPill
            label={`Lessons${lessons.length ? ` · ${lessons.length}` : ''}`}
            active={tab === 'lessons'}
            accent={scope.accent}
            onClick={() => setTab('lessons')}
          />
        </div>
      </div>

      <div className="stack" style={{ gap: 'var(--s-3)', padding: 'var(--s-4)', minHeight: 120 }}>
        {list.length === 0 && (
          <div className="muted" style={{ fontSize: 12, padding: 'var(--s-3)', textAlign: 'center' }}>
            {tab === 'proposals' ? 'Geen open voorstellen' : 'Nog geen lessons'}
          </div>
        )}
        {tab === 'proposals' && list.map(row => (
          <ProposalCard
            key={row.id}
            row={row}
            scope={scope}
            meeting={row.source_meeting_id ? meetingMap?.[row.source_meeting_id] : null}
            signals={(row.signal_ids || []).map(id => signalMap?.[id]).filter(Boolean)}
            onDecided={onChanged}
          />
        ))}
        {tab === 'lessons' && list.map(row => (
          <LessonRow key={row.id} row={row} scope={scope} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function ColumnPill({ label, active, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? `color-mix(in srgb, ${accent} 15%, var(--bg-2))` : 'transparent',
        color: active ? accent : 'var(--text-muted)',
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
