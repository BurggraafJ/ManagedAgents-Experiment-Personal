import { useState, useMemo } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useDashboard } from './hooks/useDashboard'
import { useDashboardShell } from './hooks/useDashboardShell'
import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useNotifications } from './hooks/useNotifications'
import { ModalProvider, ModalRoot } from './components/ui/ModalProvider'

import PinGate            from './components/PinGate'
import Sidebar            from './components/Sidebar'
import MobileBar          from './components/MobileBar'
import NotificationDrawer from './components/NotificationDrawer'
import ToastHost          from './components/Toast'
import NowView            from './components/views/NowView'
import HubSpotInboxCompactView from './components/views/HubSpotInboxCompactView'
import HubSpotInboxFutureView  from './components/views/HubSpotInboxFutureView'
import AdminPeriodToggle       from './components/views/AdminPeriodToggle'
import SalesOnRoadView    from './components/views/SalesOnRoadView'
import AutoDraftView      from './components/views/AutoDraftView'
import LinkedInView       from './components/views/LinkedInView'
import ChatView           from './components/views/ChatView'
import TasksView          from './components/views/TasksView'
import KilometersView     from './components/views/KilometersView'
import RagSearchView      from './components/views/RagSearchView'
import IntelligenceHubView from './components/views/IntelligenceHubView'
import IntelligenceQualityView from './components/views/IntelligenceQualityView'
import SettingsView       from './components/views/SettingsView'
import MindView           from './components/views/JelleMindView'
import LegalAIView        from './components/views/LegalAIView'
import AgendaView         from './components/views/AgendaView'
import AgendaRulesView    from './components/views/AgendaRulesView'
import HealthView         from './components/views/health/HealthView'
import ContactenView      from './components/views/ContactenView'
import SecurityView       from './components/views/SecurityView'

const VIEWS = [
  { id: 'nu',        label: 'Dashboard',       title: 'Dashboard',        subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het de afgelopen periode.' },
  { id: 'jellemind', label: 'JelleMind',       title: 'JelleMind',        subtitle: 'Drie laden voor wat agents geleerd hebben — Jelle (persoonlijke voorkeur), Legal Mind (organisatie-waarheid), Skills (procesinstructies). Alles op één blad om snel te beheren.', wide: true },
  { id: 'legalai',   label: 'Legal AI',        title: 'Legal AI Thought Leadership', subtitle: 'Dagelijks dossier over de Legal AI-markt — twee tracks (advocatuur + bedrijfsleven). Onderzoek + dagartikel + LinkedIn-drafts. Voice-feedback evolueert je visie zonder tunnel-visie.' },
  { id: 'hubspot',   label: 'Administratie',   title: 'Administratie · Admin',    subtitle: 'CRM-updates (HubSpot), partner-notities (Jira Partnerships) en recruitment-notes — alle voorstellen van Daily Admin én Daily Admin Future. Verdeeld in Nieuw / Goedkeuren / Meer informatie nodig.', wide: true },
  { id: 'hubspot_future', label: 'Toekomst',  title: 'Administratie · Toekomst', subtitle: 'Tabel-overzicht van aankomende externe afspraken (28d vooruit). Voorstellen voor nieuwe records komen vanzelf in de Admin-tab onder "Nieuw".', wide: true },
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: 'Je volledige postvak met een skill-voorstel per mail. Reageer, negeer of stuur aanpassing — al beantwoorde of verplaatste mails worden automatisch verborgen.', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing · Instellingen', subtitle: 'Voorstellen, categorieën, logboek en geleerde regels — alle skill-configuratie van auto-draft op één plek met tabs.' },
  { id: 'agenda',             label: 'Agenda',      title: 'Agenda',               subtitle: 'Outlook-agenda met week- en dag-view. Toggle \"Toon spelregels\" rendert reistijd-buffers, verkeer-windows en interne dagen als shadow-laag. Outlook blijft bron-van-waarheid.', fullWidth: true },
  { id: 'agenda_rules',       label: 'Spelregels',  title: 'Agenda · Spelregels',  subtitle: 'Beheer alle spelregels van je agenda — verkeer-windows, reistijd-buffers, interne dagen, locatieregels en meer. Wijzigingen werken direct door op de agenda-view.', fullWidth: true },
  { id: 'sales',     label: 'Road Notes',      title: 'Road Notes',       subtitle: 'Drop een korte aantekening na een kennismakingsgesprek; agent verwerkt naar HubSpot-updates, notitie per deal en Outlook-concept in de Sales Agent-map.' },
  { id: 'linkedin',  label: 'LinkedIn',        title: 'LinkedIn Agent',   subtitle: 'Dagelijks 15 connect-verzoeken via Composio Browser Tool. Targets uit mailbox, HubSpot-pipeline, proefperiode-kantoren en concurrenten. Strategie stuur je hieronder.' },
  { id: 'kilometers', label: 'Kilometers',     title: 'Kilometerregistratie', subtitle: 'Maandelijkse km-registratie voor Burggraaf Group. Draait automatisch op de 2e van elke maand. Voeg ritten direct toe via het invoerblok hieronder.' },
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: 'Alles wat actie vraagt op één pagina — Klant / Hoog / Midden / Laag, met backlog per bucket. Sales follow-ups, Jira en mogelijk-al-klaar verschijnen onderaan.' },
  { id: 'contacten',     label: 'Contactpersonen', title: 'Contactpersonen', subtitle: 'Source-of-truth van iedereen waarmee je ooit contact hebt gehad — gevuld vanuit HubSpot + Outlook. Filter op type/firm, override handmatig en zoek met autocomplete. Nightly delta-sync 03:30.' },
  { id: 'zoeken',        label: 'Zoeken',        title: 'Zoeken',        subtitle: 'Vector-zoekmachine over al je bronnen — mail, HubSpot (engagements/deals/companies/contacts) en Jira. Stel een vraag in natuurlijke taal en krijg de meest relevante records terug.' },
  { id: 'intelligence',  label: 'Intelligence',  title: 'Intelligence Hub', subtitle: 'Live pijplijn-status: sync → chunk → embed → index → retrieve → consume → quality. Beslissingen-log uit current_architecture.md, sync-health, chunks-counts en rag_outcomes-baseline.' },
  { id: 'intelligence_quality', label: 'Quality', title: 'Intelligence · Quality', subtitle: 'Diepere analyse op rag_outcomes — acceptance-rate per skill, per chunk-source, per retrieval-strategie. match_chunks vs match_chunks_for_entity vergelijking zodra ≥10 outcomes per strategie.' },
  { id: 'chat',          label: 'Chat',          title: 'Chat',          subtitle: '' },
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.' },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.' },
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: '', wide: true },
]

// Sidebar-volgorde — drie lagen:
//   1. Dashboard (los)
//   2. Operations — dagelijks operationeel werk
//   3. Hoofdagents — alle AI-agents
const NAV_GROUPS = [
  { kind: 'item',  id: 'nu' },
  { kind: 'group', id: 'operations',  label: 'Operations',  children: ['hubspot', 'autodraft', 'agenda', 'zoeken', 'intelligence'] },
  { kind: 'group', id: 'hoofdagents', label: 'Hoofdagents', children: ['jellemind', 'legalai', 'taken', 'sales', 'linkedin', 'kilometers', 'contacten'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  nu:                 '/',
  hubspot:            '/administratie',
  hubspot_future:     '/administratie/toekomst',
  autodraft:          '/postvak',
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
    return <PinGate />
  }

  if (sbAuth.status !== 'signed-in') {
    return <PinGate />
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
  // - useDashboard blijft als overgangshook tot alle views gemigreerd zijn naar
  //   per-feature hooks (Golf B-D). Niet-gemigreerde views krijgen `data` als prop.
  const shell = useDashboardShell()
  const { data, loading, error, online, lastRefresh, refresh } = useDashboard()
  const { theme, toggle: toggleTheme } = useTheme()
  const notif = useNotifications()

  const view = viewFromPathname(location.pathname)
  const handleSelect = (viewId) => navigate(pathFor(viewId))

  const nav = useMemo(() => {
    if (!data) return VIEWS.map(v => ({ ...v, count: 0 }))

    const adminPending = (data.proposals || []).filter(p =>
      p.agent_name === 'daily-admin'
      && (p.status === 'pending' || p.status === 'amended')
    ).length

    const salesNeedsReview = (data.salesEvents || []).filter(e => e.status === 'needs_review').length
    const chatPending = (data.chat || []).filter(m => m.status === 'pending' && m.author === 'user').length

    const tasksList = data.tasks || []
    const todayIso = new Date().toISOString().slice(0, 10)
    let takenCount = 0
    let takenUrgent = false
    for (const t of tasksList) {
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

    const mailingProposals = (data.autodraftCategoryProposals || []).length
                           + (data.autodraftLessonProposals   || []).length

    return VIEWS.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: adminPending, urgent: false }
      }
      if (v.id === 'sales')                 return { ...v, count: salesNeedsReview, urgent: false }
      if (v.id === 'chat')                  return { ...v, count: chatPending, urgent: false }
      if (v.id === 'taken')                 return { ...v, count: takenCount, urgent: takenUrgent }
      if (v.id === 'autodraft_settings') return { ...v, count: mailingProposals, urgent: false }
      if (v.id === 'security') {
        const openCritHigh = (data.securityFindings || []).length
        return { ...v, count: openCritHigh, urgent: (data.securityFindings || []).some(f => f.severity === 'critical') }
      }
      return { ...v, count: 0 }
    })
  }, [data])

  if (loading) return <LoadingShell />
  if (error && !data) return <ErrorShell error={error} onRetry={refresh} />

  const currentView = VIEWS.find(v => v.id === view) || VIEWS[0]

  return (
    <div className="shell">
      <Sidebar
        views={nav}
        groups={NAV_GROUPS}
        activeView={view}
        onSelect={handleSelect}
        lastRefresh={lastRefresh}
        onRefresh={refresh}
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
        onRefresh={refresh}
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
        runs={data.recentRuns || []}
      />

      <ToastHost />

      <main className={`main ${currentView.fullWidth ? 'main--full' : ''} ${currentView.wide ? 'main--wide' : ''}`}>
        {!online && (
          <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
            Verbinding met Supabase verloren — laatste data van {lastRefresh?.toLocaleTimeString('nl-NL')}
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
          <Route path="/"                       element={<NowView onNavigate={handleSelect} />} />
          <Route path="/administratie"          element={<HubSpotInboxCompactView data={data} onRefresh={refresh} />} />
          <Route path="/administratie/toekomst" element={<HubSpotInboxFutureView  data={data} onRefresh={refresh} />} />
          <Route path="/postvak"                element={<AutoDraftView subPage="postvak"  onNavigate={handleSelect} />} />
          <Route path="/postvak/instellingen"   element={<AutoDraftView subPage="settings" onNavigate={handleSelect} />} />
          <Route path="/agenda"                 element={<AgendaView data={data} onNavigate={handleSelect} />} />
          <Route path="/agenda/spelregels"      element={<AgendaRulesView onNavigate={handleSelect} />} />
          <Route path="/zoeken"                 element={<RagSearchView />} />
          <Route path="/intelligence"           element={<IntelligenceHubView />} />
          <Route path="/intelligence/quality"   element={<IntelligenceQualityView />} />
          <Route path="/jellemind"              element={<MindView />} />
          <Route path="/legal-ai"               element={<LegalAIView />} />
          <Route path="/daily-tasks"            element={<Navigate to="/taken" replace />} />
          <Route path="/road-notes"             element={<SalesOnRoadView data={data} />} />
          <Route path="/linkedin"               element={<LinkedInView data={data} />} />
          <Route path="/kilometers"             element={<KilometersView data={data} />} />
          <Route path="/taken"                  element={<TasksView data={data} />} />
          <Route path="/contacten"              element={<ContactenView />} />
          <Route path="/chat"                   element={<ChatView />} />
          <Route path="/health"                 element={<HealthView />} />
          <Route path="/security"               element={<SecurityView />} />
          <Route path="/instellingen/*"         element={<SettingsView data={data} />} />
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
