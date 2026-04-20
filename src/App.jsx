import { useState, useMemo } from 'react'
import { useDashboard } from './hooks/useDashboard'
import { useTheme } from './hooks/useTheme'

import Sidebar          from './components/Sidebar'
import MobileBar        from './components/MobileBar'
import NowView          from './components/views/NowView'
import HubSpotView      from './components/views/HubSpotView'
import SalesOnRoadView  from './components/views/SalesOnRoadView'
import SystemView       from './components/views/SystemView'

const VIEWS = [
  { id: 'nu',      label: 'Nu',            title: 'Nu',             subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het deze week.' },
  { id: 'hubspot', label: 'HubSpot',       title: 'HubSpot',        subtitle: 'Daily-sync status, open vragen over deals, week-metrics.' },
  { id: 'sales',   label: 'Sales On Road', title: 'Sales On Road',  subtitle: 'Gesprekken via Slack, HubSpot-updates en Outlook-concepten die de agent heeft klaargezet.' },
  { id: 'systeem', label: 'Systeem',       title: 'Systeem',        subtitle: 'Schedules, integraties, metadata.' },
]

export default function App() {
  const [view, setView] = useState('nu')
  const { data, loading, error, online, lastRefresh, refresh } = useDashboard()
  const { theme, toggle: toggleTheme } = useTheme()

  const nav = useMemo(() => {
    if (!data) return VIEWS.map(v => ({ ...v, count: 0 }))

    const hubspotQ = data.questions.filter(q => q.status === 'open' && q.agent_name === 'hubspot-daily-sync').length
    const hubspotUrgent = data.questions.filter(q =>
      q.status === 'open' &&
      q.agent_name === 'hubspot-daily-sync' &&
      (q.urgency === 'expired' || q.urgency === 'urgent')
    ).length

    const salesNeedsReview = (data.salesEvents || []).filter(e => e.status === 'needs_review').length

    return VIEWS.map(v => {
      if (v.id === 'hubspot') return { ...v, count: hubspotQ, urgent: hubspotUrgent > 0 }
      if (v.id === 'sales')   return { ...v, count: salesNeedsReview, urgent: false }
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
        activeView={view}
        onSelect={setView}
        lastRefresh={lastRefresh}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <MobileBar
        views={nav}
        activeView={view}
        onSelect={setView}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
        theme={theme}
        onToggleTheme={toggleTheme}
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

        {view === 'nu'      && <NowView data={data} />}
        {view === 'hubspot' && <HubSpotView data={data} />}
        {view === 'sales'   && <SalesOnRoadView data={data} />}
        {view === 'systeem' && <SystemView data={data} />}

        <footer className="foot">
          Legal Mind B.V. · legal-mind.nl · KVK 93846523 · Agent Command Center v6
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
