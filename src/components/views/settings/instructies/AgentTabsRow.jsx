import { friendlyName } from '../../../../lib/agentInstructions'

// AgentTabsRow — horizontale tab-rij met agent-pickers + dot-indicator
// (groen = instructies ingesteld, grijs = geen instructies, gebruikt SKILL.md).
export default function AgentTabsRow({ agents, activeAgent, setActiveAgent, lookup }) {
  return (
    <div className="instructies__tabs" role="tablist">
      {agents.map(s => {
        const active = s.agent_name === activeAgent
        const text = (lookup[s.agent_name]?.config_value?.text || '').trim()
        const has = text.length > 0
        return (
          <button
            key={s.agent_name}
            type="button"
            role="tab"
            aria-selected={active}
            className={`instructies__tab ${active ? 'is-active' : ''}`}
            onClick={() => setActiveAgent(s.agent_name)}
          >
            <span className="instructies__tab-label">{friendlyName(s)}</span>
            <span
              className={`instructies__tab-dot ${has ? 'is-set' : 'is-empty'}`}
              title={has ? 'Instructies ingesteld' : 'Geen instructies — gebruikt alleen SKILL.md'}
            />
          </button>
        )
      })}
    </div>
  )
}
