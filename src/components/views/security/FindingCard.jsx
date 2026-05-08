import {
  SEV_LABEL, CAT_LABEL, CAT_ICON, SCAN_LABEL,
  STATUS_TONE, STATUS_LABEL,
} from '../../../lib/severity'
import { relativeTime, absDate } from '../../../lib/dateFormat'
import styles from './SecurityView.module.css'

/**
 * FindingCard — één security-bevinding. Klikbare rij die de detail-sectie
 * (preformatted text + notes + resolved_at) uitvouwt wanneer een `detail`
 * is. Acties (mark resolved / accepted / heropen) worden via callbacks
 * doorgegeven aan de container die de mutatie uitvoert.
 */
export default function FindingCard({ finding: f, expanded, onToggle, updatingId, onUpdateStatus }) {
  const isUpdating = updatingId === f.id
  const canExpand = !!f.detail

  return (
    <div className={`card ${styles.findingCard}`} data-severity={f.severity}>
      <div
        className={`${styles.findingMain} ${canExpand ? styles['findingMain--clickable'] : ''}`}
        data-severity={f.severity}
        data-expanded={expanded ? '1' : '0'}
        onClick={() => canExpand && onToggle(f.id)}
      >
        {/* Severity + category */}
        <div>
          <div className={styles.sevTag} data-severity={f.severity}>{SEV_LABEL[f.severity] || f.severity}</div>
          <div className={styles.catLine}>
            {CAT_ICON[f.category] || ''} {CAT_LABEL[f.category] || f.category}
          </div>
        </div>

        {/* Title + object */}
        <div>
          <div className={styles.findingTitle}>{f.title}</div>
          {f.affected_object && (
            <code className={styles.findingObject}>{f.affected_object}</code>
          )}
          <div className={styles.findingMeta}>
            <span>{relativeTime(f.found_at) || '—'}</span>
            <span>·</span>
            <span>{SCAN_LABEL[f.scan_type] || f.scan_type}</span>
            {canExpand && <span>· {expanded ? '▲ verberg' : '▼ detail'}</span>}
          </div>
        </div>

        {/* Status pill */}
        <div>
          <span className={`pill s-${STATUS_TONE[f.status] || 'idle'} ${styles.tinyPill}`}>
            {STATUS_LABEL[f.status] || f.status}
          </span>
        </div>

        {/* Actions */}
        <div onClick={e => e.stopPropagation()} className={styles.findingActions}>
          {f.status === 'open' ? (
            <>
              <ActionBtn label="Opgelost" tone="success" disabled={isUpdating} onClick={() => onUpdateStatus(f.id, 'resolved')} />
              <ActionBtn label="Accepteer" tone="warning" disabled={isUpdating} onClick={() => onUpdateStatus(f.id, 'accepted_risk')} />
            </>
          ) : (
            <ActionBtn label="Heropen" tone="idle" disabled={isUpdating} onClick={() => onUpdateStatus(f.id, 'open')} />
          )}
        </div>
      </div>

      {expanded && canExpand && (
        <div className={styles.expand} data-severity={f.severity}>
          <pre className={styles.expandPre}>{f.detail}</pre>
          {f.notes && <div className={styles.expandNote}>Notitie: {f.notes}</div>}
          {f.resolved_at && (
            <div className={styles.expandResolved}>Opgelost: {absDate(f.resolved_at)}</div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ label, onClick, disabled, tone }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={styles.actionBtn}
      data-tone={tone}
    >
      {label}
    </button>
  )
}
