import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsLayout from './SettingsLayout'
import SettingsSkeleton from './SettingsSkeleton'
import AgentsPage from './pages/agents/AgentsPage'
import AgentMonitorPage from './pages/AgentMonitorPage'
import TerminologiePage from './pages/TerminologiePage'
import ChatPage from './pages/ChatPage'
import TemplatesPage from './pages/TemplatesPage'
import ExternePartijenPage from './pages/ExternePartijenPage'
import DatabasePage from './pages/DatabasePage'
import ApiKeysPage from './pages/api-keys/ApiKeysPage'
import MailVerrijkingPage from './pages/uitleg/MailVerrijkingPage'
import AutoDraftPage from './pages/uitleg/AutoDraftPage'
import { useAgents } from '../../../hooks/useAgents'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useMediaQuery } from '../../../hooks/useMediaQuery'

/**
 * SettingsView — Maestro-design settings (full rebuild 2026-05-13).
 *
 * Layout-shell + nav + 8 pages onder eigen .set-* scope. Schema:
 *
 *   src/components/views/settings/
 *   ├── SettingsView.jsx        (deze file — routing + page-switch)
 *   ├── SettingsLayout.jsx      (shell + nav + page-head)
 *   ├── SettingsSkeleton.jsx    (loading-state)
 *   ├── settings.css            (alle styling)
 *   └── pages/
 *       ├── agents/             (instructies per agent — main + tabs + editor)
 *       ├── api-keys/           (credentials tabel + edit-modal)
 *       ├── TerminologiePage.jsx
 *       ├── ChatPage.jsx
 *       ├── ConfiguratiePage.jsx
 *       ├── DeploymentsPage.jsx
 *       ├── EdgeFunctionsPage.jsx
 *       └── TemplatesPage.jsx
 *
 * Route: /instellingen/<slug> (slug-mapping hieronder).
 */

const NAV = [
  {
    id: 'instructies', label: 'Instructies',
    items: [
      {
        id: 'agents', label: 'Agents', meta: '11',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
        ),
      },
      {
        id: 'agent-monitor', label: 'Agent-overzicht',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />
          </svg>
        ),
      },
      {
        id: 'administratie', label: 'Administratie', meta: '7',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 9h10M7 13h10M7 17h6" />
          </svg>
        ),
      },
      {
        id: 'chat', label: 'Chat-assistent',
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
        id: 'terminologie', label: 'Terminologie', meta: '3',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 16 6-12 6 12" />
            <path d="M8 12h8" />
          </svg>
        ),
      },
      {
        id: 'externe-partijen', label: 'Externe partijen',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21v-2a4 4 0 0 1 4-4h4" />
            <circle cx="9" cy="7" r="4" />
            <path d="M16 11h6M16 15h6M16 19h6" />
          </svg>
        ),
      },
      {
        id: 'database', label: 'Database',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M3 5v6a9 3 0 0 0 18 0V5" />
            <path d="M3 11v6a9 3 0 0 0 18 0v-6" />
          </svg>
        ),
      },
    ],
  },
  {
    id: 'uitleg', label: 'Uitleg',
    items: [
      {
        id: 'uitleg-mail-verrijking', label: 'Mail-verrijking',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16v12H4z" />
            <path d="m4 7 8 6 8-6" />
            <circle cx="18" cy="6" r="3" fill="currentColor" stroke="none" opacity=".25" />
          </svg>
        ),
      },
      {
        id: 'uitleg-autodraft', label: 'AutoDraft',
        icon: (
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        ),
      },
    ],
  },
  {
    id: 'tokens', label: 'Tokens', adminOnly: true,
    items: [
      {
        id: 'api-keys', label: 'API Keys', meta: '3 ⚠', metaTone: 'warn',
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
]

const DEFAULT_PAGE = 'agents'

// page-id ↔ URL-slug. Houden we expliciet zodat de URL leesbaar is
// (/instellingen/agents) maar de interne id stabiel blijft.
const PAGE_SLUGS = {
  agents:               'agents',
  'agent-monitor':      'agent-overzicht',
  administratie:        'administratie',
  chat:                 'chat',
  terminologie:         'terminologie',
  'externe-partijen':   'externe-partijen',
  database:             'database',
  'api-keys':           'api-keys',
  'uitleg-mail-verrijking': 'uitleg/mail-verrijking',
  'uitleg-autodraft':       'uitleg/autodraft',
  // Configuratie, Edge Functions en Deployments zijn verhuisd naar /admin/*
  // (Infrastructuur-groep in de admin-sidebar) per 2026-05-22.
}

// Default basePath = /instellingen (hoofd-Dashboard route, voor iedereen).
// Tokens + Infrastructuur groepen worden binnen deze view role-gegated op
// isOwner; bij directe URL-access naar admin-only page redirect naar agents.
const DEFAULT_BASE_PATH = '/instellingen'
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

// Pages die binnen de admin-only NAV-groups vallen — voor non-owner geblokkeerd.
const ADMIN_ONLY_PAGES = new Set(['api-keys'])

// Pages die op mobiel verborgen worden — te zwaar (lange tabellen, edit-flows)
// of te risk-vol (tokens, infra). Op desktop blijven ze normaal zichtbaar.
const MOBILE_HIDDEN_PAGES = new Set(['agents', 'agent-monitor', 'administratie', 'database', 'api-keys'])
const MOBILE_DEFAULT_PAGE = 'terminologie'

export default function SettingsView({ basePath = DEFAULT_BASE_PATH, isOwner = false }) {
  const { schedules, latestRuns, history, todayRuns } = useAgents()
  const { agentInstructions, categories: autodraftCategories } = useAutoDraft()
  const isMobile = useMediaQuery('(max-width: 768px)')

  const navigate = useNavigate()
  const params = useParams()
  const slug = params['*'] || ''

  const defaultPage = isMobile ? MOBILE_DEFAULT_PAGE : DEFAULT_PAGE

  if (!slug) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[defaultPage]}`} replace />
  }
  const page = SLUG_TO_PAGE[slug]
  if (!page) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[defaultPage]}`} replace />
  }
  // Member die direct admin-only slug typt → redirect naar default.
  if (!isOwner && ADMIN_ONLY_PAGES.has(page)) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[defaultPage]}`} replace />
  }
  // Mobiel: zware/admin-pagina's redirecten naar mobiele default (geen
  // tabellen/tokens op telefoon — die hoor je op desktop te beheren).
  if (isMobile && MOBILE_HIDDEN_PAGES.has(page)) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[MOBILE_DEFAULT_PAGE]}`} replace />
  }

  // Filter NAV-groups op isOwner — member ziet alleen non-adminOnly groups.
  // Op mobiel filteren we daarna nog de zware/admin-pagina's uit de items
  // zodat de zijbalk schoon blijft; groepen die leeg worden vallen weg.
  let visibleNav = NAV.filter(group => !group.adminOnly || isOwner)
  if (isMobile) {
    visibleNav = visibleNav
      .map(g => ({ ...g, items: g.items.filter(i => !MOBILE_HIDDEN_PAGES.has(i.id)) }))
      .filter(g => g.items.length > 0)
  }

  const setPage = (p) => {
    const newSlug = PAGE_SLUGS[p] || PAGE_SLUGS[DEFAULT_PAGE]
    navigate(`${basePath}/${newSlug}`)
  }

  // Skeleton tijdens initial-load — schedules is de eerste relevante data
  // voor de Agents-page (default).
  if (!schedules) {
    return <SettingsSkeleton />
  }

  return (
    <SettingsLayout groups={visibleNav} activePage={page} onSelectPage={setPage}>
      {page === 'agents' && (
        <AgentsPage
          schedules={schedules}
          agentInstructions={agentInstructions}
          autodraftCategories={autodraftCategories}
        />
      )}
      {page === 'agent-monitor' && (
        <AgentMonitorPage
          schedules={schedules}
          latestRuns={latestRuns}
          history={history}
          todayRuns={todayRuns}
        />
      )}
      {page === 'administratie'       && <TemplatesPage />}
      {page === 'chat'                && <ChatPage />}
      {page === 'terminologie'        && <TerminologiePage />}
      {page === 'externe-partijen'    && <ExternePartijenPage />}
      {page === 'database'            && <DatabasePage />}
      {page === 'api-keys'            && <ApiKeysPage />}
      {page === 'uitleg-mail-verrijking' && <MailVerrijkingPage />}
      {page === 'uitleg-autodraft' && <AutoDraftPage />}
    </SettingsLayout>
  )
}
