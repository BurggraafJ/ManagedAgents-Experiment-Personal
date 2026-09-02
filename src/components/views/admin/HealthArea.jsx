import { Link } from 'react-router-dom'
import HealthView from '../health/HealthView'
import AgentMonitorPage from '../settings/pages/AgentMonitorPage'
import { useAgents } from '../../../hooks/useAgents'

// HealthArea (v1.128) — Health & Issues met het Agent-overzicht (voorheen
// Instellingen › Agent-overzicht) als tweede tab. Beide tabs zijn de
// bestaande componenten, ongewijzigd; alleen de plek is nieuw.
const TABS = [
  { key: 'health', label: 'Health & Issues', path: '/admin/health' },
  { key: 'agents', label: 'Agent-overzicht', path: '/admin/health/agents' },
]

export default function HealthArea({ tab = 'health' }) {
  return (
    <>
      <AdminTabs tabs={TABS} active={tab} />
      {tab === 'agents' ? <AgentMonitorTab /> : <HealthView />}
    </>
  )
}

// useAgents alleen in deze tab (niet in de shell) — één hook-instantie per tree.
function AgentMonitorTab() {
  const { schedules, latestRuns, history, todayRuns } = useAgents()
  if (!schedules) return <div className="skeleton" style={{ height: 320 }} />
  return (
    <div className="set-app set-app--embed">
      <AgentMonitorPage schedules={schedules} latestRuns={latestRuns} history={history} todayRuns={todayRuns} />
    </div>
  )
}

export function AdminTabs({ tabs, active }) {
  return (
    <nav className="admin-tabs" aria-label="Sub-navigatie">
      {tabs.map(t => (
        <Link key={t.key} to={t.path} className={`admin-tab ${active === t.key ? 'is-active' : ''}`} aria-current={active === t.key ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
