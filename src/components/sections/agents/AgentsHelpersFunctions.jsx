import { useState } from 'react'
import { AgentCardC as AgentCard } from '../../AgentCardVariants'
import { AGENT_PAGE_FUNCTIONS, NEVER_SHOW } from '../../../lib/agentFunctions'
import FunctionTile from './FunctionTile'

// Aparte sectie voor helpers + functies — wordt op het Dashboard helemaal
// onderaan gerenderd (na de Database-sectie). Beide default ingeklapt.
export default function AgentsHelpersFunctions({ schedules, latestRuns, history, questions, salesEvents, salesTodos }) {
  const [showSecondary, setShowSecondary] = useState(false)
  const [showFunctions, setShowFunctions] = useState(false)

  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  const tierOf = (agentName) => {
    const s = schedules.find(x => x.agent_name === agentName)
    if (!s) return 'primary'
    if (NEVER_SHOW.has(agentName)) return 'infra'
    return s.tier || 'primary'
  }
  const visibleAgents = schedules.filter(s => !NEVER_SHOW.has(s.agent_name)).map(s => s.agent_name)
  const extras = Object.keys(latestRuns).filter(a => !visibleAgents.includes(a) && !NEVER_SHOW.has(a))
  const allAgents = [...visibleAgents, ...extras]
  const secondary = allAgents.filter(a => tierOf(a) === 'secondary')

  const renderCard = (name) => (
    <AgentCard
      key={name}
      agent={name}
      schedule={schedules.find(s => s.agent_name === name)}
      latestRun={latestRuns[name]}
      history={history[name] || []}
      openQuestions={questionsByAgent[name] || []}
      extras={
        name === 'sales-on-road' ? { salesEvents } :
        name === 'sales-todos'   ? { salesTodos } :
        {}
      }
    />
  )

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--s-5)', alignItems: 'start' }}
    >
      {secondary.length > 0 && (
        <section id="agents-helpers" style={{ opacity: showSecondary ? 1 : 0.85 }}>
          <button
            type="button"
            onClick={() => setShowSecondary(v => !v)}
            className="card"
            style={{
              width: '100%',
              padding: 'var(--s-4) var(--s-5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              cursor: 'pointer',
              background: 'var(--bg-2)',
              border: '1px dashed var(--border)',
              textAlign: 'left',
            }}
          >
            <div>
              <div className="kpi__label" style={{ margin: 0 }}>
                <span aria-hidden style={{ marginRight: 6 }}>{showSecondary ? '▾' : '▸'}</span>
                Helper-agents <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>({secondary.length})</span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
                Stille hulpjes die op de achtergrond werken — autodraft-verzending en task-organizer.
                Belangrijk dat ze draaien, je hoeft er niet dagelijks naar te kijken.
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {showSecondary ? 'klik om in te klappen' : 'klik om uit te klappen'}
            </span>
          </button>

          {showSecondary && (
            <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
              {secondary.map(renderCard)}
            </div>
          )}
        </section>
      )}

      <section id="agents-functions" style={{ opacity: showFunctions ? 1 : 0.85 }}>
        <button
          type="button"
          onClick={() => setShowFunctions(v => !v)}
          className="card"
          style={{
            width: '100%',
            padding: 'var(--s-4) var(--s-5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            cursor: 'pointer',
            background: 'var(--bg-2)',
            border: '1px dashed var(--border)',
            textAlign: 'left',
          }}
        >
          <div>
            <div className="kpi__label" style={{ margin: 0 }}>
              <span aria-hidden style={{ marginRight: 6 }}>{showFunctions ? '▾' : '▸'}</span>
              Functies <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>({AGENT_PAGE_FUNCTIONS.length})</span>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>
              Edge-functions die agents + dashboard onder water aanroepen —
              embeddings, RAG-prefill, Whisper, deploy, enz. Technisch overzicht op /Functies.
            </div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {showFunctions ? 'klik om in te klappen' : 'klik om uit te klappen'}
          </span>
        </button>

        {showFunctions && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
            {AGENT_PAGE_FUNCTIONS.map(fn => (
              <FunctionTile key={fn.agent} fn={fn} latestRun={latestRuns[fn.agent]} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
