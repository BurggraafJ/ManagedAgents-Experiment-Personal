import { Fragment } from 'react'
import {
  statusTone,
  RUN_STATUS_LABEL,
  fmtTime,
  fmtDuration,
  dayKey,
  dayLabel,
} from '../../../lib/truthOfSources'
import styles from './TruthOfSourcesView.module.css'

/**
 * RunsLogPanel — lijst van recente agent_runs voor één source, gegroepeerd
 * per dag (vandaag/gisteren/<weekday>). Refactor 27 (2026-05-09).
 *
 * `runs` is reeds gefilterd + gesorteerd door SourceDetailModal.
 */
export default function RunsLogPanel({ runs }) {
  if (!runs || runs.length === 0) {
    return <div className={`muted ${styles.runsListEmpty}`}>nog geen runs gelogd voor deze functies.</div>
  }

  let prevDay = null
  return (
    <div className={styles.runsList}>
      {runs.map((r, i) => {
        const k = dayKey(r.started_at)
        const showDay = k !== prevDay
        prevDay = k
        return (
          <Fragment key={`${r.agent_name}-${r.started_at}-${i}`}>
            {showDay && (
              <div className="agent-runs-log__day">
                <span>{dayLabel(r.started_at)}</span>
              </div>
            )}
            <div className={`card ${styles.runTile}`}>
              <div className={styles.runTileHead}>
                <span className={`${statusTone(r.status)} ${styles.runTileStatus}`}>
                  ● {RUN_STATUS_LABEL[r.status] || r.status}
                </span>
                <span className={`mono muted ${styles.runTileAgent}`}>{r.agent_name}</span>
              </div>
              <div className={styles.runTileMeta}>
                <span className="mono muted">{fmtTime(r.started_at)}</span>
                <span className="mono muted">{fmtDuration(r.started_at, r.completed_at)}</span>
              </div>
              {r.summary && (
                <div className={styles.runTileSummary}>
                  {r.summary.length > 200 ? r.summary.slice(0, 200) + '…' : r.summary}
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
