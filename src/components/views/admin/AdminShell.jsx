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
import ChatView                    from '../chat/ChatView'
import SettingsView                from '../settings/SettingsView'
import UsersPage                   from '../settings/pages/UsersPage'

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
  '/admin/chat':                         { title: 'Chat',                   subtitle: 'Direct met je agents praten — debug-tool.' },
  '/admin/gebruikers':                   { title: 'Gebruikers',             subtitle: 'Wie heeft toegang en met welke rol — owner of member.' },
}

function AdminSubHeader({ pathname }) {
  // /admin/instellingen heeft eigen sub-nav binnenin → geen extra header.
  if (pathname.startsWith('/admin/instellingen')) return null
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
          <Route path="/admin/chat"                         element={<ChatView />} />
          <Route path="/admin/gebruikers"                   element={<UsersPage />} />
          <Route path="/admin/instellingen/*"               element={<SettingsView basePath="/admin/instellingen" />} />
          <Route path="*"                                   element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  )
}
