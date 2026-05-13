import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsV2Layout from './SettingsV2Layout'
import SettingsV2Skeleton from './SettingsV2Skeleton'
import AgentsPage from './pages/AgentsPage'
import TerminologiePage from './pages/TerminologiePage'
import ChatPage from './pages/ChatPage'
import ConfiguratiePage from './pages/ConfiguratiePage'
import DeploymentsPage from './pages/DeploymentsPage'
import EdgeFunctionsPage from './pages/EdgeFunctionsPage'
import TemplatesPage from './pages/TemplatesPage'
import ApiKeysPage from './pages/ApiKeysPage'
import { useAgents } from '../../../hooks/useAgents'
import { useAutoDraft } from '../../../hooks/useAutoDraft'

/**
 * SettingsV2View — fresh build van Settings (2026-05-13).
 *
 * Geen redesign-overlay op SettingsView (v1) — eigen folder, eigen route,
 * eigen styling (.sv2-*). v1 blijft naast v2 leven tot v2 alle pages dekt;
 * dan kan v1 weg.
 *
 * Eerste page = Agents (vrije-tekst instructies). Overige pages zijn nog
 * stubs ("komt later") zodat de nav-pane werkbaar is.
 */

// Nav-icons inline SVG — zelfde set als mockup
const NAV = [
  {
    id: 'instructies', label: 'Instructies',
    items: [
      {
        id: 'agents',
        label: 'Agents',
        meta: '11',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
        ),
      },
      {
        id: 'administratie',
        label: 'Administratie',
        meta: '7',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9h10M7 13h10M7 17h6" />
          </svg>
        ),
      },
      {
        id: 'chat',
        label: 'Chat-assistent',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
        ),
      },
    ],
  },
  {
    id: 'algemeen', label: 'Algemeen',
    items: [
      {
        id: 'terminologie',
        label: 'Terminologie',
        meta: '3',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 16 6-12 6 12" />
            <path d="M8 12h8" />
          </svg>
        ),
      },
    ],
  },
  {
    id: 'tokens', label: 'Tokens',
    items: [
      {
        id: 'api-keys',
        label: 'API Keys',
        meta: '3 ⚠',
        metaTone: 'warn',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7.5" cy="15.5" r="5.5" />
            <path d="m21 2-9.6 9.6" />
            <path d="m15.5 7.5 3 3L22 7l-3-3" />
          </svg>
        ),
      },
    ],
  },
  {
    id: 'infra', label: 'Infrastructuur',
    items: [
      {
        id: 'configuratie',
        label: 'Configuratie',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </svg>
        ),
      },
      {
        id: 'edge-functions',
        label: 'Edge Functions',
        meta: '17',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        ),
      },
      {
        id: 'deployments',
        label: 'Deployments',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 7h14M5 12h14M5 17h14" />
          </svg>
        ),
      },
    ],
  },
]

const DEFAULT_PAGE = 'agents'

// page-id ↔ URL-slug. Houden we expliciet zodat de URL leesbaar is
// (/instellingen-v2/agents) maar de interne id stabiel blijft.
const PAGE_SLUGS = {
  agents:           'agents',
  administratie:    'administratie',
  chat:             'chat',
  terminologie:     'terminologie',
  'api-keys':       'api-keys',
  configuratie:     'configuratie',
  'edge-functions': 'edge-functions',
  deployments:      'deployments',
}
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

export default function SettingsV2View() {
  const { schedules } = useAgents()
  const { agentInstructions, categories: autodraftCategories } = useAutoDraft()

  const navigate = useNavigate()
  const params = useParams()
  const slug = params['*'] || ''

  if (!slug) {
    return <Navigate to={`/instellingen-v2/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  const page = SLUG_TO_PAGE[slug]
  if (!page) {
    return <Navigate to={`/instellingen-v2/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  const setPage = (p) => {
    const newSlug = PAGE_SLUGS[p] || PAGE_SLUGS[DEFAULT_PAGE]
    navigate(`/instellingen-v2/${newSlug}`)
  }

  // Skeleton tijdens initial-load — schedules is de eerste relevante data
  // voor de Agents-page (default).
  if (!schedules) {
    return <SettingsV2Skeleton />
  }

  return (
    <SettingsV2Layout
      groups={NAV}
      activePage={page}
      onSelectPage={setPage}
    >
      {page === 'agents' && (
        <AgentsPage
          schedules={schedules}
          agentInstructions={agentInstructions}
          autodraftCategories={autodraftCategories}
        />
      )}
      {page === 'administratie'    && <TemplatesPage />}
      {page === 'chat'             && <ChatPage />}
      {page === 'terminologie'     && <TerminologiePage />}
      {page === 'api-keys'         && <ApiKeysPage />}
      {page === 'configuratie'     && <ConfiguratiePage />}
      {page === 'edge-functions'   && <EdgeFunctionsPage />}
      {page === 'deployments'      && <DeploymentsPage />}
    </SettingsV2Layout>
  )
}
