import { friendlyName } from '../../../../../lib/agentInstructions'

/**
 * AgentTabs — horizontale tab-rij met agent-pickers + dot-indicator.
 * Groen dot = instructies ingesteld, grijs = geen instructies (alleen SKILL.md).
 */
export default function AgentTabs({ agents, activeAgent, setActiveAgent, lookup }) {
  return (
    <div className="sv2-tabs" role="tablist">
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
            className={`sv2-tab ${active ? 'is-active' : ''}`}
            onClick={() => setActiveAgent(s.agent_name)}
          >
            <span>{friendlyName(s)}</span>
            <span
              className={`sv2-tab__dot ${has ? '' : 'is-empty'}`}
              title={has ? 'Instructies ingesteld' : 'Geen instructies — alleen SKILL.md'}
            />
          </button>
        )
      })}
    </div>
  )
}
