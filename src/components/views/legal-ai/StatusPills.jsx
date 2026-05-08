import { relativeTime } from '../../../lib/dateFormat'
import styles from './LegalAIView.module.css'

/**
 * StatusPills — research-fresh + artikel-status pills.
 * Research is "fresh" als de laatste run binnen 36u was.
 */
export default function StatusPills({ latestRunAt, hasArticle }) {
  const runFresh = latestRunAt && (Date.now() - new Date(latestRunAt).getTime()) < 36 * 3600 * 1000
  return (
    <div className={styles.statusPills}>
      <span className={styles.statusPill} data-tone={runFresh ? 'success' : 'warning'}>
        Research: {latestRunAt ? relativeTime(latestRunAt) : 'nog nooit'}
      </span>
      <span className={styles.statusPill} data-tone={hasArticle ? 'success' : 'idle'}>
        {hasArticle ? 'Artikel klaar' : 'Geen artikel vandaag'}
      </span>
    </div>
  )
}
