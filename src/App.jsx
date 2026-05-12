import { useState, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useDashboardShell } from './hooks/useDashboardShell'
import { useNavBadges } from './hooks/useNavBadges'
import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useNotifications } from './hooks/useNotifications'
import { ModalProvider, ModalRoot } from './components/ui/ModalProvider'

import Login              from './components/Login'
import Sidebar            from './components/shell/Sidebar'
import MobileBar          from './components/shell/MobileBar'
import NotificationDrawer from './components/shell/NotificationDrawer'
import ToastHost          from './components/Toast'
import NowView            from './components/views/NowView'
import HubSpotInboxCompactView from './components/views/administratie/HubSpotInboxCompactView'
import HubSpotInboxFutureView  from './components/views/administratie/HubSpotInboxFutureView'
import HubSpotInboxMaestroView       from './components/views/administratie/maestro/HubSpotInboxMaestroView'
import HubSpotInboxFutureMaestroView from './components/views/administratie/maestro/HubSpotInboxFutureMaestroView'
import AdminPeriodToggle       from './components/views/AdminPeriodToggle'
import SalesOnRoadView    from './components/views/road-notes/SalesOnRoadView'
import AutoDraftView      from './components/views/autodraft/AutoDraftView'
import AutoDraftMaestroView from './components/views/autodraft/AutoDraftMaestroView'
import LinkedInView       from './components/views/linkedin/LinkedInView'
import ChatView           from './components/views/chat/ChatView'
import TasksView          from './components/views/tasks/TasksView'
import KilometersView     from './components/views/kilometers/KilometersView'
import RagSearchView      from './components/views/zoeken/RagSearchView'
import IntelligenceHubView from './components/views/intelligence/maestro/IntelligenceMaestroView'
import IntelligenceQualityView from './components/views/intelligence/IntelligenceQualityView'
import SettingsView       from './components/views/SettingsView'
import MindView           from './components/views/jellemind/JelleMindView'
import LegalAIView        from './components/views/legal-ai/LegalAIView'
import AgendaView         from './components/views/agenda/AgendaView'
import AgendaRulesView    from './components/views/agenda/AgendaRulesView'
import HealthView         from './components/views/health/HealthView'
import ContactenView      from './components/views/contacten/ContactenView'
import SecurityView       from './components/views/security/SecurityView'

const VIEWS = [
  { id: 'nu',        label: 'Dashboard',       title: 'Dashboard',        subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het de afgelopen periode.', fullWidth: true },
  { id: 'jellemind', label: 'JelleMind',       title: 'JelleMind',        subtitle: 'Drie laden voor wat agents geleerd hebben — Jelle (persoonlijke voorkeur), Legal Mind (organisatie-waarheid), Skills (procesinstructies). Alles op één blad om snel te beheren.', wide: true },
  { id: 'legalai',   label: 'Legal AI',        title: 'Legal AI Thought Leadership', subtitle: 'Dagelijks dossier over de Legal AI-markt — twee tracks (advocatuur + bedrijfsleven). Onderzoek + dagartikel + LinkedIn-drafts. Voice-feedback evolueert je visie zonder tunnel-visie.' },
  { id: 'hubspot',   label: 'Administratie',   title: 'Administratie · Admin',    subtitle: 'CRM-updates (HubSpot), partner-notities (Jira Partnerships) en recruitment-notes — alle voorstellen van Daily Admin én Daily Admin Future. Verdeeld in Nieuw / Goedkeuren / Meer informatie nodig.', wide: true },
  { id: 'hubspot_future', label: 'Toekomst',  title: 'Administratie · Toekomst', subtitle: 'Tabel-overzicht van aankomende externe afspraken (28d vooruit). Voorstellen voor nieuwe records komen vanzelf in de Admin-tab onder "Nieuw".', wide: true },
  { id: 'hubspot_maestro', label: 'Administratie (Maestro)', title: 'Administratie · Admin', subtitle: '', fullWidth: true },
  { id: 'hubspot_maestro_future', label: 'Toekomst (Maestro)', title: 'Administratie · Toekomst', subtitle: '', fullWidth: true },
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: 'Je volledige postvak met een skill-voorstel per mail. Reageer, negeer of stuur aanpassing — al beantwoorde of verplaatste mails worden automatisch verborgen.', fullWidth: true },
  { id: 'autodraft_maestro',  label: 'Postvak (Maestro)', title: 'Postvak',         subtitle: '', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing · Instellingen', subtitle: 'Voorstellen, categorieën, logboek en geleerde regels — alle skill-configuratie van auto-draft op één plek met tabs.' },
  { id: 'agenda',             label: 'Agenda',      title: 'Agenda',               subtitle: 'Outlook-agenda met week- en dag-view. Toggle \"Toon spelregels\" rendert reistijd-buffers, verkeer-windows en interne dagen als shadow-laag. Outlook blijft bron-van-waarheid.', fullWidth: true },
  { id: 'agenda_rules',       label: 'Spelregels',  title: 'Agenda · Spelregels',  subtitle: 'Beheer alle spelregels van je agenda — verkeer-windows, reistijd-buffers, interne dagen, locatieregels en meer. Wijzigingen werken direct door op de agenda-view.', fullWidth: true },
  { id: 'sales',     label: 'Road Notes',      title: 'Road Notes',       subtitle: 'Drop een korte aantekening na een kennismakingsgesprek; agent verwerkt naar HubSpot-updates, notitie per deal en Outlook-concept in de Sales Agent-map.' },
  { id: 'linkedin',  label: 'LinkedIn',        title: 'LinkedIn Agent',   subtitle: 'Dagelijks 15 connect-verzoeken via Composio Browser Tool. Targets uit mailbox, HubSpot-pipeline, proefperiode-kantoren en concurrenten. Strategie stuur je hieronder.' },
  { id: 'kilometers', label: 'Kilometers',     title: 'Kilometerregistratie', subtitle: 'Maandelijkse km-registratie voor Burggraaf Group. Draait automatisch op de 2e van elke maand. Voeg ritten direct toe via het invoerblok hieronder.' },
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: 'Alles wat actie vraagt op één pagina — Klant / Hoog / Midden / Laag, met backlog per bucket. Sales follow-ups, Jira en mogelijk-al-klaar verschijnen onderaan.' },
  { id: 'contacten',     label: 'Contactpersonen', title: 'Contactpersonen', subtitle: 'Source-of-truth van iedereen waarmee je ooit contact hebt gehad — gevuld vanuit HubSpot + Outlook. Filter op type/firm, override handmatig en zoek met autocomplete. Nightly delta-sync 03:30.' },
  { id: 'zoeken',        label: 'Zoeken',        title: 'Zoeken',        subtitle: 'Vector-zoekmachine over al je bronnen — mail, HubSpot (engagements/deals/companies/contacts) en Jira. Stel een vraag in natuurlijke taal en krijg de meest relevante records terug.' },
  { id: 'intelligence',  label: 'Intelligence',  title: 'Intelligence Hub', subtitle: '', fullWidth: true },
  { id: 'intelligence_quality', label: 'Quality', title: 'Intelligence · Quality', subtitle: 'Diepere analyse op rag_outcomes — acceptance-rate per skill, per chunk-source, per retrieval-strategie. match_chunks vs match_chunks_for_entity vergelijking zodra ≥10 outcomes per strategie.' },
  { id: 'chat',          label: 'Chat',          title: 'Chat',          subtitle: '' },
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.' },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.' },
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: '', fullWidth: true },
]

// Sidebar-volgorde — drie lagen:
//   1. Dashboard (los)
//   2. Operations — dagelijks operationeel werk
//   3. Hoofdagents — alle AI-agents
const NAV_GROUPS = [
  { kind: 'item',  id: 'nu' },
  { kind: 'group', id: 'operations',  label: 'Operations',  children: ['hubspot', 'hubspot_maestro', 'autodraft', 'autodraft_maestro', 'agenda', 'zoeken', 'intelligence'] },
  { kind: 'group', id: 'hoofdagents', label: 'Hoofdagents', children: ['jellemind', 'legalai', 'taken', 'sales', 'linkedin', 'kilometers', 'contacten'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  nu:                 '/',
  hubspot:            '/administratie',
  hubspot_future:     '/administratie/toekomst',
  hubspot_maestro:        '/administratie-maestro',
  hubspot_maestro_future: '/administratie-maestro/toekomst',
  autodraft:          '/postvak',
  autodraft_maestro:  '/postvak-maestro',
  autodraft_settings: '/postvak/instellingen',
  agenda:             '/agenda',
  agenda_rules:       '/agenda/spelregels',
  zoeken:             '/zoeken',
  intelligence:       '/intelligence',
  intelligence_quality: '/intelligence/quality',
  jellemind:          '/jellemind',
  legalai:            '/legal-ai',
  sales:              '/road-notes',
  linkedin:           '/linkedin',
  kilometers:         '/kilometers',
  taken:              '/taken',
  contacten:          '/contacten',
  chat:               '/chat',
  health:             '/health',
  security:           '/security',
  settings:           '/instellingen',
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
    },
    logout: sbAuth.signOut,
  }

  return (
    <ModalProvider>
      <Dashboard auth={authIface} />
      <ModalRoot />
    </ModalProvider>
  )
}

function Dashboard({ auth }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [notifOpen, setNotifOpen] = useState(false)

  // Tijdens Refactor 02-migratie:
  // - useDashboardShell levert orchestrator-pill + connection-state (nieuwe weg)
  // Refactor 26 — perf-fix: useDashboard (38 queries) is vervangen door
  // useNavBadges (7 lichte queries). Per-view data komt uit feature-hooks.
  const shell = useDashboardShell()
  const badges = useNavBadges()
  const { theme, toggle: toggleTheme } = useTheme()
  const notif = useNotifications()

  const view = viewFromPathname(location.pathname)
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

    return VIEWS.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: badges.adminPending, urgent: false }
      }
      if (v.id === 'sales')              return { ...v, count: badges.salesNeedsReview, urgent: false }
      if (v.id === 'chat')               return { ...v, count: badges.chatPending, urgent: false }
      if (v.id === 'taken')              return { ...v, count: takenCount, urgent: takenUrgent }
      if (v.id === 'autodraft_settings') return { ...v, count: badges.autodraftPropsCount, urgent: false }
      if (v.id === 'security') {
        const openCritHigh = (badges.securityFindings || []).length
        return { ...v, count: openCritHigh, urgent: (badges.securityFindings || []).some(f => f.severity === 'critical') }
      }
      return { ...v, count: 0 }
    })
  }, [badges.adminPending, badges.salesNeedsReview, badges.chatPending, badges.tasks, badges.autodraftPropsCount, badges.securityFindings])

  const currentView = VIEWS.find(v => v.id === view) || VIEWS[0]

  return (
    <div className="shell">
      <Sidebar
        views={nav}
        groups={NAV_GROUPS}
        activeView={view}
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
        activeView={view}
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

      <main className={`main ${currentView.fullWidth ? 'main--full' : ''} ${currentView.wide ? 'main--wide' : ''} ${(view === 'hubspot_maestro' || view === 'hubspot_maestro_future') ? 'theme-maestro adm-app' : ''} ${view === 'autodraft_maestro' ? 'theme-maestro mc-maestro-app' : ''} ${view === 'intelligence' ? 'theme-maestro itl-maestro-app' : ''}`}>
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
            {(view === 'hubspot' || view === 'hubspot_future' || view === 'hubspot_maestro' || view === 'hubspot_maestro_future') && (
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
          <Route path="/administratie"          element={<HubSpotInboxCompactView onRefresh={shell.refresh} />} />
          <Route path="/administratie/toekomst" element={<HubSpotInboxFutureView onRefresh={shell.refresh} />} />
          <Route path="/administratie-maestro"          element={<HubSpotInboxMaestroView onRefresh={shell.refresh} />} />
          <Route path="/administratie-maestro/toekomst" element={<HubSpotInboxFutureMaestroView onRefresh={shell.refresh} />} />
          <Route path="/postvak"                element={<AutoDraftView subPage="postvak"  onNavigate={handleSelect} />} />
          <Route path="/postvak-maestro"        element={<AutoDraftMaestroView onNavigate={handleSelect} />} />
          <Route path="/postvak/instellingen"   element={<AutoDraftView subPage="settings" onNavigate={handleSelect} />} />
          <Route path="/agenda"                 element={<AgendaView onNavigate={handleSelect} />} />
          <Route path="/agenda/spelregels"      element={<AgendaRulesView onNavigate={handleSelect} />} />
          <Route path="/zoeken"                 element={<RagSearchView />} />
          <Route path="/intelligence"           element={<IntelligenceHubView />} />
          <Route path="/intelligence/quality"   element={<IntelligenceQualityView />} />
          <Route path="/jellemind"              element={<MindView />} />
          <Route path="/legal-ai"               element={<LegalAIView />} />
          <Route path="/daily-tasks"            element={<Navigate to="/taken" replace />} />
          <Route path="/road-notes"             element={<SalesOnRoadView />} />
          <Route path="/linkedin"               element={<LinkedInView />} />
          <Route path="/kilometers"             element={<KilometersView />} />
          <Route path="/taken"                  element={<TasksView />} />
          <Route path="/contacten"              element={<ContactenView />} />
          <Route path="/chat"                   element={<ChatView />} />
          <Route path="/health"                 element={<HealthView />} />
          <Route path="/security"               element={<SecurityView />} />
          <Route path="/instellingen/*"         element={<SettingsView />} />
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
