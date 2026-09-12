import { useNavigate, useParams, Navigate } from 'react-router-dom'
import SettingsLayout from '../settings/SettingsLayout'
import { useAdminCounts } from '../../../hooks/useAdminCounts'
import { APP_VERSION } from '../../../version'

// Organisatie sub-pages
import HealthArea from '../admin/HealthArea'
import IntelligenceArea from '../admin/IntelligenceArea'
import SecurityView from '../security/SecurityView'
import LegalAIView from '../legal-ai/LegalAIView'
import UsersPage from '../settings/pages/UsersPage'
import ApiKeysPage from '../settings/pages/api-keys/ApiKeysPage'
import PlatformPage from '../admin/pages/PlatformPage'
import SkillsPage from '../admin/pages/SkillsPage'
import UpdatesPage from '../admin/pages/UpdatesPage'

/**
 * OrganisatieView — Maestro Organisatie overlay (v1.168), desktop-only.
 *
 * Opens WITHIN Dashboard (Espresso sidebar stays visible) like SettingsView,
 * NOT as a separate AdminShell. Uses SettingsLayout pattern: left nav + right
 * content pane, scoped under .set-* classes.
 *
 * Route: /organisatie/<slug>. Owner-only. Mobile renders MobileAdminPortal
 * (drill-in hub).
 *
 * v1.168 (Maestro Organisatie B Platform): Kosten + Deployments removed,
 * Configuratie + Edge Functions + Database merged into Platform page.
 */

const ICON = (paths) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
)

const NAV = [
  {
    id: 'toegang', label: 'Toegang',
    items: [
      { id: 'gebruikers', label: 'Gebruikers', icon: ICON(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>) },
    ],
  },
  {
    id: 'bewaking', label: 'Bewaking',
    items: [
      { id: 'health', label: 'Health', icon: ICON(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />) },
      { id: 'security', label: 'Security', icon: ICON(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />) },
    ],
  },
  {
    id: 'kennis', label: 'Kennis',
    items: [
      { id: 'skills', label: 'Skills', icon: ICON(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>) },
      { id: 'legalai', label: 'Legal AI', icon: ICON(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>) },
    ],
  },
  {
    id: 'intelligence', label: 'Intelligence',
    items: [
      { id: 'intelligence-pijplijn', label: 'Pijplijn', icon: ICON(<><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" /></>) },
      { id: 'intelligence-kwaliteit', label: 'Kwaliteit', icon: ICON(<path d="m4 13 5 5L20 7" />) },
    ],
  },
  {
    id: 'infrastructuur', label: 'Infrastructuur',
    items: [
      { id: 'platform', label: 'Platform', icon: ICON(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>) },
      { id: 'api-keys', label: 'API Keys', icon: ICON(<><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>) },
    ],
  },
  {
    id: 'systeem', label: 'Systeem',
    items: [
      { id: 'updates', label: 'Wat is nieuw', icon: ICON(<><path d="M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20z" /><path d="M12 6v6l4 2" /></>) },
    ],
  },
]

const PAGE_SLUGS = {
  'gebruikers': 'gebruikers',
  'health': 'health',
  'health-agents': 'health/agents',
  'security': 'security',
  'skills': 'skills',
  'legalai': 'legalai',
  'intelligence-pijplijn': 'intelligence',
  'intelligence-kwaliteit': 'intelligence/kwaliteit',
  'platform': 'platform',
  'api-keys': 'api-keys',
  'updates': 'updates',
}

const DEFAULT_PAGE = 'health'
const DEFAULT_BASE_PATH = '/organisatie'
const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
)

export default function OrganisatieView({ basePath = DEFAULT_BASE_PATH, isOwner = false, profile }) {
  const counts = useAdminCounts()
  const navigate = useNavigate()
  const params = useParams()
  const slug = params['*'] || ''

  if (!slug) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  const page = SLUG_TO_PAGE[slug] || (slug.startsWith('health/') ? 'health-agents' : null)
  if (!page) {
    return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />
  }

  // Enrich nav with counts
  const visibleNav = NAV.map(g => ({
    ...g,
    items: g.items.map(i => {
      if (i.id === 'gebruikers' && counts.users != null) {
        return { ...i, meta: String(counts.users) }
      }
      if (i.id === 'health' && counts.healthAttention != null && counts.healthAttention > 0) {
        return { ...i, meta: String(counts.healthAttention), metaTone: 'warn' }
      }
      if (i.id === 'security' && counts.securityOpen != null && counts.securityOpen > 0) {
        return { ...i, meta: String(counts.securityOpen), metaTone: counts.securityUrgent > 0 ? 'err' : '' }
      }
      return i
    }),
  }))

  const setPage = (p) => {
    const newSlug = PAGE_SLUGS[p] || PAGE_SLUGS[DEFAULT_PAGE]
    navigate(`${basePath}/${newSlug}`)
  }

  const footer = (
    <div>
      <div style={{ fontSize: 12, color: 'var(--neutral-500)', marginBottom: 4 }}>
        v{APP_VERSION}{profile?.display_name ? ` · ${profile.display_name}` : ''}
      </div>
    </div>
  )

  return (
    <SettingsLayout
      groups={visibleNav}
      activePage={page}
      onSelectPage={setPage}
      footer={footer}
    >
      {/* Render the active page content */}
      {page === 'gebruikers' && <UsersPage />}
      {page === 'health' && <HealthArea tab="health" />}
      {page === 'health-agents' && <HealthArea tab="agents" />}
      {page === 'security' && <SecurityView />}
      {page === 'skills' && <SkillsPage />}
      {page === 'legalai' && <LegalAIView />}
      {page === 'intelligence-pijplijn' && <IntelligenceArea tab="pijplijn" />}
      {page === 'intelligence-kwaliteit' && <IntelligenceArea tab="kwaliteit" />}
      {page === 'platform' && <PlatformPage />}
      {page === 'api-keys' && <ApiKeysPage />}
      {page === 'updates' && <UpdatesPage />}
    </SettingsLayout>
  )
}
