import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import HealthArea from './HealthArea'
import IntelligenceArea from './IntelligenceArea'
import { useAdminCounts } from '../../../hooks/useAdminCounts'
import './admin.css'

// Sub-pages — bestaande view-components hergebruikt binnen de admin-shell.
import SecurityView                from '../security/SecurityView'
import MindView                    from '../jellemind/JelleMindView'
import LegalAIView                 from '../legal-ai/LegalAIView'
import UsersPage                   from '../settings/pages/UsersPage'
import DatabasePage                from '../settings/pages/DatabasePage'
import ApiKeysPage                 from '../settings/pages/api-keys/ApiKeysPage'
import ConfiguratiePage            from './pages/ConfiguratiePage'
import EdgeFunctionsPage           from './pages/EdgeFunctionsPage'
import DeploymentsPage             from './pages/DeploymentsPage'
import UpdatesPage                 from './pages/UpdatesPage'

// AdminShell — aparte layout voor /admin/*, los van de hoofd-Dashboard.
// Eigen sidebar links + main rechts. Bereikbaar via profile-menu (owner-only).
// Members die /admin direct typen krijgen Navigate naar /.
//
// v1.128 (Admin A, desktop): sidebar hergegroepeerd met tellers, geen Admin
// home meer (/admin → /admin/health), Intelligence als één gebied met tabs
// Pijplijn · Kwaliteit · Kosten, Agent-overzicht als tab onder Health, en
// Database + API Keys uit Instellingen verhuisd naar Infrastructuur. Oude
// paden blijven als redirect werken. Op ≤768px rendert App.jsx deze shell
// niet — daar staat het mobiele Admin-hub (src/mobile/screens/admin/).
//
// Sub-pages krijgen hun eigen titel/intro; de admin-page-head wordt door
// AdminSubHeader rond bestaande views getekend zodat ze consistent ogen.

const SUB_PAGE_META = {
  '/admin/health':                       { title: 'Health',                 subtitle: 'Welke agent is ziek. Run-success over 7 dagen uit agent_runs_health_7d; ververst elke minuut. Agent-overzicht (schedules, open vragen) als tweede tab.' },
  '/admin/health/agents':                { title: 'Health',                 subtitle: 'Welke agent is ziek. Run-success over 7 dagen uit agent_runs_health_7d; ververst elke minuut. Agent-overzicht (schedules, open vragen) als tweede tab.' },
  '/admin/security':                     { title: 'Security',               subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan.' },
  '/admin/intelligence':                 { title: 'Intelligence',           subtitle: 'Eén pijplijn, drie blikken: Pijplijn (chunks, embeddings, retrieval), Kwaliteit (acceptance per strategie) en Kosten (Claude-telemetrie).' },
  '/admin/intelligence/kwaliteit':       { title: 'Intelligence',           subtitle: 'Eén pijplijn, drie blikken: Pijplijn (chunks, embeddings, retrieval), Kwaliteit (acceptance per strategie) en Kosten (Claude-telemetrie).' },
  '/admin/intelligence/kosten':          { title: 'Intelligence',           subtitle: 'Eén pijplijn, drie blikken: Pijplijn (chunks, embeddings, retrieval), Kwaliteit (acceptance per strategie) en Kosten (Claude-telemetrie).' },
  '/admin/jellemind':                    { title: 'JelleMind',              subtitle: 'Persoonlijke voorkeur, organisatie-waarheid, procesinstructies.' },
  '/admin/legalai':                      { title: 'Legal AI',               subtitle: 'Dagelijks dossier — research, dagartikel, LinkedIn-drafts.' },
  '/admin/gebruikers':                   { title: 'Gebruikers',             subtitle: 'Wie heeft toegang en met welke rol — owner of member.' },
  '/admin/configuratie':                 { title: 'Configuratie',           subtitle: 'Project-info en runtime-settings. Read-only — wijzigingen via Supabase / Vercel zelf.' },
  '/admin/edge-functions':               { title: 'Edge Functions',         subtitle: 'Alle Supabase Edge-functies met laatste run-status uit agent_runs.' },
  '/admin/deployments':                  { title: 'Deployments',            subtitle: 'Vercel deploy-controles — promote, cancel, redeploy via vercel-control.' },
  '/admin/database':                     { title: 'Database',               subtitle: 'Sync-status van alle bronnen — Outlook, HubSpot, Jira, Fireflies, Agenda, Contactpersonen, JelleMind.' },
  // /admin/api-keys en /admin/updates tekenen hun eigen paginakop.
}

function AdminSubHeader({ pathname }) {
  const meta = SUB_PAGE_META[pathname]
  if (!meta) return null
  return (
    <header className="admin-page-head">
      <h1 className="admin-page-head__title">{meta.title}</h1>
      {meta.subtitle && <p className="admin-page-head__subtitle">{meta.subtitle}</p>}
    </header>
  )
}

export default function AdminShell({ auth, isOwner, isLoadingRole }) {
  const navigate = useNavigate()
  const location = useLocation()
  const counts = useAdminCounts()

  // Tijdens role-load niets renderen — anders flikker. Bij member: weg.
  if (isLoadingRole) return null
  if (!isOwner) return <Navigate to="/" replace />

  const exitToDashboard = () => navigate('/')

  return (
    <div className="admin-shell">
      <AdminSidebar onExit={exitToDashboard} counts={counts} profile={auth?.profile} />
      <main className="admin-main">
        <AdminSubHeader pathname={location.pathname} />
        <Routes>
          <Route path="/admin"                              element={<Navigate to="/admin/health" replace />} />
          <Route path="/admin/health"                       element={<HealthArea tab="health" />} />
          <Route path="/admin/health/agents"                element={<HealthArea tab="agents" />} />
          <Route path="/admin/security"                     element={<SecurityView />} />
          <Route path="/admin/intelligence"                 element={<IntelligenceArea tab="pijplijn" />} />
          <Route path="/admin/intelligence/kwaliteit"       element={<IntelligenceArea tab="kwaliteit" />} />
          <Route path="/admin/intelligence/kosten"          element={<IntelligenceArea tab="kosten" />} />
          {/* Oude Intelligence-paden (t/m v1.127) → nieuwe tabs. */}
          <Route path="/admin/intelligence/quality"         element={<Navigate to="/admin/intelligence/kwaliteit" replace />} />
          <Route path="/admin/intelligence/observability"   element={<Navigate to="/admin/intelligence/kosten" replace />} />
          <Route path="/admin/jellemind"                    element={<MindView />} />
          <Route path="/admin/legalai"                      element={<LegalAIView />} />
          <Route path="/admin/gebruikers"                   element={<UsersPage />} />
          <Route path="/admin/configuratie"                 element={<ConfiguratiePage />} />
          <Route path="/admin/edge-functions"               element={<EdgeFunctionsPage />} />
          <Route path="/admin/deployments"                  element={<DeploymentsPage />} />
          {/* Uit Instellingen verhuisd (v1.128). ApiKeysPage tekent met .set-*
              classes → in een .set-app-embed zodat z'n tokens kloppen. */}
          <Route path="/admin/database"                     element={<DatabasePage />} />
          <Route path="/admin/api-keys"                     element={<div className="set-app set-app--embed"><ApiKeysPage /></div>} />
          <Route path="/admin/updates"                      element={<UpdatesPage />} />
          <Route path="*"                                   element={<Navigate to="/admin/health" replace />} />
        </Routes>
      </main>
    </div>
  )
}
