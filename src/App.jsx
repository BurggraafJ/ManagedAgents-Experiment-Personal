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
import LinkedInView       from './components/views/LinkedInView'
import ChatView           from './components/views/ChatView'
import TasksView          from './components/views/TasksView'
import ImprovementsView   from './components/views/ImprovementsView'
import KilometersView     from './components/views/KilometersView'
import RagSearchView      from './components/views/RagSearchView'
import SettingsView       from './components/views/SettingsView'
import JelleMindView      from './components/views/JelleMindView'

const VIEWS = [
  { id: 'nu',        label: 'Dashboard',       title: 'Dashboard',        subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het de afgelopen periode.' },
  { id: 'jellemind', label: 'JelleMind',       title: 'JelleMind',        subtitle: 'Een notitieboekje dat zichzelf schrijft — agent leert van je correcties bij andere agents en stelt voorzichtige voorkeur-regels voor. Accepteer, wijs af of pas aan.' },
  // Hoofd-agents \u2014 volgorde op gebruik (Administratie = 2, Mailing = 3, etc.)
  { id: 'hubspot',   label: 'Administratie',   title: 'Administratie',    subtitle: 'CRM-updates (HubSpot), partner-notities (Jira Partnerships) en recruitment-notes \u2014 alle acties als voorstel dat jij accepteert, aanpast of afwijst.' },
  // Mailing \u2014 Postvak (full-width Outlook-stijl) + 1 sub-pagina "Instellingen"
  // die de overige onderdelen als intra-tabs bundelt: Voorstellen, Categorie\u00ebn,
  // Logboek, Regels. Sidebar blijft daarmee rustig \u2014 alleen 2 mailing-items.
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: 'Je volledige postvak met een skill-voorstel per mail. Reageer, negeer of stuur aanpassing \u2014 al beantwoorde of verplaatste mails worden automatisch verborgen.', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing \u00b7 Instellingen', subtitle: 'Voorstellen, categorie\u00ebn, logboek en geleerde regels \u2014 alle skill-configuratie van auto-draft op \u00e9\u00e9n plek met tabs.' },
  { id: 'salestodo', label: 'Daily Tasks',     title: 'Daily Tasks',      subtitle: 'Deals die actie vragen \u2014 offerte-reminders, trial-einde, check-ins \u2014 met concept-mails klaar in Outlook-map Sales Agent. Draait elke werkochtend 08:00.' },
  { id: 'sales',     label: 'Road Notes',      title: 'Road Notes',       subtitle: 'Drop een korte aantekening na een kennismakingsgesprek; agent verwerkt naar HubSpot-updates, notitie per deal en Outlook-concept in de Sales Agent-map.' },
  { id: 'linkedin',  label: 'LinkedIn',        title: 'LinkedIn Agent',   subtitle: 'Dagelijks 15 connect-verzoeken via Composio Browser Tool. Targets uit mailbox, HubSpot-pipeline, proefperiode-kantoren en concurrenten. Strategie stuur je hieronder.' },
  { id: 'kilometers', label: 'Kilometers',     title: 'Kilometerregistratie', subtitle: 'Maandelijkse km-registratie voor Burggraaf Group. Draait automatisch op de 2e van elke maand. Voeg ritten direct toe via het invoerblok hieronder.' },
  // Tools \u2014 minder vaak gebruikt, gegroepeerd
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: 'E\u00e9n inbox voor alles wat je niet wil vergeten \u2014 handmatig, uit Fireflies, mail of voice. AI clustert in projecten en zet deadlines bij. Vang \'m bovenaan en herindeel met \u2728.' },
  { id: 'zoeken',        label: 'Zoeken',        title: 'Zoeken',        subtitle: 'Vector-zoekmachine over al je bronnen \u2014 mail, HubSpot (engagements/deals/companies/contacts) en Jira. Stel een vraag in natuurlijke taal en krijg de meest relevante records terug.' },
  { id: 'chat',          label: 'Chat',          title: 'Chat',          subtitle: 'Praat met je agents \u2014 stel vragen, geef opdrachten of verbetervoorstellen. Agents pakken berichten op bij hun volgende run.' },
  { id: 'improvements',  label: 'Improvements',  title: 'Improvements',  subtitle: 'Verbetervoorstellen-overzicht. Hier komen straks alle voorstellen die je agents zelf doen \u2014 met status, accept/reject en geschiedenis. Coming soon.' },
  // Truth of Sources is op het Dashboard zelf ingebed (onderaan NowView).
  // Functions/edge-function-overzicht zit als sub-tab in Settings (geen aparte sidebar-pagina).
  // Settings is geen sidebar-item meer — bereikbaar via gear-icoon rechtsboven.
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: 'Schedules, integraties en systeem-configuratie. Per agent kun je cadence + aan/uit ook bewerken via het ⋯-menu op zijn kaart op het Dashboard.' },
]

// Sidebar-volgorde (v71) — strakke groepering zonder spacer:
//   1. Dashboard (los) — bevat ook live Truth-of-Sources health-strip
//   2. Administratie + Mailing — top hoofdwerk
//   3. "Op pad" (groep) — sales, outreach en buitendienst-administratie:
//        Daily Tasks, Road Notes, LinkedIn, Kilometers
//   4. "Tools" (groep) — minder gebruikte algemeen-toolset:
//        Taken, Chat, Improvements (coming soon)
//
// Infra (Bronnen-detail + Functions/edge-function-health) zit:
//   - compacte versie ingebed in het Dashboard zelf
//   - volledige versie als 'Infra'-tab in Settings (achter gear-icoon)
const NAV_GROUPS = [
  { kind: 'item',  id: 'nu' },
  { kind: 'item',  id: 'hubspot' },
  { kind: 'item',  id: 'autodraft' },
  // autodraft_settings staat NIET in de sidebar — bereikbaar via gear-knop in Postvak-toolbar.
  { kind: 'item',  id: 'jellemind' },
  { kind: 'group', id: 'op-pad', label: 'Op pad', children: ['salestodo', 'sales', 'linkedin', 'kilometers'] },
  { kind: 'group', id: 'tools',  label: 'Tools',  children: ['taken', 'zoeken', 'chat', 'improvements'] },
]

export default function App() {
  const sbAuth = useSupabaseAuth()

  // Checking-state blokkeert tot Supabase minstens één keer gecheckt heeft.
  if (sbAuth.status === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  // Wachtwoord-recovery heeft voorrang: Supabase ruilt de recovery-token in
  // voor een sessie en stuurt event 'PASSWORD_RECOVERY'. In die staat moet
  // de user een nieuw wachtwoord kiezen voordat hij naar dashboard gaat.
  if (sbAuth.isRecovery) {
    return <PinGate />
  }

  // Geen sessie? Login-paneel.
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

    // Administratie (daily-admin): proposal-first model — tellen wat
    // er klaar staat voor Jelle's review (status pending of amended).
    // 'accepted' = al goedgekeurd, wacht op uitvoering, niet "te doen".
    const adminPending = (data.proposals || []).filter(p =>
      p.agent_name === 'daily-admin'
      && (p.status === 'pending' || p.status === 'amended')
    ).length

    const salesNeedsReview = (data.salesEvents || []).filter(e => e.status === 'needs_review').length
    const todosReady = (data.salesTodos || []).filter(t => t.status === 'draft_ready').length
    const chatPending = (data.chat || []).filter(m => m.status === 'pending' && m.author === 'user').length

    // Mailing en LinkedIn krijgen GEEN counter — die zouden altijd hoog
    // staan (mails komen continu binnen, linkedin-targets is een grote
    // queue) en zijn dus niet betekenisvol als "te doen"-getal. Zonder
    // counter is de sidebar rustiger.

    // Taken-badge: vandaag-bucket (overdue + due today + do_date today). Urgent als er overdue tussen zit.
    const tasksList = data.tasks || []
    const todayIso = new Date().toISOString().slice(0, 10)
    let takenCount = 0
    let takenUrgent = false
    for (const t of tasksList) {
      if (t.status === 'done' || t.status === 'dropped') continue
      const overdue = t.deadline && t.deadline < todayIso
      const due = t.deadline === todayIso || t.do_date === todayIso
      if (overdue || due) takenCount++
      if (overdue) takenUrgent = true
    }

    // Mailing-Voorstellen telt: categorie-voorstellen + lesson-voorstellen die wachten.
    // Alle andere mailing-subviews krijgen geen counter (Postvak fluctueert teveel,
    // logboek/regels/categorieën zijn referentie-pagina's).
    const mailingProposals = (data.autodraftCategoryProposals || []).length
                           + (data.autodraftLessonProposals   || []).length

    return VIEWS.map(v => {
      if (v.id === 'hubspot' || v.id.startsWith('hubspot_')) {
        return { ...v, count: adminPending, urgent: false }
      }
      if (v.id === 'sales')                 return { ...v, count: salesNeedsReview, urgent: false }
      if (v.id === 'salestodo')             return { ...v, count: todosReady, urgent: false }
      if (v.id === 'chat')                  return { ...v, count: chatPending, urgent: false }
      if (v.id === 'taken')                 return { ...v, count: takenCount, urgent: takenUrgent }
      if (v.id === 'autodraft_settings') return { ...v, count: mailingProposals, urgent: false }
      // Postvak, LinkedIn, Kilometers, Improvements, Settings: geen counter
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

      <main className={`main ${currentView.fullWidth ? 'main--full' : ''}`}>
        {!online && (
          <div className="banner" style={{ marginBottom: 'var(--s-5)' }}>
            Verbinding met Supabase verloren — laatste data van {lastRefresh?.toLocaleTimeString('nl-NL')}
          </div>
        )}

        {/* View-header onderdrukken voor fullWidth views — Mailing-postvak
            begint dan echt vanaf de top, zoals Outlook. */}
        {!currentView.fullWidth && (
          <header className="view__header view__header--with-actions">
            <div className="view__header-text">
              <h1 className="view__title">{currentView.title}</h1>
              <p className="view__subtitle">{currentView.subtitle}</p>
            </div>
            {/* ⚙-button alleen op Dashboard — daar is het overkoepelende
                vertrekpunt. Op andere pagina's heb je 'm zelden nodig en
                hij leidt af. Vanuit Settings zelf is er een terug-knop. */}
            {(view === 'nu' || view === 'settings') && (
              <div className="view__header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                <OrchestratorPill ageMin={data.orchestratorAgeMin} />
                <button
                  type="button"
                  className={`btn btn--ghost view__settings-btn ${view === 'settings' ? 'is-active' : ''}`}
                  onClick={() => setView(view === 'settings' ? 'nu' : 'settings')}
                  title={view === 'settings' ? 'Terug naar Dashboard' : 'Instellingen — schedules, integraties, configuratie'}
                  aria-label="Instellingen"
                  aria-pressed={view === 'settings'}
                >
                  <span aria-hidden style={{ marginRight: 6 }}>{view === 'settings' ? '←' : '⚙'}</span>
                  {view === 'settings' ? 'Terug' : 'Instellingen'}
                </button>
              </div>
            )}
          </header>
        )}

        {view === 'nu'           && <NowView data={data} onNavigate={setView} />}
        {view === 'jellemind'    && <JelleMindView data={data} />}
        {view === 'chat'         && <ChatView data={data} />}
        {view === 'taken'        && <TasksView data={data} />}
        {view === 'zoeken'       && <RagSearchView />}
        {view === 'autodraft'          && <AutoDraftView data={data} subPage="postvak"  onNavigate={setView} />}
        {view === 'autodraft_settings' && <AutoDraftView data={data} subPage="settings" onNavigate={setView} />}
        {view === 'linkedin'     && <LinkedInView data={data} />}
        {view === 'hubspot'   && <HubSpotInboxCompactView data={data} onRefresh={refresh} />}
        {view === 'sales'     && <SalesOnRoadView data={data} />}
        {view === 'salestodo'    && <SalesTodosView data={data} />}
        {view === 'kilometers'   && <KilometersView data={data} />}
        {view === 'improvements' && <ImprovementsView data={data} />}
        {view === 'settings'     && <SettingsView data={data} />}
      </main>
    </div>
  )
}

// Compact bolletje + label dat aangeeft of de orchestrator nog leeft.
// Groen ≤20m, geel ≤60m, rood daarna. Vervangt de heartbeat in de
// sidebar-footer (die ruimt op naar minder noise).
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
