import { useNavigate } from 'react-router-dom'
import AgendaRulesView from '../AgendaRulesView'
import './agenda-maestro.css'

/**
 * AgendaRulesMaestroView — wrapper rond AgendaRulesView voor /agenda-maestro/spelregels.
 *
 * HARD-RULE: oude AgendaRulesView blijft 100% functioneel.
 * Deze wrapper:
 *   1. Geeft AgendaRulesView een `theme-maestro agm-app agm-rules-app`-context
 *   2. Voegt mockup-topbar (crumbs) toe
 *   3. Vertaalt onNavigate('agenda') → /agenda-maestro zodat de "← Terug"-knop
 *      naar de Maestro-route gaat en niet naar de oude /agenda
 */
export default function AgendaRulesMaestroView({ onNavigate }) {
  const navigate = useNavigate()

  // onNavigate-shim: AgendaRulesView roept onNavigate('agenda') aan voor de
  // terug-knop. In Maestro-context willen we naar /agenda-maestro.
  const handleNavigate = (viewId) => {
    if (viewId === 'agenda') {
      // Direct naar Maestro-agenda
      if (onNavigate) onNavigate('agenda_maestro')
      else navigate('/agenda-maestro')
      return
    }
    if (onNavigate) onNavigate(viewId)
  }

  return (
    <div className="theme-maestro agm-app agm-rules-app">
      <header className="agm-topbar">
        <div className="agm-crumbs">
          <span>Werkruimte</span>
          <span className="agm-crumbs__sep">/</span>
          <span>Agenda</span>
          <span className="agm-crumbs__sep">/</span>
          <span className="agm-crumbs__current">Spelregels</span>
        </div>
      </header>

      <div className="agm-surface agm-rules-surface">
        <AgendaRulesView onNavigate={handleNavigate} />
      </div>
    </div>
  )
}
