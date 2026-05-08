import { relativeTime } from '../../../lib/dateFormat'
import styles from './LegalAIView.module.css'

/**
 * LinkedInDraftsPanel — recente LinkedIn drafts (laatste 10) met expand
 * + kopieer-knop. Gegenereerd door legal-ai-linkedin-draft skill.
 */
export default function LinkedInDraftsPanel({ drafts }) {
  if (!drafts || drafts.length === 0) return null

  function copyToClipboard(text) {
    if (navigator.clipboard) navigator.clipboard.writeText(text || '')
  }

  return (
    <section>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>LinkedIn drafts ({drafts.length})</h2>
      <div className="stack stack--sm">
        {drafts.map(d => (
          <details key={d.id} className={styles.draftCard}>
            <summary className={styles.draftSummary}>
              <span className={styles.draftVariant}>[{d.variant}]</span>
              {(d.body_md || '').slice(0, 90).replace(/\n/g, ' ')}
              {(d.body_md || '').length > 90 ? '…' : ''}
              <span className={styles.draftMeta}>
                {relativeTime(d.created_at)} · {d.status}
              </span>
            </summary>
            <pre className={styles.draftBody}>{d.body_md}</pre>
            <button onClick={() => copyToClipboard(d.body_md)} className={styles.btnGhost} style={{ marginTop: 8 }}>
              Kopieer
            </button>
          </details>
        ))}
      </div>
    </section>
  )
}
