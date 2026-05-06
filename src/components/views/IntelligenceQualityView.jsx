import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import RagHealthPanel from '../RagHealthPanel'

// =====================================================================
// IntelligenceQualityView — R.7 deep quality-analyse
// =====================================================================
// Uitgebreide rag_outcomes analyse: acceptance-rate per chunk_type, per
// source, per retrieval-strategy, recente timeline. Empty-state-friendly
// voor wanneer er nog weinig data is.
// =====================================================================

const SOURCE_LABELS = {
  mail: 'Mail', engagement: 'Engagement', jira: 'Jira',
  deal: 'Deal', company: 'Company', contact: 'Contact',
  meeting: 'Meeting', event: 'Event', lesson: 'Lesson',
}

const OUTCOME_COLORS = {
  accept: '#22c55e',
  amend:  '#f59e0b',
  reject: '#94a3b8',
  pending: 'var(--text-muted)',
  timeout: '#ef4444',
  error: '#ef4444',
}

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  const day = Math.floor(hr / 24)
  return `${day}d`
}

function pct(n, d) {
  if (!d) return '–'
  return `${((n / d) * 100).toFixed(1)}%`
}

function Bar({ accept, amend, reject, total }) {
  if (!total) return <div style={{ height: 6, background: 'var(--border)', borderRadius: 3 }} />
  const pa = (accept / total) * 100
  const pm = (amend / total) * 100
  const pr = (reject / total) * 100
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--border)' }}>
      <div style={{ width: `${pa}%`, background: OUTCOME_COLORS.accept }} title={`Accept: ${accept}`} />
      <div style={{ width: `${pm}%`, background: OUTCOME_COLORS.amend }} title={`Amend: ${amend}`} />
      <div style={{ width: `${pr}%`, background: OUTCOME_COLORS.reject }} title={`Reject: ${reject}`} />
    </div>
  )
}

function StatRow({ label, accept, amend, reject, total, sub }) {
  return (
    <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
          {sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {pct(accept, total)} <span style={{ fontSize: 11 }}>({total})</span>
        </div>
      </div>
      <Bar accept={accept} amend={amend} reject={reject} total={total} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 12 }}>
        <span style={{ color: OUTCOME_COLORS.accept }}>● accept {accept}</span>
        <span style={{ color: OUTCOME_COLORS.amend }}>● amend {amend}</span>
        <span style={{ color: OUTCOME_COLORS.reject }}>● reject {reject}</span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card" style={{ padding: 'var(--s-7)', textAlign: 'center', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>Nog te weinig data voor diepe analyse</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
        De <code>rag_outcomes</code> tabel vult zich automatisch zodra je drafts gaat
        beoordelen — de DB-trigger op <code>autodraft_decisions</code> logt elke
        send/amend/ignore actie met de chunks die in de RAG-context zaten. Sales-followups,
        daily-admin en sales-on-road loggen via expliciete <code>log_rag_outcome</code>-calls.
      </div>
      <Link to="/intelligence" style={{ marginTop: 16, display: 'inline-block', fontSize: 12 }}>
        ← Terug naar Intelligence Hub
      </Link>
    </div>
  )
}

export default function IntelligenceQualityView() {
  const [outcomes, setOutcomes] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('rag_outcomes')
        .select('id, source_type, decision_action, chunks_used, total_chunks, avg_top_similarity, retrieval_strategy, retrieval_params, outcome, outcome_at, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw new Error(err.message)
      setOutcomes(data || [])
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Aggregations
  const stats = useMemo(() => {
    if (!outcomes || outcomes.length === 0) return null

    const finalized = outcomes.filter(o => ['accept','amend','reject'].includes(o.outcome))

    // By source_type (skill)
    const bySource = {}
    for (const o of finalized) {
      const k = o.source_type || 'unknown'
      bySource[k] = bySource[k] || { total: 0, accept: 0, amend: 0, reject: 0 }
      bySource[k].total++
      bySource[k][o.outcome]++
    }

    // By retrieval-strategy
    const byStrategy = {}
    for (const o of finalized) {
      const k = o.retrieval_strategy || 'unknown'
      byStrategy[k] = byStrategy[k] || { total: 0, accept: 0, amend: 0, reject: 0 }
      byStrategy[k].total++
      byStrategy[k][o.outcome]++
    }

    // By chunk source-type — flatten chunks_used per outcome
    const byChunkSource = {}
    for (const o of finalized) {
      const chunks = Array.isArray(o.chunks_used) ? o.chunks_used : []
      for (const c of chunks) {
        const k = c.source || 'unknown'
        byChunkSource[k] = byChunkSource[k] || { total: 0, accept: 0, amend: 0, reject: 0 }
        byChunkSource[k].total++
        byChunkSource[k][o.outcome]++
      }
    }

    // Avg top similarity by outcome
    const simByOutcome = {}
    for (const o of finalized) {
      const k = o.outcome
      simByOutcome[k] = simByOutcome[k] || { sum: 0, n: 0 }
      if (o.avg_top_similarity != null) {
        simByOutcome[k].sum += Number(o.avg_top_similarity)
        simByOutcome[k].n++
      }
    }

    return {
      total: outcomes.length,
      finalized: finalized.length,
      pending: outcomes.length - finalized.length,
      bySource: Object.entries(bySource).sort((a,b) => b[1].total - a[1].total),
      byStrategy: Object.entries(byStrategy).sort((a,b) => b[1].total - a[1].total),
      byChunkSource: Object.entries(byChunkSource).sort((a,b) => b[1].total - a[1].total),
      simByOutcome,
      recent: outcomes.slice(0, 50),
    }
  }, [outcomes])

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Link to="/intelligence" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            ← Intelligence Hub
          </Link>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 0' }}>Quality — RAG outcomes</h1>
        </div>
        <button className="btn" onClick={load} disabled={refreshing}>
          {refreshing ? 'Laden…' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '3px solid #ef4444', color: '#ef4444', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      {/* Coverage-paneel: hoeveel records hebben überhaupt RAG-context? */}
      <RagHealthPanel recordType="autodraft_mail" weeks={4} />
      <RagHealthPanel recordType="agent_proposal" weeks={4} />

      {!outcomes ? (
        <div className="card" style={{ padding: 'var(--s-5)', color: 'var(--text-muted)' }}>laden…</div>
      ) : stats === null || stats.finalized === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Top stats */}
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Samenvatting</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              <Stat label="Total" value={stats.total} />
              <Stat label="Finalized" value={stats.finalized} />
              <Stat label="Pending" value={stats.pending} />
              {Object.entries(stats.simByOutcome).map(([oc, v]) => (
                <Stat
                  key={oc}
                  label={`Top-sim ${oc}`}
                  value={v.n > 0 ? (v.sum / v.n).toFixed(3) : '–'}
                  color={OUTCOME_COLORS[oc]}
                />
              ))}
            </div>
          </section>

          {/* By skill */}
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Per skill (source_type)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
              {stats.bySource.map(([k, v]) => (
                <StatRow key={k} label={k} {...v} />
              ))}
            </div>
          </section>

          {/* By retrieval-strategy */}
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Per retrieval-strategie</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
              {stats.byStrategy.map(([k, v]) => (
                <StatRow key={k} label={k} {...v} sub="match_chunks vs match_chunks_for_entity vergelijking" />
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'var(--s-3)', lineHeight: 1.5 }}>
              <strong>Hypothese</strong>: <code>match_chunks_for_entity</code> zou een hogere
              acceptance-rate moeten geven dan plain <code>match_chunks</code> — entity-aware
              context is per definitie gericht. Wacht totdat per strategy ≥10 finalized outcomes
              zijn voor een betekenisvolle vergelijking.
            </div>
          </section>

          {/* By chunk source */}
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Per chunk-source</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 'var(--s-3)' }}>
              Hoe vaak een chunk uit elke source-type in een geaccepteerde / ge-amendde / verworpen
              draft is geland. Lage acceptance per source = signaal dat die chunking-strategie
              tuning nodig heeft.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {stats.byChunkSource.map(([k, v]) => (
                <StatRow key={k} label={SOURCE_LABELS[k] || k} {...v} />
              ))}
            </div>
          </section>

          {/* Recent timeline */}
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Laatste 50 outcomes</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {stats.recent.map((o) => {
                const oc = o.outcome || 'pending'
                return (
                  <div key={o.id} style={{
                    display: 'flex', alignItems: 'baseline', gap: 10,
                    padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 12,
                  }}>
                    <span style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: 3,
                      background: OUTCOME_COLORS[oc], marginTop: 2,
                    }} />
                    <span style={{ minWidth: 70, fontWeight: 500 }}>{oc}</span>
                    <span style={{ minWidth: 110, color: 'var(--text-muted)' }}>{o.source_type}</span>
                    <span style={{ minWidth: 70, color: 'var(--text-muted)' }}>{o.decision_action}</span>
                    <span style={{ minWidth: 60, fontFamily: 'var(--font-mono)' }}>
                      {o.total_chunks ?? '–'} chunks
                    </span>
                    <span style={{ minWidth: 60, fontFamily: 'var(--font-mono)' }}>
                      {o.avg_top_similarity != null ? Number(o.avg_top_similarity).toFixed(3) : '–'}
                    </span>
                    <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.retrieval_strategy}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {relTime(o.outcome_at || o.created_at)}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{
      padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', fontWeight: 600, color: color || 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}
