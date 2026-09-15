import { useState, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useDashboardShell } from '../../hooks/useDashboardShell'
import { useNavBadges } from '../../hooks/useNavBadges'
import { useMyCapabilities } from '../../hooks/useMyCapabilities'
import { zichtbareViews } from '../../lib/capabilities'
import { useMobileViewportGuard } from '../../hooks/useMobileViewportGuard'
import { VIEWS, NAV_GROUPS, pathFor, viewFromPathname, isAdminPathname, groupLabelFor, parentFor } from '../../routes/viewRegistry'

import AppShell           from './AppShell'
import MobileBar          from './MobileBar'
import ToastHost          from '../Toast'
// Product-removal 2026-09-12 (spoor 12): Briefing-cockpit (`nu` → /briefing,
// desktop NowView / mobiel MobileDashboard) is als navigeerbare pagina weg.
// Componenten staan nog op schijf — geparkeerd voor design-v3 Home (spoor 09).
import MobileTabBar       from '../../mobile/MobileTabBar'
import MobileMoreDrawer   from '../../mobile/MobileMoreDrawer'
import MobileTaken        from '../../mobile/screens/MobileTaken'
import MobileAdmin        from '../../mobile/screens/MobileAdmin'
import MobilePostvak      from '../../mobile/screens/MobilePostvak'
import MobileZoeken       from '../../mobile/screens/MobileZoeken'
// Home op de telefoon (v1.176, design A "Stuurkaarten"): / is ook mobiel het
// Dashboard — drie stuurkaarten (D1 · D9 · D10) plus de overige tegels. De
// vragenbak (MobileZoeken) staat sinds v1.176 op /zoeken, net als op desktop.
import MobileHome         from '../../mobile/screens/MobileHome'
import MobileAgenda       from '../../mobile/screens/MobileAgenda'
import MobileSettings     from '../../mobile/screens/MobileSettings'
import MobileLongRunning  from '../../mobile/screens/MobileLongRunning'
// Owner-portaal op de telefoon (v1.128, design A): hub + drill-in. Op desktop
// rendert OrganisatieView hetzelfde portaal als overlay-pane (v1.172, spoor 20).
import MobileAdminPortal  from '../../mobile/screens/admin/MobileAdminPortal'
import OrganisatieView    from '../views/organisatie/OrganisatieView'
// Maestro V2 is sinds 2026-05-14 canoniek — V1 (HubSpotInboxCompactView /
// HubSpotInboxFutureView + sub-files) is verwijderd. Maestro-componenten leven
// nog in de `maestro/` subfolder als historische naam-conventie.
import HubSpotInboxView       from '../views/administratie/HubSpotInboxView'
import HubSpotInboxFutureView from '../views/administratie/HubSpotInboxFutureView'
import AdminPeriodToggle       from '../views/AdminPeriodToggle'
import AutoDraftSettingsView from '../views/autodraft/AutoDraftSettingsView'
// Postvak = variant 2 (Claude Design "Postvak v2" rebuild), sinds 2026-07-07
// canoniek op /postvak na Jelle's akkoord. De oude Maestro-shell-variant is
// verwijderd (zie git-historie t/m commit b07ee52); de instellingen-route
// (/postvak/instellingen) leeft nog in views/autodraft/.
import Postvak2View          from '../views/postvak2/Postvak2View'
// Taken-view is sinds 2026-05-20 v2.0 — schaduw-view promoted naar canoniek
// op /taken. Oude TasksView (src/components/views/tasks/) is verwijderd.
import TakenV2View        from '../views/taken-v2/TakenV2View'
// Long running tasks (v1.127) — eigen module in Operations, stub tot inhoud.
import LongRunningTasksView from '../views/long-running/LongRunningTasksView'
// Stuurinformatie — D1/D9/D10 als Home-dashboards (v1.178 geen nav-groep).
// full-width views; werkt ook op de telefoon (checktabel wordt kaartenlijst).
import D1View                from '../views/stuurinformatie/d1/D1View'
import D1Kwartaal            from '../views/stuurinformatie/d1/D1Kwartaal'
import D9View                from '../views/stuurinformatie/d9/D9View'
import D10View               from '../views/stuurinformatie/d10/D10View'
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
// Home (v1.158) — dashboard-tegels als landing op desktop. De vragenbak
// (RagSearchView) verhuist naar /zoeken en blijft bereikbaar via het zoekveld
// in de sidebar, het zoek-icoon in de topbalk en ⌘K. Mobiel blijft / de
// vragenbak (MobileZoeken) — daar verandert niets.
import HomeView           from '../views/home/HomeView'
import AgendaView         from '../views/agenda/AgendaView'
import AgendaRulesView    from '../views/agenda/AgendaRulesView'
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

export default function Dashboard({ auth, isOwner, isLoadingRole, isMobile }) {
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
  // Multi-user M2 — één instantie voor de hele shell; sub-views krijgen 'm via
  // props (pre-flight-regel 4: geen tweede useMyCapabilities in dezelfde tree).
  const caps = useMyCapabilities()

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

    // Multi-user M2: de navigatie volgt de rechten uit de matrix, niet meer één
    // boolean. De regel zelf staat in lib/capabilities.js, naast magOrganisatie().
    const filtered = zichtbareViews(VIEWS, caps, isOwner)
    return filtered.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: badges.adminPending, urgent: false }
      }
      if (v.id === 'taken')              return { ...v, count: takenCount, urgent: takenUrgent }
      if (v.id === 'autodraft_settings') return { ...v, count: badges.autodraftPropsCount, urgent: false }
      if (v.id === 'security') {
        const openCritHigh = (badges.securityFindings || []).length
        return { ...v, count: openCritHigh, urgent: (badges.securityFindings || []).some(f => f.severity === 'critical') }
      }
      return { ...v, count: 0 }
    })
  }, [badges.adminPending, badges.tasks, badges.autodraftPropsCount, badges.securityFindings, isOwner, caps.ready, caps.has])

  const currentView = VIEWS.find(v => v.id === view) || VIEWS[0]
  const groupLabel = groupLabelFor(view)

  // Per-view acties die vroeger in `view__header` stonden. Ze zijn niet
  // verdwenen maar verhuisd naar de rechterkant van de vaste topbalk, zodat
  // elke pagina dezelfde chrome houdt (design-lock 2026-09-12).
  const topActions = (view === 'hubspot' || view === 'hubspot_future') ? (
    <>
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
    </>
  ) : null

  // De weg terug staat op élke desktop-pagina in de topbalk, en alleen daar
  // (v1.191, Jelle 14-09-2026: "navigatie terug alleen in de TopBar"). In
  // v1.189 stond `◂ Dashboard` alleen op de vier dashboardborden en droeg elk
  // bord er zelf nog een in zijn kop — twee keer dezelfde bestemming binnen
  // veertig pixels. Nu wijst de topbalk naar de ouder van het pad: een
  // top-level pagina naar Dashboard, een ingesprongen pagina naar de pagina
  // erboven (kwartaaldiagnose → Pipeline, dossier → Klantverlies). Home zelf
  // heeft geen ouder en dus geen pijl. De regel staat in viewRegistry.parentFor.
  const parent = parentFor(location.pathname)
  const topBack = parent
    ? { label: parent.label, onClick: () => navigate(parent.path) }
    : null

  // De broodkruimel: voor een view in een nav-groep "Operations / Postvak"
  // (v1.158); voor een ingesprongen pagina buiten de groepen het spoor naar
  // haar ouder, "Pipeline / Kwartaaldiagnose". Ligt het pad dieper dan de
  // route van dezelfde view (dossier, artikel), dan zegt de titel het al.
  const crumb = groupLabel
    ? `${groupLabel} / ${currentView.label}`
    : (parent && parent.viewId !== view && parent.viewId !== 'zoeken'
      ? `${parent.label} / ${currentView.label}`
      : null)

  const mainClassName = [
    currentView.fullWidth ? 'main--full' : '',
    currentView.wide ? 'main--wide' : '',
    (view === 'hubspot' || view === 'hubspot_future') ? 'adm-app' : '',
    view === 'autodraft' ? 'pvk2-shell' : '',
    view === 'vragenbak' ? 'zk-v2-app' : '',
    view === 'klantbase' ? 'kb-shell' : '',
  ].filter(Boolean).join(' ')

  const content = (
    <>
      {!isMobile && !shell.online && (
        <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
          Verbinding met Supabase verloren — laatste data van {shell.lastRefresh?.toLocaleTimeString('nl-NL')}
        </div>
      )}

      {/* De topbalk draagt de paginatitel; hier blijft alleen de subtitel
          staan zodat pagina's hem niet dubbel tonen. */}
      {!isMobile && !currentView.fullWidth && currentView.subtitle && (
        <header className="view__header view__header--with-actions">
          <div className="view__header-text">
            <p className="view__subtitle">{currentView.subtitle}</p>
          </div>
        </header>
      )}

      <Routes>
          {/* v1.158 — op desktop is / de dashboard-Home (tegels); de vragenbak
              staat op /zoeken en is bereikbaar via het zoekveld in de sidebar,
              het zoek-icoon in de topbalk en ⌘K. Sinds v1.176 geldt dat óók
              mobiel: / = MobileHome (stuurkaarten), /zoeken = MobileZoeken. */}
          <Route path="/" element={isMobile ? <MobileHome profile={auth.profile} isOwner={isOwner} /> : <HomeView profile={auth.profile} />} />
          {/* Briefing-removal 2026-09-12 — bookmarks blijven werken. */}
          <Route path="/briefing" element={<Navigate to="/" replace />} />
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
          {/* Pre-meeting briefing per calendar-event verwijderd 2026-09-12 —
              oude links landen op de agenda. */}
          <Route path="/agenda/briefing/:eventId" element={<Navigate to="/agenda" replace />} />
          {/* Vragenbak op een eigen pad (v1.158); mobiel sinds v1.176 ook hier
              (via de vraag-pil op Home en de rij Analyse in Meer). */}
          <Route path="/zoeken"                 element={isMobile ? <MobileZoeken /> : <RagSearchView isOwner={isOwner} />} />
          <Route path="/zoeken-v2"              element={<Navigate to="/zoeken" replace />} />
          <Route path="/daily-tasks"            element={<Navigate to="/taken" replace />} />
          <Route path="/taken"                  element={isMobile ? <MobileTaken /> : <TakenV2View />} />
          {/* Legacy redirect — v2.0 is sinds 2026-05-20 canoniek op /taken */}
          <Route path="/taken-v2"               element={<Navigate to="/taken" replace />} />
          {/* Long running tasks (v1.127) — module in Operations / Meer, stub. */}
          <Route path="/long-running-tasks"     element={isMobile ? <MobileLongRunning /> : <LongRunningTasksView />} />
          {/* Stuurinformatie · D1 (stuurbord) + D9 (hygiënebord eronder).
              Sinds v1.174 is /pipeline het pipelinebord zelf; de tijdelijke
              redirect naar /pipeline/hygiene is daarmee vervallen. */}
          <Route path="/pipeline"               element={<D1View />} />
          <Route path="/pipeline/hygiene"       element={<D9View />} />
          {/* De kwartaaldiagnose (v1.181) draagt wat van het weekbord af moest
              zonder weg te mogen: win-rate-hoeken, dekking, stage-ontleding en
              salescyclus. Eén klik vanaf /pipeline, niet nergens. */}
          <Route path="/pipeline/kwartaal"      element={<D1Kwartaal />} />
          {/* D10 stuurbord (v1.178) — pure board via D10View; oude CS-dossiershell
              staat geparkeerd. Detailroute blijft voor diepe links. */}
          <Route path="/klantverlies"           element={<D10View />} />
          <Route path="/klantverlies/:dealId"   element={<KlantverliesDetailView />} />
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
          {/* Organisatie (owner-only). Desktop: overlay-pane náást de Espresso-
              sidebar, zelfde patroon als Instellingen (v1.172, spoor 20).
              Telefoon: hub + drill-in, ongewijzigd sinds v1.128. */}
          <Route path="/organisatie/*"          element={isMobile
            ? <MobileAdminPortal isOwner={isOwner} isLoadingRole={isLoadingRole} badges={badges} />
            : <OrganisatieView isOwner={isOwner} isLoadingRole={isLoadingRole} profile={auth.profile} caps={caps} />} />
          {/* /admin/* was het pad tot v1.171 — bookmarks en oude links houden
              hun diepe pad (/admin/health/agents → /organisatie/health/agents). */}
          <Route path="/admin/*"                      element={<PreserveWildcardRedirect to="/organisatie" />} />
          <Route path="/beheer"                       element={<Navigate to="/organisatie" replace />} />
          {/* Intelligence is per 2026-09-14 weg (v1.183) en de Pijplijn-uitleg
              die ervoor in de plaats kwam verhuisde in v1.195 (P9) uit het
              owner-portaal naar Instellingen › Uitleg. Drie generaties links
              landen daarom op dezelfde pagina. Ze staan ná de
              /organisatie/*-wildcard maar winnen er wél van: React Router
              rangschikt op specificiteit, niet op volgorde. */}
          <Route path="/intelligence/*"               element={<Navigate to="/instellingen/uitleg/pijplijn" replace />} />
          <Route path="/organisatie/pijplijn"         element={<Navigate to="/instellingen/uitleg/pijplijn" replace />} />
          <Route path="/organisatie/intelligence/*"   element={<Navigate to="/instellingen/uitleg/pijplijn" replace />} />
          {/* /admin/pijplijn hoeft hier niet: die valt in de /admin/*-regel
              hierboven en komt via /organisatie/pijplijn alsnog goed uit. */}
          {/* JelleMind-removal 2026-09-12 — product weg, oude links naar Home. */}
          <Route path="/jellemind"                    element={<Navigate to="/" replace />} />
          <Route path="/legal-ai"                     element={<Navigate to="/organisatie/legalai" replace />} />
          {/* /chat was de oude admin-chat view (verwijderd 2026-05-22) —
              redirect naar dashboard zodat oude bookmarks niet 404'en. */}
          <Route path="/chat"                         element={<Navigate to="/" replace />} />
          <Route path="/health"                       element={<Navigate to="/organisatie/health" replace />} />
          <Route path="/security"                     element={<Navigate to="/organisatie/security" replace />} />
          {/* Legacy infra-paden uit Settings. Configuratie, Edge Functions en
              Database zijn per v1.172 één pagina (Platform); die drie slugs
              vangt OrganisatieView zelf op. Eerst specifiek declareren zodat ze
              winnen van de /instellingen/* wildcard. */}
          <Route path="/instellingen/configuratie"    element={<Navigate to="/organisatie/platform" replace />} />
          <Route path="/instellingen/edge-functions"  element={<Navigate to="/organisatie/platform" replace />} />
          <Route path="/instellingen/deployments"     element={<Navigate to="/organisatie/deployments" replace />} />
          <Route path="/instellingen/agent-overzicht" element={<Navigate to="/organisatie/health/agents" replace />} />
          <Route path="/instellingen/database"        element={<Navigate to="/organisatie/platform" replace />} />
          <Route path="/instellingen/api-keys"        element={<Navigate to="/organisatie/api-keys" replace />} />
          {/* Instellingen is operationeel: members + owner. Mobiel (v1.126,
              design A) krijgt een eigen iOS drill-in scherm i.p.v. de
              gesquashte desktop-two-pane. */}
          <Route path="/instellingen/*"               element={isMobile
            ? <MobileSettings isOwner={isOwner} profile={auth.profile} onLogout={auth.logout} />
            : <SettingsView isOwner={isOwner} profile={auth.profile} caps={caps} />} />
          <Route path="*"                       element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )

  // Mobiel: ongewijzigd — tabbar, Meer-sheet en m-main blijven zoals ze waren.
  if (isMobile) {
    return (
      <div className="shell shell--m">
        <ToastHost />
        <main className="m-main">{content}</main>
        {/* v1.204: de Admin-tab werd Agenda en Administratie zakte naar de
            Meer-drawer. De adminPending-teller stond op die tab en zou daarmee
            onzichtbaar worden tot je de drawer opent — hij staat nu op "Meer",
            zodat het signaal blijft. In de drawer zelf staat dezelfde teller
            nog eens op de rij Administratie (via nav.count). */}
        <MobileTabBar
          activeView={activeNavId}
          onSelect={handleSelect}
          onOpenMore={() => setMoreOpen(true)}
          counts={{ more: badges.adminPending || 0, task: nav.find(v => v.id === 'taken')?.count || 0 }}
        />
        <MobileMoreDrawer
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          nav={nav}
          activeView={activeNavId}
          onSelect={(id) => { setMoreOpen(false); handleSelect(id) }}
          isOwner={isOwner}
          profile={auth.profile}
          onLogout={auth.logout}
          adminBadge={(badges.securityFindings || []).length}
        />
      </div>
    )
  }

  // Desktop: Espresso-sidebar + vaste topbalk op élke route (v1.158).
  return (
    <AppShell
      views={nav}
      groups={NAV_GROUPS}
      activeView={activeNavId}
      onSelect={handleSelect}
      title={currentView.title}
      crumb={crumb}
      topBack={topBack}
      topActions={topActions}
      profile={auth.profile}
      onLogout={auth.logout}
      orchestratorAgeMin={shell.orchestratorAgeMin}
      mainClassName={mainClassName}
      chrome={
        <MobileBar
          views={nav}
          activeView={activeNavId}
          onSelect={handleSelect}
          onRefresh={shell.refresh}
          orchestratorAgeMin={shell.orchestratorAgeMin}
          profile={auth.profile}
          onLogout={auth.logout}
        />
      }
    >
      <ToastHost />
      {content}
    </AppShell>
  )
}
