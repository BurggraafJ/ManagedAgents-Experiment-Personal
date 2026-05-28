import { formatRelative } from '../../../../lib/autodraft'
import Avatar from './Avatar'
import styles from '../autodraft.module.css'

// ThreadSubRow — compactere weergave van een andere mail in dezelfde
// conversatie, gerenderd direct onder de uitgeklapte hoofdrij in InboxList.
// Outlook-stijl kaartje: avatar links, afzender + snippet midden, tijd rechts.
// Klik selecteert die specifieke mail; MailDetail rendert hem read-only met
// de bestaande OutlookChain ernaast (zie __thread_member-flag).
export default function ThreadSubRow({ mail, selected, onSelect }) {
  const fromLabel = mail.is_from_me
    ? 'Jij'
    : (mail.from_name || mail.from_email || '—')
  const snippet = (mail.body_preview || '').trim()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`${styles.threadSubRow} ${selected ? styles.threadSubRowActive : ''}`}
      title={mail.subject || ''}
    >
      <Avatar name={mail.is_from_me ? 'Jij' : mail.from_name} email={mail.from_email} size="sm" />
      <span className={styles.threadSubFrom}>{fromLabel}</span>
      {snippet && <span className={styles.threadSubSnippet}>{snippet}</span>}
      <span className={styles.threadSubTime}>{formatRelative(mail.received_at)}</span>
    </div>
  )
}
