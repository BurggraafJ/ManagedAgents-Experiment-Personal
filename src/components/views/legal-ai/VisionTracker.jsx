import styles from './LegalAIView.module.css'

/**
 * VisionTracker — actieve stellingen met confidence-bar + evidence/counter
 * counts. Highlight wanneer counter-evidence ≥ 2× evidence (stelling verzwakt).
 */
export default function VisionTracker({ theses }) {
  if (!theses || theses.length === 0) {
    return (
      <div className={styles.heroEmpty}>
        <div style={{ fontSize: 13 }}>
          Nog geen actieve stellingen. Voeg er handmatig toe via DB of laat ze
          groeien uit voice-notes (F.5).
        </div>
      </div>
    )
  }

  return (
    <div className="stack stack--sm">
      {theses.map(t => {
        const total = t.evidence_count + t.counter_evidence_count
        const supportPct = total === 0 ? 50 : (t.evidence_count / total) * 100
        const isWeakening = total >= 3 && t.counter_evidence_count * 2 > t.evidence_count
        return (
          <div key={t.id} className={styles.thesis} data-weakening={isWeakening ? '1' : '0'}>
            <div className={styles.thesisHead}>
              <div className={styles.thesisStatement}>{t.statement}</div>
              <div className={styles.thesisConfidence}>conf. {t.confidence}</div>
            </div>
            <div className={styles.thesisBar}>
              <div className={styles.thesisBarFill} style={{ width: `${supportPct}%` }} />
            </div>
            <div className={styles.thesisCounts}>
              <span>👍 {t.evidence_count} ondersteunend</span>
              {isWeakening && <span className={styles.thesisWeakLabel}>⚠️ stelling verzwakt</span>}
              <span>👎 {t.counter_evidence_count} tegen</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
