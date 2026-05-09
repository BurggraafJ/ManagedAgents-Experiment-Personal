import { fmtScore } from '../../../lib/rag'

export default function ScoreBar({ vec, bm25, recency, combined }) {
  const items = [
    { label: 'Combined', value: combined, color: '#22c55e', strong: true },
    { label: 'Vector',   value: vec,      color: '#3b82f6' },
    { label: 'BM25',     value: bm25,     color: '#a855f7' },
    { label: 'Recency',  value: recency,  color: '#f59e0b' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it) => {
        const pct = Math.min(Math.max(Number(it.value ?? 0) * 100, 0), 100)
        return (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ minWidth: 64, color: it.strong ? 'var(--text)' : 'var(--text-muted)', fontWeight: it.strong ? 600 : 400 }}>
              {it.label}
            </span>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: it.color }} />
            </div>
            <span style={{ minWidth: 48, fontFamily: 'var(--font-mono)', textAlign: 'right', color: 'var(--text-muted)' }}>
              {fmtScore(it.value)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
