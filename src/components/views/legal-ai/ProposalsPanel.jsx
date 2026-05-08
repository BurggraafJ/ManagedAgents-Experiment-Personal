import { relativeTime } from '../../../lib/dateFormat'
import styles from './LegalAIView.module.css'

/**
 * ProposalsPanel — pending visie-update voorstellen vanuit
 * legal-ai-vision-update skill. Accept/reject muteert de stelling via
 * apply_legal_ai_thesis_update RPC.
 */
export default function ProposalsPanel({ proposals, onDecide }) {
  if (!proposals || proposals.length === 0) return null
  return (
    <section>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Visie-update voorstellen ({proposals.length})</h2>
      <div className="stack stack--sm">
        {proposals.map(p => {
          const pl = p.payload || {}
          return (
            <div key={p.id} className={styles.proposalCard}>
              <div className={styles.proposalMeta}>
                {pl.target} · {pl.action} · {relativeTime(p.created_at)}
              </div>
              {pl.proposed_statement && (
                <div className={styles.proposalContent}>
                  <strong>Voorstel:</strong> {pl.proposed_statement}
                </div>
              )}
              {pl.proposed_confidence !== undefined && pl.current_thesis && (
                <div className={styles.proposalContent}>
                  Confidence: <strong>{pl.current_thesis?.confidence}</strong> → <strong>{pl.proposed_confidence}</strong>
                </div>
              )}
              {pl.reason && <div className={styles.proposalReason}>Reden: {pl.reason}</div>}
              <div className={styles.proposalActions}>
                <button onClick={() => onDecide(p.id, 'accept')} className={styles.btnGhost} data-tone="success">
                  Accept
                </button>
                <button onClick={() => onDecide(p.id, 'reject')} className={styles.btnGhost} data-tone="error">
                  Reject
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
