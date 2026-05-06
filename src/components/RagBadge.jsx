// =============================================================================
// RagBadge — kleine klikbare indicator per record (mail/voorstel)
// =============================================================================
// Toont per record of er RAG-context is gebruikt en welke breedte/diepte.
// Klik opent <RagDetailsModal>.
//
// Twee gebruiks-modi:
//   1. <RagBadge summary={summaryRow} />   — wanneer parent al view-data heeft
//   2. <RagBadge recordType="..." recordId="..." />  — single-record fetch
//
// Vier states:
//   ✓  groen   — RAG via context_bundle (nieuwe pijplijn, volledig zichtbaar)
//   ✓  blauw   — RAG via legacy_prefill (oude autodraft-rag-prefill route)
//   ⊘  grijs   — geen RAG-context
//   ⚠  geel    — bundle gevonden maar warning (low similarity, slow build)
// =============================================================================

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import RagDetailsModal from './RagDetailsModal'

const PILL_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
}

const STATES = {
  bundle:  { bg: '#dcfce7', fg: '#166534', border: '#86efac', icon: '✓', label: 'RAG' },
  legacy:  { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd', icon: '✓', label: 'RAG' },
  warning: { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d', icon: '⚠', label: 'RAG' },
  none:    { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb', icon: '⊘', label: 'geen' },
}

export default function RagBadge({ summary, recordType, recordId, compact = false }) {
  const [data, setData] = useState(summary || null)
  const [loading, setLoading] = useState(!summary && !!recordId)
  const [modalOpen, setModalOpen] = useState(false)

  // Single-record fetch wanneer geen summary prop
  useEffect(() => {
    if (summary) { setData(summary); return }
    if (!recordId || !recordType) return
    let cancel = false
    setLoading(true)
    supabase
      .from('v_record_rag_summary')
      .select('*')
      .eq('record_type', recordType)
      .eq('record_id', recordId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (!cancel) {
          setData(row || null)
          setLoading(false)
        }
      })
    return () => { cancel = true }
  }, [summary, recordType, recordId])

  // Bepaal state
  const stateKey = (() => {
    if (!data) return 'none'
    if (!data.has_rag) return 'none'
    if (data.rag_source === 'legacy_prefill') return 'legacy'
    // Warning als build_ms > 5s of avg_top_similarity < 0.4
    if (data.build_ms && data.build_ms > 5000) return 'warning'
    if (data.avg_top_similarity && Number(data.avg_top_similarity) < 0.4) return 'warning'
    return 'bundle'
  })()
  const state = STATES[stateKey]

  // Tooltip met breakdown
  const tooltip = (() => {
    if (!data || !data.has_rag) return 'Geen RAG-context gebruikt'
    const parts = []
    if (data.total_chunks) parts.push(`${data.total_chunks} chunks`)
    const sourceParts = []
    if (data.n_meeting > 0)    sourceParts.push(`🦟${data.n_meeting} meeting`)
    if (data.n_mail > 0)       sourceParts.push(`✉${data.n_mail} mail`)
    if (data.n_engagement > 0) sourceParts.push(`📝${data.n_engagement} engagement`)
    if (data.n_deal > 0)       sourceParts.push(`💼${data.n_deal} deal`)
    if (data.n_lesson > 0)     sourceParts.push(`📚${data.n_lesson} lesson`)
    if (sourceParts.length) parts.push(sourceParts.join(' · '))
    if (data.has_fireflies) parts.push('Fireflies ✓')
    if (data.rag_source === 'legacy_prefill') parts.push('(legacy prefill)')
    if (data.build_ms) parts.push(`${data.build_ms}ms`)
    return parts.join(' — ')
  })()

  const handleClick = useCallback((e) => {
    e.stopPropagation()
    if (data && data.has_rag) setModalOpen(true)
  }, [data])

  if (loading) {
    return (
      <span style={{ ...PILL_BASE, ...{ bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }, opacity: 0.5 }}>
        …
      </span>
    )
  }

  // Compacte versie: alleen icoon + counter
  if (compact) {
    const hasContent = data?.has_rag
    const counterText = hasContent
      ? (data.has_fireflies ? `🦟${data.n_meeting}` : `${data.total_chunks}`)
      : ''
    return (
      <>
        <span
          style={{
            ...PILL_BASE,
            background: state.bg, color: state.fg, borderColor: state.border,
            cursor: hasContent ? 'pointer' : 'default',
            opacity: hasContent ? 1 : 0.6,
            padding: '2px 6px', fontSize: 10,
          }}
          title={tooltip}
          onClick={handleClick}
        >
          {state.icon}
          {counterText && <span style={{ fontSize: 10, fontWeight: 700 }}>{counterText}</span>}
        </span>
        {modalOpen && (
          <RagDetailsModal
            recordType={data?.record_type || recordType}
            recordId={data?.record_id || recordId}
            onClose={() => setModalOpen(false)}
          />
        )}
      </>
    )
  }

  // Volle versie met label + breakdown-chips
  return (
    <>
      <span
        style={{
          ...PILL_BASE,
          background: state.bg, color: state.fg, borderColor: state.border,
          cursor: data?.has_rag ? 'pointer' : 'default',
          opacity: data?.has_rag ? 1 : 0.7,
        }}
        title={tooltip}
        onClick={handleClick}
      >
        <span style={{ fontSize: 12 }}>{state.icon}</span>
        <span>{state.label}</span>
        {data?.has_rag && data.total_chunks > 0 && (
          <span style={{ opacity: 0.7, fontSize: 10 }}>· {data.total_chunks}</span>
        )}
        {data?.has_fireflies && (
          <span style={{ marginLeft: 2 }} title="Fireflies meeting-context">🦟</span>
        )}
        {data?.n_lessons > 0 && (
          <span style={{ marginLeft: 2 }} title={`${data.n_lessons} JelleMind-lesson(s)`}>📚</span>
        )}
      </span>
      {modalOpen && (
        <RagDetailsModal
          recordType={data?.record_type || recordType}
          recordId={data?.record_id || recordId}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}
