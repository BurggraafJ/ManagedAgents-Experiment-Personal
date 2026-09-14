import { useNavigate, useParams, Navigate, Link } from 'react-router-dom'
import SettingsLayout from '../settings/SettingsLayout'
import { useAdminCounts } from '../../../hooks/useAdminCounts'
import { APP_VERSION } from '../../../version'

import HealthArea       from '../admin/HealthArea'
import SecurityView     from '../security/SecurityView'
import LegalAIView      from '../legal-ai/LegalAIView'
import UsersPage        from '../settings/pages/UsersPage'
import ApiKeysPage      from '../settings/pages/api-keys/ApiKeysPage'
import SkillsPage       from '../admin/pages/SkillsPage'
import UpdatesPage      from '../admin/pages/UpdatesPage'
import DeploymentsPage  from '../admin/pages/DeploymentsPage'
import PlatformPage     from './PlatformPage'
import PijplijnPage     from './PijplijnPage'

import '../admin/admin.css'
import '../admin/admin-components.css'
import '../admin/admin-overlay.css'

/**
 * OrganisatieView — het owner-portaal als overlay náást de Espresso-shell,
 * precies zoals Instellingen (spoor 20, optie B "Platform").
 *
 * Tot v1.171 opende /admin/* als een eigen AdminShell: eigen sidebar, een
 * "← Dashboard"-knop, en de Espresso-shell verdween. Dat is weg. Deze view
 * rendert binnen Dashboard, dus de hoofdnavigatie blijft links staan en je
 * bent niet "de app uit".
 *
 * Wat er veranderde t.o.v. AdminShell:
 *   • chrome      → SettingsLayout (set-nav + set-content), kop "Organisatie"
 *                   met owner-badge; geen terugknop meer
 *   • Platform    → Configuratie + Edge Functions + Database zijn één pagina
 *   • nav         → zonder Kosten en Deployments (lock 20). Deployments blijft
 *                   bereikbaar vanaf Platform — alleen de nav-rij is weg.
 *   • route       → /organisatie/*; /admin/* redirect mee (Dashboard.jsx)
 *
 * v1.183 (Jelle 2026-09-14): Intelligence (Pijplijn · Kwaliteit · Kosten) is
 * uit het product — views/intelligence/** en IntelligenceArea zijn verwijderd
 * (PRODUCT-PURGE). In de plaats staat onder Leren één uitlegpagina Pijplijn
 * (PijplijnPage). /organisatie/intelligence* landt daar.
 */

const ICON = (paths) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {paths}
  </svg>
)

const ICONS = {
  users:    ICON(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  health:   ICON(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  security: ICON(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  book:     ICON(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  spark:    ICON(<><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" /></>),
  sliders:  ICON(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
  key:      ICON(<><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>),
}

// Vier groepen, precies de indeling van het vastgelegde artboord (optie B).
// `meta` = sleutel in useAdminCounts.
const NAV = [
  { id: 'toegang', label: 'Toegang', items: [
    { id: 'gebruikers', label: 'Gebruikers', icon: ICONS.users, meta: 'users' },
  ] },
  { id: 'bewaking', label: 'Bewaking', items: [
    { id: 'health',   label: 'Health',   icon: ICONS.health,   meta: 'healthAttention', metaTone: 'warn' },
    { id: 'security', label: 'Security', icon: ICONS.security, meta: 'securityOpen',    metaTone: 'warn' },
  ] },
  { id: 'leren', label: 'Leren', items: [
    { id: 'skills',   label: 'Skills',   icon: ICONS.book },
    { id: 'pijplijn', label: 'Pijplijn', icon: ICONS.spark },
  ] },
  { id: 'platform', label: 'Platform', items: [
    { id: 'platform', label: 'Platform', icon: ICONS.sliders },
    { id: 'api-keys', label: 'API Keys', icon: ICONS.key },
  ] },
]

const DEFAULT_PAGE = 'health'

// page-id → URL-slug. Sub-slugs (health/agents) horen bij dezelfde pagina;
// die worden hieronder met startsWith teruggemapt.
const PAGE_SLUGS = {
  gebruikers:   'gebruikers',
  health:       'health',
  security:     'security',
  skills:       'skills',
  pijplijn:     'pijplijn',
  platform:     'platform',
  'api-keys':   'api-keys',
  // Niet in de nav, wel bereikbaar (lock 20 haalt ze uit de navigatie, niet
  // uit het product): Deployments via Platform, Legal AI en Wat is nieuw via
  // een directe link.
  deployments:  'deployments',
  legalai:      'legalai',
  updates:      'updates',
}

const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page]),
)

// Oude paden van vóór de samenvoeging → Platform.
const MERGED_INTO_PLATFORM = new Set(['configuratie', 'edge-functions', 'database'])
// Intelligence (t/m v1.182) → Pijplijn; ook de sub-paden kwaliteit en kosten.
const MERGED_INTO_PIJPLIJN = new Set(['intelligence'])

// Paginakop voor de pagina's die er zelf geen tekenen. Gebruikers, Skills,
// Updates, API Keys en Platform doen dat wél (metaregel + acties rechts).
// Overgenomen uit AdminShell's SUB_PAGE_META, tekst ongewijzigd.
const PAGE_HEAD = {
  health:                  { title: 'Health',        subtitle: 'Welke agent is ziek. Run-success over 7 dagen, ververst elke minuut.' },
  'health/agents':         { title: 'Health',        subtitle: 'Schedules, laatste runs en open vragen per agent.' },
  security:                { title: 'Security',      subtitle: 'Open bevindingen van de dagelijkse security-scan, kritiek bovenaan.' },
  deployments:             { title: 'Deployments',   subtitle: 'Vercel deploy-controles: promote, cancel, redeploy. Staat niet in de nav — je komt hier via Platform.' },
  legalai:                 { title: 'Legal AI',      subtitle: 'Dagelijks dossier: research en dagartikel.' },
}

// De pagina's die met .set-* tekenen horen rechtstreeks in de pane; al het
// andere draagt nog de .admin-*-classes en krijgt daarom de embed-wrapper.
const SET_SCOPED = new Set(['api-keys', 'platform', 'pijplijn'])

function pageForSlug(slug) {
  if (SLUG_TO_PAGE[slug]) return SLUG_TO_PAGE[slug]
  const head = slug.split('/')[0]
  if (MERGED_INTO_PLATFORM.has(head)) return 'platform'
  if (MERGED_INTO_PIJPLIJN.has(head)) return 'pijplijn'
  return SLUG_TO_PAGE[head] || null
}

export default function OrganisatieView({ basePath = '/organisatie', isOwner, isLoadingRole, profile }) {
  const navigate = useNavigate()
  const counts = useAdminCounts()
  const slug = useParams()['*'] || ''

  // Tijdens role-load niets renderen — anders flikkert de pane. Member: weg.
  if (isLoadingRole) return null
  if (!isOwner) return <Navigate to="/" replace />

  if (!slug) return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />

  const page = pageForSlug(slug)
  if (!page) return <Navigate to={`${basePath}/${PAGE_SLUGS[DEFAULT_PAGE]}`} replace />

  const sub = slug.slice(PAGE_SLUGS[page].length + 1)

  const groups = NAV.map(g => ({
    ...g,
    items: g.items.map(item => {
      const n = item.meta ? counts[item.meta] : null
      return n ? { ...item, meta: String(n) } : { ...item, meta: null }
    }),
  }))

  const footer = (
    <>
      <div>{profile?.display_name ? `${profile.display_name} · owner · ` : ''}v{APP_VERSION}</div>
      <div className="set-nav__footer-links">
        <Link to={`${basePath}/updates`}>Wat is nieuw</Link>
        {' · '}
        <Link to={`${basePath}/legalai`}>Legal AI</Link>
      </div>
    </>
  )

  const head = PAGE_HEAD[slug] || PAGE_HEAD[page]

  const body = (
    <>
      {page === 'gebruikers'   && <UsersPage />}
      {page === 'health'       && <HealthArea tab={sub === 'agents' ? 'agents' : 'health'} />}
      {page === 'security'     && <SecurityView />}
      {page === 'skills'       && <SkillsPage />}
      {page === 'pijplijn'     && <PijplijnPage />}
      {page === 'platform'     && <PlatformPage />}
      {page === 'api-keys'     && <ApiKeysPage />}
      {page === 'deployments'  && <DeploymentsPage />}
      {page === 'legalai'      && <LegalAIView />}
      {page === 'updates'      && <UpdatesPage />}
    </>
  )

  return (
    <SettingsLayout
      title="Organisatie"
      titleBadge="owner"
      groups={groups}
      activePage={page}
      onSelectPage={(p) => navigate(`${basePath}/${PAGE_SLUGS[p]}`)}
      footer={footer}
    >
      {SET_SCOPED.has(page) ? body : (
        <div className="theme-maestro admin-main admin-main--embed">
          <div className="admin-frame admin-frame--embed">
            {head && (
              <header className="admin-page-head">
                <div className="admin-page-head__main">
                  <h1 className="admin-page-head__title">{head.title}</h1>
                  {head.subtitle && <p className="admin-page-head__subtitle">{head.subtitle}</p>}
                </div>
              </header>
            )}
            {body}
          </div>
        </div>
      )}
    </SettingsLayout>
  )
}
