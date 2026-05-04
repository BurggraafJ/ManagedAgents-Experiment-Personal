import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// =====================================================================
// IntelligenceHubView — R.9 stack-status pagina
// =====================================================================
// Live overzicht van de RAG-stack: sync-health, chunks-counts, recente
// agent_runs van retrieval-skills, beslissingen-log uit
// current_architecture.md §8, en rag_outcomes-baseline.
// =====================================================================

const PIPELINE_STAGES = [
  { id: 'sync',     label: 'Sync',      desc: 'Outlook · HubSpot · Jira · Fireflies · Calendar' },
  { id: 'chunk',    label: 'Chunk',     desc: '9 source-types → chunks-tabel (halfvec 3072)' },
  { id: 'embed',    label: 'Embed',     desc: 'text-embedding-3-large + GPT-5-nano context-prefix' },
  { id: 'index',    label: 'Index',     desc: 'HNSW + GIN FTS · v_entity_edges_full' },
  { id: 'retrieve', label: 'Retrieve',  desc: 'match_chunks (BM25+vec+RRF) + match_chunks_for_entity' },
  { id: 'consume',  label: 'Consume',   desc: '6 skills · auto-draft · sales-* · daily-admin · agenda · task-organizer' },
  { id: 'quality',  label: 'Quality',   desc: 'rag_outcomes via R.7 trigger op autodraft_decisions' },
]

const DECISIONS = [
  { id: 'B.1', status: '✓', title: 'Contextual augmentation: GPT-5-nano',
    body: '~€15 eenmalig + €3/maand. Templates per source-type definitief geversioneerd (§11.6).' },
  { id: 'B.2', status: '✓', title: 'Embedding: text-embedding-3-large + halfvec(3072)',
    body: 'Cutover compleet 2026-05-03. 20.698 records herembed.' },
  { id: 'B.3', status: '✓', title: 'GraphRAG: graph-light',
    body: 'Postgres views + 1-hop entity-traversal. Volle GraphRAG pas heroverwegen bij ≥5 multi-hop fails/maand.' },
  { id: 'B.4', status: '✓', title: 'autodraft-rag-prefill blijft, vervangt later context-build',
    body: 'In R.6 vervangen door generieke CaaS-endpoint.' },
  { id: 'B.5', status: '✓', title: 'Maandbudget intelligence-stack',
    body: '~€3-5/maand structureel. Ruim binnen €50/maand budget.' },
  { id: 'B.6', status: '✓', title: 'Owner: datascience skill',
    body: 'Single source of truth = current_architecture.md.' },
  { id: 'B.7', status: '○', title: 'LLM-rerank (Stage F)',
    body: 'Geparkeerd als optionele R.10. Alleen als R.7 baseline plateau bij 70-80% acceptance laat zien.' },
]

const SOURCE_LABELS = {
  mail: 'Mail', engagement: 'Engagement', jira: 'Jira',
  deal: 'Deal', company: 'Company', contact: 'Contact',
  meeting: 'Meeting', event: 'Event',
  embedding: 'Embedding', chunks: 'Chunks',
}

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  return `${day}d geleden`
}

function HealthDot({ isFresh, age }) {
  const color = isFresh === true ? '#22c55e' : isFresh === false ? '#f59e0b' : 'var(--text-muted)'
  return (
    <span
      title={age ? `${age.toFixed(0)} min oud` : 'unknown'}
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: 4,
        background: color, marginRight: 6,
      }}
    />
  )
}

function HealthGrid({ health }) {
  if (!health) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  const keys = Object.keys(health).filter(k => k !== 'all_fresh' && k !== 'checked_at')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
      {keys.map((k) => {
        const v = health[k]
        if (!v || typeof v !== 'object') return null
        return (
          <div key={k} style={{
            padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
              <HealthDot isFresh={v.is_fresh} age={v.age_minutes} />
              {SOURCE_LABELS[k] || k}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {v.source_count != null ? `${v.source_count.toLocaleString()} records` : ''}
              {v.last_sync_at && ' · ' + relTime(v.last_sync_at)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChunksGrid({ chunks }) {
  if (!chunks) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  if (chunks.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>geen chunks gevonden</div>
  const total = chunks.reduce((s, r) => s + r.total, 0)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        Totaal: <strong>{total.toLocaleString()}</strong> chunks over {chunks.length} bronnen
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
        {chunks.map((c) => (
          <div key={c.source} style={{
            padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{SOURCE_LABELS[c.source] || c.source}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.total.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PipelineDiagram({ counts }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
      {PIPELINE_STAGES.map((stage, i) => (
        <div key={stage.id} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 140px' }}>
          <div style={{
            padding: '10px 12px', flex: 1, border: '1px solid var(--border)',
            borderRadius: 6, background: 'var(--bg-input, rgba(0,0,0,0.02))',
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 4,
            }}>
              {i + 1}. {stage.label}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              {stage.desc}
            </div>
            {counts?.[stage.id] != null && (
              <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                {counts[stage.id]}
              </div>
            )}
          </div>
          {i < PIPELINE_STAGES.length - 1 && (
            <div style={{
              width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 18,
            }}>
              →
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function DecisionsLog() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {DECISIONS.map((d) => (
        <div key={d.id} style={{
          padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 6,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
            minWidth: 36, color: d.status === '✓' ? '#22c55e' : 'var(--text-muted)',
          }}>
            {d.id}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{d.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{d.body}</div>
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 14, marginTop: -2,
            color: d.status === '✓' ? '#22c55e' : 'var(--text-muted)',
          }}>
            {d.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function OutcomesPanel({ outcomes }) {
  if (!outcomes) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  if (outcomes.total === 0) {
    return (
      <div style={{
        padding: 'var(--s-4)', border: '1px dashed var(--border)', borderRadius: 6,
        textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
      }}>
        Nog geen rag_outcomes gelogd. Trigger op <code>autodraft_decisions</code> vult dit
        automatisch zodra je drafts gaat beoordelen (send / amend / ignore).
      </div>
    )
  }
  const totalAcc = outcomes.byOutcome.accept || 0
  const totalAmd = outcomes.byOutcome.amend || 0
  const totalRej = outcomes.byOutcome.reject || 0
  const accRate = outcomes.total > 0 ? (totalAcc / outcomes.total) * 100 : 0
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <Stat label="Total" value={outcomes.total} />
        <Stat label="Accept" value={totalAcc} color="#22c55e" />
        <Stat label="Amend" value={totalAmd} color="#f59e0b" />
        <Stat label="Reject" value={totalRej} color="var(--text-muted)" />
        <Stat label="Acceptance" value={`${accRate.toFixed(1)}%`} />
        <Stat label="Avg chunks" value={outcomes.avgChunks?.toFixed(1) ?? '-'} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Bron: <code>rag_outcomes</code> — log van retrieved chunks per skill-decision.
        Vermenigvuldigt met elke nieuwe autodraft-execute en handmatige <code>log_rag_outcome</code>-calls vanuit consumer-skills.
      </div>
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

function RecentRuns({ runs }) {
  if (!runs) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  if (runs.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>geen recente runs</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {runs.map((r, i) => {
        const color = r.status === 'success' ? '#22c55e'
          : r.status === 'warning' ? '#f59e0b'
          : r.status === 'error' ? '#ef4444' : 'var(--text-muted)'
        return (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
            padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: color }} />
              <span style={{ fontWeight: 500 }}>{r.agent_name}</span>
              <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.summary || '–'}
              </span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, marginLeft: 12, flexShrink: 0 }}>
              {relTime(r.completed_at || r.started_at)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function IntelligenceHubView() {
  const [health, setHealth] = useState(null)
  const [chunks, setChunks] = useState(null)
  const [outcomes, setOutcomes] = useState(null)
  const [runs, setRuns] = useState(null)
  const [edges, setEdges] = useState(null)
  const [resolutions, setResolutions] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const [h, ch, oc, rn, ed, er] = await Promise.all([
        supabase.rpc('sync_health_all'),
        supabase.from('chunks').select('source', { count: 'exact', head: false }),
        supabase.from('rag_outcomes').select('outcome, total_chunks'),
        supabase.from('agent_runs')
          .select('agent_name, status, summary, started_at, completed_at')
          .in('agent_name', ['chunker', 'autodraft-rag-prefill', 'jellemind-embed'])
          .order('started_at', { ascending: false })
          .limit(15),
        supabase.from('v_entity_edges_full').select('src_type', { count: 'exact', head: true }),
        supabase.from('entity_resolution').select('alias_type', { count: 'exact', head: true }),
      ])

      if (h.error) throw new Error(`sync_health_all: ${h.error.message}`)
      setHealth(h.data)

      // Tel chunks per source
      if (ch.data) {
        const counts = {}
        for (const r of ch.data) counts[r.source] = (counts[r.source] || 0) + 1
        setChunks(Object.entries(counts).map(([source, total]) => ({ source, total }))
          .sort((a, b) => b.total - a.total))
      }

      // Aggregate outcomes
      if (oc.data) {
        const byOutcome = {}
        let totalChunks = 0
        for (const r of oc.data) {
          const key = r.outcome || 'pending'
          byOutcome[key] = (byOutcome[key] || 0) + 1
          totalChunks += r.total_chunks || 0
        }
        setOutcomes({
          total: oc.data.length,
          byOutcome,
          avgChunks: oc.data.length > 0 ? totalChunks / oc.data.length : 0,
        })
      }

      setRuns(rn.data || [])
      setEdges(ed.count ?? null)
      setResolutions(er.count ?? null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Pipeline-counts uit beschikbare data
  const pipelineCounts = (() => {
    const totalChunks = chunks?.reduce((s, r) => s + r.total, 0) ?? null
    return {
      chunk: totalChunks != null ? `${totalChunks.toLocaleString()} chunks` : null,
      embed: totalChunks != null ? '3072d halfvec' : null,
      index: edges != null && resolutions != null
        ? `${edges.toLocaleString()} edges · ${resolutions.toLocaleString()} aliases`
        : null,
      consume: '6 skills',
      quality: outcomes != null ? `${outcomes.total} outcomes` : null,
    }
  })()

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
          <div>
            <h2 className="section__title" style={{ marginBottom: 4 }}>Pijplijn</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Sync → Chunk → Embed → Index → Retrieve → Consume → Quality
            </div>
          </div>
          <button className="btn" onClick={load} disabled={refreshing}>
            {refreshing ? 'Laden…' : '↻ Refresh'}
          </button>
        </div>
        <PipelineDiagram counts={pipelineCounts} />
      </section>

      {error && (
        <div className="card" style={{ borderLeft: '3px solid #ef4444', color: '#ef4444', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Sync-health</h2>
        <HealthGrid health={health} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Chunks per source</h2>
        <ChunksGrid chunks={chunks} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
          <h2 className="section__title" style={{ margin: 0 }}>Quality-baseline (R.7)</h2>
          <Link to="/intelligence/quality" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Diepere analyse →
          </Link>
        </div>
        <OutcomesPanel outcomes={outcomes} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Recente RAG-skill runs</h2>
        <RecentRuns runs={runs} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Beslissingen-log</h2>
        <DecisionsLog />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 'var(--s-4)', textAlign: 'right' }}>
          Bron: <code>dashboard-react/skills/datascience/references/current_architecture.md §8</code>
        </div>
      </section>
    </div>
  )
}
