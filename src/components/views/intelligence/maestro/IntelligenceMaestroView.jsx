import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useIntelligenceHub } from '../../../../hooks/useIntelligenceHub'
import PipelineDiagram from '../PipelineDiagram'
import { HealthGrid, ChunksGrid } from '../HealthAndChunks'
import {
  OutcomesPanel, CostPanel, RecentRuns, FailingQueriesPanel, DecisionsLog,
} from '../IntelligencePanels'
import './intelligence-maestro.css'

// IntelligenceMaestroView — volledige Maestro-restyle (mockup-tokens) van
// IntelligenceHubView. Hergebruikt useIntelligenceHub() + alle sub-componenten
// (PipelineDiagram, HealthGrid, ChunksGrid, OutcomesPanel, CostPanel,
// RecentRuns, FailingQueriesPanel, DecisionsLog). Visuele wrapping +
// scoped CSS overlay onder .theme-maestro.itl-maestro-app.
//
// Sessie ITL-V1 (2026-05-11): Jelle vraagt complete restyle naar Maestro-
// look, oude visual wegdoen, data-binding intact.
//
// HARD-RULE: oude code is leidend. Sub-componenten zijn ongewijzigd.
// useIntelligenceHub levert exact dezelfde data. Visual is mockup-conform.

const BUILD_TAG = 'itl·v1·2026-05-11'

export default function IntelligenceMaestroView() {
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

  // eslint-disable-next-line no-console
  console.log(`[IntelligenceMaestroView ${BUILD_TAG}] mounted`)

  return (
    <div className="theme-maestro itl-maestro-app">
      {/* Mockup-topbar (crumbs + sync-pill + Refresh) */}
      <header className="itl-topbar">
        <div className="itl-crumbs">
          <span className="itl-crumbs__current">Intelligence</span>
          <span className="itl-crumbs__sep">/</span>
          <span>Hub</span>
        </div>
        <div className="itl-topbar__actions">
          <span className="itl-sync-pill">
            <span className="itl-sync-dot" />
            <span>Live</span>
          </span>
          <Link to="/intelligence/quality" className="itl-btn itl-btn--ghost">
            Diepere analyse →
          </Link>
          <button
            type="button"
            className="itl-btn itl-btn--primary"
            onClick={data.refresh}
            disabled={data.refreshing}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M8 16H3v5"/>
            </svg>
            {data.refreshing ? 'Laden…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Card-wrapper rond hele content */}
      <div className="itl-card">
        <div className="itl-scroll">
          {data.error && (
            <div className="itl-error-banner">{data.error}</div>
          )}

          {/* Pijplijn — hero-sectie met diagram */}
          <section className="itl-section itl-section--hero">
            <header className="itl-section__head">
              <div>
                <h2 className="itl-section__title">Pijplijn</h2>
                <p className="itl-section__sub">
                  Sync → Chunk → Embed → Index → Retrieve → Consume → Quality
                </p>
              </div>
            </header>
            <div className="itl-section__body">
              <PipelineDiagram
                counts={pipelineCounts}
                selectedStage={selectedStage}
                onSelect={setSelectedStage}
              />
            </div>
          </section>

          {/* 2-column grid: Sync-health + Chunks per source */}
          <div className="itl-grid itl-grid--2col">
            <section className="itl-section">
              <header className="itl-section__head">
                <h2 className="itl-section__title">Sync-health</h2>
                <p className="itl-section__sub">Per agent, laatste 24u</p>
              </header>
              <div className="itl-section__body">
                <HealthGrid health={data.health} />
              </div>
            </section>

            <section className="itl-section">
              <header className="itl-section__head">
                <h2 className="itl-section__title">Chunks per source</h2>
                <p className="itl-section__sub">Volume per bron-type</p>
              </header>
              <div className="itl-section__body">
                <ChunksGrid chunks={data.chunks} />
              </div>
            </section>
          </div>

          {/* Quality-baseline */}
          <section className="itl-section">
            <header className="itl-section__head">
              <h2 className="itl-section__title">Quality-baseline</h2>
              <p className="itl-section__sub">
                R.7 RAG outcomes — acceptance per skill
              </p>
            </header>
            <div className="itl-section__body">
              <OutcomesPanel outcomes={data.outcomes} />
            </div>
          </section>

          {/* 2-col: Kosten + Recente runs */}
          <div className="itl-grid itl-grid--2col">
            <section className="itl-section">
              <header className="itl-section__head">
                <h2 className="itl-section__title">Kosten</h2>
                <p className="itl-section__sub">Laatste 30 dagen</p>
              </header>
              <div className="itl-section__body">
                <CostPanel stats={data.costStats} />
              </div>
            </section>

            <section className="itl-section">
              <header className="itl-section__head">
                <h2 className="itl-section__title">Recente RAG-skill runs</h2>
                <p className="itl-section__sub">Top 10 latest</p>
              </header>
              <div className="itl-section__body">
                <RecentRuns runs={data.runs} />
              </div>
            </section>
          </div>

          {/* Top-failing queries */}
          <section className="itl-section">
            <header className="itl-section__head">
              <h2 className="itl-section__title">Top-failing queries</h2>
              <p className="itl-section__sub">Laatste 30 dagen</p>
            </header>
            <div className="itl-section__body">
              <FailingQueriesPanel rows={data.failingQueries} />
            </div>
          </section>

          {/* Beslissingen-log */}
          <section className="itl-section">
            <header className="itl-section__head">
              <h2 className="itl-section__title">Beslissingen-log</h2>
              <p className="itl-section__sub">
                Architectuur-beslissingen + bronnen
              </p>
            </header>
            <div className="itl-section__body">
              <DecisionsLog />
              <div className="itl-source-line">
                Bron: <code>dashboard-react/skills/datascience/references/current_architecture.md §8</code>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
