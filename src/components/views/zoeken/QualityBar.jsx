import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { SOURCE_LABEL } from '../../../lib/rag'

export default function QualityBar({ result, feedbackCount }) {
  const sources = useMemo(() => {
    const counts = {}
    for (const m of result.matches || []) counts[m.source] = (counts[m.source] || 0) + 1
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }, [result])

  const reranked = result.reranked
  const strategy = result.retrieval_strategy
  const entityUsed = result.entity_used

  return (
    <div className="card" style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
            {result.match_count > 0 ? `${result.match_count} resultaten` : 'Geen resultaten'}
          </h2>
          {sources.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sources.map(([s, n]) => (
                <span key={s} style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 3,
                  background: 'var(--bg-input, rgba(0,0,0,0.04))',
                  color: 'var(--text-muted)', border: '1px solid var(--border)',
                }}>
                  {SOURCE_LABEL[s] || s} <strong style={{ color: 'var(--text)' }}>{n}</strong>
                </span>
              ))}
            </div>
          )}
        </div>
        <Link to="/intelligence/quality" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Quality dashboard →
        </Link>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'baseline' }}>
        <span><strong>strategy</strong> <code>{strategy}</code></span>
        {entityUsed && (
          <span>
            <strong>entity</strong> {entityUsed.entity_type}/{entityUsed.entity_id}
            <span style={{ marginLeft: 4, fontStyle: 'italic' }}>(via {entityUsed.via})</span>
          </span>
        )}
        {reranked && <span style={{ color: '#22c55e' }}><strong>✦ reranked</strong></span>}
        <span><strong>tokens</strong> {result.tokens_used}</span>
        <span><strong>embed</strong> {result.timing_ms?.embed}ms</span>
        <span><strong>search</strong> {result.timing_ms?.search}ms</span>
        {result.timing_ms?.rerank > 0 && <span><strong>rerank</strong> {result.timing_ms.rerank}ms</span>}
        {feedbackCount > 0 && (
          <span style={{ color: '#22c55e' }}><strong>{feedbackCount}</strong> feedback gegeven</span>
        )}
        {result.bundle_id && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
            bundle {result.bundle_id.slice(0, 8)}…
          </span>
        )}
      </div>
    </div>
  )
}
