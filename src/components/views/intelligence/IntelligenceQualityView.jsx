import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { OUTCOME_COLORS, SOURCE_LABELS, pct } from '../../../lib/intelligence'
import { relativeTime } from '../../../lib/dateFormat'
import RagHealthPanel from '../../RagHealthPanel'
import Stat from './Stat'
import styles from './IntelligenceView.module.css'

/**
 * IntelligenceQualityView — R.7 deep quality-analyse. Diepere uitsplitsing
 * van rag_outcomes per skill, retrieval-strategy, chunk-source.
 *
 * Refactor 13 (Golf C): container <200 LOC. useSupabaseQuery vervangt
 * inline fetch. Stat helper + module.css gedeeld met Hub-view.
 */
export default function IntelligenceQualityView() {
  const { data: outcomes, error, refresh, loading } = useSupabaseQuery('rag_outcomes', {
    select: 'id, source_type, decision_action, chunks_used, total_chunks, avg_top_similarity, retrieval_strategy, retrieval_params, outcome, outcome_at, created_at',
    orderBy: ['created_at', { ascending: false }],
    limit: 500,
    initialData: null,
  })

  const stats = useMemo(() => {
    if (!outcomes || outcomes.length === 0) return null
    const finalized = outcomes.filter(o => ['accept', 'amend', 'reject'].includes(o.outcome))

    const bySource = {}
    for (const o of finalized) {
      const k = o.source_type || 'unknown'
      bySource[k] = bySource[k] || { total: 0, accept: 0, amend: 0, reject: 0 }
      bySource[k].total++
      bySource[k][o.outcome]++
    }

    const byStrategy = {}
    for (const o of finalized) {
      const k = o.retrieval_strategy || 'unknown'
      byStrategy[k] = byStrategy[k] || { total: 0, accept: 0, amend: 0, reject: 0 }
      byStrategy[k].total++
      byStrategy[k][o.outcome]++
    }

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
      bySource: Object.entries(bySource).sort((a, b) => b[1].total - a[1].total),
      byStrategy: Object.entries(byStrategy).sort((a, b) => b[1].total - a[1].total),
      byChunkSource: Object.entries(byChunkSource).sort((a, b) => b[1].total - a[1].total),
      simByOutcome,
      recent: outcomes.slice(0, 50),
    }
  }, [outcomes])

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <div className={styles.qualityHeader}>
        <div>
          <Link to="/intelligence" className="muted text-md">← Intelligence Hub</Link>
          <h1 className={styles.qualityTitle}>Quality — RAG outcomes</h1>
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? 'Laden…' : '↻ Refresh'}
        </button>
      </div>

      {error && <div className={`card ${styles.errorBanner}`}>{error}</div>}

      <RagHealthPanel recordType="autodraft_mail" weeks={4} />
      <RagHealthPanel recordType="agent_proposal" weeks={4} />

      {!outcomes ? (
        <div className="card" style={{ padding: 'var(--s-5)' }}><span className="muted">laden…</span></div>
      ) : !stats || stats.finalized === 0 ? (
        <EmptyState />
      ) : (
        <>
          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Samenvatting</h2>
            <div className={styles.gridAuto}>
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

          <BreakdownSection title="Per skill (source_type)" rows={stats.bySource} />
          <BreakdownSection
            title="Per retrieval-strategie"
            rows={stats.byStrategy}
            sub="match_chunks vs match_chunks_for_entity vergelijking"
            footnote="Hypothese: match_chunks_for_entity zou een hogere acceptance-rate moeten geven dan plain match_chunks. Wacht totdat per strategy ≥10 finalized outcomes zijn voor een betekenisvolle vergelijking."
          />
          <BreakdownSection
            title="Per chunk-source"
            rows={stats.byChunkSource.map(([k, v]) => [SOURCE_LABELS[k] || k, v])}
            footnote="Hoe vaak een chunk uit elke source-type in een geaccepteerde / ge-amendde / verworpen draft is geland."
            cols="mid"
          />

          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Laatste 50 outcomes</h2>
            <div>
              {stats.recent.map(o => {
                const oc = o.outcome || 'pending'
                return (
                  <div key={o.id} className={styles.outcomeRow}>
                    <span
                      className={styles.outcomeDot}
                      style={{ background: OUTCOME_COLORS[oc] }}
                    />
                    <span style={{ minWidth: 70, fontWeight: 500 }}>{oc}</span>
                    <span style={{ minWidth: 110, color: 'var(--text-muted)' }}>{o.source_type}</span>
                    <span style={{ minWidth: 70, color: 'var(--text-muted)' }}>{o.decision_action}</span>
                    <span className={styles.listMono}>{o.total_chunks ?? '–'} chunks</span>
                    <span className={styles.listMono}>
                      {o.avg_top_similarity != null ? Number(o.avg_top_similarity).toFixed(3) : '–'}
                    </span>
                    <span className={styles.runSummary} style={{ flex: 1 }}>{o.retrieval_strategy}</span>
                    <span className={styles.listMono}>{relativeTime(o.outcome_at || o.created_at) || '–'}</span>
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

function BreakdownSection({ title, rows, sub, footnote, cols = 'wide' }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>{title}</h2>
      {sub && <div className="muted text-md" style={{ marginBottom: 'var(--s-3)' }}>{sub}</div>}
      <div className={cols === 'mid' ? styles.gridAutoMid : styles.gridAutoWide}>
        {rows.map(([k, v]) => (
          <StatRow key={k} label={k} {...v} sub={sub ? '' : null} />
        ))}
      </div>
      {footnote && <div className="muted text-md" style={{ marginTop: 'var(--s-3)' }}>{footnote}</div>}
    </section>
  )
}

function StatRow({ label, accept, amend, reject, total, sub }) {
  return (
    <div className={styles.statRowCard}>
      <div className={styles.statRowHead}>
        <div>
          <div className={styles.statRowLabel}>{label}</div>
          {sub && <div className={styles.statRowSub}>{sub}</div>}
        </div>
        <div className={styles.statRowValue}>
          {pct(accept, total)} <span style={{ fontSize: 11 }}>({total})</span>
        </div>
      </div>
      <Bar accept={accept} amend={amend} reject={reject} total={total} />
      <div className={styles.statRowLegend}>
        <span style={{ color: OUTCOME_COLORS.accept }}>● accept {accept}</span>
        <span style={{ color: OUTCOME_COLORS.amend }}>● amend {amend}</span>
        <span style={{ color: OUTCOME_COLORS.reject }}>● reject {reject}</span>
      </div>
    </div>
  )
}

function Bar({ accept, amend, reject, total }) {
  if (!total) return <div className={styles.statRowBar} />
  const pa = (accept / total) * 100
  const pm = (amend / total) * 100
  const pr = (reject / total) * 100
  return (
    <div className={styles.statRowBar}>
      <div className={styles.statRowFill} style={{ width: `${pa}%`, background: OUTCOME_COLORS.accept }} />
      <div className={styles.statRowFill} style={{ width: `${pm}%`, background: OUTCOME_COLORS.amend }} />
      <div className={styles.statRowFill} style={{ width: `${pr}%`, background: OUTCOME_COLORS.reject }} />
    </div>
  )
}

function EmptyState() {
  return (
    <div className={`card ${styles.cardSubtle}`}>
      <div style={{ fontSize: 14, marginBottom: 8 }}>Nog te weinig data voor diepe analyse</div>
      <div className="text-md" style={{ lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
        De <code>rag_outcomes</code> tabel vult zich automatisch zodra je drafts gaat
        beoordelen — de DB-trigger op <code>autodraft_decisions</code> logt elke
        send/amend/ignore actie met de chunks die in de RAG-context zaten.
      </div>
      <Link to="/intelligence" style={{ marginTop: 16, display: 'inline-block', fontSize: 12 }}>
        ← Terug naar Intelligence Hub
      </Link>
    </div>
  )
}
