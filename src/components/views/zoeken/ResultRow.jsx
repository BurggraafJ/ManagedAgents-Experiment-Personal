import { useState } from 'react'
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
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', cursor: 'pointer', minHeight: 36,
        }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 14 }}>
          {expanded ? '▾' : '▸'}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
          color: '#22c55e', minWidth: 56, textAlign: 'right',
        }}>
          {fmtPct(match.similarity)}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {derivedSubject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
          </span>
          {linked && (linked.person || linked.company) && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ opacity: 0.7 }}>↳ </span>
              {linked.person && <span>{linked.person}</span>}
              {linked.person && linked.company && <span style={{ margin: '0 4px', opacity: 0.5 }}>·</span>}
              {linked.company && <span>{linked.company}</span>}
              {linked.extra && <span style={{ marginLeft: 4, opacity: 0.6 }}>· {linked.extra}</span>}
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 56, textAlign: 'right' }}>
          {occurredRel}
        </span>
        {viaEdge && viaEdge !== 'self' && (
          <span style={{
            fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic',
            padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 3, background: 'var(--bg-input, rgba(0,0,0,0.02))',
            whiteSpace: 'nowrap',
          }}>
            via {viaEdge}
          </span>
        )}
        <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => handleFeedback('accept')}
            disabled={submitting || !!fb}
            title={fb === 'accept' ? 'Gemarkeerd als nuttig' : 'Markeer als nuttig'}
            style={{
              padding: '2px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 3,
              background: fb === 'accept' ? '#22c55e' : 'transparent',
              color: fb === 'accept' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'accept' ? 0.4 : 1,
            }}
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => handleFeedback('reject')}
            disabled={submitting || !!fb}
            title={fb === 'reject' ? 'Gemarkeerd als ruis' : 'Markeer als ruis'}
            style={{
              padding: '2px 8px', fontSize: 11, border: '1px solid var(--border)', borderRadius: 3,
              background: fb === 'reject' ? '#94a3b8' : 'transparent',
              color: fb === 'reject' ? 'white' : 'var(--text-muted)',
              cursor: submitting || fb ? 'default' : 'pointer',
              opacity: fb && fb !== 'reject' ? 0.4 : 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{
          padding: '12px 16px 14px 40px', display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24,
          background: 'var(--bg-input, rgba(0,0,0,0.02))',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {cleanPrefix && (
              <div style={{
                padding: '8px 12px', borderLeft: '3px solid #a855f7',
                background: 'rgba(168,85,247,0.06)', borderRadius: '0 4px 4px 0',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#a855f7',
                }}>
                  ✦ Contextuele samenvatting
                </div>
                <div style={{
                  fontSize: 12, color: 'var(--text)', fontStyle: 'italic',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {cleanPrefix}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  Automatisch gegenereerd door GPT-5-nano bij het chunken — wordt mee-geëmbed en mee-gezocht via BM25 zodat ook losse mailberichten in een breder verband terugkomen.
                </div>
              </div>
            )}
            {(parsed.folder || parsed.headers.length > 0) && (
              <div style={{
                padding: '8px 12px', borderLeft: '3px solid var(--text-muted)',
                background: 'rgba(0,0,0,0.03)', borderRadius: '0 4px 4px 0',
                display: 'grid', gridTemplateColumns: 'minmax(70px, max-content) 1fr',
                rowGap: 4, columnGap: 12, fontSize: 11,
              }}>
                {parsed.folder && (
                  <>
                    <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Locatie</div>
                    <div style={{ fontFamily: 'var(--font-mono)' }}>{parsed.folder}</div>
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
              <div style={{
                fontSize: 13, color: 'var(--text)', lineHeight: 1.65,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                padding: '8px 12px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 4,
              }}>
                {bodyTop}
                {quotedFormatted && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{
                      cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)',
                      padding: '4px 8px', background: 'var(--bg-input, rgba(0,0,0,0.03))',
                      borderRadius: 3, userSelect: 'none', listStyle: 'none',
                      display: 'inline-block', marginBottom: 4,
                    }}>
                      ▸ Vorige berichten in deze thread tonen
                    </summary>
                    <div style={{
                      marginTop: 8, paddingLeft: 10, borderLeft: '2px solid var(--border)',
                      color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.55,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                      {quotedFormatted}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <em style={{ fontSize: 12, color: 'var(--text-muted)' }}>(geen body)</em>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Score-breakdown
            </div>
            <ScoreBar
              vec={match.vector_score}
              bm25={match.bm25_score}
              recency={match.recency_score}
              combined={match.similarity}
            />
            {match.entity_path && match.entity_path.via_edge !== 'self' && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 3 }}>
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
