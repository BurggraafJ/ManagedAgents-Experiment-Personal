import { formatRunStamp } from '../../../lib/kilometers'
import styles from './KilometersView.module.css'

/**
 * RecentRunsList — laatste runs van de kilometerregistratie-agent.
 * Compacte tabel met datum/summary/status.
 */
export default function RecentRunsList({ runs }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Recente runs <span className="section__count">{runs.length}</span>
        </h2>
      </div>
      {runs.length === 0 ? (
        <div className={`empty ${styles.empty}`}>Nog geen recente runs.</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          {runs.map(r => (
            <div key={r.id} className={styles.runRow}>
              <span className={styles.runStamp}>{formatRunStamp(r.started_at)}</span>
              <span style={{ color: 'var(--text)' }}>{r.summary || '—'}</span>
              <span className={`s-${r.status} ${styles.runStatus}`}>{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
