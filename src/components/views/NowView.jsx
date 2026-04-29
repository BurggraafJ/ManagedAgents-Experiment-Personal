import Agents             from '../sections/Agents'
import WeekProgress       from '../sections/WeekProgress'
import TruthOfSourcesView from './TruthOfSourcesView'

// Dashboard. Volgorde van boven naar beneden:
//   1. WeekProgress     — Prognose vs werkelijk (deze week)
//   2. Truth of Sources — Outlook / HubSpot / Jira (compact, klikbaar)
//   3. Agents           — alle agent-kaarten met status / cadence / acties
//
// KpiStrip ("Afgelopen 7 dagen") is verwijderd — getallen waren ruis,
// echte status zit in WeekProgress + de agent-kaarten zelf.
export default function NowView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <WeekProgress
        runs={data.weekRuns}
        schedules={data.schedules}
        weekStart={data.weekStart}
      />

      <TruthOfSourcesView />

      <Agents
        schedules={data.schedules}
        latestRuns={data.latestRuns}
        history={data.history}
        questions={data.questions}
        salesEvents={data.salesEvents}
        salesTodos={data.salesTodos}
      />
    </div>
  )
}
