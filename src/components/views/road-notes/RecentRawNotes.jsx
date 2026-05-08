import { absDate } from '../../../lib/dateFormat'
import styles from './SalesOnRoadView.module.css'

/**
 * RecentRawNotes — laatste 5 ruwe aantekeningen onderaan de view, met
 * eventueel een agent-summary erachter.
 */
export default function RecentRawNotes({ events }) {
  if (events.length === 0) return null

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Laatste aantekeningen</h2>
        <span className="section__hint">wat je schreef</span>
      </div>
      <div className="stack stack--sm">
        {events.slice(0, 5).map(e => (
          <div key={`msg-${e.id}`} className={`card ${styles.noteCard}`}>
            <div className={styles.noteHead}>
              <span className="muted">
                {absDate(e.created_at)}{e.company_name ? ` · ${e.company_name}` : ''}
              </span>
            </div>
            <div className="inbox-item__default" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
              {e.raw_message}
            </div>
            {e.summary && (
              <div className={`inbox-item__default ${styles.noteSummary}`}>
                <span className="muted">samenvatting: </span>{e.summary}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
