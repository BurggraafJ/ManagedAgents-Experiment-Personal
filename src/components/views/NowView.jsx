import LiveNow             from '../sections/LiveNow'
import Agents               from '../sections/Agents'
import WeekTimeline         from '../sections/WeekTimeline'
import KpiStrip             from '../sections/KpiStrip'
import AdministratieWidget  from '../sections/AdministratieWidget'

export default function NowView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <LiveNow
        runningSchedules={data.runningSchedules}
        orchestratorAgeMin={data.orchestratorAgeMin}
        orchestratorRun={data.orchestratorRun}
        orchestratorSchedule={data.orchestratorSchedule}
      />
      <AdministratieWidget
        proposals={data.proposals}
        salesTodos={data.salesTodos}
        autodraftDecisions={data.autodraftDecisions}
      />
      <WeekTimeline
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
      {/* KpiStrip krijgt rangeRuns (180d) zodat de selector 7/30/90d kan
          aggregeren incl. previous-period vergelijking — geen extra DB-query. */}
      <KpiStrip runs={data.rangeRuns || []} />
    </div>
  )
}
