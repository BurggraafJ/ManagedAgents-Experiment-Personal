// RagDetailsModal — popover met top-chunks, lessons en meta voor één record.
// Roept get_record_rag_details RPC aan; toont 4 secties:
//   1. Headline-stats (chunks, build_ms, intent)
//   2. Per-source bar (visueel)
//   3. Top 5 chunks met preview, source-tag, similarity
//   4. Lessons (indien aanwezig)
//
// Sinds R09.b Modal-API (2026-05-09): rendert via base <Modal> component
// (Refactor 03/04). Eigen overlay/ESC/portal-code is weg. Consumers
// (ProposalCardCompact, RagBadge) gebruiken nog steeds dezelfde API:
//   const [open, setOpen] = useState(false)
//   {open && <RagDetailsModal recordType=… recordId=… onClose={() => setOpen(false)} />}

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Modal from './ui/Modal'
import {
  SOURCE_COLORS,
  fmtDate,
  SourceChip,
  FactChip,
  Section,
  Stat,
  TabButton,
} from './rag-details/chrome'
import OutgoingTab from './rag-details/OutgoingTab'
import AgendaCheckSection from './rag-details/AgendaCheckSection'

export default function RagDetailsModal({ recordType, recordId, onClose }) {
  const navigate = useNavigate()
  const [details, setDetails] = useState(null)
  const [outgoing, setOutgoing] = useState(null)
  const [agendaInfo, setAgendaInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('incoming')

  useEffect(() => {
    if (!recordType || !recordId) return
    let cancel = false
    setLoading(true)
    const calls = [
      supabase.rpc('get_record_rag_details', { p_record_type: recordType, p_record_id: recordId }),
      supabase.rpc('get_record_outgoing_usage', { p_record_type: recordType, p_record_id: recordId }),
    ]
    if (recordType === 'autodraft_mail') {
      calls.push(
        supabase.from('autodraft_mails')
          .select('agenda_relevance, agenda_check_result, category_key, audience, status, suggested_action')
          .eq('id', recordId)
          .maybeSingle()
      )
    }
    Promise.all(calls).then((results) => {
      if (cancel) return
      const [incRes, outRes, agendaRes] = results
      if (incRes.error) setErr(incRes.error.message)
      else setDetails(incRes.data)
      if (!outRes.error) setOutgoing(outRes.data)
      if (agendaRes && !agendaRes.error) setAgendaInfo(agendaRes.data)
      setLoading(false)
    })
    return () => { cancel = true }
  }, [recordType, recordId])

  const summary = details?.summary || {}
  const topChunks = details?.top_chunks || []
  const lessons = details?.lessons || []
  const meta = details?.retrieval_meta || {}

  const sourceCounts = []
  for (const src of ['meeting', 'mail', 'engagement', 'deal', 'company', 'contact', 'jira', 'event', 'lesson']) {
    const n = summary[`n_${src}`] || 0
    if (n > 0) sourceCounts.push({ source: src, n })
  }

  const factTypes = summary.fact_types_breakdown || {}
  const factTypeEntries = Object.entries(factTypes).sort((a, b) => b[1] - a[1])

  return (
    <Modal
      open
      onClose={onClose}
      title="RAG-zicht per record"
      size="lg"
      className="theme-maestro mcm-rag-modal"
    >
      <div style={{
        fontSize: 12,
        color: 'var(--neutral-500, #737373)',
        marginTop: -4,
        marginBottom: 12,
        fontFamily: 'var(--font-mono, "Geist", monospace)',
      }}>
        {recordType.replace('_', ' ')} · {recordId.slice(0, 8)}…
      </div>

      <div style={{
        display: 'flex',
        gap: 0,
        marginBottom: 14,
        borderBottom: '1px solid var(--border-soft, #efece5)',
      }}>
        <TabButton
          active={tab === 'incoming'}
          onClick={() => setTab('incoming')}
          label="↓ Inkomend"
          sub={summary.has_rag ? `${summary.total_chunks || 0} chunks` : 'geen RAG'}
          tone={summary.has_rag ? 'good' : 'mute'}
        />
        <TabButton
          active={tab === 'outgoing'}
          onClick={() => setTab('outgoing')}
          label="↑ Uitgaand"
          sub={outgoing ? `${outgoing.n_uses || 0}× gebruikt` : '…'}
          tone={outgoing && outgoing.n_uses > 0 ? 'good' : 'mute'}
        />
      </div>

      {loading && (
        <div style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--neutral-500, #737373)',
        }}>Laden…</div>
      )}
      {err && (
        <div style={{
          padding: 12,
          color: 'var(--error, #b3291f)',
          background: 'var(--error-subtle, #fdecec)',
          border: '1px solid #f7d8d8',
          borderRadius: 8,
          fontSize: 12.5,
        }}>Fout: {err}</div>
      )}

      {!loading && !err && tab === 'outgoing' && (
        <OutgoingTab outgoing={outgoing} recordType={recordType} />
      )}

      {!loading && !err && tab === 'incoming' && (!summary.has_rag) && (
        <div style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--neutral-500, #737373)',
          background: 'var(--paper-2, #fafaf8)',
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⊘</div>
          <strong style={{ color: 'var(--ink, #121212)' }}>Geen RAG-context gebruikt voor dit record.</strong>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            De skill heeft geen <code>context-build</code>-call gedaan, of de bundle is niet gekoppeld via <code>trigger_ref_id</code>.
          </div>
        </div>
      )}

      {!loading && !err && tab === 'incoming' && agendaInfo && (
        <AgendaCheckSection agendaInfo={agendaInfo} />
      )}

      {!loading && !err && tab === 'incoming' && summary.has_rag && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginBottom: 16,
            padding: '12px 14px',
            background: 'var(--paper-2, #fafaf8)',
            border: '1px solid var(--border-soft, #efece5)',
            borderRadius: 10,
          }}>
            <Stat label="Chunks" value={summary.total_chunks || 0} />
            <Stat label="Build" value={summary.build_ms ? `${summary.build_ms}ms` : '—'} />
            <Stat label="Top sim" value={summary.avg_top_similarity ? Number(summary.avg_top_similarity).toFixed(2) : '—'} />
            <Stat label="Bron" value={summary.rag_source === 'legacy_prefill' ? 'legacy' : 'bundle'} sub={summary.reranked ? '· reranked' : ''} />
          </div>

          {(meta.filter_audience || meta.filter_meeting_category) && (
            <div style={{
              marginBottom: 16,
              fontSize: 11,
              color: 'var(--neutral-500, #737373)',
              fontFamily: 'var(--font-mono, "Geist", monospace)',
            }}>
              <strong style={{ color: 'var(--ink, #121212)' }}>Filter:</strong>
              {meta.filter_audience && <> audience={JSON.stringify(meta.filter_audience)}</>}
              {meta.filter_meeting_category && <> · meeting_category={JSON.stringify(meta.filter_meeting_category)}</>}
            </div>
          )}

          {sourceCounts.length > 0 && (
            <Section title="Per bron">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {sourceCounts.map(({ source, n }) => <SourceChip key={source} source={source} n={n} />)}
              </div>
            </Section>
          )}

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
                      display: 'inline-block',
                      padding: '1px 7px',
                      marginRight: 4,
                      background: 'var(--orange-subtle, #f9e5dd)',
                      color: 'var(--orange-deep, #8b4628)',
                      border: '1px solid #f0d4c5',
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 500,
                    }}>{c}</span>
                  ))}
                </div>
              )}
              {factTypeEntries.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  Feit-types:{' '}
                  {factTypeEntries.map(([t, n]) => (
                    <span key={t} style={{ marginRight: 6 }}>
                      <FactChip type={t} /> <span style={{
                        fontSize: 11,
                        color: 'var(--neutral-500, #737373)',
                        fontFamily: 'var(--font-mono, "Geist", monospace)',
                      }}>{n}</span>
                    </span>
                  ))}
                </div>
              )}
            </Section>
          )}

          {topChunks.length > 0 && (
            <Section title={`Top ${topChunks.length} chunks`}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {topChunks.map((c, i) => (
                  <div key={i} style={{
                    padding: '10px 12px',
                    background: 'var(--paper, #fff)',
                    border: '1px solid var(--border-soft, #efece5)',
                    borderLeft: '3px solid ' + (SOURCE_COLORS[c.source]?.fg || 'var(--neutral-400, #a6a6a6)'),
                    borderRadius: 10,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11 }}>
                      <span style={{
                        fontWeight: 600,
                        color: 'var(--ink, #121212)',
                        fontFamily: 'var(--font-mono, "Geist", monospace)',
                      }}>{i + 1}.</span>
                      <SourceChip source={c.source} n={c.chunk_type || ''} />
                      {c.fact_type && <FactChip type={c.fact_type} />}
                      {c.topic_title && <span style={{ color: 'var(--neutral-500, #737373)' }}>· {c.topic_title}</span>}
                      {c.speaker && <span style={{ color: 'var(--neutral-500, #737373)' }}>· {c.speaker}</span>}
                      <span style={{
                        marginLeft: 'auto',
                        color: 'var(--neutral-400, #a6a6a6)',
                        fontSize: 10,
                        fontFamily: 'var(--font-mono, "Geist", monospace)',
                      }}>
                        sim {c.similarity || '?'} · {fmtDate(c.occurred_at)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 12.5,
                      color: 'var(--neutral-700, #404040)',
                      lineHeight: 1.5,
                    }}>
                      {c.preview || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {Array.isArray(lessons) && lessons.length > 0 && (
            <Section title={`JelleMind-lessons (${lessons.length})`}>
              {lessons.map((l, i) => (
                <div key={i} style={{
                  padding: '10px 12px',
                  background: 'linear-gradient(180deg, #fff7f1, #fef0e6)',
                  border: '1px solid #f1d6c0',
                  borderLeft: '3px solid var(--orange, #dc6f3f)',
                  borderRadius: 10,
                  marginBottom: 6,
                }}>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--orange-deep, #8b4628)',
                    fontWeight: 600,
                    marginBottom: 4,
                    fontFamily: 'var(--font-mono, "Geist", monospace)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    📚 {l.mind_scope || 'lesson'} · sim {Number(l.similarity || 0).toFixed(2)}
                  </div>
                  <div style={{
                    fontSize: 12.5,
                    color: 'var(--neutral-700, #404040)',
                    lineHeight: 1.5,
                  }}>{l.lesson_text || l.text || '—'}</div>
                </div>
              ))}
            </Section>
          )}

          <div style={{
            marginTop: 16,
            paddingTop: 12,
            borderTop: '1px solid var(--border-soft, #efece5)',
            fontSize: 11,
            color: 'var(--neutral-500, #737373)',
            fontFamily: 'var(--font-mono, "Geist", monospace)',
          }}>
            {details?.bundle_id && <>bundle_id: <code>{details.bundle_id.slice(0, 8)}…</code> · </>}
            <a
              href="/zoeken"
              onClick={(e) => { e.preventDefault(); onClose(); navigate('/zoeken') }}
              style={{
                color: 'var(--orange-deep, #8b4628)',
                textDecoration: 'underline',
                fontWeight: 500,
              }}
            >Open RagSearchView →</a>
          </div>
        </>
      )}
    </Modal>
  )
}
