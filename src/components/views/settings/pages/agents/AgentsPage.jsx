import { useState, useEffect, useMemo } from 'react'
import { friendlyName } from '../../../../../lib/agentInstructions'
import { SettingsPage } from '../../SettingsLayout'
import AgentTabs from './AgentTabs'
import AgentEditor from './AgentEditor'

/**
 * AgentsPage — vrije-tekst instructies per agent.
 *
 * Data: schedules + agentInstructions (props van SettingsView).
 * Sub-componenten: AgentTabs (horizontale picker) + AgentEditor (RichTextEditor
 * + opslaan-flow via upsert_agent_instructions RPC).
 *
 * View-toggle: Per agent (default) vs Voorkeuren per categorie/tone (stub).
 */
export default function AgentsPage({ schedules, agentInstructions, autodraftCategories }) {
  const [view, setView] = useState('agents')

  const agents = useMemo(() => {
    return (schedules || [])
      .filter(s => !['orchestrator', 'agent-manager', 'dashboard-refresh'].includes(s.agent_name))
      .slice()
      .sort((a, b) => {
        if (a.agent_name === 'daily-admin') return -1
        if (b.agent_name === 'daily-admin') return 1
        return friendlyName(a).localeCompare(friendlyName(b))
      })
  }, [schedules])

  const lookup = useMemo(() => {
    const m = {}
    for (const row of agentInstructions || []) m[row.agent_name] = row
    return m
  }, [agentInstructions])

  const [activeAgent, setActiveAgent] = useState(null)
  useEffect(() => {
    if (!activeAgent && agents.length > 0) setActiveAgent(agents[0].agent_name)
  }, [agents, activeAgent])

  const activeSchedule = agents.find(a => a.agent_name === activeAgent) || null
  const activeRow = activeAgent ? lookup[activeAgent] : null

  return (
    <SettingsPage
      title="Agents"
      intro="Vrije-tekst richtlijnen per agent. De agent leest deze bij elke run als aanvulling op de SKILL.md."
      right={
        <span className="sv2-pill sv2-pill--ok">
          <span className="sv2-pill__dot" />
          Live
        </span>
      }
    >
      <div className="sv2-toggle">
        {[
          { id: 'agents',      label: 'Per agent' },
          { id: 'preferences', label: 'Voorkeuren per categorie / tone' },
        ].map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setView(opt.id)}
            className={`sv2-toggle__btn ${view === opt.id ? 'is-active' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {view === 'preferences' ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Voorkeuren per categorie / tone — komt later</div>
          <div className="sv2-stub__hint">
            Deze view (AutoDraft-categorieën met tone-guides) wordt in een volgende
            iteratie gemigreerd.
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Geen agents geladen</div>
          <div className="sv2-stub__hint">
            Check of <code>agent_schedules</code> rijen heeft.
          </div>
        </div>
      ) : (
        <>
          <AgentTabs
            agents={agents}
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            lookup={lookup}
          />
          {activeSchedule && (
            <AgentEditor
              key={activeSchedule.agent_name}
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </>
      )}
    </SettingsPage>
  )
}
