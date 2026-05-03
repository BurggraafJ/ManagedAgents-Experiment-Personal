import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsLayout from './settings/SettingsLayout'
import InstructiesPage       from './settings/InstructiesPage'
import TemplatesPage         from './settings/TemplatesPage'
import TerminologiePage      from './settings/TerminologiePage'
import ApiKeysPage           from './settings/ApiKeysPage'
import ConfiguratiePage      from './settings/ConfiguratiePage'
import EdgeFunctionsPage     from './settings/EdgeFunctionsPage'
import DeploymentsPage       from './settings/DeploymentsPage'

// SettingsView — Claude-style admin: links een vaste nav-pane (gegroepeerd
// in secties), rechts de content van één pagina tegelijk.
//
// Schedules + cadence per agent zitten HIER NIET — die regel je via het
// ⋯-menu op de agent-card op het Dashboard. Zie agent_schedules.

const NAV = [
  {
    id: 'instructies', label: 'Instructies',
    items: [
      { id: 'instructies',  label: 'Agents' },
      { id: 'templates',    label: 'Administratie' },
    ],
  },
  {
    id: 'algemeen', label: 'Algemeen',
    items: [
      { id: 'terminologie', label: 'Terminologie' },
    ],
  },
  {
    id: 'tokens', label: 'Tokens',
    items: [
      { id: 'api-keys', label: 'API Keys' },
    ],
  },
  {
    id: 'infra', label: 'Infrastructuur',
    items: [
      { id: 'configuratie',   label: 'Configuratie' },
      { id: 'edge-functions', label: 'Edge Functions' },
      { id: 'deployments',    label: 'Deployments' },
    ],
  },
]

const DEFAULT_PAGE = 'instructies'

// page-id ↔ URL-slug. Houden we expliciet zodat de URL leesbaar is
// (/instellingen/agents) maar de interne id stabiel blijft (instructies).
const PAGE_SLUGS = {
  instructies:    'agents',
  templates:      'administratie',
  terminologie:   'terminologie',
  'api-keys':     'api-keys',
  configuratie:   'configuratie',
  'edge-functions': 'edge-functions',
  deployments:    'deployments',
}
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

export default function SettingsView({ data }) {
  const navigate = useNavigate()
  const params = useParams()
  const slug = params['*'] || ''

  // Geen sub-pad? Stuur door naar de default-pagina zodat de URL altijd
  // exact weergeeft op welke instelling je staat.
  if (!slug) {
    return <Navigate to={`/instellingen/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  const page = SLUG_TO_PAGE[slug]
  // Onbekende slug → terug naar default.
  if (!page) {
    return <Navigate to={`/instellingen/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  const setPage = (p) => {
    const newSlug = PAGE_SLUGS[p] || PAGE_SLUGS[DEFAULT_PAGE]
    navigate(`/instellingen/${newSlug}`)
  }

  return (
    <SettingsLayout
      groups={NAV}
      activePage={page}
      onSelectPage={setPage}
    >
      {page === 'instructies'   && <InstructiesPage  schedules={data.schedules} agentInstructions={data.agentInstructions} />}
      {page === 'templates'     && <TemplatesPage    templates={data.noteTemplates} />}
      {page === 'terminologie'  && <TerminologiePage rows={data.terminology} />}
      {page === 'api-keys'      && <ApiKeysPage      secretsInventory={data.secretsInventory} skillSecrets={data.skillSecrets} />}
      {page === 'configuratie'  && <ConfiguratiePage />}
      {page === 'edge-functions' && <EdgeFunctionsPage />}
      {page === 'deployments'   && <DeploymentsPage />}
    </SettingsLayout>
  )
}
