import { friendlyName, instructionText, ruleCount, scheduleLabel, editedLabel } from '../../../../../lib/agentInstructions'

/**
 * AgentList — agent-kolom links van de editor (v1.126, design A). Vervangt de
 * horizontale chip-rij (AgentTabs): twee secties — Met eigen regels (groene
 * dot, schema · bewerkt, aantal regels) en Alleen SKILL.md (grijze dot).
 */
export default function AgentList({ agents, activeAgent, setActiveAgent, lookup }) {
  const withRules = [], without = []
  for (const a of agents) (instructionText(lookup[a.agent_name]) ? withRules : without).push(a)

  const renderRow = (s, has) => {
    const row = lookup[s.agent_name]
    const active = s.agent_name === activeAgent
    const n = has ? ruleCount(instructionText(row)) : 0
    const sub = has ? [scheduleLabel(s), editedLabel(row?.updated_at)].filter(Boolean).join(' · ') : ''
    return (
      <button
        key={s.agent_name}
        type="button"
        role="tab"
        aria-selected={active}
        className={`set-alist__row ${active ? 'is-active' : ''}`}
        onClick={() => setActiveAgent(s.agent_name)}
      >
        <span className={`set-tab__dot ${has ? '' : 'is-empty'}`} title={has ? 'Instructies ingesteld' : 'Geen instructies — alleen SKILL.md'} />
        <span className="set-alist__txt">
          <span className="set-alist__name">{friendlyName(s)}</span>
          {sub && <span className="set-alist__sub">{sub}</span>}
        </span>
        {has && <span className="set-alist__count">{n}</span>}
      </button>
    )
  }

  return (
    <aside className="set-alist" role="tablist" aria-label="Agents">
      {withRules.length > 0 && (
        <>
          <div className="set-alist__head">Met eigen regels</div>
          {withRules.map(s => renderRow(s, true))}
        </>
      )}
      {without.length > 0 && (
        <>
          <div className="set-alist__head">Alleen SKILL.md</div>
          {without.map(s => renderRow(s, false))}
        </>
      )}
    </aside>
  )
}
