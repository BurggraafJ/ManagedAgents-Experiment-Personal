import { useState, useMemo, useEffect } from 'react'
import { SettingsPage } from '../SettingsLayout'
import { friendlyName } from '../../../../lib/agentInstructions'
import AgentTabsRow from './AgentTabsRow'
import InstructionsEditor from './InstructionsEditor'
import CategoryPreferencesPanel from './CategoryPreferencesPanel'

// InstructiesPage — system-messages per agent. Vervangt de oude AgentInstructions
// section die in een grid van kleine kaartjes met collapse-toggle stond. Hier:
// agent-picker als horizontale tab-rij bovenaan, daaronder ÉÉN groot editor-vlak.
// Bedoeld om uitnodigend te zijn — instructies aanpassen is een van de meest
// terugkerende beheer-acties, dus geen muis-circus en niet "verstopt".
export default function InstructiesPage({ schedules, agentInstructions, autodraftCategories }) {
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
  const [view, setView] = useState('agents')  // 'agents' | 'preferences'

  useEffect(() => {
    if (!activeAgent && agents.length > 0) setActiveAgent(agents[0].agent_name)
  }, [agents, activeAgent])

  const activeSchedule = agents.find(a => a.agent_name === activeAgent) || null
  const activeRow = activeAgent ? lookup[activeAgent] : null

  return (
    <SettingsPage
      title="Agents"
      intro="Vrije-tekst richtlijnen per agent. De agent leest deze bij elke run als aanvulling op de SKILL.md. Plak gerust uit ChatGPT — bold en regel­einden blijven behouden."
    >
      {/* View-switch — algemene agent-instructies óf voorkeuren per categorie/tone/globaal */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { id: 'agents',      label: 'Per agent' },
          { id: 'preferences', label: 'Voorkeuren per categorie / tone' },
        ].map(opt => {
          const on = view === opt.id
          return (
            <button key={opt.id} type="button" onClick={() => setView(opt.id)}
              style={{
                padding: '6px 14px', borderRadius: 999,
                border: '1px solid var(--border)',
                background: on ? 'var(--accent-soft)' : 'var(--bg)',
                color: on ? 'var(--accent)' : 'var(--text)',
                fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 600 : 400,
                cursor: 'pointer',
              }}>{opt.label}</button>
          )
        })}
      </div>

      {view === 'preferences' ? (
        <CategoryPreferencesPanel categories={autodraftCategories || []} />
      ) : agents.length === 0 ? (
        <div className="empty empty--compact">
          Geen agents geladen — check of <span className="mono">agent_schedules</span> rijen heeft.
        </div>
      ) : (
        <div className="instructies">
          <AgentTabsRow
            agents={agents}
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            lookup={lookup}
          />
          {activeSchedule && (
            <InstructionsEditor
              key={activeSchedule.agent_name}
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </div>
      )}
    </SettingsPage>
  )
}
