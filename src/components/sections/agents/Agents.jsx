import { AgentCardC as AgentCard } from '../../AgentCardVariants'
import { NEVER_SHOW } from '../../../lib/agentFunctions'

export default function Agents({ schedules, latestRuns, history, questions, salesEvents, salesTodos }) {
  const Card = AgentCard

  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  // Bouw lijsten gegroepeerd per tier — fallback naar 'primary' voor agents
  // zonder tier-veld (DB-defaults op 'primary' maar oudere rijen kunnen NULL zijn).
  const tierOf = (agentName) => {
    const s = schedules.find(x => x.agent_name === agentName)
    if (!s) return 'primary'
    if (NEVER_SHOW.has(agentName)) return 'infra'
    return s.tier || 'primary'
  }

  const visibleAgents = schedules
    .filter(s => !NEVER_SHOW.has(s.agent_name))
    .map(s => s.agent_name)

  const extras = Object.keys(latestRuns).filter(
    a => !visibleAgents.includes(a) && !NEVER_SHOW.has(a)
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
    <Card
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

  // Voorstel C (Activity Feed) is de gekozen layout. Grid van 360px-cards,
  // auto-fit zodat het op grote schermen 2-3 kolommen wordt.
  const primaryGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--s-4)' }

  return (
    <section id="agents">
      <div className="section__head">
        <h2 className="section__title">
          Hoofd-agents <span className="section__count">{primary.length}</span>
        </h2>
        <span className="section__hint">de werk-agents waar je actief mee bezig bent</span>
      </div>
      <div style={primaryGridStyle}>
        {primary.map(renderCard)}
      </div>
    </section>
  )
}
