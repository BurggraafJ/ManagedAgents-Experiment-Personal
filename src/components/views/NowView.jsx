import Agents, { AgentsHelpersFunctions } from '../sections/Agents'
import WeekProgress       from '../sections/WeekProgress'
import TruthOfSourcesView from './TruthOfSourcesView'

// Dashboard. Volgorde van boven naar beneden:
//   1. WeekProgress — Doel vs werkelijk (3 oude dagen + vandaag-timeline)
//   2. Agents       — alle agent-kaarten (Voorstel C: activity feed)
//   3. Database     — Outlook / HubSpot / Jira / Fireflies / JelleMind / Agenda
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

      <Agents
        schedules={data.schedules}
        latestRuns={data.latestRuns}
        history={data.history}
        questions={data.questions}
        salesEvents={data.salesEvents}
        salesTodos={data.salesTodos}
      />

      <TruthOfSourcesView />

      <AgentsHelpersFunctions
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
