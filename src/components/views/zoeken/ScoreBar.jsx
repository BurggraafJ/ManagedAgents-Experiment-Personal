import styles from './zoeken.module.css'
import { fmtScore } from '../../../lib/rag'

export default function ScoreBar({ vec, bm25, recency, combined }) {
  const items = [
    { label: 'Combined', value: combined, color: '#22c55e', strong: true },
    { label: 'Vector',   value: vec,      color: '#3b82f6' },
    { label: 'BM25',     value: bm25,     color: '#a855f7' },
    { label: 'Recency',  value: recency,  color: '#f59e0b' },
  ]
  return (
    <div className="stack" style={{ gap: 4 }}>
      {items.map((it) => {
        const pct = Math.min(Math.max(Number(it.value ?? 0) * 100, 0), 100)
        return (
          <div key={it.label} className={styles.scoreBarItem}>
            <span
              className={styles.scoreBarLabel}
              style={{ color: it.strong ? 'var(--text)' : 'var(--text-muted)', fontWeight: it.strong ? 600 : 400 }}
            >
              {it.label}
            </span>
            <div className={styles.scoreBarTrack}>
              <div className={styles.scoreBarFill} style={{ width: `${pct}%`, background: it.color }} />
            </div>
            <span className={styles.scoreBarValue}>{fmtScore(it.value)}</span>
          </div>
        )
      })}
    </div>
  )
}
