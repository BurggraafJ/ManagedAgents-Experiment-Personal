import { fmtDate, SOURCE_LABEL, SOURCE_ICONS } from '../../../lib/rag'

export default function CitationCard({ cite, highlighted }) {
  return (
    <div
      id={`citation-${cite.n}`}
      style={{
        padding: '10px 12px', borderRadius: 6, fontSize: 12,
        border: `1px solid ${highlighted ? '#7c3aed' : 'var(--border)'}`,
        background: highlighted ? 'rgba(124,58,237,0.06)' : 'var(--bg-input, transparent)',
        display: 'flex', flexDirection: 'column', gap: 4,
        transition: 'border-color 200ms, background 200ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#7c3aed',
          fontFamily: 'var(--font-mono)',
        }}>#{cite.n}</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {SOURCE_ICONS[cite.source] || '·'} {SOURCE_LABEL[cite.source] || cite.source}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {fmtDate(cite.occurred_at)}
        </span>
      </div>
      <div style={{ fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {cite.subject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
      </div>
      {cite.preview && (
        <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
          overflow: 'hidden' }}>
          {cite.preview}
        </div>
      )}
    </div>
  )
}
