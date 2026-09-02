import { useState, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useDashboardShell } from '../../hooks/useDashboardShell'
import { useNavBadges } from '../../hooks/useNavBadges'
import { useMobileViewportGuard } from '../../hooks/useMobileViewportGuard'
import { VIEWS, NAV_GROUPS, pathFor, viewFromPathname, isAdminPathname } from '../../routes/viewRegistry'

import Sidebar            from './Sidebar'
import MobileBar          from './MobileBar'
import ToastHost          from '../Toast'
import NowView            from '../views/NowView'
import MobileTabBar       from '../../mobile/MobileTabBar'
import MobileMoreDrawer   from '../../mobile/MobileMoreDrawer'
import MobileDashboard    from '../../mobile/screens/MobileDashboard'
import MobileTaken        from '../../mobile/screens/MobileTaken'
import MobileAdmin        from '../../mobile/screens/MobileAdmin'
import MobilePostvak      from '../../mobile/screens/MobilePostvak'
import MobileZoeken       from '../../mobile/screens/MobileZoeken'
import MobileAgenda       from '../../mobile/screens/MobileAgenda'
import MobileSettings     from '../../mobile/screens/MobileSettings'
import MobileLongRunning  from '../../mobile/screens/MobileLongRunning'
// Owner-portaal op de telefoon (v1.128, design A): hub + drill-in i.p.v. de
// desktop AdminShell. Desktop /admin/* gaat in App.jsx naar AdminShell.
import MobileAdminPortal  from '../../mobile/screens/admin/MobileAdminPortal'
// Maestro V2 is sinds 2026-05-14 canoniek — V1 (HubSpotInboxCompactView /
// HubSpotInboxFutureView + sub-files) is verwijderd. Maestro-componenten leven
// nog in de `maestro/` subfolder als historische naam-conventie.
import HubSpotInboxView       from '../views/administratie/HubSpotInboxView'
import HubSpotInboxFutureView from '../views/administratie/HubSpotInboxFutureView'
import AdminPeriodToggle       from '../views/AdminPeriodToggle'
import SalesOnRoadView    from '../views/road-notes/SalesOnRoadView'
import AutoDraftSettingsView from '../views/autodraft/AutoDraftSettingsView'
// Postvak = variant 2 (Claude Design "Postvak v2" rebuild), sinds 2026-07-07
// canoniek op /postvak na Jelle's akkoord. De oude Maestro-shell-variant is
// verwijderd (zie git-historie t/m commit b07ee52); de instellingen-route
// (/postvak/instellingen) leeft nog in views/autodraft/.
import Postvak2View          from '../views/postvak2/Postvak2View'
import LinkedInView       from '../views/linkedin/LinkedInView'
// Taken-view is sinds 2026-05-20 v2.0 — schaduw-view promoted naar canoniek
// op /taken. Oude TasksView (src/components/views/tasks/) is verwijderd.
import TakenV2View        from '../views/taken-v2/TakenV2View'
import KilometersView     from '../views/kilometers/KilometersView'
// Long running tasks (v1.127) — eigen module in Operations, stub tot inhoud.
import LongRunningTasksView from '../views/long-running/LongRunningTasksView'
import KlantverliesView      from '../views/klantverlies-v2/KlantverliesV2View'
import KlantverliesDetailView from '../views/klantverlies-v2/KlantverliesDetailView'
import KennisbankView         from '../views/kennisbank/KennisbankView'
import KbArticleView          from '../views/kennisbank/KbArticleView'
import KbReviewView           from '../views/kennisbank/KbReviewView'
import KbComposeView          from '../views/kennisbank/KbComposeView'
// Klantbase — sales pipeline → customer base verrijking + verlenging-voorspelling.
// UI-fase: dummy data uit klantbase-data.js. Backend-integratie volgt (zie
// Confluence project-voorstel).
import KlantbaseView         from '../views/klantbase/KlantbaseView'
import KlantbaseUitlegView   from '../views/klantbase/KlantbaseUitlegView'
// Zoeken — sinds 2026-05-20 is dit de v2.0 view (entity-aware RAG +
// streaming + markdown + timeline-RPC's). De oude RagSearchView is
// vervangen; de file leeft nog in `v2/` folder met RagSearchV2View
// als exportname (file rename = aparte refactor zodat git-history schoon
// blijft).
import RagSearchView      from '../views/zoeken/RagSearchView'
import AgendaView         from '../views/agenda/AgendaView'
import AgendaRulesView    from '../views/agenda/AgendaRulesView'
import BriefingView       from '../views/briefing/BriefingView'
// Settings is operationeel (instructies/algemeen voor iedereen); tokens en
// infrastructuur worden binnen SettingsView role-gegated voor owners.
import SettingsView       from '../views/settings/SettingsView'
// Platform-side 'Wat is nieuw' — alleen platform-updates, voor iedereen.
import PlatformUpdatesView from '../views/updates/PlatformUpdatesView'

// Redirect helper die de wildcard-rest meeneemt — voor legacy /instellingen/*
// paths die nu onder /admin/* leven. Behoud diepe links als bookmarks.
function PreserveWildcardRedirect({ to }) {
  const params = useParams()
  const tail = params['*'] ? `/${params['*']}` : ''
  return <Navigate to={`${to}${tail}`} replace />
}

export default function Dashboard({ auth, isOwner, isLoadingRole, theme: themeCtl, isMobile }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)
  // iOS laat het window na keyboard-dismiss soms verschoven staan → fixed
  // tabbar zweeft boven de home-indicator. Guard zet het window terug op 0.
  useMobileViewportGuard(isMobile)

  // Multi-user access (Project — Multi-user Access, Confluence 454819841).
  // Admin-views leven onder /admin/* met eigen shell (desktop). Dashboard
  // bevat de operationele views; legacy admin-paden redirecten hieronder naar
  // /admin/* zodat bookmarks blijven werken. Op de telefoon rendert Dashboard
  // óók /admin/* (MobileAdminPortal) zodat tabbar + Meer-sheet blijven staan.

  // Tijdens Refactor 02-migratie:
  // - useDashboardShell levert orchestrator-pill + connection-state (nieuwe weg)
  // Refactor 26 — perf-fix: useDashboard (38 queries) is vervangen door
  // useNavBadges (7 lichte queries). Per-view data komt uit feature-hooks.
  const shell = useDashboardShell()
  const badges = useNavBadges()
  const { theme, toggle: toggleTheme } = themeCtl

  const view = viewFromPathname(location.pathname)
  // Alle /admin/*-paden tellen als 'admin' voor de mobiele tabbar (Meer actief).
  const activeNavId = isAdminPathname(location.pathname) ? 'admin' : view
  const handleSelect = (viewId) => navigate(pathFor(viewId))

  const nav = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10)
    let takenCount = 0
    let takenUrgent = false
    for (const t of (badges.tasks || [])) {
      if (t.status === 'done' || t.status === 'dropped') continue
      // Product-cut 2026-09-01: Fireflies-voorstellen (is_newly_found) en
      // Jira/Sales-rijen staan niet meer in de Taken-UI → tellen niet mee.
      if (t.is_newly_found || t.source === 'jira' || t.source === 'sales_followup') continue
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
    <div className={`shell ${isMobile ? 'shell--m' : ''}`}>
      {!isMobile && <Sidebar
        views={nav}
        groups={NAV_GROUPS}
        activeView={activeNavId}
        onSelect={handleSelect}
        lastRefresh={shell.lastRefresh}
        onRefresh={shell.refresh}
        orchestratorAgeMin={shell.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
        profile={auth.profile}
        onLogout={auth.logout}
      />}
      {!isMobile && <MobileBar
        views={nav}
        activeView={activeNavId}
        onSelect={handleSelect}
        onRefresh={shell.refresh}
        orchestratorAgeMin={shell.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
        profile={auth.profile}
        onLogout={auth.logout}
      />}

      <ToastHost />

      <main className={isMobile ? 'm-main' : `main ${currentView.fullWidth ? 'main--full' : ''} ${currentView.wide ? 'main--wide' : ''} ${(view === 'hubspot' || view === 'hubspot_future') ? 'adm-app' : ''} ${view === 'autodraft' ? 'pvk2-shell' : ''} ${view === 'intelligence' ? 'itl-app' : ''} ${view === 'zoeken' ? 'zk-v2-app' : ''} ${view === 'klantbase' ? 'kb-shell' : ''}`}>
        {!isMobile && !shell.online && (
          <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
            Verbinding met Supabase verloren — laatste data van {shell.lastRefresh?.toLocaleTimeString('nl-NL')}
          </div>
        )}

        {!isMobile && !currentView.fullWidth && (
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
          {/* Vragenbak (471302146): / = Home (vragenbak, ook mobiel);
              de cockpit leeft op /briefing als "Briefing". */}
          <Route path="/" element={isMobile ? <MobileZoeken /> : <RagSearchView />} />
          <Route path="/briefing" element={isMobile
            ? <MobileDashboard badges={badges} profile={auth.profile} onOpenMore={() => setMoreOpen(true)} />
            : <NowView onNavigate={handleSelect} badges={badges} shell={shell} />} />
          <Route path="/administratie"          element={isMobile ? <MobileAdmin /> : <HubSpotInboxView onRefresh={shell.refresh} />} />
          <Route path="/administratie/toekomst" element={<HubSpotInboxFutureView onRefresh={shell.refresh} />} />
          {/* Legacy aliases (2026-05-13) — redirecten naar de canonical paths. */}
          <Route path="/administratie-maestro"          element={<Navigate to="/administratie" replace />} />
          <Route path="/administratie-maestro/toekomst" element={<Navigate to="/administratie/toekomst" replace />} />
          <Route path="/postvak"                element={isMobile ? <MobilePostvak /> : <Postvak2View />} />
          {/* Legacy aliassen: /postvak-maestro (oude Maestro-shell) en
              /postvak2 (schaduw-periode variant 2) → beide naar /postvak. */}
          <Route path="/postvak-maestro"        element={<Navigate to="/postvak" replace />} />
          <Route path="/postvak2"               element={<Navigate to="/postvak" replace />} />
          <Route path="/postvak/instellingen"   element={<AutoDraftSettingsView onNavigate={handleSelect} />} />
          <Route path="/agenda"                 element={isMobile ? <MobileAgenda /> : <AgendaView onNavigate={handleSelect} />} />
          <Route path="/agenda/spelregels"      element={<AgendaRulesView onNavigate={handleSelect} />} />
          {/* Pre-meeting briefing per calendar-event (wired op meeting_briefings).
              Bereikbaar vanaf de NU-kaart + timeline op het dashboard. */}
          <Route path="/agenda/briefing/:eventId" element={<BriefingView />} />
          {/* Legacy redirects — de vragenbak is sinds 2026-06-12 Home op /. */}
          <Route path="/zoeken"                 element={<Navigate to="/" replace />} />
          <Route path="/zoeken-v2"              element={<Navigate to="/" replace />} />
          <Route path="/daily-tasks"            element={<Navigate to="/taken" replace />} />
          <Route path="/road-notes"             element={<SalesOnRoadView />} />
          <Route path="/linkedin"               element={<LinkedInView />} />
          <Route path="/kilometers"             element={<KilometersView />} />
          <Route path="/taken"                  element={isMobile ? <MobileTaken /> : <TakenV2View />} />
          {/* Legacy redirect — v2.0 is sinds 2026-05-20 canoniek op /taken */}
          <Route path="/taken-v2"               element={<Navigate to="/taken" replace />} />
          {/* Long running tasks (v1.127) — module in Operations / Meer, stub. */}
          <Route path="/long-running-tasks"     element={isMobile ? <MobileLongRunning /> : <LongRunningTasksView />} />
          <Route path="/klantverlies"           element={<KlantverliesView />} />
          <Route path="/klantverlies/:dealId"   element={<KlantverliesDetailView />} />
          {/* Legacy redirect — v2 is sinds 2026-05-27 canoniek op /klantverlies */}
          <Route path="/klantverlies-v2/*"      element={<PreserveWildcardRedirect to="/klantverlies" />} />
          {/* Klantbase — UI-fase, dummy data. Drie schermen via één view:
              /klantbase (overdracht), /klantbase/verlenging, /klantbase/uitleg + /velden. */}
          <Route path="/klantbase"              element={<KlantbaseView />} />
          <Route path="/klantbase/verlenging"   element={<KlantbaseView />} />
          <Route path="/klantbase/uitleg"       element={<KlantbaseUitlegView />} />
          <Route path="/klantbase/velden"       element={<KlantbaseUitlegView />} />
          <Route path="/kennisbank"             element={<KennisbankView />} />
          {/* Handmatige AI-aanmaak — beschrijving → 2 versies → publiceren/concept. */}
          <Route path="/kennisbank/nieuw"       element={<KbComposeView />} />
          {/* Kennisbank artikel-detail (Project Kennisbank) — gepubliceerd
              kb_article met transparantie-paneel (bron-mails + waarom). */}
          <Route path="/kennisbank/artikel/:id" element={<KbArticleView profile={auth.profile} />} />
          <Route path="/kennisbank/review"      element={<KbReviewView />} />
          {/* Platform 'Wat is nieuw' — voor iedereen toegankelijk, alleen
              area=platform updates. RLS filtert al, hier expliciet voor owner-views. */}
          <Route path="/updates"                element={<PlatformUpdatesView />} />
          {/* Owner-portaal op de telefoon (v1.128): hub + drill-in. Op desktop
              komt Dashboard hier nooit — App.jsx rendert dan AdminShell. */}
          <Route path="/admin/*"                element={isMobile
            ? <MobileAdminPortal isOwner={isOwner} isLoadingRole={isLoadingRole} badges={badges} />
            : <Navigate to="/admin/health" replace />} />
          {/* Legacy admin-paden — leven nu onder /admin/* in een eigen shell.
              Behouden als redirects zodat bookmarks blijven werken. */}
          <Route path="/beheer"                       element={<Navigate to="/admin" replace />} />
          <Route path="/intelligence"                 element={<Navigate to="/admin/intelligence" replace />} />
          <Route path="/intelligence/quality"         element={<Navigate to="/admin/intelligence/kwaliteit" replace />} />
          <Route path="/intelligence/observability"   element={<Navigate to="/admin/intelligence/kosten" replace />} />
          <Route path="/jellemind"                    element={<Navigate to="/admin/jellemind" replace />} />
          <Route path="/legal-ai"                     element={<Navigate to="/admin/legalai" replace />} />
          {/* /chat was de oude admin-chat view (verwijderd 2026-05-22) —
              redirect naar dashboard zodat oude bookmarks niet 404'en. */}
          <Route path="/chat"                         element={<Navigate to="/" replace />} />
          <Route path="/health"                       element={<Navigate to="/admin/health" replace />} />
          <Route path="/security"                     element={<Navigate to="/admin/security" replace />} />
          {/* Legacy infra-paden uit Settings — verhuisd naar /admin/* per 2026-05-22
              (Configuratie/Edge Functions/Deployments) en v1.128 (Agent-overzicht →
              Health-tab, Database + API Keys → Infrastructuur). Eerst specifiek
              declareren zodat ze winnen van de /instellingen/* wildcard. */}
          <Route path="/instellingen/configuratie"    element={<Navigate to="/admin/configuratie" replace />} />
          <Route path="/instellingen/edge-functions"  element={<Navigate to="/admin/edge-functions" replace />} />
          <Route path="/instellingen/deployments"     element={<Navigate to="/admin/deployments" replace />} />
          <Route path="/instellingen/agent-overzicht" element={<Navigate to="/admin/health/agents" replace />} />
          <Route path="/instellingen/database"        element={<Navigate to="/admin/database" replace />} />
          <Route path="/instellingen/api-keys"        element={<Navigate to="/admin/api-keys" replace />} />
          {/* Instellingen is operationeel: members + owner. Mobiel (v1.126,
              design A) krijgt een eigen iOS drill-in scherm i.p.v. de
              gesquashte desktop-two-pane. */}
          <Route path="/instellingen/*"               element={isMobile
            ? <MobileSettings isOwner={isOwner} profile={auth.profile} onLogout={auth.logout} theme={theme} onToggleTheme={toggleTheme} />
            : <SettingsView isOwner={isOwner} profile={auth.profile} />} />
          <Route path="*"                       element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {isMobile && (
        <MobileTabBar
          activeView={activeNavId}
          onSelect={handleSelect}
          onOpenMore={() => setMoreOpen(true)}
          counts={{ admin: badges.adminPending || 0, task: nav.find(v => v.id === 'taken')?.count || 0 }}
        />
      )}
      {isMobile && (
        <MobileMoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          nav={nav}
          activeView={activeNavId}
          onSelect={(id) => { setMoreOpen(false); handleSelect(id) }}
          isOwner={isOwner}
          profile={auth.profile}
          onLogout={auth.logout}
          theme={theme}
          onToggleTheme={toggleTheme}
          adminBadge={(badges.securityFindings || []).length}
        />
      )}
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
