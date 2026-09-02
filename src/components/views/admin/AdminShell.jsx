import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import AdminSidebar from './AdminSidebar'
import HealthArea from './HealthArea'
import IntelligenceArea from './IntelligenceArea'
import { useAdminCounts } from '../../../hooks/useAdminCounts'
import './admin.css'
import './admin-components.css'
import './admin-overlay.css'

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
import SkillsPage                  from './pages/SkillsPage'

// AdminShell — de Organisatie-shell (owner-portaal): aparte layout voor
// /admin/*, los van de hoofd-Dashboard. Eigen sidebar links + main rechts.
// Bereikbaar via profile-menu (owner-only). Members die /admin direct typen
// krijgen Navigate naar /.
//
// v1.134: het portaal heet in de UI "Organisatie" (was "Admin"). De route
// blijft /admin/* — dat is een intern pad, geen label. Niet te verwarren met
// de tabbar-tab "Admin", dat is Administratie (daily-admin).
//
// v1.128 (Admin A, desktop): sidebar hergegroepeerd met tellers, geen home
// meer (/admin → /admin/health), Intelligence als één gebied met tabs
// Pijplijn · Kwaliteit · Kosten, Agent-overzicht als tab onder Health, en
// Database + API Keys uit Instellingen verhuisd naar Infrastructuur. Oude
// paden blijven als redirect werken. Op ≤768px rendert App.jsx deze shell
// niet — daar staat het mobiele Admin-hub (src/mobile/screens/admin/).
//
// v1.129 (Chrome A "Register"): de shell draagt .theme-maestro (Maestro-
// tokens) — cream rail, paper2-canvas, één content-frame, rustige paginakop.
// v1.130: de v1.129-overlay is in de basisregels gevouwen; er is nog één
// design: admin.css (shell-chrome), admin-components.css (content-
// componenten) en admin-overlay.css (Maestro-look over de globale .card/.pill
// van views die ook buiten Admin leven). JSX/state ongewijzigd.
// JelleMind is desktop-only (het mobiele portaal toont hem als desktop-rij).
//
// Sub-pages krijgen hun eigen titel/één zin; de admin-page-head wordt door
// AdminSubHeader rond bestaande views getekend zodat ze consistent ogen.
// Gebruikers, JelleMind en Skills tekenen hun eigen kop (metaregel + acties
// rechts).

const SUB_PAGE_META = {
  '/admin/health':                       { title: 'Health',                 subtitle: 'Welke agent is ziek. Run-success over 7 dagen, ververst elke minuut.' },
  '/admin/health/agents':                { title: 'Health',                 subtitle: 'Schedules, laatste runs en open vragen per agent.' },
  '/admin/security':                     { title: 'Security',               subtitle: 'Open bevindingen van de dagelijkse security-scan, kritiek bovenaan.' },
  '/admin/intelligence':                 { title: 'Intelligence',           subtitle: 'Eén pijplijn, drie blikken: Pijplijn, Kwaliteit en Kosten.' },
  '/admin/intelligence/kwaliteit':       { title: 'Intelligence',           subtitle: 'Acceptance per skill, chunk-bron en retrieval-strategie.' },
  '/admin/intelligence/kosten':          { title: 'Intelligence',           subtitle: 'Claude-telemetrie: model, tokens, kosten en latency per skill.' },
  '/admin/legalai':                      { title: 'Legal AI',               subtitle: 'Dagelijks dossier: research, dagartikel, LinkedIn-drafts.' },
  '/admin/configuratie':                 { title: 'Configuratie',           subtitle: 'Project-info en runtime-settings, alleen lezen.' },
  '/admin/edge-functions':               { title: 'Edge Functions',         subtitle: 'Alle Supabase Edge-functies met laatste run-status.' },
  '/admin/deployments':                  { title: 'Deployments',            subtitle: 'Vercel deploy-controles: promote, cancel, redeploy.' },
  '/admin/database':                     { title: 'Database',               subtitle: 'Sync-status van alle bronnen.' },
  // /admin/gebruikers, /admin/jellemind, /admin/skills, /admin/api-keys en
  // /admin/updates tekenen hun eigen paginakop (metaregel + acties rechts).
}

function AdminSubHeader({ pathname }) {
  const meta = SUB_PAGE_META[pathname]
  if (!meta) return null
  return (
    <header className="admin-page-head">
      <div className="admin-page-head__main">
        <h1 className="admin-page-head__title">{meta.title}</h1>
        {meta.subtitle && <p className="admin-page-head__subtitle">{meta.subtitle}</p>}
      </div>
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
    <div className="theme-maestro admin-shell">
      <AdminSidebar onExit={exitToDashboard} counts={counts} profile={auth?.profile} />
      <main className="admin-main">
        {/* Eén content-frame voor elke admin-pagina, ook de desktop-only. */}
        <div className="admin-frame">
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
            {/* v1.134: in-app Skills — org-brede pijplijn-/lead-kennis die de
                vragenbak injecteert. Tekent z'n eigen paginakop. */}
            <Route path="/admin/skills"                       element={<SkillsPage />} />
            <Route path="*"                                   element={<Navigate to="/admin/health" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
