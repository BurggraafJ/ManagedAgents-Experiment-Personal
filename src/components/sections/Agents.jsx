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
    <section id="agents">
      <div className="section__head">
        <h2 className="section__title">
          Agents <span className="section__count">{primary.length}</span>
        </h2>
        {secondary.length > 0 && (
          <button
            type="button"
            className="btn btn--ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => setShowSecondary(v => !v)}
          >
            {showSecondary
              ? `▾ verberg achtergrond-agents`
              : `▸ toon achtergrond-agents (${secondary.length})`}
          </button>
        )}
      </div>

      <div className="grid grid--agents">
        {primary.map(renderCard)}
      </div>

      {showSecondary && secondary.length > 0 && (
        <>
          <div className="section__hint" style={{ marginTop: 'var(--s-5)', marginBottom: 'var(--s-3)' }}>
            Achtergrond-agents — plumbing die in stilte hun werk doet (mail-sync, task-organizer, autodraft-execute).
            Belangrijk dat ze draaien, maar je hoeft er niet dagelijks naar te kijken.
          </div>
          <div className="grid grid--agents">
            {secondary.map(renderCard)}
          </div>
        </>
      )}
    </section>
  )
}
