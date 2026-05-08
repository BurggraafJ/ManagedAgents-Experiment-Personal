import { useState } from 'react'
import { relativeTime, absDate } from '../../../lib/dateFormat'
import styles from './SecurityView.module.css'

/**
 * ScanLogsList — tab met agent_runs van de security-monitor agent. Per run
 * een uitvouwbare card met summary + counts. Daily monitor en weekly deep
 * scan worden visueel onderscheiden via data-mode.
 */
export default function ScanLogsList({ logs }) {
  const [expandedId, setExpandedId] = useState(null)

  if (!logs || logs.length === 0) {
    return (
      <div className={`card ${styles.empty}`}>
        Nog geen scan-logs. De agent draait dagelijks 07:00 op werkdagen.
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-3)' }}>
      {logs.map(log => (
        <ScanLogCard
          key={log.id}
          log={log}
          expanded={expandedId === log.id}
          onToggle={() => setExpandedId(prev => prev === log.id ? null : log.id)}
        />
      ))}
    </div>
  )
}

function ScanLogCard({ log, expanded, onToggle }) {
  const isWeekly = log.stats?.mode === 'weekly_scan'
  const counts = log.stats?.counts || {}
  return (
    <div className={`card ${styles.logCard}`} data-mode={isWeekly ? 'weekly' : 'daily'}>
      <div className={styles.logHead} onClick={onToggle}>
        <div>
          <div className={styles.logTitleRow}>
            <span className={styles.logTitle}>
              {isWeekly ? '🔍 Weekly Deep Scan' : '👁 Daily Monitor'}
            </span>
            <span className={`pill s-${log.status === 'success' ? 'success' : log.status === 'warning' ? 'warning' : 'error'} ${styles.tinyPill}`}>
              {log.status}
            </span>
            {counts.findings_new > 0 && (
              <span className={`pill s-${counts.findings_critical > 0 ? 'error' : counts.findings_high > 0 ? 'warning' : 'idle'} ${styles.tinyPill}`}>
                {counts.findings_new} nieuw
              </span>
            )}
            {counts.findings_new === 0 && (
              <span className={`pill s-success ${styles.tinyPill}`}>✓ schoon</span>
            )}
          </div>
          <div className={styles.logSubLine}>
            <span>{absDate(log.completed_at)}</span>
            {counts.checks_run && <span>· {counts.checks_run} checks</span>}
          </div>
        </div>
        <div className={styles.logRel}>{relativeTime(log.completed_at) || '—'}</div>
        <div className={styles.logCaret}>{expanded ? '▲' : '▼'}</div>
      </div>

      {expanded && (
        <div className={styles.logBody}>
          {log.summary && <div className={styles.logSummary}>{log.summary}</div>}
          {log.stats && (
            <div className={styles.logStatRow}>
              {counts.checks_run != null && <Stat label="Checks" value={counts.checks_run} />}
              {counts.findings_new != null && (
                <Stat label="Nieuw" value={counts.findings_new} tone={counts.findings_new > 0 ? 'error' : 'success'} />
              )}
              {counts.findings_critical > 0 && (
                <Stat label="Kritiek" value={counts.findings_critical} tone="error" />
              )}
              {counts.findings_high > 0 && (
                <Stat label="Hoog" value={counts.findings_high} tone="high" />
              )}
            </div>
          )}
          {log.stats?.extra?.modus && (
            <div className={styles.logExtra}>
              Modus: {log.stats.extra.modus === 'weekly_scan' ? 'Weekly deep scan' : 'Daily light monitor'}
              {log.started_at && (
                <> · Duur: {Math.round((new Date(log.completed_at) - new Date(log.started_at)) / 1000)}s</>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}:</span>
      <strong className={styles.statValue} data-tone={tone || ''}>{value}</strong>
    </div>
  )
}
