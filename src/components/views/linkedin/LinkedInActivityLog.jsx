import { EVENT_LABEL, eventTone } from '../../../lib/linkedin'
import { formatDateTime } from '../../../lib/dateFormat'
import styles from './LinkedInView.module.css'

/**
 * LinkedInActivityLog — laatste 50 events uit linkedin_activity_log.
 */
export default function LinkedInActivityLog({ activity }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Logboek</h2>
        <span className="section__hint">laatste 50 events</span>
      </div>
      {activity.length === 0 ? (
        <div className="empty">Nog geen activity-log. Na de eerste run verschijnen events hier.</div>
      ) : (
        <div className="stack stack--sm">
          {activity.slice(0, 50).map(ev => (
            <div key={ev.id} className={`card ${styles.activityRow}`}>
              <span className={styles.activityDate}>{formatDateTime(ev.created_at)}</span>
              <span className={`pill s-${eventTone(ev.event_type)} ${styles.activityType}`}>
                {EVENT_LABEL[ev.event_type] || ev.event_type}
              </span>
              <span className={styles.activityDetail}>
                {ev.detail || <span className="muted">—</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
