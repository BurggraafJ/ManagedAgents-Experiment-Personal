import { INBOX_STATUS_LABEL, INBOX_STATUS_TONE, formatShortDate, formatEuro } from '../../../lib/kilometers'
import styles from './KilometersView.module.css'

/**
 * TripsInboxList — lijst van wachtende ritten in `km_trips_inbox` onder de
 * invoervorm. Toont laatste 10 met status-pill (pending/processing/done/error).
 */
export default function TripsInboxList({ inbox }) {
  if (!inbox || inbox.length === 0) return null

  const pendingCount = inbox.filter(i => i.status === 'pending').length

  return (
    <div className={styles.inboxWrap}>
      <div className={`section__hint ${styles.inboxHint}`}>
        Wachtrij {pendingCount} pending · totaal {inbox.length}
      </div>
      <div className="card" style={{ padding: 0 }}>
        {inbox.slice(0, 10).map(item => (
          <div key={item.id} className={styles.inboxRow}>
            <span className={styles.inboxDate}>
              {item.datum || formatShortDate(item.created_at)}
            </span>
            <span className={styles.inboxText}>
              {item.van || '—'}
              {item.naar && <span className="muted"> → {item.naar}</span>}
              {item.doel && <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>· {item.doel}</span>}
            </span>
            <span className={styles.inboxParking}>{formatEuro(item.parkeerkosten)}</span>
            <span className={`pill s-${INBOX_STATUS_TONE[item.status] || 'idle'} ${styles.inboxStatusPill}`}>
              {INBOX_STATUS_LABEL[item.status] || item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
