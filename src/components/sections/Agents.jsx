import { useState } from 'react'
import AgentCard from '../AgentCard'

// Tier-based grouping (zie agent_schedules.tier):
//   primary   = hoofdagent — altijd zichtbaar.
//   secondary = ondersteunend (auto-draft-execute, task-organizer, mail-sync) —
//               default ingeklapt onder "Achtergrond-agents (N)".
//   infra     = orchestrator/dashboard-refresh/agent-manager — helemaal verborgen.
const INFRA_HIDDEN = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

export default function Agents({ schedules, latestRuns, history, questions, salesEvents, salesTodos }) {
  const [showSecondary, setShowSecondary] = useState(false)

  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  // Bouw lijsten gegroepeerd per tier — fallback naar 'primary' voor agents
  // zonder tier-veld (DB-defaults op 'primary' maar oudere rijen kunnen NULL zijn).
  const tierOf = (agentName) => {
    const s = schedules.find(x => x.agent_name === agentName)
    if (!s) return 'primary' // alleen runs, geen schedule — toon 'm bij primary
    if (INFRA_HIDDEN.has(agentName)) return 'infra'
    return s.tier || 'primary'
  }

  const visibleAgents = schedules
    .filter(s => !INFRA_HIDDEN.has(s.agent_name))
    .map(s => s.agent_name)

  // Extras: agents met runs maar zonder schedule-rij
  const extras = Object.keys(latestRuns).filter(
    a => !visibleAgents.includes(a) && !INFRA_HIDDEN.has(a)
  )
  const allAgents = [...visibleAgents, ...extras]

  const primary   = allAgents.filter(a => tierOf(a) === 'primary')
  const secondary = allAgents.filter(a => tierOf(a) === 'secondary')

  if (primary.length === 0 && secondary.length === 0) {
    return (
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">Agents</h2>
        </div>
        <div className="empty">Geen agents geregistreerd in agent_schedules.</div>
      </section>
    )
  }

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
    <>
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">
            Hoofd-agents <span className="section__count">{primary.length}</span>
          </h2>
          <span className="section__hint">de werk-agents waar je actief mee bezig bent</span>
        </div>

        <div className="grid grid--agents">
          {primary.map(renderCard)}
        </div>
      </section>

      {/* Helper-agents als duidelijk eigen sectie ERONDER, niet als toggle in
          de header — dan is het ook visueel helder dat het een aparte rang is.
          Standaard ingeklapt; klikken opent ze. */}
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
                Stille hulpjes die op de achtergrond synchroniseren — mail-sync, autodraft-verzending, task-organizer.
                Belangrijk dat ze draaien, je hoeft er niet dagelijks naar te kijken.
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {showSecondary ? 'klik om in te klappen' : 'klik om uit te klappen'}
            </span>
          </button>

          {showSecondary && (
            <div className="grid grid--agents" style={{ marginTop: 'var(--s-3)' }}>
              {secondary.map(renderCard)}
            </div>
          )}
        </section>
      )}
    </>
  )
}
