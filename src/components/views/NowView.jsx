import LiveNow       from '../sections/LiveNow'
import Agents         from '../sections/Agents'
import TodayTimeline  from '../sections/TodayTimeline'
import KpiStrip       from '../sections/KpiStrip'

export default function NowView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <LiveNow
        runningSchedules={data.runningSchedules}
        nextRun={data.nextRun}
        orchestratorAgeMin={data.orchestratorAgeMin}
        orchestratorRun={data.orchestratorRun}
        orchestratorSchedule={data.orchestratorSchedule}
      />
      <Agents
        schedules={data.schedules}
        latestRuns={data.latestRuns}
        history={data.history}
        questions={data.questions}
        salesEvents={data.salesEvents}
        salesTodos={data.salesTodos}
      />
      <TodayTimeline
        runs={data.todayRuns}
        schedules={data.schedules}
      />
      <KpiStrip
        weekStats={data.weekStats}
        lastWeekStats={data.lastWeekStats}
      />
    </div>
  )
}
