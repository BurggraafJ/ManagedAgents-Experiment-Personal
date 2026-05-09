import { fmtNum, pct } from '../../../lib/truthOfSources'
import styles from './TruthOfSourcesView.module.css'

/**
 * VectorBar — toont embedding-coverage als horizontale progress-bar met
 * percentage-pill en absolute aantallen. Refactor 27 (2026-05-09).
 *
 * `width` op de fill blijft inline omdat het puur data-driven is (geldige
 * uitzondering volgens R03/R27).
 */
export default function VectorBar({ embedded, total }) {
  const p = pct(embedded, total)
  if (p === null) return <div className={styles.vectorBarEmpty}>–</div>
  const tone  = p >= 99 ? 's-success' : p >= 80 ? 's-warning' : 's-error'
  const color = p >= 99
    ? 'var(--success, #16a34a)'
    : p >= 80
      ? 'var(--warning, #d97706)'
      : 'var(--error, #d9534f)'
  return (
    <div className={styles.vectorBar}>
      <div className={styles.vectorBarLabel}>
        <span className={styles.vectorBarLabelMuted}>{fmtNum(embedded)} / {fmtNum(total)}</span>
        <span className={`status-pill ${tone} ${styles.vectorBarPill}`}>{p}%</span>
      </div>
      <div className={styles.vectorBarTrack}>
        <div
          className={styles.vectorBarFill}
          style={{ width: `${p}%`, background: color }}
        />
      </div>
    </div>
  )
}
