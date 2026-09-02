import { relativeTime } from '../../../lib/dateFormat'
import styles from './SecurityView.module.css'

/**
 * SecuritySummary — top-strip met severity-tellers, laatste-scan info en
 * de Ververs-knop. Puur presentational.
 */
export default function SecuritySummary({ summary, lastScan, lastWeeklyScan, refreshing, onRefresh }) {
  return (
    <div className="card admin-strip" style={{ padding: 'var(--s-5)' }}>
      <div className={styles.kpiRow}>
        <KpiBadge value={summary.critical} label="kritiek" severity="critical" urgent={summary.critical > 0} />
        <KpiBadge value={summary.high}     label="hoog"     severity="high" />
        <KpiBadge value={summary.medium}   label="medium"   severity="medium" />
        <KpiBadge value={summary.resolved} label="opgelost" severity="resolved" />

        <div className={styles.kpiActions}>
          {lastScan ? (
            <div className={styles.scanInfo}>
              <div>
                Laatste scan: <strong>{relativeTime(lastScan.completed_at) || '—'}</strong>{' '}
                <span className={`pill s-${lastScan.status === 'success' ? 'success' : lastScan.status === 'warning' ? 'warning' : 'error'} ${styles.tinyPill}`}>
                  {lastScan.status}
                </span>{' '}
                <span className={`pill ${styles.tinyPill}`}>
                  {lastScan.stats?.mode === 'weekly_scan' ? 'Weekly scan' : 'Daily monitor'}
                </span>
              </div>
              {lastWeeklyScan && lastWeeklyScan !== lastScan && (
                <div className={styles.scanInfoSecond}>
                  Laatste weekly scan: <strong>{relativeTime(lastWeeklyScan.completed_at) || '—'}</strong>
                </div>
              )}
            </div>
          ) : (
            <span className={styles.kpiLabel}>Nog geen scan uitgevoerd</span>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? 'Laden…' : 'Ververs'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KpiBadge({ value, label, severity, urgent }) {
  return (
    <div className={styles.kpiBadge}>
      <span
        className={styles.kpiSquare}
        data-severity={severity}
        data-urgent={urgent ? '1' : '0'}
      >
        {value}
      </span>
      <span className={styles.kpiLabel}>{label}</span>
    </div>
  )
}
