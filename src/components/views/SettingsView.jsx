import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsLayout from './settings/SettingsLayout'
import InstructiesPage       from './settings/instructies/InstructiesPage'
import TemplatesPage         from './settings/TemplatesPage'
import TerminologiePage      from './settings/TerminologiePage'
import ApiKeysPage           from './settings/ApiKeysPage'
import ConfiguratiePage      from './settings/ConfiguratiePage'
import EdgeFunctionsPage     from './settings/EdgeFunctionsPage'
import DeploymentsPage       from './settings/DeploymentsPage'
import ChatInstructiesPage   from './settings/ChatInstructiesPage'
import { useAgents } from '../../hooks/useAgents'
import { useAutoDraft } from '../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../hooks/useSupabaseQuery'

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
      { id: 'chat',         label: 'Chat-assistent' },
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
  chat:           'chat',
  terminologie:   'terminologie',
  'api-keys':     'api-keys',
  configuratie:   'configuratie',
  'edge-functions': 'edge-functions',
  deployments:    'deployments',
}
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

export default function SettingsView() {
  // Refactor 24 — hook-migratie: data-prop weg, fetches via feature-hooks +
  // useSupabaseQuery voor de twee tabellen die alleen settings raken.
  const { schedules } = useAgents()
  const { agentInstructions, categories: autodraftCategories } = useAutoDraft()
  const { data: noteTemplates } = useSupabaseQuery('note_templates', {
    orderBy: ['sort_order', { ascending: true }],
    realtime: true,
  })
  const { data: terminology } = useSupabaseQuery('terminology_corrections', {
    orderBy: ['incorrect', { ascending: true }],
    realtime: true,
  })

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
      {page === 'instructies'   && <InstructiesPage  schedules={schedules} agentInstructions={agentInstructions} autodraftCategories={autodraftCategories} />}
      {page === 'templates'     && <TemplatesPage    templates={noteTemplates} />}
      {page === 'chat'          && <ChatInstructiesPage />}
      {page === 'terminologie'  && <TerminologiePage rows={terminology} />}
      {page === 'api-keys'      && <ApiKeysPage />}
      {page === 'configuratie'  && <ConfiguratiePage />}
      {page === 'edge-functions' && <EdgeFunctionsPage />}
      {page === 'deployments'   && <DeploymentsPage />}
    </SettingsLayout>
  )
}
