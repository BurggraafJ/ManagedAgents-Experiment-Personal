import AgentCard from '../AgentCard'

export default function Agents({ schedules, latestRuns, history, questions, salesEvents, salesTodos }) {
  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  // Derive agent list from schedules — alleen werk-agents, geen infra/admin
  const HIDDEN = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])
  const agents = schedules
    .filter(s => !HIDDEN.has(s.agent_name))
    .map(s => s.agent_name)

  // Fallback: include any agent that has a run but isn't in schedules
  const extras = Object.keys(latestRuns).filter(a => !agents.includes(a) && !HIDDEN.has(a))
  const allAgents = [...agents, ...extras]

  if (allAgents.length === 0) {
    return (
      <section id="agents">
        <div className="section__head">
          <h2 className="section__title">Agents</h2>
        </div>
        <div className="empty">Geen agents geregistreerd in agent_schedules.</div>
      </section>
    )
  }

  return (
    <section id="agents">
      <div className="section__head">
        <h2 className="section__title">Agents <span className="section__count">{allAgents.length}</span></h2>
      </div>

      <div className="grid grid--agents">
        {allAgents.map(name => (
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
        ))}
      </div>
    </section>
  )
}
