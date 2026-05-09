import { relTime, statusTone, RUN_STATUS_LABEL } from '../../../lib/truthOfSources'
import styles from './TruthOfSourcesView.module.css'

/**
 * LinkedFunctions — lijst van edge-functions die bij een source horen, met
 * laatste run-status en relatieve tijd. Wordt rechts in de detail-modal
 * gerenderd. Refactor 27 (2026-05-09).
 */
export default function LinkedFunctions({ functions, latestByAgent }) {
  return (
    <div className={styles.linkedList}>
      {functions.map((fn) => {
        const r = latestByAgent[fn.agent]
        const tone = r?.status ? statusTone(r.status) : 's-idle'
        const label = r?.status ? (RUN_STATUS_LABEL[r.status] || r.status) : 'geen logs'
        return (
          <div key={fn.agent} className={styles.linkedTile}>
            <div className={styles.linkedHead}>
              <div className={styles.linkedHeadLeft}>
                <div className={styles.linkedTitle}>{fn.label}</div>
                <div className={`mono muted ${styles.linkedAgent}`}>{fn.agent}</div>
              </div>
              <span className={`status-pill ${tone} ${styles.linkedPill}`}>{label}</span>
            </div>
            <div className={`muted ${styles.linkedDesc}`}>{fn.desc}</div>
            {r && (
              <div className={`muted ${styles.linkedRel}`}>
                {relTime(r.started_at)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
