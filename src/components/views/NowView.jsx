import Agents           from '../sections/Agents'
import WeekTimeline     from '../sections/WeekTimeline'
import KpiStrip         from '../sections/KpiStrip'
import QuickActions     from '../sections/QuickActions'

// LiveNow ('orchestrator draait nu / volgende run') is bewust verwijderd —
// de groene heartbeat-dot in de sidebar-footer toont al of de orchestrator
// gezond is. Geen dubbele info bovenin het Dashboard.
export default function NowView({ data, onNavigate }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
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

      {/* Onderin: KPI's links + Snelacties rechts (op desktop).
          Op smal scherm stacken ze. */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--s-5)',
          alignItems: 'start',
        }}
      >
        <KpiStrip runs={data.rangeRuns || []} schedules={data.schedules} />
        <QuickActions onNavigate={onNavigate} />
      </div>
    </div>
  )
}
