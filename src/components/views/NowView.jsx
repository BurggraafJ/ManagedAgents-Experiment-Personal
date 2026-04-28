import Agents       from '../sections/Agents'
import WeekProgress from '../sections/WeekProgress'
import KpiStrip     from '../sections/KpiStrip'

// Snelacties is verwijderd (v70) — agents draaien op schedule via orchestrator
// en vercel-deploys gaan nu via Functions-pagina i.p.v. ad-hoc knoppen.
// LiveNow ('orchestrator draait nu / volgende run') is bewust ook weg —
// de groene heartbeat-dot in de sidebar-footer toont dat al.
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

      <KpiStrip
        runs={data.rangeRuns || []}
        schedules={data.schedules}
        proposals={data.proposals}
        autodraftDecisions={data.autodraftDecisions}
        salesTodos={data.salesTodos}
        tasks={data.tasks}
      />
    </div>
  )
}
