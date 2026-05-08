import { formatDateTime } from '../../../lib/dateFormat'
import styles from './LegalAIView.module.css'

/**
 * Archive — laatste 14 artikelen onder vandaag's article.
 */
export default function Archive({ archive, onSelect }) {
  if (!archive || archive.length === 0) {
    return <div className={styles.empty}>Nog geen archief.</div>
  }
  return (
    <div className="stack stack--sm">
      {archive.map(a => (
        <button
          key={a.id}
          onClick={() => onSelect && onSelect(a.id)}
          className={styles.archiveBtn}
        >
          <span className={styles.archiveBtnDate}>
            <strong>{formatDateTime(a.article_date)}</strong> — {a.title}
          </span>
          <span className={styles.archiveBtnTime}>
            {a.reading_time_min ?? '–'} min
          </span>
        </button>
      ))}
    </div>
  )
}
