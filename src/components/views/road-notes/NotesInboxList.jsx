import { INBOX_STATUS_LABEL, INBOX_STATUS_TONE } from '../../../lib/salesOnRoad'
import { absDate } from '../../../lib/dateFormat'
import styles from './SalesOnRoadView.module.css'

/**
 * NotesInboxList — laatste 5 inbox-items onder NoteCapture. Toont status-pill
 * (pending / processing / done / error) en eventueel error-message.
 */
export default function NotesInboxList({ inbox }) {
  if (!inbox || inbox.length === 0) return null

  return (
    <div className={styles.inboxWrap}>
      <div className={`section__hint ${styles.inboxHint}`}>
        Laatste {Math.min(5, inbox.length)} aantekeningen
      </div>
      <div className="stack stack--sm">
        {inbox.slice(0, 5).map(item => (
          <div key={item.id} className={`card ${styles.inboxItem}`}>
            <div className={styles.inboxHead}>
              <span className="muted">{absDate(item.created_at)}</span>
              <span className={`pill s-${INBOX_STATUS_TONE[item.status] || 'idle'} ${styles.inboxStatus}`}>
                {INBOX_STATUS_LABEL[item.status] || item.status}
              </span>
            </div>
            <div className={styles.inboxText}>{item.raw_text}</div>
            {item.error && <div className={`s-error ${styles.inboxError}`}>{item.error}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
