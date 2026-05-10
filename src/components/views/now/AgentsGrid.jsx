import { useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { NEVER_SHOW } from '../../../lib/agentFunctions'
import MaestroAgentCard from './MaestroAgentCard'
import AgentVisibilityModal from './AgentVisibilityModal'
import Icon from './Icon'

// AgentsGrid — toont alle zichtbare agents (filter NEVER_SHOW + tier-source +
// show_in_overview). Geeft "Beheer zichtbaarheid"-knop in section-head die
// AgentVisibilityModal opent. Per card een 3-puntjes-menu voor snel verbergen.
export default function AgentsGrid({ schedules, latestRuns, history }) {
  const [vmodalOpen, setVmodalOpen] = useState(false)
  // Lokale optimistic-hide state voor snelle "verberg uit overzicht" via
  // de 3-puntjes-knop. Bij echte sla-actie roepen we de RPC aan en sluiten
  // we de hide direct toe; de schedules-prop ververst zichzelf via realtime.
  const [optimisticHidden, setOptimisticHidden] = useState({})

  const visible = useMemo(() => {
    return (schedules || [])
      .filter(s => !NEVER_SHOW.has(s.agent_name))
      .filter(s => s.tier !== 'source')
      .filter(s => {
        if (optimisticHidden[s.agent_name]) return false
        return s.show_in_overview !== false
      })
  }, [schedules, optimisticHidden])

  // Voor de visibility-modal willen we ALLE agents zien — niet de filter.
  const allManageable = useMemo(() => {
    return (schedules || [])
      .filter(s => !NEVER_SHOW.has(s.agent_name))
      .filter(s => s.tier !== 'source')
  }, [schedules])

  async function onLocalHide(agentName) {
    setOptimisticHidden(prev => ({ ...prev, [agentName]: true }))
    try {
      await supabase.rpc('set_agent_overview_visibility', {
        p_agent_name: agentName,
        p_visible: false,
      })
    } catch (e) {
      // Rollback bij fout
      setOptimisticHidden(prev => ({ ...prev, [agentName]: false }))
      console.error('set_agent_overview_visibility', e)
    }
  }

  return (
    <section className="now-section">
      <div className="now-section__head">
        <div className="now-section__head-left">
          <h2>Agents <span>· {visible.length} in overzicht</span></h2>
          <span className="now-section__hint">klik status om te wisselen · ▶ run nu · ⚙ instellingen · ⋯ verbergen / beheren</span>
        </div>
        <button
          type="button"
          className="now-btn now-btn--ghost"
          onClick={() => setVmodalOpen(true)}
          title="Beheer welke agents in dit overzicht staan"
        >
          <Icon size={13}><path d="M3 6h18M3 12h18M3 18h18"/></Icon>
          Beheer zichtbaarheid
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="now-empty">
          alle agents verborgen — open <button type="button" className="now-empty__link" onClick={() => setVmodalOpen(true)}>beheer zichtbaarheid</button> om er weer toe te voegen
        </div>
      ) : (
        <div className="now-agents-grid">
          {visible.map(s => (
            <MaestroAgentCard
              key={s.agent_name}
              schedule={s}
              latestRun={latestRuns?.[s.agent_name]}
              history={history?.[s.agent_name] || []}
              onOpenVisibilityModal={() => setVmodalOpen(true)}
              onLocalHide={onLocalHide}
            />
          ))}
        </div>
      )}

      {vmodalOpen && (
        <AgentVisibilityModal
          schedules={allManageable}
          onClose={() => setVmodalOpen(false)}
          onSave={() => setOptimisticHidden({})}
        />
      )}
    </section>
  )
}
