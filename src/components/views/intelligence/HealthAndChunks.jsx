import { SOURCE_LABELS } from '../../../lib/intelligence'
import { relativeTime } from '../../../lib/dateFormat'
import styles from './IntelligenceView.module.css'

/**
 * HealthGrid — sync-status per source (mail, hubspot, jira, fireflies, etc.)
 * met fresh-dot + record-count + last-sync.
 */
export function HealthGrid({ health }) {
  if (!health) return <div className="muted text-md">laden…</div>
  const keys = Object.keys(health).filter(k => k !== 'all_fresh' && k !== 'checked_at')
  return (
    <div className={styles.healthGrid}>
      {keys.map(k => {
        const v = health[k]
        if (!v || typeof v !== 'object') return null
        const fresh = v.is_fresh === true ? 'true' : v.is_fresh === false ? 'false' : 'unknown'
        return (
          <div key={k} className={styles.healthCard}>
            <div className={styles.healthName}>
              <span
                className={styles.healthDot}
                data-fresh={fresh}
                title={v.age_minutes != null ? `${v.age_minutes.toFixed(0)} min oud` : 'unknown'}
              />
              {SOURCE_LABELS[k] || k}
            </div>
            <div className={styles.healthMeta}>
              {v.source_count != null ? `${v.source_count.toLocaleString()} records` : ''}
              {v.last_sync_at && ' · ' + (relativeTime(v.last_sync_at) || 'nooit')}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * ChunksGrid — chunk-counts per source-type met totaal bovenaan.
 */
export function ChunksGrid({ chunks }) {
  if (!chunks) return <div className="muted text-md">laden…</div>
  if (chunks.length === 0) return <div className="muted text-md">geen chunks gevonden</div>
  const total = chunks.reduce((s, r) => s + r.total, 0)
  return (
    <div className="stack stack--sm">
      <div className="muted text-md">
        Totaal: <strong>{total.toLocaleString()}</strong> chunks over {chunks.length} bronnen
      </div>
      <div className={styles.chunksGrid}>
        {chunks.map(c => (
          <div key={c.source} className={styles.chunksCell}>
            <span className={styles.chunksLabel}>{SOURCE_LABELS[c.source] || c.source}</span>
            <span className={styles.chunksValue}>{c.total.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
