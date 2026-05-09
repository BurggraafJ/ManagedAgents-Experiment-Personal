import { useState } from 'react'
import styles from './zoeken.module.css'
import {
  relTime,
  fmtPct,
  cleanText,
  splitAugmented,
  splitTopAndQuoted,
  paragraphifyQuoted,
  parseMailContent,
  deriveSubject,
} from '../../../lib/rag'
import ScoreBar from './ScoreBar'

// ResultRow — één compacte rij; klik op caret = expand.
export default function ResultRow({ match, onFeedback, feedbackState, linked }) {
  const [expanded, setExpanded] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const occurredRel = relTime(match.occurred_at)
  const { prefix: augPrefix, body: augBody } = splitAugmented(match.content_with_context, match.preview)
  const cleanPrefix = augPrefix ? cleanText(augPrefix) : null
  const parsed = parseMailContent(augBody)
  const cleanBody = cleanText(parsed.body || augBody)
  const { top: bodyTop, quoted: bodyQuoted } = splitTopAndQuoted(cleanBody)
  const quotedFormatted = bodyQuoted ? paragraphifyQuoted(bodyQuoted) : null
  const derivedSubject = deriveSubject(match) || match.subject
  const viaEdge = match.entity_path?.via_edge
  const fb = feedbackState[match.chunk_id]

  const handleFeedback = async (outcome) => {
    if (submitting || fb) return
    setSubmitting(true)
    try {
      await onFeedback(match, outcome)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      background: fb === 'accept' ? 'rgba(34,197,94,0.04)' : fb === 'reject' ? 'rgba(148,163,184,0.05)' : 'transparent',
    }}>
      <div className={styles.resultSummary} onClick={() => setExpanded(e => !e)}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 14 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span className={styles.similarity}>{fmtPct(match.similarity)}</span>
        <span className={styles.resultTitle}>
          <span className={styles.resultTitleName}>
            {derivedSubject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
          </span>
          {linked && (linked.person || linked.company) && (
            <span className={styles.resultTitleMeta}>
              <span style={{ opacity: 0.7 }}>↳ </span>
              {linked.person && <span>{linked.person}</span>}
              {linked.person && linked.company && <span style={{ margin: '0 4px', opacity: 0.5 }}>·</span>}
              {linked.company && <span>{linked.company}</span>}
              {linked.extra && <span style={{ marginLeft: 4, opacity: 0.6 }}>· {linked.extra}</span>}
            </span>
          )}
        </span>
        <span className={styles.resultDate}>{occurredRel}</span>
        {viaEdge && viaEdge !== 'self' && (
          <span className={styles.viaEdge}>via {viaEdge}</span>
        )}
        <div className={styles.feedbackBtns} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleFeedback('accept')}
            disabled={submitting || !!fb}
            title={fb === 'accept' ? 'Gemarkeerd als nuttig' : 'Markeer als nuttig'}
            className={styles.feedbackBtn}
            style={{
              background: fb === 'accept' ? '#22c55e' : 'transparent',
              color: fb === 'accept' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'accept' ? 0.4 : 1,
            }}
          >✓</button>
          <button
            type="button"
            onClick={() => handleFeedback('reject')}
            disabled={submitting || !!fb}
            title={fb === 'reject' ? 'Gemarkeerd als ruis' : 'Markeer als ruis'}
            className={styles.feedbackBtn}
            style={{
              background: fb === 'reject' ? '#94a3b8' : 'transparent',
              color: fb === 'reject' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'reject' ? 0.4 : 1,
            }}
          >✕</button>
        </div>
      </div>

      {expanded && (
        <div className={styles.expandedPanel}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cleanPrefix && (
              <div className={styles.contextBlock}>
                <div className={styles.contextLabel}>✦ Contextuele samenvatting</div>
                <div className={styles.contextBody}>{cleanPrefix}</div>
                <div className={styles.contextHint}>
                  Automatisch gegenereerd door GPT-5-nano bij het chunken — wordt mee-geëmbed en mee-gezocht via BM25 zodat ook losse mailberichten in een breder verband terugkomen.
                </div>
              </div>
            )}
            {(parsed.folder || parsed.headers.length > 0) && (
              <div className={styles.mailGrid}>
                {parsed.folder && (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Locatie</div>
                    <div style={{ fontFamily: 'var(--mono)' }}>{parsed.folder}</div>
                  </>
                )}
                {parsed.headers.map((h, i) => (
                  <span key={i} style={{ display: 'contents' }}>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{h.key}</div>
                    <div style={{ wordBreak: 'break-word' }}>{h.value || <em style={{ color: 'var(--text-muted)' }}>(leeg)</em>}</div>
                  </span>
                ))}
              </div>
            )}
            {cleanBody ? (
              <div className={styles.bodyBlock}>
                {bodyTop}
                {quotedFormatted && (
                  <details style={{ marginTop: 12 }}>
                    <summary className={styles.quotedSummary}>▸ Vorige berichten in deze thread tonen</summary>
                    <div className={styles.quotedBody}>{quotedFormatted}</div>
                  </details>
                )}
              </div>
            ) : (
              <em style={{ fontSize: 12, color: 'var(--text-muted)' }}>(geen body)</em>
            )}
            <div className={styles.metaDebug}>
              <div><strong>chunk_type:</strong> {match.chunk_type ?? '–'}</div>
              <div><strong>source_id:</strong> <code>{match.id}</code></div>
              {match.meta && Object.keys(match.meta).length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer' }}>metadata</summary>
                  <pre style={{ fontSize: 10, marginTop: 4, padding: 6, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'auto', maxHeight: 200 }}>
                    {JSON.stringify(match.meta, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
          <div className={styles.scoreSection}>
            <div className={styles.scoreSectionTitle}>Score-breakdown</div>
            <ScoreBar
              vec={match.vector_score}
              bm25={match.bm25_score}
              recency={match.recency_score}
              combined={match.similarity}
            />
            {match.entity_path && match.entity_path.via_edge !== 'self' && (
              <div className={styles.entityPath}>
                <strong>Entity-pad:</strong> via <code>{match.entity_path.via_edge}</code>
                {match.entity_path.confidence != null && (
                  <> · conf {Number(match.entity_path.confidence).toFixed(2)}</>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
