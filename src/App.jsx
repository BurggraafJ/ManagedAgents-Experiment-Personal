import { useCallback, useMemo } from 'react'
import { useDashboard } from './hooks/useDashboard'
import { useActiveSection } from './hooks/useActiveSection'

import Sidebar       from './components/Sidebar'
import MobileBar     from './components/MobileBar'
import ActionRail    from './components/sections/ActionRail'
import LiveNow       from './components/sections/LiveNow'
import TodayTimeline from './components/sections/TodayTimeline'
import KpiStrip      from './components/sections/KpiStrip'
import Agents        from './components/sections/Agents'
import Inbox         from './components/sections/Inbox'
import Schedules     from './components/sections/Schedules'
import LinkedInProgress from './components/sections/LinkedInProgress'
import Config        from './components/sections/Config'

const SECTION_IDS = ['actie', 'nu', 'vandaag', 'week', 'agents', 'inbox', 'schedules', 'linkedin', 'config']

export default function App() {
  const { data, loading, error, online, lastRefresh, refresh } = useDashboard()
  const active = useActiveSection(SECTION_IDS)

  const jump = useCallback((id) => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const links = useMemo(() => {
    if (!data) return baseLinks(0, 0, 0, false)
    const openQ = data.questions.filter(q => q.status === 'open')
    const urgentQ = openQ.filter(q => q.urgency === 'expired' || q.urgency === 'urgent').length
    const openF = data.feedback.filter(f => !f.status || f.status === 'open').length
    const actionCount = openQ.length + openF + data.overdueSchedules.length
    const hasLinkedIn = (data.linkedin || []).length > 0
    return baseLinks(actionCount, openQ.length + openF, urgentQ, hasLinkedIn)
  }, [data])

  if (loading) return <LoadingShell />
  if (error && !data) return <ErrorShell error={error} onRetry={refresh} />

  return (
    <div className="shell">
      <Sidebar
        links={links}
        active={active}
        onJump={jump}
        lastRefresh={lastRefresh}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
      />
      <MobileBar
        links={links}
        active={active}
        onJump={jump}
        onRefresh={refresh}
        orchestratorAgeMin={data.orchestratorAgeMin}
      />

      <main className="main">
        {!online && (
          <div className="banner">
            Verbinding met Supabase verloren — laatste data van {lastRefresh?.toLocaleTimeString('nl-NL')}
          </div>
        )}

        <ActionRail
          questions={data.questions}
          feedback={data.feedback}
          overdueSchedules={data.overdueSchedules}
          onJump={jump}
        />

        <LiveNow
          runningSchedules={data.runningSchedules}
          nextRun={data.nextRun}
          orchestratorAgeMin={data.orchestratorAgeMin}
          orchestratorRun={data.orchestratorRun}
        />

        <TodayTimeline
          runs={data.todayRuns}
          schedules={data.schedules}
        />

        <KpiStrip
          weekStats={data.weekStats}
          lastWeekStats={data.lastWeekStats}
        />

        <Agents
          schedules={data.schedules}
          latestRuns={data.latestRuns}
          history={data.history}
          questions={data.questions}
        />

        <Inbox
          questions={data.questions}
          feedback={data.feedback}
        />

        <Schedules schedules={data.schedules} />

        <LinkedInProgress rows={data.linkedin} />

        <Config />

        <footer className="foot">
          Legal Mind B.V. · legal-mind.nl · KVK 93846523 · Agent Command Center v4
        </footer>
      </main>
    </div>
  )
}

function baseLinks(actionCount, inboxCount, urgent, hasLinkedIn) {
  const links = [
    { id: 'actie',     label: 'Actie',      count: actionCount, urgent: urgent > 0 },
    { id: 'nu',        label: 'Live nu',    count: 0 },
    { id: 'vandaag',   label: 'Vandaag',    count: 0 },
    { id: 'week',      label: 'Week',       count: 0 },
    { id: 'agents',    label: 'Agents',     count: 0 },
    { id: 'inbox',     label: 'Inbox',      count: inboxCount, urgent: urgent > 0 },
    { id: 'schedules', label: 'Schedules',  count: 0 },
  ]
  if (hasLinkedIn) links.push({ id: 'linkedin', label: 'LinkedIn', count: 0 })
  links.push({ id: 'config', label: 'Systeem', count: 0 })
  return links
}

function LoadingShell() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar__logo">legal<span className="sidebar__logo-accent">mind</span></div>
        <div className="sidebar__tagline">Agent Command Center</div>
        <div className="sidebar__nav">
          {[...Array(7)].map((_, i) => <div key={i} className="skeleton" style={{ height: 28 }} />)}
        </div>
      </aside>
      <main className="main">
        <div className="skeleton" style={{ height: 40 }} />
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
