import { futureTime, relativeTime } from '../../../lib/dateFormat'
import {
  RUNNERS, durationLabel, isBadDuration, isLongRun, lateLabel, lateTone, overdueMs,
  sortForReview, STATUS_TONE,
} from '../../../lib/longRunning'
import styles from './LongRunningTasks.module.css'

/**
 * LongRunningTable — één uitvoerder-groep als tabel. Rijen komen al gefilterd
 * binnen; sorteren (zwaarste eerst) gebeurt hier zodat elke groep dezelfde
 * leesrichting heeft.
 */
export default function LongRunningTable({ runner, rows, now }) {
  const meta = RUNNERS[runner]
  const sorted = sortForReview(rows, now)

  return (
    <section>
      <div className={styles.groupHead}>
        <span className={styles.groupTitle}>{meta.label}</span>
        <span className={`pill s-${meta.tone} ${styles.tinyPill}`}>{rows.length}</span>
        <span className={styles.groupSub}>{meta.sub}</span>
      </div>

      <div className={`card ${styles.cardFlush}`}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <Th>Taak</Th>
                <Th>Ritme</Th>
                <Th>Laatste run</Th>
                <Th right>Duur</Th>
                <Th>Volgende run</Th>
                <Th right>7d</Th>
                <Th right>Fouten 14d</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => <Row key={r.agent_name} row={r} now={now} />)}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

function Row({ row: r, now }) {
  const late = overdueMs(r, now)
  const tone = STATUS_TONE[r.last_status] || 'idle'

  return (
    <tr>
      <Td>
        <div className={styles.taskName}>{r.display_name || r.agent_name}</div>
        {r.display_name && r.display_name !== r.agent_name && (
          <div className={styles.taskSlug}>{r.agent_name}</div>
        )}
        <div className={styles.flags}>
          {r.is_running && <span className={`pill s-warning ${styles.tinyPill}`}>draait nu</span>}
          {isLongRun(r) && <span className={`pill s-warning ${styles.tinyPill}`}>lange run</span>}
          {r.manual_run_requested_at && !r.is_running && (
            <span className={`pill ${styles.tinyPill}`}>handmatig aangevraagd</span>
          )}
        </div>
      </Td>

      <Td><span className={styles.cron}>{r.cron_expression || '—'}</span></Td>

      <Td>
        <span className={`pill s-${tone} ${styles.tinyPill}`}>{r.last_status || 'geen run'}</span>
        <div className={styles.when}>{relativeTime(r.last_run_at) || 'nooit'}</div>
      </Td>

      <Td right num className={isBadDuration(r) ? 'text-warning' : isLongRun(r) ? 'text-warning' : 'text-muted'}>
        {durationLabel(r)}
      </Td>

      <Td>
        {late > 0
          ? <span className={`${styles.late} text-${lateTone(late)}`}>{lateLabel(late)}</span>
          : <span className={styles.when}>{nextLabel(r)}</span>}
      </Td>

      <Td right num className="text-muted">{r.week_runs ?? 0}</Td>

      <Td right num className={r.error_14d > 0 ? 'text-error' : 'text-muted'}>{r.error_14d ?? 0}</Td>
    </tr>
  )
}

// Een uitgeschakelde rij houdt zijn oude next_run_at; die als "nu" tonen zou
// suggereren dat hij op het punt staat te draaien.
function nextLabel(r) {
  if (r.enabled === false) return '—'
  if (r.is_running) return 'draait'
  return futureTime(r.next_run_at)
}

function Th({ children, right }) {
  return <th className={`${styles.th} ${right ? styles['th--right'] : ''}`}>{children}</th>
}

function Td({ children, right, num, className = '' }) {
  return (
    <td className={`${styles.td} ${right ? styles['td--right'] : ''} ${num ? styles['td--num'] : ''} ${className}`}>
      {children}
    </td>
  )
}
