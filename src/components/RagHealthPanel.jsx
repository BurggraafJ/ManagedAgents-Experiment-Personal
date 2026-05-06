// =============================================================================
// RagHealthPanel — wekelijkse RAG-coverage telemetrie
// =============================================================================
// Toont per week per record_type: % met RAG, Fireflies-coverage,
// lessons-coverage, build-tijd P50/P95, route (bundle vs legacy).
//
// Lichtgewicht component, herbruikbaar in IntelligenceQualityView,
// AutoDraftView header, of waar Jelle health-trend wil zien.
// =============================================================================

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function fmtWeek(weekStartIso) {
  if (!weekStartIso) return '?'
  const d = new Date(weekStartIso)
  // ISO-week-nr berekenen
  const target = new Date(d.valueOf())
  const dayNr = (d.getUTCDay() + 6) % 7
  target.setUTCDate(target.getUTCDate() - dayNr + 3)
  const firstThursday = target.valueOf()
  target.setUTCMonth(0, 1)
  if (target.getUTCDay() !== 4) target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7)
  const week = 1 + Math.ceil((firstThursday - target) / 604800000)
  return `Wk ${week}`
}

function Cell({ label, value, sub, tone }) {
  const colors = {
    good:    { bg: 'var(--success-soft, #dcfce7)', fg: 'var(--success, #166534)' },
    mid:     { bg: 'var(--accent-soft, #dbeafe)',  fg: 'var(--accent, #1e40af)' },
    warn:    { bg: 'var(--warning-soft, #fef3c7)', fg: 'var(--warning, #92400e)' },
    neutral: { bg: 'var(--bg-soft, #f9fafb)',      fg: 'var(--text)' },
  }
  const c = colors[tone || 'neutral']
  return (
    <div style={{ padding: '8px 10px', background: c.bg, borderRadius: 6, minWidth: 88 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: c.fg }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: 11, color: c.fg, opacity: 0.8, marginTop: 1 }}>{sub}</div>}
    </div>
  )
}

export default function RagHealthPanel({ recordType = 'autodraft_mail', weeks = 4, compact = false }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancel = false
    setLoading(true)
    supabase
      .from('v_rag_health_weekly')
      .select('*')
      .eq('record_type', recordType)
      .order('week_start', { ascending: false })
      .limit(weeks)
      .then(({ data, error }) => {
        if (cancel) return
        if (error) console.warn('[RagHealthPanel]', error)
        setRows(data || [])
        setLoading(false)
      })
    return () => { cancel = true }
  }, [recordType, weeks])

  if (loading) return null
  if (!rows.length) return null

  const cur = rows[0]
  const prev = rows[1]

  // Trend-pijlen
  const trend = (curVal, prevVal) => {
    if (prevVal == null || curVal == null) return ''
    const d = Number(curVal) - Number(prevVal)
    if (Math.abs(d) < 0.5) return ''
    return d > 0 ? `▲${d.toFixed(0)}` : `▼${Math.abs(d).toFixed(0)}`
  }

  const ragPctTone = cur.with_rag_pct >= 75 ? 'good' : cur.with_rag_pct >= 40 ? 'mid' : 'warn'
  const ffPctTone = cur.with_fireflies_pct >= 20 ? 'good' : cur.with_fireflies_pct >= 5 ? 'mid' : 'warn'
  const buildTone = cur.p95_build_ms && cur.p95_build_ms > 5000 ? 'warn' : 'good'

  if (compact) {
    return (
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: '6px 10px', background: 'var(--bg-soft, #f9fafb)', borderRadius: 6,
        fontSize: 11, color: 'var(--text-muted)',
      }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>RAG-health · {fmtWeek(cur.week_start)}</span>
        <span><strong>{cur.with_rag_pct ?? 0}%</strong> coverage</span>
        <span>{cur.with_fireflies_pct ?? 0}% met Fireflies</span>
        <span>{cur.with_lessons_pct ?? 0}% met lessons</span>
        <span>P95 {cur.p95_build_ms ? Math.round(cur.p95_build_ms) + 'ms' : '–'}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
          {cur.via_context_bundle} bundle · {cur.via_legacy_prefill} legacy
        </span>
      </div>
    )
  }

  return (
    <div style={{
      padding: 12, border: '1px solid var(--border)', borderRadius: 8,
      background: 'var(--bg)', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
          Intelligence Health · {recordType === 'autodraft_mail' ? 'Mail-drafts' : 'Voorstellen'}
        </h4>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {fmtWeek(cur.week_start)} · {cur.total_records} records
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Cell
          label="RAG-coverage"
          value={`${cur.with_rag_pct ?? 0}%`}
          sub={prev ? `${trend(cur.with_rag_pct, prev.with_rag_pct)} vs vorige wk` : null}
          tone={ragPctTone}
        />
        <Cell
          label="Fireflies"
          value={`${cur.with_fireflies_pct ?? 0}%`}
          sub={`${cur.with_fireflies_count ?? 0} van ${cur.with_rag_count ?? 0}`}
          tone={ffPctTone}
        />
        <Cell
          label="Lessons"
          value={`${cur.with_lessons_pct ?? 0}%`}
          sub={`${cur.with_lessons_count ?? 0} records`}
          tone="neutral"
        />
        <Cell
          label="Avg chunks"
          value={cur.avg_chunks_per_record ? Number(cur.avg_chunks_per_record).toFixed(1) : '–'}
          tone="neutral"
        />
        <Cell
          label="Build P50"
          value={cur.p50_build_ms ? `${Math.round(cur.p50_build_ms)}ms` : '–'}
          tone="neutral"
        />
        <Cell
          label="Build P95"
          value={cur.p95_build_ms ? `${Math.round(cur.p95_build_ms)}ms` : '–'}
          tone={buildTone}
        />
        <Cell
          label="Via bundle"
          value={cur.via_context_bundle ?? 0}
          sub={`legacy: ${cur.via_legacy_prefill ?? 0}`}
          tone={cur.via_context_bundle > cur.via_legacy_prefill ? 'good' : 'mid'}
        />
      </div>
      {/* Mini-trend per week */}
      {rows.length > 1 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          Voorgaande weken:{' '}
          {rows.slice(1).map((r, i) => (
            <span key={i} style={{ marginRight: 10 }}>
              {fmtWeek(r.week_start)}: <strong>{r.with_rag_pct ?? 0}%</strong>
              {r.with_fireflies_pct != null && <> · 🦟 {r.with_fireflies_pct}%</>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
