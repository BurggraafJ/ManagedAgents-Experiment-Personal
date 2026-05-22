import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import AdminHome from './AdminHome'
import './admin.css'

// Sub-pages — bestaande view-components hergebruikt binnen de admin-shell.
import HealthView                  from '../health/HealthView'
import SecurityView                from '../security/SecurityView'
import IntelligenceHubView         from '../intelligence/IntelligenceHubView'
import IntelligenceQualityView     from '../intelligence/IntelligenceQualityView'
import IntelligenceObservabilityView from '../intelligence/IntelligenceObservabilityView'
import MindView                    from '../jellemind/JelleMindView'
import LegalAIView                 from '../legal-ai/LegalAIView'
import UsersPage                   from '../settings/pages/UsersPage'
import ConfiguratiePage            from './pages/ConfiguratiePage'
import EdgeFunctionsPage           from './pages/EdgeFunctionsPage'
import DeploymentsPage             from './pages/DeploymentsPage'
import UpdatesPage                 from './pages/UpdatesPage'

// AdminShell — aparte layout voor /admin/*, los van de hoofd-Dashboard.
// Eigen sidebar links + main rechts. Bereikbaar via profile-menu (owner-only).
// Members die /admin direct typen krijgen Navigate naar /.
//
// Sub-pages krijgen hun eigen titel/intro; de admin-page-head wordt door
// AdminSubHeader rond bestaande views getekend zodat ze consistent ogen
// met de hub-pagina.

const SUB_PAGE_META = {
  '/admin/health':                       { title: 'Health & Issues',        subtitle: 'Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d.' },
  '/admin/security':                     { title: 'Security Monitor',       subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan.' },
  '/admin/intelligence':                 { title: 'Intelligence Hub',       subtitle: 'Pipeline-overzicht: chunks, embeddings, retrieval, context-build.' },
  '/admin/intelligence/quality':         { title: 'Intelligence · Quality', subtitle: 'Acceptance-rate per skill, retrieval-strategie en chunk-source.' },
  '/admin/intelligence/observability':   { title: 'Intelligence · Observability', subtitle: 'Claude-call telemetrie — model, tokens, cost, latency per skill.' },
  '/admin/jellemind':                    { title: 'JelleMind',              subtitle: 'Persoonlijke voorkeur, organisatie-waarheid, procesinstructies.' },
  '/admin/legalai':                      { title: 'Legal AI',               subtitle: 'Dagelijks dossier — research, dagartikel, LinkedIn-drafts.' },
  '/admin/gebruikers':                   { title: 'Gebruikers',             subtitle: 'Wie heeft toegang en met welke rol — owner of member.' },
  '/admin/configuratie':                 { title: 'Configuratie',           subtitle: 'Project-info en runtime-settings. Read-only — wijzigingen via Supabase / Vercel zelf.' },
  '/admin/edge-functions':               { title: 'Edge Functions',         subtitle: 'Alle Supabase Edge-functies met laatste run-status uit agent_runs.' },
  '/admin/deployments':                  { title: 'Deployments',            subtitle: 'Vercel deploy-controles — promote, cancel, redeploy via vercel-control.' },
  // /admin/updates rendert z'n eigen paper-look header — geen extra
  // AdminSubHeader nodig.
}

function AdminSubHeader({ pathname }) {
  if (pathname === '/admin' || pathname === '/admin/') return null
  const meta = SUB_PAGE_META[pathname]
  if (!meta) return null
  return (
    <header className="admin-page-head">
      <h1 className="admin-page-head__title">{meta.title}</h1>
      {meta.subtitle && <p className="admin-page-head__subtitle">{meta.subtitle}</p>}
    </header>
  )
}

export default function AdminShell({ isOwner, isLoadingRole }) {
  const navigate = useNavigate()
  const location = useLocation()

  // Tijdens role-load niets renderen — anders flikker. Bij member: weg.
  if (isLoadingRole) return null
  if (!isOwner) return <Navigate to="/" replace />

  const exitToDashboard = () => navigate('/')

  return (
    <div className="admin-shell">
      <AdminSidebar onExit={exitToDashboard} />
      <main className="admin-main">
        <AdminSubHeader pathname={location.pathname} />
        <Routes>
          <Route path="/admin"                              element={<AdminHome />} />
          <Route path="/admin/health"                       element={<HealthView />} />
          <Route path="/admin/security"                     element={<SecurityView />} />
          <Route path="/admin/intelligence"                 element={<IntelligenceHubView />} />
          <Route path="/admin/intelligence/quality"         element={<IntelligenceQualityView />} />
          <Route path="/admin/intelligence/observability"   element={<IntelligenceObservabilityView />} />
          <Route path="/admin/jellemind"                    element={<MindView />} />
          <Route path="/admin/legalai"                      element={<LegalAIView />} />
          <Route path="/admin/gebruikers"                   element={<UsersPage />} />
          <Route path="/admin/configuratie"                 element={<ConfiguratiePage />} />
          <Route path="/admin/edge-functions"               element={<EdgeFunctionsPage />} />
          <Route path="/admin/deployments"                  element={<DeploymentsPage />} />
          <Route path="/admin/updates"                      element={<UpdatesPage />} />
          <Route path="*"                                   element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  )
}
