import styles from './zoeken.module.css'
import { fmtDate, SOURCE_LABEL, SOURCE_ICONS } from '../../../lib/rag'

export default function CitationCard({ cite, highlighted }) {
  return (
    <div
      id={`citation-${cite.n}`}
      className={styles.citCard}
      style={{
        border: `1px solid ${highlighted ? '#7c3aed' : 'var(--border)'}`,
        background: highlighted ? 'rgba(124,58,237,0.06)' : 'var(--bg-input, transparent)',
      }}
    >
      <div className={styles.citHeader}>
        <span className={styles.citNum}>#{cite.n}</span>
        <span className={styles.citSource}>
          {SOURCE_ICONS[cite.source] || '·'} {SOURCE_LABEL[cite.source] || cite.source}
        </span>
        <span className={styles.citDate}>{fmtDate(cite.occurred_at)}</span>
      </div>
      <div className={styles.citSubject}>
        {cite.subject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
      </div>
      {cite.preview && (
        <div className={styles.citPreview}>{cite.preview}</div>
      )}
    </div>
  )
}
