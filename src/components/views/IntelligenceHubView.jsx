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

const STAGE_DETAILS = {
  sync: {
    explainer: "Haalt elke 15-30 min nieuwe mails, agenda-items, deals, Jira-issues en Fireflies-meetings binnen via externe APIs en spiegelt die in Supabase als 'truth-of-source mirrors'. Zonder verse sync valt het hele systeem terug op oude data.",
    agents: ['mail-sync-etl-v2', 'hubspot-sync-etl', 'hubspot-engagements-sync', 'jira-sync-etl', 'outlook-calendar-sync-etl', 'fireflies-sync-etl'],
    source: 'mail_messages · hubspot_deals · hubspot_companies · hubspot_contacts · jira_issues · calendar_events · fireflies_meetings',
  },
  chunk: {
    explainer: "De chunker draait elke 5 min, knipt nieuwe records uit alle 9 bronnen in 'chunks' (logische stukken tekst, ~200-1500 chars per chunk). Per chunk schrijft GPT-5-nano een korte contextuele samenvatting bovenaan zodat losse stukjes (bv. mail-replies) hun verband bewaren bij retrieval.",
    agents: ['chunker'],
    source: 'chunks.content + chunks.content_with_context',
  },
  embed: {
    explainer: "Elke chunk wordt door OpenAI text-embedding-3-large vertaald naar een 3072-dim vector (halfvec). Dat is de kern van semantic search: 'wat lijkt qua betekenis op de vraag, ongeacht woordkeuze'. ~$0.05/maand structureel; eenmalige re-embed kostte ~$0.50.",
    agents: ['chunker'],
    source: 'chunks.embedding (HNSW halfvec_cosine_ops)',
  },
  index: {
    explainer: "Twee indexen + één view dragen alle queries. HNSW maakt vector-search sub-second over 20k chunks. GIN-FTS doet hetzelfde voor BM25-tekst-zoek. v_entity_edges_full verbindt mails ↔ contacts ↔ companies ↔ deals via 36k edges (15k via entity_resolution), zodat 'alles van klant X' werkt zonder per bron te query'en.",
    agents: [],
    source: 'v_entity_edges_full · entity_resolution · idx HNSW + GIN',
  },
  retrieve: {
    explainer: "match_chunks combineert per query: (1) HNSW vector-similarity (semantisch), (2) BM25 ts_rank_cd (woordelijk), (3) Reciprocal Rank Fusion smelt beide rangordes samen, (4) recency-weight bevoordeelt recente content licht. match_chunks_for_entity pakt eerst 1-hop edges van een entity en zoekt daarbinnen — sterk voor 'wat besprak ik recent met klant X'.",
    agents: [],
    source: 'match_chunks · match_chunks_for_entity · context_bundles (audit-trail)',
    bundleAudit: true,
  },
  consume: {
    explainer: "Elke skill die context nodig heeft roept context-build aan met een intent (draft_reply / search / enrich_record / extract_actions / compose_followup / match_appointment / learn_pattern / analyze_meeting). Die levert een bundle van top-N chunks + optionele entity-resolution + optionele Haiku-rerank. Bundle_id wordt gelogd zodat de quality-loop later kan meten welke chunks tot accept/amend/reject leidden.",
    agents: ['autodraft-rag-prefill', 'sales-followups', 'daily-admin', 'sales-on-road', 'task-organizer-fireflies', 'agenda'],
    source: 'context_bundles · context_intents (recipes per intent)',
  },
  quality: {
    explainer: "rag_outcomes wordt automatisch gevuld door een trigger op autodraft_decisions: send → accept, amend → amend, ignore/spam → reject. Plus zoekpagina-feedback (✓/✕) schrijft direct via log_search_feedback. Dat is de meetlat: welke retrieval-strategy levert de beste drafts? Volle uitsplitsing per source/strategy zit op de Quality-pagina.",
    agents: [],
    source: 'rag_outcomes · log_rag_outcome RPC · log_search_feedback RPC',
  },
}

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

function PipelineDiagram({ counts, selectedStage, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap' }}>
      {PIPELINE_STAGES.map((stage, i) => {
        const active = selectedStage === stage.id
        return (
          <div key={stage.id} style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 140px' }}>
            <button
              type="button"
              onClick={() => onSelect(active ? null : stage.id)}
              style={{
                padding: '10px 12px', flex: 1, textAlign: 'left',
                border: `1px solid ${active ? '#22c55e' : 'var(--border)'}`,
                borderRadius: 6,
                background: active ? 'rgba(34,197,94,0.08)' : 'var(--bg-input, rgba(0,0,0,0.02))',
                cursor: 'pointer', color: 'inherit', font: 'inherit',
                transition: 'border-color 120ms, background 120ms',
              }}
              title="Klik voor uitleg + recente runs"
            >
              <div style={{
                fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: active ? '#22c55e' : 'var(--text-muted)', marginBottom: 4,
              }}>
                {i + 1}. {stage.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {stage.desc}
              </div>
              {counts?.[stage.id] != null && (
                <div style={{ fontSize: 11, marginTop: 6, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  {counts[stage.id]}
                </div>
              )}
            </button>
            {i < PIPELINE_STAGES.length - 1 && (
              <div style={{
                width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', fontSize: 18,
              }}>
                →
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StageDetail({ stageId, onClose }) {
  const stage = PIPELINE_STAGES.find(s => s.id === stageId)
  const detail = STAGE_DETAILS[stageId]
  const [agentRuns, setAgentRuns] = useState(null)
  const [bundles, setBundles] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!stage || !detail) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (detail.agents.length > 0) {
          const { data } = await supabase.from('agent_runs')
            .select('agent_name, status, summary, started_at, completed_at')
            .in('agent_name', detail.agents)
            .order('started_at', { ascending: false })
            .limit(8)
          if (!cancelled) setAgentRuns(data ?? [])
        } else {
          if (!cancelled) setAgentRuns([])
        }
        if (detail.bundleAudit) {
          const { data } = await supabase.from('context_bundles')
            .select('bundle_id, intent, audience, total_chunks, build_ms, reranked, created_at, retrieval_meta')
            .order('created_at', { ascending: false })
            .limit(8)
          if (!cancelled) setBundles(data ?? [])
        }
      } catch {
        if (!cancelled) { setAgentRuns([]); setBundles([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [stageId, stage, detail])

  if (!stage || !detail) return null
  return (
    <div style={{
      marginTop: 'var(--s-4)', padding: 'var(--s-4)',
      border: '1px solid #22c55e', borderRadius: 6,
      background: 'rgba(34,197,94,0.04)',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {stage.label} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>— {stage.desc}</span>
        </h3>
        <button type="button" onClick={onClose} style={{
          background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
          padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--text-muted)',
        }}>Sluit ✕</button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55 }}>
        {detail.explainer}
      </div>

      <div style={{
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
        padding: '6px 10px', background: 'var(--bg-input, rgba(0,0,0,0.04))',
        border: '1px solid var(--border)', borderRadius: 4,
      }}>
        Tabellen / RPC's: {detail.source}
      </div>

      {detail.agents.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Recente runs (top 8)
          </div>
          {loading && !agentRuns && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>}
          {agentRuns && agentRuns.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Geen runs zichtbaar in deze tijdsperiode.</div>}
          {agentRuns && agentRuns.length > 0 && <RecentRuns runs={agentRuns} />}
        </div>
      )}

      {detail.bundleAudit && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
            Recente context_bundles (laatste 8 RAG-calls)
          </div>
          {loading && !bundles && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>}
          {bundles && bundles.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nog geen bundles geproduceerd.</div>}
          {bundles && bundles.length > 0 && <BundleList bundles={bundles} />}
        </div>
      )}
    </div>
  )
}

function CostPanel({ stats }) {
  if (!stats) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  const fmtEur = (n) => '€' + n.toFixed(n < 0.10 ? 4 : 2)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Stat label="Vandaag" value={fmtEur(stats.eurToday)} />
        <Stat label="Calls vandaag" value={stats.callsToday} />
        <Stat label="Laatste 30d" value={fmtEur(stats.eur30d)} />
        <Stat label="Calls 30d" value={stats.calls30d.toLocaleString()} />
        <Stat label="Tokens 30d" value={stats.tokens30d.toLocaleString()} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Bron: <code>context_bundles.tokens_used</code> × $0.13/1M (text-embedding-3-large) × 0.93 EUR. Exclusief eenmalige re-embed kosten en optionele Haiku-rerank.
      </div>
    </div>
  )
}

function FailingQueriesPanel({ rows }) {
  if (!rows) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>laden…</div>
  if (rows.length === 0) return (
    <div style={{
      padding: 'var(--s-4)', border: '1px dashed var(--border)', borderRadius: 6,
      textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
    }}>
      Geen recente bundles met 0 chunks of avg-similarity &lt; 0.5 — retrieval ziet er goed uit.
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => {
        const zero = (r.total_chunks ?? 0) === 0
        const lowSim = !zero && r.avg_top_similarity != null && r.avg_top_similarity < 0.5
        const flag = zero ? '0 chunks' : lowSim ? `top sim ${(r.avg_top_similarity * 100).toFixed(0)}%` : '?'
        const flagColor = zero ? '#ef4444' : '#f59e0b'
        return (
          <div key={r.bundle_id} style={{
            display: 'grid', gridTemplateColumns: '90px 110px 1fr 110px 80px',
            gap: 10, alignItems: 'baseline', fontSize: 12,
            padding: '6px 10px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, color: 'white', background: flagColor, textAlign: 'center', fontFamily: 'var(--font-mono)' }}>{flag}</span>
            <span style={{ fontWeight: 600 }}>{r.intent}</span>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.audience || '–'}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{r.build_ms}ms</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}>{relTime(r.created_at)}</span>
          </div>
        )
      })}
    </div>
  )
}

function BundleList({ bundles }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {bundles.map((b) => {
        const strategy = b.retrieval_meta?.strategy || '?'
        return (
          <div key={b.bundle_id} style={{
            display: 'grid', gridTemplateColumns: '110px 130px 1fr 70px 70px 80px',
            gap: 10, alignItems: 'baseline', fontSize: 12,
            padding: '6px 10px', borderBottom: '1px solid var(--border)',
          }}>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{b.intent}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{strategy}</span>
            <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.audience || '–'}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{b.total_chunks} chunks</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{b.build_ms}ms</span>
            <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}>
              {relTime(b.created_at)}
            </span>
          </div>
        )
      })}
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
  const [selectedStage, setSelectedStage] = useState(null)
  const [costStats, setCostStats] = useState(null)
  const [failingQueries, setFailingQueries] = useState(null)

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

      // Cost-counter + top-failing queries — uit context_bundles
      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
      const sinceToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const [bundlesAll, bundlesFail] = await Promise.all([
        supabase.from('context_bundles')
          .select('tokens_used, build_ms, created_at, intent, audience')
          .gte('created_at', since30)
          .order('created_at', { ascending: false })
          .limit(2000),
        supabase.from('context_bundles')
          .select('bundle_id, intent, audience, total_chunks, avg_top_similarity, build_ms, created_at, retrieval_meta')
          .gte('created_at', since30)
          .or('total_chunks.eq.0,avg_top_similarity.lt.0.5')
          .order('created_at', { ascending: false })
          .limit(15),
      ])
      if (bundlesAll.data) {
        let tokensToday = 0, tokens30d = 0, callsToday = 0, calls30d = 0
        for (const b of bundlesAll.data) {
          const t = b.tokens_used || 0
          tokens30d += t; calls30d += 1
          if (b.created_at >= sinceToday) { tokensToday += t; callsToday += 1 }
        }
        // text-embedding-3-large: $0.13 per 1M tokens. Voor display: euro = $ × 0.93
        const usdPerToken = 0.13 / 1_000_000
        setCostStats({
          tokensToday, tokens30d, callsToday, calls30d,
          eurToday: tokensToday * usdPerToken * 0.93,
          eur30d: tokens30d * usdPerToken * 0.93,
        })
      }
      if (bundlesFail.data) setFailingQueries(bundlesFail.data)
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
        <PipelineDiagram counts={pipelineCounts} selectedStage={selectedStage} onSelect={setSelectedStage} />
        {selectedStage && (
          <StageDetail stageId={selectedStage} onClose={() => setSelectedStage(null)} />
        )}
        {!selectedStage && (
          <div style={{ marginTop: 'var(--s-3)', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Klik op een stap voor uitleg + recente runs.
          </div>
        )}
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
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Kosten (laatste 30 dagen)</h2>
        <CostPanel stats={costStats} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Recente RAG-skill runs</h2>
        <RecentRuns runs={runs} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Top-failing queries (laatste 30d)</h2>
        <FailingQueriesPanel rows={failingQueries} />
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
