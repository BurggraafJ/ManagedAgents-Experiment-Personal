import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsLayout from './SettingsLayout'
import SettingsSkeleton from './SettingsSkeleton'
import AgentsPage from './pages/agents/AgentsPage'
import TerminologiePage from './pages/TerminologiePage'
import ChatPage from './pages/ChatPage'
import TemplatesPage from './pages/TemplatesPage'
import ExternePartijenPage from './pages/ExternePartijenPage'
import ConnectorsPage from './pages/ConnectorsPage'
import MailVerrijkingPage from './pages/uitleg/MailVerrijkingPage'
import AutoDraftPage from './pages/uitleg/AutoDraftPage'
import { useAgents } from '../../../hooks/useAgents'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { instructableAgents } from '../../../lib/agentInstructions'
import { APP_VERSION } from '../../../version'

/**
 * SettingsView — Maestro-design settings (full rebuild 2026-05-13), desktop.
 *
 * Layout-shell + nav + pages onder eigen .set-* scope. Schema:
 *
 *   src/components/views/settings/
 *   ├── SettingsView.jsx        (deze file — routing + page-switch)
 *   ├── SettingsLayout.jsx      (shell + nav + page-head)
 *   ├── SettingsSkeleton.jsx    (loading-state)
 *   ├── settings.css            (alle styling)
 *   └── pages/
 *       ├── agents/             (instructies per agent — lijst + editor)
 *       ├── api-keys/           (credentials tabel + edit-modal)
 *       ├── uitleg/             (Mail-verrijking, AutoDraft)
 *       ├── TerminologiePage.jsx, ChatPage.jsx, TemplatesPage.jsx,
 *       ├── ExternePartijenPage.jsx, DatabasePage.jsx, AgentMonitorPage.jsx
 *
 * Route: /instellingen/<slug> (slug-mapping hieronder). Op mobiel (≤768px)
 * rendert App.jsx sinds v1.126 src/mobile/screens/MobileSettings.jsx
 * (iOS drill-in) — deze view is dus puur desktop/tablet.
 *
 * Nav-groepen (design A): Instructies / Beheer / Uitleg. Agent-overzicht,
 * Database en API Keys zijn per v1.128 (Admin A) verhuisd naar /admin
 * (Health-tab resp. Infrastructuur); oude slugs redirecten in Dashboard.jsx.
 */

const ICON = (paths) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
)

const NAV = [
  {
    id: 'instructies', label: 'Instructies',
    items: [
      { id: 'agents', label: 'Agents', icon: ICON(<><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></>) },
      { id: 'chat', label: 'Chat-assistent', icon: ICON(<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />) },
    ],
  },
  {
    id: 'beheer', label: 'Beheer',
    items: [
      { id: 'administratie', label: 'Administratie', meta: '7', icon: ICON(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10M7 13h10M7 17h6" /></>) },
      { id: 'terminologie', label: 'Terminologie', meta: '3', icon: ICON(<><path d="m6 16 6-12 6 12" /><path d="M8 12h8" /></>) },
      { id: 'externe-partijen', label: 'Externe partijen', icon: ICON(<><path d="M3 21v-2a4 4 0 0 1 4-4h4" /><circle cx="9" cy="7" r="4" /><path d="M16 11h6M16 15h6M16 19h6" /></>) },
      // Connectors (v1.127) — koppelingen met externe systemen; nu nog stub.
      { id: 'connectors', label: 'Connectors', icon: ICON(<><path d="M12 22v-5" /><path d="M9 8V2M15 8V2" /><path d="M6 8h12v4a6 6 0 0 1-12 0Z" /></>) },
    ],
  },
  {
    id: 'uitleg', label: 'Uitleg',
    items: [
      { id: 'uitleg-mail-verrijking', label: 'Mail-verrijking', icon: ICON(<><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /><circle cx="18" cy="6" r="3" fill="currentColor" stroke="none" opacity=".25" /></>) },
      { id: 'uitleg-autodraft', label: 'AutoDraft', icon: ICON(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>) },
    ],
  },
]

const DEFAULT_PAGE = 'agents'

// page-id ↔ URL-slug. Houden we expliciet zodat de URL leesbaar is
// (/instellingen/agents) maar de interne id stabiel blijft.
const PAGE_SLUGS = {
  agents:               'agents',
  administratie:        'administratie',
  chat:                 'chat',
  terminologie:         'terminologie',
  'externe-partijen':   'externe-partijen',
  connectors:           'connectors',
  'uitleg-mail-verrijking': 'uitleg/mail-verrijking',
  'uitleg-autodraft':       'uitleg/autodraft',
  // Configuratie, Edge Functions en Deployments zijn verhuisd naar /admin/*
  // (Infrastructuur-groep in de admin-sidebar) per 2026-05-22; Agent-overzicht
  // (→ /admin/health/agents), Database en API Keys (→ Infrastructuur) per v1.128.
}

// Default basePath = /instellingen (hoofd-Dashboard route, voor iedereen).
// Owner-only items worden binnen deze view role-gegated op isOwner; bij
// directe URL-access naar een admin-only page redirect naar agents.
const DEFAULT_BASE_PATH = '/instellingen'
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

// Pages die admin-only zijn — voor non-owner geblokkeerd. Sinds v1.128 leeg
// (API Keys leeft in /admin), set blijft staan voor toekomstige owner-pages.
const ADMIN_ONLY_PAGES = new Set()

export default function SettingsView({ basePath = DEFAULT_BASE_PATH, isOwner = false, profile }) {
  const { schedules } = useAgents()
  const { agentInstructions, categories: autodraftCategories } = useAutoDraft()

  const navigate = useNavigate()
  const params = useParams()
  const slug = params['*'] || ''

  if (!slug) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }
  // Mobiele editor-deeplink (/instellingen/agents/<agent>) op desktop → Agents.
  const page = SLUG_TO_PAGE[slug] || (slug.startsWith('agents/') ? 'agents' : null)
  if (!page) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }
  // Member die direct admin-only slug typt → redirect naar default.
  if (!isOwner && ADMIN_ONLY_PAGES.has(page)) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  // Filter NAV op isOwner — member ziet geen adminOnly-items; groepen die
  // leeg worden vallen weg. Agents-teller komt live uit agent_schedules.
  const agentCount = instructableAgents(schedules).length
  const visibleNav = NAV
    .map(g => ({
      ...g,
      label: isOwner && g.ownerLabel ? g.ownerLabel : g.label,
      items: g.items
        .filter(i => !i.adminOnly || isOwner)
        .map(i => (i.id === 'agents' && agentCount > 0 ? { ...i, meta: String(agentCount) } : i)),
    }))
    .filter(g => g.items.length > 0)

  const setPage = (p) => {
    const newSlug = PAGE_SLUGS[p] || PAGE_SLUGS[DEFAULT_PAGE]
    navigate(`${basePath}/${newSlug}`)
  }

  // Skeleton tijdens initial-load — schedules is de eerste relevante data
  // voor de Agents-page (default).
  if (!schedules) {
    return <SettingsSkeleton />
  }

  const footer = profile
    ? `${profile.display_name || 'Gebruiker'} · ${profile.role || 'member'} · v${APP_VERSION}`
    : `v${APP_VERSION}`

  return (
    <SettingsLayout groups={visibleNav} activePage={page} onSelectPage={setPage} footer={footer}>
      {page === 'agents' && (
        <AgentsPage
          schedules={schedules}
          agentInstructions={agentInstructions}
          autodraftCategories={autodraftCategories}
        />
      )}
      {page === 'administratie'       && <TemplatesPage />}
      {page === 'chat'                && <ChatPage />}
      {page === 'terminologie'        && <TerminologiePage />}
      {page === 'externe-partijen'    && <ExternePartijenPage />}
      {page === 'connectors'          && <ConnectorsPage />}
      {page === 'uitleg-mail-verrijking' && <MailVerrijkingPage />}
      {page === 'uitleg-autodraft' && <AutoDraftPage />}
    </SettingsLayout>
  )
}
