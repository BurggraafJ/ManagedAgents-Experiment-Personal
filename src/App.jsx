import { useState, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useDashboardShell } from './hooks/useDashboardShell'
import { useNavBadges } from './hooks/useNavBadges'
import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useUserRole } from './hooks/useUserRole'
import { useNotifications } from './hooks/useNotifications'
import { ModalProvider, ModalRoot } from './components/ui/ModalProvider'

import Login              from './components/Login'
import Sidebar            from './components/shell/Sidebar'
import MobileBar          from './components/shell/MobileBar'
import NotificationDrawer from './components/shell/NotificationDrawer'
import ToastHost          from './components/Toast'
import NowView            from './components/views/NowView'
// Maestro V2 is sinds 2026-05-14 canoniek — V1 (HubSpotInboxCompactView /
// HubSpotInboxFutureView + sub-files) is verwijderd. Maestro-componenten leven
// nog in de `maestro/` subfolder als historische naam-conventie.
import HubSpotInboxView       from './components/views/administratie/HubSpotInboxView'
import HubSpotInboxFutureView from './components/views/administratie/HubSpotInboxFutureView'
import AdminPeriodToggle       from './components/views/AdminPeriodToggle'
import SalesOnRoadView    from './components/views/road-notes/SalesOnRoadView'
import AutoDraftView         from './components/views/autodraft/AutoDraftView'
import AutoDraftSettingsView from './components/views/autodraft/AutoDraftSettingsView'
import LinkedInView       from './components/views/linkedin/LinkedInView'
// Taken-view is sinds 2026-05-20 v2.0 — schaduw-view promoted naar canoniek
// op /taken. Oude TasksView (src/components/views/tasks/) is verwijderd.
import TakenV2View        from './components/views/taken-v2/TakenV2View'
import KilometersView     from './components/views/kilometers/KilometersView'
// Zoeken — sinds 2026-05-20 is dit de v2.0 view (entity-aware RAG +
// streaming + markdown + timeline-RPC's). De oude RagSearchView is
// vervangen; de file leeft nog in `v2/` folder met RagSearchV2View
// als exportname (file rename = aparte refactor zodat git-history schoon
// blijft).
import RagSearchView      from './components/views/zoeken/RagSearchView'
import AgendaView         from './components/views/agenda/AgendaView'
import AgendaRulesView    from './components/views/agenda/AgendaRulesView'
// Settings is operationeel (instructies/algemeen voor iedereen); tokens en
// infrastructuur worden binnen SettingsView role-gegated voor owners.
import SettingsView       from './components/views/settings/SettingsView'
// Admin-only views (Intelligence, JelleMind, Legal AI, Chat, Health, Security)
// leven binnen de AdminShell op /admin/*.
import AdminShell         from './components/views/admin/AdminShell'

const VIEWS = [
  { id: 'nu',        label: 'Dashboard',       title: 'Dashboard',        subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het de afgelopen periode.', fullWidth: true },
  { id: 'jellemind', label: 'JelleMind',       title: 'JelleMind',        subtitle: 'Drie laden voor wat agents geleerd hebben — Jelle (persoonlijke voorkeur), Legal Mind (organisatie-waarheid), Skills (procesinstructies). Alles op één blad om snel te beheren.', wide: true, adminOnly: true },
  { id: 'legalai',   label: 'Legal AI',        title: 'Legal AI Thought Leadership', subtitle: 'Dagelijks dossier over de Legal AI-markt — twee tracks (advocatuur + bedrijfsleven). Onderzoek + dagartikel + LinkedIn-drafts. Voice-feedback evolueert je visie zonder tunnel-visie.', adminOnly: true },
  { id: 'hubspot',         label: 'Administratie', title: 'Administratie · Admin',    subtitle: '', fullWidth: true },
  { id: 'hubspot_future',  label: 'Toekomst',      title: 'Administratie · Toekomst', subtitle: '', fullWidth: true },
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: 'Je volledige postvak met een skill-voorstel per mail. Reageer, negeer of stuur aanpassing — al beantwoorde of verplaatste mails worden automatisch verborgen.', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing · Instellingen', subtitle: 'Voorstellen, categorieën, logboek en geleerde regels — alle skill-configuratie van auto-draft op één plek met tabs.' },
  { id: 'agenda',             label: 'Agenda',      title: 'Agenda',               subtitle: 'Outlook-agenda met week- en dag-view. Toggle \"Toon spelregels\" rendert reistijd-buffers, verkeer-windows en interne dagen als shadow-laag. Outlook blijft bron-van-waarheid.', fullWidth: true },
  { id: 'agenda_rules',       label: 'Spelregels',  title: 'Agenda · Spelregels',  subtitle: 'Beheer alle spelregels van je agenda — verkeer-windows, reistijd-buffers, interne dagen, locatieregels en meer. Wijzigingen werken direct door op de agenda-view.', fullWidth: true },
  { id: 'sales',     label: 'Road Notes',      title: 'Road Notes',       subtitle: 'Drop een korte aantekening na een kennismakingsgesprek; agent verwerkt naar HubSpot-updates, notitie per deal en Outlook-concept in de Sales Agent-map.' },
  { id: 'linkedin',  label: 'LinkedIn',        title: 'LinkedIn Agent',   subtitle: 'Dagelijks 15 connect-verzoeken via Composio Browser Tool. Targets uit mailbox, HubSpot-pipeline, proefperiode-kantoren en concurrenten. Strategie stuur je hieronder.' },
  { id: 'kilometers', label: 'Kilometers',     title: 'Kilometerregistratie', subtitle: 'Maandelijkse km-registratie voor Burggraaf Group. Draait automatisch op de 2e van elke maand. Voeg ritten direct toe via het invoerblok hieronder.' },
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: '', fullWidth: true },
  { id: 'zoeken',        label: 'Zoeken',        title: 'Zoeken',        subtitle: '', fullWidth: true },
  { id: 'intelligence',  label: 'Intelligence',  title: 'Intelligence Hub', subtitle: '', fullWidth: true, adminOnly: true },
  { id: 'intelligence_quality', label: 'Quality', title: 'Intelligence · Quality', subtitle: 'Diepere analyse op rag_outcomes — acceptance-rate per skill, per chunk-source, per retrieval-strategie. match_chunks vs match_chunks_for_entity vergelijking zodra ≥10 outcomes per strategie.', adminOnly: true },
  { id: 'intelligence_observability', label: 'Observability', title: 'Intelligence · Observability', subtitle: 'Claude-call telemetrie — model, tokens, cost, latency per skill en Edge Function. Bron: claude_api_calls + claude_api_costs_7d view.', adminOnly: true },
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.', adminOnly: true },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.', adminOnly: true },
  // Instellingen is operationeel: members krijgen Instructies + Algemeen,
  // owner ziet daarnaast Tokens (API Keys) en Infrastructuur (binnen view).
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: '', fullWidth: true },
]

// Sidebar-volgorde — hoofd-dashboard (operationeel). Admin-functies leven
// in een eigen shell onder /admin/* en zijn bereikbaar via het profile-menu
// (owner-only). Geen verspreide admin-items meer in deze sidebar.
const NAV_GROUPS = [
  { kind: 'item',  id: 'nu' },
  { kind: 'item',  id: 'zoeken' },
  { kind: 'group', id: 'operations',  label: 'Operations',  children: ['hubspot', 'autodraft', 'agenda', 'taken'] },
  { kind: 'group', id: 'hoofdagents', label: 'Hoofdagents', children: ['sales', 'linkedin', 'kilometers'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  nu:                 '/',
  hubspot:        '/administratie',
  hubspot_future: '/administratie/toekomst',
  autodraft:          '/postvak',
  autodraft_settings: '/postvak/instellingen',
  agenda:             '/agenda',
  agenda_rules:       '/agenda/spelregels',
  zoeken:             '/zoeken',
  sales:              '/road-notes',
  linkedin:           '/linkedin',
  kilometers:         '/kilometers',
  taken:              '/taken',
  settings:           '/instellingen',
  // Admin-views leven onder /admin/* — eigen shell met eigen navigatie.
  admin:                      '/admin',
  intelligence:               '/admin/intelligence',
  intelligence_quality:       '/admin/intelligence/quality',
  intelligence_observability: '/admin/intelligence/observability',
  jellemind:                  '/admin/jellemind',
  legalai:                    '/admin/legalai',
  health:                     '/admin/health',
  security:                   '/admin/security',
}

export function pathFor(viewId) {
  return VIEW_PATHS[viewId] || '/'
}

// Map een URL-pad terug naar view-id. Langste match wint, zodat
// '/postvak/instellingen' niet per ongeluk als 'autodraft' herkend wordt.
const SORTED_PATHS = Object.entries(VIEW_PATHS)
  .sort((a, b) => b[1].length - a[1].length)

export function viewFromPathname(pathname) {
  for (const [vid, p] of SORTED_PATHS) {
    if (p === '/') continue
    if (pathname === p || pathname.startsWith(p + '/')) return vid
  }
  return 'nu'
}

export default function App() {
  const sbAuth = useSupabaseAuth()
  // useUserRole pas zinvol als signed-in. Voor checking/login geeft de hook
  // role=null terug en dan komen we toch niet in de Dashboard-tak.
  const userRole = useUserRole(sbAuth.user?.id)
  const location = useLocation()

  if (sbAuth.status === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  if (sbAuth.isRecovery) {
    return <Login />
  }

  if (sbAuth.status !== 'signed-in') {
    return <Login />
  }

  const authIface = {
    profile: {
      display_name: sbAuth.user?.user_metadata?.full_name ||
                    sbAuth.user?.email?.split('@')[0] ||
                    'Gebruiker',
      name: sbAuth.user?.email || 'gebruiker',
      role: userRole.role,
    },
    logout: sbAuth.signOut,
  }

  // /admin/* paden krijgen de AdminShell met eigen sidebar — losgekoppeld van
  // het hoofd-Dashboard. Bereikbaar via het profile-menu (owner-only).
  const isAdminPath = location.pathname === '/admin' || location.pathname.startsWith('/admin/')

  return (
    <ModalProvider>
      {isAdminPath ? (
        <AdminShell auth={authIface} isOwner={userRole.isOwner} isLoadingRole={userRole.isLoadingRole} />
      ) : (
        <Dashboard auth={authIface} isOwner={userRole.isOwner} isLoadingRole={userRole.isLoadingRole} />
      )}
      <ModalRoot />
    </ModalProvider>
  )
}

// Redirect helper die de wildcard-rest meeneemt — voor legacy /instellingen/*
// paths die nu onder /admin/* leven. Behoud diepe links als bookmarks.
function PreserveWildcardRedirect({ to }) {
  const params = useParams()
  const tail = params['*'] ? `/${params['*']}` : ''
  return <Navigate to={`${to}${tail}`} replace />
}

function Dashboard({ auth, isOwner, isLoadingRole }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)

  // Multi-user access (Project — Multi-user Access, Confluence 454819841).
  // Admin-views leven nu onder /admin/* met eigen shell. Dashboard hier
  // bevat alleen de operationele views; legacy admin-paden redirecten
  // hieronder naar /admin/* zodat bookmarks blijven werken.

  // Tijdens Refactor 02-migratie:
  // - useDashboardShell levert orchestrator-pill + connection-state (nieuwe weg)
  // Refactor 26 — perf-fix: useDashboard (38 queries) is vervangen door
  // useNavBadges (7 lichte queries). Per-view data komt uit feature-hooks.
  const shell = useDashboardShell()
  const badges = useNavBadges()
  const { theme, toggle: toggleTheme } = useTheme()
  const notif = useNotifications()

  const view = viewFromPathname(location.pathname)
  // Admin-paden worden in App naar AdminShell gerouteerd — Dashboard ziet die
  // niet meer. activeNavId is dus 1-op-1 de view-id.
  const activeNavId = view
  const handleSelect = (viewId) => navigate(pathFor(viewId))

  const nav = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    let takenCount = 0
    let takenUrgent = false
    for (const t of (badges.tasks || [])) {
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.is_newly_found) {
        takenCount++ // pending review telt mee
        continue
      }
      if (t.in_backlog) continue
      const overdue = t.deadline && t.deadline < todayIso
      const due = t.deadline === todayIso || t.do_date === todayIso
      if (overdue || due) takenCount++
      if (overdue) takenUrgent = true
    }

    // Multi-user: members zien adminOnly-views niet. Tijdens role-load (!isOwner &&
    // isLoadingRole) ook verbergen — voorkomt flikker bij owner-login.
    const filtered = VIEWS.filter(v => !v.adminOnly || isOwner)
    return filtered.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: badges.adminPending, urgent: false }
      }
      if (v.id === 'sales')              return { ...v, count: badges.salesNeedsReview, urgent: false }
      if (v.id === 'taken')              return { ...v, count: takenCount, urgent: takenUrgent }
      if (v.id === 'autodraft_settings') return { ...v, count: badges.autodraftPropsCount, urgent: false }
      if (v.id === 'security') {
        const openCritHigh = (badges.securityFindings || []).length
        return { ...v, count: openCritHigh, urgent: (badges.securityFindings || []).some(f => f.severity === 'critical') }
      }
      return { ...v, count: 0 }
    })
  }, [badges.adminPending, badges.salesNeedsReview, badges.tasks, badges.autodraftPropsCount, badges.securityFindings, isOwner])

  const currentView = VIEWS.find(v => v.id === view) || VIEWS[0]

  return (
    <div className="shell">
      <Sidebar
        views={nav}
        groups={NAV_GROUPS}
        activeView={activeNavId}
        onSelect={handleSelect}
        lastRefresh={shell.lastRefresh}
        onRefresh={shell.refresh}
        orchestratorAgeMin={shell.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
        notif={notif}
        onOpenNotifications={() => setNotifOpen(true)}
        profile={auth.profile}
        onLogout={auth.logout}
      />
      <MobileBar
        views={nav}
        activeView={activeNavId}
        onSelect={handleSelect}
        onRefresh={shell.refresh}
        orchestratorAgeMin={shell.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
        notif={notif}
        onOpenNotifications={() => setNotifOpen(true)}
        profile={auth.profile}
        onLogout={auth.logout}
      />

      <NotificationDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        runs={badges.recentRuns || []}
      />

      <ToastHost />

      <main className={`main ${currentView.fullWidth ? 'main--full' : ''} ${currentView.wide ? 'main--wide' : ''} ${(view === 'hubspot' || view === 'hubspot_future') ? 'adm-app' : ''} ${view === 'autodraft' ? 'theme-maestro mc-maestro-app' : ''} ${view === 'intelligence' ? 'itl-app' : ''} ${view === 'zoeken' ? 'zk-v2-app' : ''}`}>
        {!shell.online && (
          <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
            Verbinding met Supabase verloren — laatste data van {shell.lastRefresh?.toLocaleTimeString('nl-NL')}
          </div>
        )}

        {!currentView.fullWidth && (
          <header className={`view__header view__header--with-actions${view === 'chat' ? ' view__header--compact' : ''}`}>
            <div className="view__header-text">
              <h1 className="view__title">{currentView.title}</h1>
              {currentView.subtitle && <p className="view__subtitle">{currentView.subtitle}</p>}
            </div>
            {(view === 'nu' || view === 'chat') && (
              <div className="view__header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                {view === 'nu' && <OrchestratorPill ageMin={shell.orchestratorAgeMin} />}
                <button
                  type="button"
                  className={`btn btn--ghost ${view === 'chat' ? 'is-active' : ''}`}
                  onClick={() => handleSelect(view === 'chat' ? 'nu' : 'chat')}
                  title={view === 'chat' ? 'Terug naar Dashboard' : 'Chat met je agents'}
                  aria-pressed={view === 'chat'}
                >
                  <span aria-hidden style={{ marginRight: 6 }}>{view === 'chat' ? '←' : '💬'}</span>
                  {view === 'chat' ? 'Terug' : 'Chat'}
                </button>
              </div>
            )}
            {(view === 'hubspot' || view === 'hubspot_future') && (
              <div className="view__header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => navigate('/instellingen/administratie')}
                  title="Beheer note-templates en tone-of-voice voor Daily Admin (instructies)"
                >
                  <span aria-hidden style={{ marginRight: 6 }}>📝</span>
                  Instructies
                </button>
                <AdminPeriodToggle />
              </div>
            )}
          </header>
        )}

        <Routes>
          <Route path="/"                       element={<NowView onNavigate={handleSelect} badges={badges} shell={shell} />} />
          <Route path="/administratie"          element={<HubSpotInboxView onRefresh={shell.refresh} />} />
          <Route path="/administratie/toekomst" element={<HubSpotInboxFutureView onRefresh={shell.refresh} />} />
          {/* Legacy aliases (2026-05-13) — redirecten naar de canonical paths. */}
          <Route path="/administratie-maestro"          element={<Navigate to="/administratie" replace />} />
          <Route path="/administratie-maestro/toekomst" element={<Navigate to="/administratie/toekomst" replace />} />
          <Route path="/postvak"                element={<AutoDraftView onNavigate={handleSelect} />} />
          {/* Legacy alias (2026-05-14) — Maestro-shell is canoniek geworden,
              de oude één-koloms view is verwijderd. Redirect zodat oude links
              en bookmarks blijven werken. */}
          <Route path="/postvak-maestro"        element={<Navigate to="/postvak" replace />} />
          <Route path="/postvak/instellingen"   element={<AutoDraftSettingsView onNavigate={handleSelect} />} />
          <Route path="/agenda"                 element={<AgendaView onNavigate={handleSelect} />} />
          <Route path="/agenda/spelregels"      element={<AgendaRulesView onNavigate={handleSelect} />} />
          <Route path="/zoeken"                 element={<RagSearchView />} />
          {/* Legacy redirect — Zoeken v2.0 is sinds 2026-05-20 canoniek op /zoeken */}
          <Route path="/zoeken-v2"              element={<Navigate to="/zoeken" replace />} />
          <Route path="/daily-tasks"            element={<Navigate to="/taken" replace />} />
          <Route path="/road-notes"             element={<SalesOnRoadView />} />
          <Route path="/linkedin"               element={<LinkedInView />} />
          <Route path="/kilometers"             element={<KilometersView />} />
          <Route path="/taken"                  element={<TakenV2View />} />
          {/* Legacy redirect — v2.0 is sinds 2026-05-20 canoniek op /taken */}
          <Route path="/taken-v2"               element={<Navigate to="/taken" replace />} />
          {/* Legacy admin-paden — leven nu onder /admin/* in een eigen shell.
              Behouden als redirects zodat bookmarks blijven werken. */}
          <Route path="/beheer"                       element={<Navigate to="/admin" replace />} />
          <Route path="/intelligence"                 element={<Navigate to="/admin/intelligence" replace />} />
          <Route path="/intelligence/quality"         element={<Navigate to="/admin/intelligence/quality" replace />} />
          <Route path="/intelligence/observability"   element={<Navigate to="/admin/intelligence/observability" replace />} />
          <Route path="/jellemind"                    element={<Navigate to="/admin/jellemind" replace />} />
          <Route path="/legal-ai"                     element={<Navigate to="/admin/legalai" replace />} />
          {/* /chat was de oude admin-chat view (verwijderd 2026-05-22) —
              redirect naar dashboard zodat oude bookmarks niet 404'en. */}
          <Route path="/chat"                         element={<Navigate to="/" replace />} />
          <Route path="/health"                       element={<Navigate to="/admin/health" replace />} />
          <Route path="/security"                     element={<Navigate to="/admin/security" replace />} />
          {/* Legacy infra-paden uit Settings — verhuisd naar /admin/* per 2026-05-22.
              Eerst specifiek declareren zodat ze winnen van de /instellingen/* wildcard. */}
          <Route path="/instellingen/configuratie"    element={<Navigate to="/admin/configuratie" replace />} />
          <Route path="/instellingen/edge-functions"  element={<Navigate to="/admin/edge-functions" replace />} />
          <Route path="/instellingen/deployments"     element={<Navigate to="/admin/deployments" replace />} />
          {/* Instellingen is operationeel: members + owner. Tokens (API Keys)
              wordt binnen SettingsView role-gated. */}
          <Route path="/instellingen/*"               element={<SettingsView isOwner={isOwner} />} />
          <Route path="*"                       element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function OrchestratorPill({ ageMin }) {
  let tone = 'idle', label = 'geen signaal'
  if (ageMin !== null && ageMin !== undefined) {
    if (ageMin < 20)      { tone = 'success'; label = ageMin < 1 ? 'live' : `${ageMin}m geleden` }
    else if (ageMin < 60) { tone = 'warning'; label = `${ageMin}m geleden` }
    else                  { tone = 'error';   label = ageMin < 1440 ? `${Math.round(ageMin / 60)}u geleden` : `${Math.round(ageMin / 1440)}d geleden` }
  }
  const titles = {
    success: 'Orchestrator draait — laatste poll binnen 20 min',
    warning: 'Orchestrator verlaat — meer dan 20 min sinds laatste poll',
    error:   'Orchestrator stale — meer dan 1u sinds laatste poll',
    idle:    'Geen orchestrator-signaal',
  }
  return (
    <span className={`orch-pill orch-pill--${tone}`} title={titles[tone]} aria-label={`Orchestrator ${label}`}>
      <span className="orch-pill__dot" />
      <span className="orch-pill__label">{label}</span>
    </span>
  )
}

function LoadingShell() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__logo">legal<span className="sidebar__logo-accent">mind</span></div>
        <div className="sidebar__tagline">Agent Command Center</div>
        <div className="sidebar__nav">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 34 }} />)}
        </div>
      </aside>
      <main className="main">
        <div className="skeleton" style={{ height: 60, width: '40%' }} />
        <div className="skeleton" style={{ height: 180 }} />
        <div className="skeleton" style={{ height: 220 }} />
        <div className="skeleton" style={{ height: 160 }} />
      </main>
    </div>
  )
}

function ErrorShell({ error, onRetry }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="card" style={{ maxWidth: 480, textAlign: 'center' }}>
        <div className="kpi__label" style={{ marginBottom: 10, color: 'var(--error)' }}>Verbinding mislukt</div>
        <div style={{ marginBottom: 14 }}>{error}</div>
        <button className="btn btn--accent" onClick={onRetry}>Opnieuw proberen</button>
      </div>
    </div>
  )
}
