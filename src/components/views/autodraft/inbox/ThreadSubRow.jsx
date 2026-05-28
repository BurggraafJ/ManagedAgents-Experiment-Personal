import { formatRelative } from '../../../../lib/autodraft'
import Avatar from './Avatar'
import styles from '../autodraft.module.css'

// ThreadSubRow — andere mails in dezelfde conversatie, gerenderd direct onder
// de uitgeklapte hoofdrij in InboxList. V1.49: visueel gelijkwaardig aan
// MailRow (zelfde avatar + zelfde rij-hoogte + subject + snippet) zodat
// Outlook-stijl klopt. Indent + accent-rand links via .threadSubList wrapper.
export default function ThreadSubRow({ mail, selected, onSelect }) {
  const fromLabel = mail.is_from_me
    ? 'Jij'
    : (mail.from_name || mail.from_email || '—')
  const snippet = (mail.body_preview || '').trim()
  const subject = mail.subject || '(geen onderwerp)'
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      className={`${styles.threadSubRow} ${selected ? styles.threadSubRowActive : ''}`}
      title={subject}
    >
      <Avatar name={mail.is_from_me ? 'Jij' : mail.from_name} email={mail.from_email} size="sm" />
      <div className={styles.threadSubBody}>
        <div className={styles.threadSubHead}>
          <span className={styles.threadSubFrom}>{fromLabel}</span>
          <span className={styles.threadSubTime}>{formatRelative(mail.received_at)}</span>
        </div>
        <div className={styles.threadSubSubject}>{subject}</div>
        {snippet && <div className={styles.threadSubSnippet}>{snippet}</div>}
      </div>
    </div>
  )
}
