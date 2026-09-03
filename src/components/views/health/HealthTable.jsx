import { healthPct, rowTone, TIER_LABELS } from '../../../lib/agentHealth'
import { relativeTime } from '../../../lib/dateFormat'
import styles from './HealthView.module.css'

/**
 * HealthTable — toont de gefilterde + gesorteerde agent-health rijen.
 * Aanroep met `rows` al gefilterd en gesorteerd door de container.
 */
export default function HealthTable({ rows }) {
  return (
    <div className={`card ${styles.cardFlush}`}>
      <table className={styles.table}>
        <thead>
          <tr>
            <Th>Agent</Th>
            <Th>Tier</Th>
            <Th right>7d runs</Th>
            <Th right>✓</Th>
            <Th right>⚠</Th>
            <Th right>✗</Th>
            <Th right>Gezond</Th>
            <Th right>Avg dur</Th>
            <Th>Laatste fout</Th>
            <Th>Laatste run</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={10} className={styles.empty}>Geen agents in deze filter.</td>
            </tr>
          )}
          {rows.map(r => <HealthRow key={r.agent_name} row={r} />)}
        </tbody>
      </table>
    </div>
  )
}

function HealthRow({ row: r }) {
  // Kleurt op health_pct = (success+warning)/totaal, niet op success_pct —
  // een warning-run is voltooid werk. Zie lib/agentHealth.healthPct().
  const pct = healthPct(r)
  const t = rowTone(r)
  return (
    <tr>
      <Td>
        <div className={styles.agentName}>{r.display_name || r.agent_name}</div>
        {r.display_name && r.display_name !== r.agent_name && (
          <div className={styles.agentSlug}>{r.agent_name}</div>
        )}
        {!r.enabled && <div className={styles.agentDisabled}>(disabled)</div>}
      </Td>
      <Td>
        <span className={`pill ${styles.tinyPill}`}>{TIER_LABELS[r.tier] || r.tier || '—'}</span>
      </Td>
      <Td right>{r.runs_total ?? 0}</Td>
      <Td right className={r.ok_count > 0 ? 'text-success' : 'text-muted'}>{r.ok_count ?? 0}</Td>
      <Td right className={r.warn_count > 0 ? 'text-warning' : 'text-muted'}>{r.warn_count ?? 0}</Td>
      <Td right className={r.err_count > 0 ? 'text-error' : 'text-muted'}>{r.err_count ?? 0}</Td>
      <Td right>
        <span className={`pill s-${t} ${styles.summaryPill}`}>
          {pct === null ? '—' : `${pct}%`}
        </span>
      </Td>
      <Td right num className="text-muted">
        {r.avg_dur_s ? `${Number(r.avg_dur_s).toFixed(0)}s` : '—'}
      </Td>
      <Td className={r.last_failure_at ? styles.lastFailure : `${styles.lastFailure} ${styles['lastFailure--none']}`}>
        {relativeTime(r.last_failure_at) || '—'}
      </Td>
      <Td className={styles.lastRun}>
        {relativeTime(r.last_run_at) || '—'}
      </Td>
    </tr>
  )
}

function Th({ children, right }) {
  return <th className={`${styles.th} ${right ? styles['th--right'] : ''}`}>{children}</th>
}

function Td({ children, right, num, className = '' }) {
  const cls = [
    styles.td,
    right ? styles['td--right'] : '',
    num ? styles['td--num'] : '',
    className,
  ].filter(Boolean).join(' ')
  return <td className={cls}>{children}</td>
}
