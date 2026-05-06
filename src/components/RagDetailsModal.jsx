// =============================================================================
// RagDetailsModal — popover met top-chunks, lessons en meta voor één record
// =============================================================================
// Roept get_record_rag_details RPC aan; toont 4 secties:
//   1. Headline-stats (chunks, build_ms, intent)
//   2. Per-source bar (visueel)
//   3. Top 5 chunks met preview, source-tag, similarity
//   4. Lessons (indien aanwezig)
// =============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SOURCE_COLORS = {
  meeting:    { bg: '#fef3c7', fg: '#92400e' },
  mail:       { bg: '#dbeafe', fg: '#1e40af' },
  engagement: { bg: '#e9d5ff', fg: '#6b21a8' },
  deal:       { bg: '#bbf7d0', fg: '#166534' },
  company:    { bg: '#fce7f3', fg: '#9f1239' },
  contact:    { bg: '#fce7f3', fg: '#9f1239' },
  jira:       { bg: '#dbeafe', fg: '#1e40af' },
  event:      { bg: '#fed7aa', fg: '#9a3412' },
  lesson:     { bg: '#cffafe', fg: '#155e75' },
}

const SOURCE_ICONS = {
  meeting: '🦟', mail: '✉', engagement: '📝', deal: '💼',
  company: '🏢', contact: '👤', jira: '🎫', event: '📅', lesson: '📚',
}

const FACT_TYPE_COLORS = {
  decision:    { bg: '#fef3c7', fg: '#92400e' },
  commitment:  { bg: '#dcfce7', fg: '#166534' },
  date:        { bg: '#dbeafe', fg: '#1e40af' },
  price:       { bg: '#fce7f3', fg: '#9f1239' },
  agreement:   { bg: '#dcfce7', fg: '#166534' },
  objection:   { bg: '#fee2e2', fg: '#991b1b' },
  rejection:   { bg: '#fee2e2', fg: '#991b1b' },
  risk:        { bg: '#fed7aa', fg: '#9a3412' },
  name:        { bg: '#f3f4f6', fg: '#374151' },
  question:    { bg: '#e0e7ff', fg: '#3730a3' },
  question_followup: { bg: '#e0e7ff', fg: '#3730a3' },
}

function fmtDate(d) {
  if (!d) return '?'
  try {
    return new Date(d).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })
  } catch { return d }
}

function SourceChip({ source, n }) {
  const c = SOURCE_COLORS[source] || { bg: '#f3f4f6', fg: '#374151' }
  const icon = SOURCE_ICONS[source] || '•'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg,
    }}>
      <span>{icon}</span> {source} <span style={{ opacity: 0.6 }}>· {n}</span>
    </span>
  )
}

function FactChip({ type }) {
  const c = FACT_TYPE_COLORS[type] || { bg: '#f3f4f6', fg: '#374151' }
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, background: c.bg, color: c.fg,
    }}>{type}</span>
  )
}

export default function RagDetailsModal({ recordType, recordId, onClose }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!recordType || !recordId) return
    let cancel = false
    setLoading(true)
    supabase
      .rpc('get_record_rag_details', { p_record_type: recordType, p_record_id: recordId })
      .then(({ data, error }) => {
        if (cancel) return
        if (error) setErr(error.message)
        else setDetails(data)
        setLoading(false)
      })
    return () => { cancel = true }
  }, [recordType, recordId])

  // Esc-key sluit modal
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const summary = details?.summary || {}
  const topChunks = details?.top_chunks || []
  const lessons = details?.lessons || []
  const meta = details?.retrieval_meta || {}

  // Per-source counts
  const sourceCounts = []
  for (const src of ['meeting', 'mail', 'engagement', 'deal', 'company', 'contact', 'jira', 'event', 'lesson']) {
    const n = summary[`n_${src}`] || 0
    if (n > 0) sourceCounts.push({ source: src, n })
  }

  const factTypes = summary.fact_types_breakdown || {}
  const factTypeEntries = Object.entries(factTypes).sort((a, b) => b[1] - a[1])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%',
          maxHeight: '85vh', overflow: 'auto', padding: 20,
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>RAG-context</h3>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              {recordType.replace('_', ' ')} · intent: <strong>{summary.intent || '—'}</strong>
              {summary.rag_built_at && <> · gebouwd op {fmtDate(summary.rag_built_at)}</>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent', border: 0, fontSize: 22, cursor: 'pointer',
              color: '#6b7280', padding: 0, lineHeight: 1,
            }}
            aria-label="Sluiten"
          >×</button>
        </div>

        {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>Laden…</div>}
        {err && <div style={{ padding: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 6 }}>Fout: {err}</div>}

        {!loading && !err && (!summary.has_rag) && (
          <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⊘</div>
            <strong>Geen RAG-context gebruikt voor dit record.</strong>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              De skill heeft geen <code>context-build</code>-call gedaan, of de bundle is niet gekoppeld via <code>trigger_ref_id</code>.
            </div>
          </div>
        )}

        {!loading && !err && summary.has_rag && (
          <>
            {/* Headline stats */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
              marginBottom: 16, padding: '10px 12px',
              background: '#f9fafb', borderRadius: 8,
            }}>
              <Stat label="Chunks" value={summary.total_chunks || 0} />
              <Stat label="Build" value={summary.build_ms ? `${summary.build_ms}ms` : '—'} />
              <Stat label="Top sim" value={summary.avg_top_similarity ? Number(summary.avg_top_similarity).toFixed(2) : '—'} />
              <Stat label="Bron" value={summary.rag_source === 'legacy_prefill' ? 'legacy' : 'bundle'} sub={summary.reranked ? '· reranked' : ''} />
            </div>

            {/* Filters van het recept */}
            {(meta.filter_audience || meta.filter_meeting_category) && (
              <div style={{ marginBottom: 16, fontSize: 11, color: '#6b7280' }}>
                <strong>Filter:</strong>
                {meta.filter_audience && <> audience={JSON.stringify(meta.filter_audience)}</>}
                {meta.filter_meeting_category && <> · meeting_category={JSON.stringify(meta.filter_meeting_category)}</>}
              </div>
            )}

            {/* Per source */}
            {sourceCounts.length > 0 && (
              <Section title="Per bron">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sourceCounts.map(({ source, n }) => <SourceChip key={source} source={source} n={n} />)}
                </div>
              </Section>
            )}

            {/* Meeting-laag breakdown */}
            {summary.has_fireflies && (
              <Section title="Fireflies-laag">
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  <span><strong>{summary.n_meeting_macro || 0}</strong> macro</span>
                  <span><strong>{summary.n_meeting_topic || 0}</strong> topic</span>
                  <span><strong>{summary.n_meeting_salient || 0}</strong> salient</span>
                </div>
                {summary.meeting_categories && summary.meeting_categories.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Categorieën: {summary.meeting_categories.map((c, i) => (
                      <span key={i} style={{
                        display: 'inline-block', padding: '1px 6px', marginRight: 4,
                        background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: 11,
                      }}>{c}</span>
                    ))}
                  </div>
                )}
                {factTypeEntries.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Feit-types:{' '}
                    {factTypeEntries.map(([t, n]) => (
                      <span key={t} style={{ marginRight: 6 }}>
                        <FactChip type={t} /> <span style={{ fontSize: 11, color: '#6b7280' }}>{n}</span>
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Top chunks */}
            {topChunks.length > 0 && (
              <Section title={`Top ${topChunks.length} chunks`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {topChunks.map((c, i) => (
                    <div key={i} style={{
                      padding: 8, background: '#fafafa', borderRadius: 6,
                      borderLeft: '3px solid ' + (SOURCE_COLORS[c.source]?.fg || '#9ca3af'),
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11 }}>
                        <span style={{ fontWeight: 700 }}>{i + 1}.</span>
                        <SourceChip source={c.source} n={c.chunk_type || ''} />
                        {c.fact_type && <FactChip type={c.fact_type} />}
                        {c.topic_title && <span style={{ color: '#6b7280' }}>· {c.topic_title}</span>}
                        {c.speaker && <span style={{ color: '#6b7280' }}>· {c.speaker}</span>}
                        <span style={{ marginLeft: 'auto', color: '#9ca3af', fontSize: 10 }}>
                          sim {c.similarity || '?'} · {fmtDate(c.occurred_at)}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
                        {c.preview || '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Lessons */}
            {Array.isArray(lessons) && lessons.length > 0 && (
              <Section title={`JelleMind-lessons (${lessons.length})`}>
                {lessons.map((l, i) => (
                  <div key={i} style={{
                    padding: 8, background: '#cffafe', borderRadius: 6, marginBottom: 6,
                    borderLeft: '3px solid #155e75',
                  }}>
                    <div style={{ fontSize: 10, color: '#155e75', fontWeight: 700, marginBottom: 4 }}>
                      📚 {l.mind_scope || 'lesson'} · sim {Number(l.similarity || 0).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 12 }}>{l.lesson_text || l.text || '—'}</div>
                  </div>
                ))}
              </Section>
            )}

            {/* Footer-link */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e7eb', fontSize: 11, color: '#6b7280' }}>
              {details?.bundle_id && <>bundle_id: <code>{details.bundle_id.slice(0, 8)}…</code> · </>}
              <a href="#/zoeken" onClick={(e) => { e.preventDefault(); window.location.hash = '#/zoeken'; onClose() }} style={{ color: '#2563eb' }}>Open RagSearchView →</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 8px 0', fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </h4>
      {children}
    </div>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label} {sub && <span style={{ opacity: 0.7 }}>{sub}</span>}
      </div>
    </div>
  )
}
