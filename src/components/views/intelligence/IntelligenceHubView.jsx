import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useIntelligenceHub } from '../../../hooks/useIntelligenceHub'
import PipelineDiagram from './PipelineDiagram'
import { HealthGrid, ChunksGrid } from './HealthAndChunks'
import {
  OutcomesPanel, CostPanel, RecentRuns, FailingQueriesPanel, DecisionsLog,
} from './IntelligencePanels'
import styles from './IntelligenceView.module.css'

/**
 * IntelligenceHubView — R.9 stack-status pagina. Live overzicht van de
 * RAG-stack: pipeline, sync-health, chunks, outcomes baseline, kosten,
 * recente runs, failing queries, beslissingen-log.
 *
 * Refactor 13 (Golf C): container <100 LOC. Hook in src/hooks/. Sub-views
 * + helpers in deze folder. lib/intelligence.js bevat constants.
 */
export default function IntelligenceHubView() {
  const data = useIntelligenceHub()
  const [selectedStage, setSelectedStage] = useState(null)

  const totalChunks = data.chunks?.reduce((s, r) => s + r.total, 0) ?? null
  const pipelineCounts = {
    chunk: totalChunks != null ? `${totalChunks.toLocaleString()} chunks` : null,
    embed: totalChunks != null ? '3072d halfvec' : null,
    index: data.edges != null && data.resolutions != null
      ? `${data.edges.toLocaleString()} edges · ${data.resolutions.toLocaleString()} aliases`
      : null,
    consume: '6 skills',
    quality: data.outcomes != null ? `${data.outcomes.total} outcomes` : null,
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
          <div>
            <h2 className="section__title" style={{ marginBottom: 4 }}>Pijplijn</h2>
            <div className="muted text-md">Sync → Chunk → Embed → Index → Retrieve → Consume → Quality</div>
          </div>
          <button className="btn" onClick={data.refresh} disabled={data.refreshing}>
            {data.refreshing ? 'Laden…' : '↻ Refresh'}
          </button>
        </div>
        <PipelineDiagram counts={pipelineCounts} selectedStage={selectedStage} onSelect={setSelectedStage} />
      </section>

      {data.error && (
        <div className={`card ${styles.errorBanner}`}>{data.error}</div>
      )}

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Sync-health</h2>
        <HealthGrid health={data.health} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Chunks per source</h2>
        <ChunksGrid chunks={data.chunks} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
          <h2 className="section__title" style={{ margin: 0 }}>Quality-baseline (R.7)</h2>
          <Link to="/intelligence/quality" className="muted text-md">Diepere analyse →</Link>
        </div>
        <OutcomesPanel outcomes={data.outcomes} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Kosten (laatste 30 dagen)</h2>
        <CostPanel stats={data.costStats} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Recente RAG-skill runs</h2>
        <RecentRuns runs={data.runs} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Top-failing queries (laatste 30d)</h2>
        <FailingQueriesPanel rows={data.failingQueries} />
      </section>

      <section className="card" style={{ padding: 'var(--s-5)' }}>
        <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Beslissingen-log</h2>
        <DecisionsLog />
        <div className="muted text-md" style={{ marginTop: 'var(--s-4)', textAlign: 'right' }}>
          Bron: <code>dashboard-react/skills/datascience/references/current_architecture.md §8</code>
        </div>
      </section>
    </div>
  )
}
