import { useMemo } from 'react'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { relativeTime } from '../../../lib/dateFormat'
import { SummaryKpi } from './HealthSummary'
import styles from './HealthView.module.css'

/**
 * SecurityEventsSection — Frontend Security F.4.4.
 * Toont auth-events + CSP-violations + client-errors uit de drie
 * security-tabellen via security_events_summary + _recent views.
 *
 * Refactor 19: rechtstreeks supabase.from()-fetches vervangen door
 * useSupabaseQuery (Refactor 04 patroon).
 */
export default function SecurityEventsSection() {
  const { data: summary, error: summaryErr } = useSupabaseQuery('security_events_summary')
  const { data: recent, error: recentErr } = useSupabaseQuery('security_events_recent', {
    orderBy: ['event_at', { ascending: false }],
    limit: 20,
  })
  const error = summaryErr || recentErr

  const totals = useMemo(() => {
    if (!summary || summary.length === 0) return { last24h: 0, last7d: 0, errors24h: 0 }
    let last24h = 0, last7d = 0, errors24h = 0
    for (const row of summary) {
      last24h += Number(row.last_24h || 0)
      last7d  += Number(row.last_7d  || 0)
      if (row.severity === 'error') errors24h += Number(row.last_24h || 0)
    }
    return { last24h, last7d, errors24h }
  }, [summary])

  if (error) {
    return (
      <div className={`card ${styles.errorBanner}`}>
        Security events kon niet geladen worden: {error}
      </div>
    )
  }

  if (summary === null || recent === null) {
    return <div className="skeleton" style={{ height: 160 }} />
  }

  return (
    <div className="stack stack--gap-4">
      <div className={styles.secHeading}>
        Security events
        <span className={`pill ${styles.tinyPill}`}>F.4.4</span>
      </div>

      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div className={styles.summaryRow}>
          <SummaryKpi tone={totals.errors24h > 0 ? 'error' : 'success'} value={totals.errors24h} label="errors (24u)" />
          <SummaryKpi tone="idle" value={totals.last24h} label="events (24u)" />
          <SummaryKpi tone="idle" value={totals.last7d}  label="events (7d)" />
        </div>
        {summary.length > 0 && (
          <div className={styles.secTags}>
            {summary.map((row, i) => (
              <span
                key={i}
                className={`pill s-${row.severity === 'error' ? 'error' : row.severity === 'warning' ? 'warning' : 'idle'} ${styles.tinyPill}`}
              >
                {row.kind}/{row.severity}: {row.last_24h}/24u · {row.last_7d}/7d
              </span>
            ))}
          </div>
        )}
      </div>

      {recent.length > 0 ? (
        <div className={`card ${styles.cardFlush}`}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Wanneer</th>
                <th className={styles.th}>Soort</th>
                <th className={styles.th}>Sev</th>
                <th className={styles.th}>Code</th>
                <th className={styles.th}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr key={i}>
                  <td className={`${styles.td} ${styles.lastRun}`}>{relativeTime(e.event_at) || '—'}</td>
                  <td className={styles.td}>
                    <span className={`pill ${styles.tinyPill}`}>{e.kind}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={`pill s-${e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'success'} ${styles.tinyPill}`}>
                      {e.severity}
                    </span>
                  </td>
                  <td className={`${styles.td} ${styles.secCellMono}`}>{e.event_code || '—'}</td>
                  <td className={`${styles.td} ${styles.lastRun}`}>
                    {e.actor || e.ip_address || e.message || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`card ${styles.footer}`}>
          Geen security-events in de laatste 30 dagen. Bron: <code>security_events_recent</code>.
        </div>
      )}
    </div>
  )
}
