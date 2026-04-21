import LiveNow       from '../sections/LiveNow'
import Agents         from '../sections/Agents'
import WeekTimeline   from '../sections/WeekTimeline'
import KpiStrip       from '../sections/KpiStrip'

export default function NowView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <LiveNow
        runningSchedules={data.runningSchedules}
        orchestratorAgeMin={data.orchestratorAgeMin}
        orchestratorRun={data.orchestratorRun}
        orchestratorSchedule={data.orchestratorSchedule}
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
      <KpiStrip
        weekStats={data.weekStats}
        lastWeekStats={data.lastWeekStats}
      />
    </div>
  )
}
