import { mdToHtml } from '../../../lib/legalAi'
import { formatDateTime } from '../../../lib/dateFormat'
import FeedbackPanel from './FeedbackPanel'
import styles from './LegalAIView.module.css'

/**
 * ArticleHero — vandaag's Legal AI artikel: TLDR + body (sanitized markdown)
 * + tegengeluid-flag + voorgestelde visie-updates + feedback-panel.
 */
export default function ArticleHero({ article, onFeedback, onLinkedIn }) {
  if (!article) {
    return (
      <div className={styles.heroEmpty}>
        <div style={{ fontSize: 16, color: 'var(--text-muted)' }}>
          Nog geen artikel voor vandaag.
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
          <code>legal-ai-research</code> draait dagelijks 06:30, <code>legal-ai-compose</code> 07:30 NL.
          Beide schedules staan disabled tot Jelle de <code>perplexity_api_key</code> heeft gezet.
        </div>
      </div>
    )
  }

  const tldr = Array.isArray(article.tldr) ? article.tldr : []
  const sections = article.sections || {}
  const tegengeluidIds = sections.tegengeluid || []
  const visionUpdates = sections.vision_updates_proposed || []

  return (
    <article className={styles.hero}>
      <header style={{ marginBottom: 16 }}>
        <div className={styles.heroDate}>
          {formatDateTime(article.article_date)} · {article.reading_time_min ?? '–'} min lezen
        </div>
        <h1 className={styles.heroTitle}>{article.title}</h1>
      </header>

      {tldr.length > 0 && (
        <div className={styles.tldrBox}>
          <div className={styles.tldrLabel}>TL;DR</div>
          <ul className={styles.tldrList}>
            {tldr.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      <div
        className={styles.bodyHtml}
        dangerouslySetInnerHTML={{ __html: mdToHtml(article.body_md || '') }}
      />

      {tegengeluidIds.length === 0 && (
        <div className={styles.warningBlock}>
          ⚠️ <strong>Geen tegengeluid vandaag — verdacht?</strong>
          <br />
          Alle findings bevestigen Jelle's huidige stellingen. Mogelijk een blind spot.
        </div>
      )}

      {visionUpdates.length > 0 && (
        <div className={styles.visionUpdates}>
          <div className={styles.visionUpdatesLabel}>Voorgestelde visie-updates</div>
          {visionUpdates.map((v, i) => (
            <div key={i} className={styles.visionUpdate}>
              <div>
                Stelling #{v.thesis_id}: confidence{' '}
                <strong>{v.current_confidence}</strong> → <strong>{v.proposed_confidence}</strong>
              </div>
              <div className={styles.visionUpdateReason}>{v.reason}</div>
              <div className={styles.visionUpdateActions}>
                <button className={styles.btnGhost}>Accept</button>
                <button className={styles.btnGhost}>Reject</button>
                <button className={styles.btnGhost}>Amend</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <FeedbackPanel article={article} onFeedback={onFeedback} onLinkedIn={onLinkedIn} />
    </article>
  )
}
