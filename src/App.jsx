import { useState, useMemo } from 'react'
import { useDashboard } from './hooks/useDashboard'
import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useNotifications } from './hooks/useNotifications'

import PinGate            from './components/PinGate'
import Sidebar            from './components/Sidebar'
import MobileBar          from './components/MobileBar'
import NotificationDrawer from './components/NotificationDrawer'
import NowView            from './components/views/NowView'
import HubSpotInboxCompactView from './components/views/HubSpotInboxCompactView'
import SalesOnRoadView    from './components/views/SalesOnRoadView'
import SalesTodosView     from './components/views/SalesTodosView'
import AutoDraftView      from './components/views/AutoDraftView'
import ChatView           from './components/views/ChatView'
import InstellingenView   from './components/views/InstellingenView'
import SystemView         from './components/views/SystemView'

const VIEWS = [
  { id: 'nu',        label: 'Dashboard',       title: 'Dashboard',        subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het deze week.' },
  { id: 'chat',      label: 'Chat',            title: 'Chat',             subtitle: 'Praat met je agents \u2014 stel vragen, geef opdrachten of verbetervoorstellen. Agents pakken berichten op bij hun volgende run.' },
  { id: 'autodraft', label: 'Auto-Draft',      title: 'Auto-Draft',       subtitle: 'Hoe consistent draait de concept-mail-agent \u2014 runs per periode, Chrome-beschikbaarheid en per-mail beslissingen.' },
  { id: 'hubspot', label: 'Daily Admin', title: 'Daily Admin', subtitle: 'CRM-updates (HubSpot), partner-notities (Jira Partnerships) en recruitment-notes \u2014 alle acties als voorstel dat jij accepteert, aanpast of afwijst. KPI-kaarten bovenaan, inbox-split in het midden, Logboek + Andere contactmomenten onderaan.' },
  { id: 'sales',     label: 'Road Notes',      title: 'Road Notes',       subtitle: 'Kennismakingen via Slack verwerkt: HubSpot-updates, notities per deal en Outlook-concepten in de Sales Agent-map.' },
  { id: 'salestodo', label: 'Daily Tasks',     title: 'Daily Tasks',      subtitle: 'Deals die actie vragen \u2014 offerte-reminders, trial-einde, check-ins \u2014 met concept-mails klaar in Outlook-map Sales Agent. Draait elke werkochtend 08:00.' },
  { id: 'instellingen', label: 'Instellingen',  title: 'Instellingen',     subtitle: 'Hoe schrijven agents? Notitie-templates per context (Sales / Customer Base / Partner / Recruitment) en terminologie-correcties voor spraak-input. Wijzigingen zijn live voor de volgende run.' },
  { id: 'systeem',   label: 'Systeem',         title: 'Systeem',          subtitle: 'Schedules, integraties, metadata.' },
]

// Sidebar-groepering: Dashboard los bovenin, dan twee collapsible groepen
// (Agents \u2192 auto-draft, HubSpot \u2192 3 HubSpot-gerelateerde pagina's), en Systeem onderin.
const NAV_GROUPS = [
  { kind: 'item',  id: 'nu' },
  { kind: 'item',  id: 'chat' },
  { kind: 'group', id: 'agents',  label: 'Agents',  children: ['autodraft'] },
  { kind: 'group', id: 'hubspot', label: 'HubSpot', children: ['hubspot', 'sales', 'salestodo'] },
  { kind: 'spacer' },
  { kind: 'item',  id: 'instellingen' },
  { kind: 'item',  id: 'systeem' },
]

export default function App() {
  const sbAuth = useSupabaseAuth()

  // Checking-state blokkeert tot Supabase minstens één keer gecheckt heeft.
  if (sbAuth.status === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  // Geen sessie? Login-paneel. Een URL-hash met `type=recovery` wordt door
  // PinGate intern gedetecteerd en toont dan de "kies nieuw wachtwoord"-UI,
  // ook als er nog geen sessie is.
  if (sbAuth.status !== 'signed-in') {
    return <PinGate />
  }

  // Auth-shape voor Dashboard component (sidebar + MobileBar verwachten
  // `profile` + `logout`).
  const authIface = {
    profile: {
      display_name: sbAuth.user?.user_metadata?.full_name ||
                    sbAuth.user?.email?.split('@')[0] ||
                    'Gebruiker',
      name: sbAuth.user?.email || 'gebruiker',
    },
    logout: sbAuth.signOut,
  }

  return <Dashboard auth={authIface} />
}

function Dashboard({ auth }) {
  const [view, setView] = useState('nu')
  const [notifOpen, setNotifOpen] = useState(false)

  const { data, loading, error, online, lastRefresh, refresh } = useDashboard()
  const { theme, toggle: toggleTheme } = useTheme()
  const notif = useNotifications()

  const nav = useMemo(() => {
    if (!data) return VIEWS.map(v => ({ ...v, count: 0 }))

    // HubSpot: "te doen" = nog wacht op Jelle (open/pending), ongeacht of expires_at verstreken is.
    // Verlopen/auto-afgehandeld telt NIET in de badge.
    const hubspotOpen = data.questions.filter(q =>
      q.agent_name === 'hubspot-daily-sync' && (q.status === 'open' || q.status === 'pending')
    )
    const hubspotQ = hubspotOpen.length
    const hubspotUrgent = hubspotOpen.some(q => q.urgency === 'expired' || q.urgency === 'urgent')

    const salesNeedsReview = (data.salesEvents || []).filter(e => e.status === 'needs_review').length
    const todosReady = (data.salesTodos || []).filter(t => t.status === 'draft_ready').length
    const chatPending = (data.chat || []).filter(m => m.status === 'pending' && m.author === 'user').length

    return VIEWS.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: hubspotQ, urgent: hubspotUrgent }
      }
      if (v.id === 'sales')     return { ...v, count: salesNeedsReview, urgent: false }
      if (v.id === 'salestodo') return { ...v, count: todosReady, urgent: false }
      if (v.id === 'chat')      return { ...v, count: chatPending, urgent: false }
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
        onSelect={setView}
        lastRefresh={lastRefresh}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
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
        onSelect={setView}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
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

      <main className="main">
        {!online && (
          <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
            Verbinding met Supabase verloren — laatste data van {lastRefresh?.toLocaleTimeString('nl-NL')}
          </div>
        )}

        <header className="view__header">
          <h1 className="view__title">{currentView.title}</h1>
          <p className="view__subtitle">{currentView.subtitle}</p>
        </header>

        {view === 'nu'           && <NowView data={data} />}
        {view === 'chat'         && <ChatView data={data} />}
        {view === 'autodraft'    && <AutoDraftView data={data} />}
        {view === 'hubspot'   && <HubSpotInboxCompactView data={data} onRefresh={refresh} />}
        {view === 'sales'     && <SalesOnRoadView data={data} />}
        {view === 'salestodo'    && <SalesTodosView data={data} />}
        {view === 'instellingen' && <InstellingenView data={data} />}
        {view === 'systeem'      && <SystemView data={data} />}

        <footer className="foot">
          Legal Mind B.V. · legal-mind.nl · KVK 93846523 · Agent Command Center v9
        </footer>
      </main>
    </div>
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
