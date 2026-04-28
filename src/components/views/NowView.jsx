import Agents             from '../sections/Agents'
import WeekProgress       from '../sections/WeekProgress'
import KpiStrip           from '../sections/KpiStrip'
import TruthOfSourcesView from './TruthOfSourcesView'

// Dashboard (v71). Volgorde van boven naar beneden:
//   1. WeekProgress     — wat is er deze week gebeurd
//   2. Agents           — alle agent-kaarten met status / cadence / acties
//   3. KpiStrip         — proposals, drafts, todos, taken — getallen
//   4. Truth of Sources — Outlook / HubSpot / Jira (bronnen waarop alles draait)
//                         — staat op het dashboard zelf, geen aparte pagina meer.
//
// Snelacties is verwijderd (v70) — agents draaien op schedule via orchestrator.
// LiveNow is bewust ook weg — de groene heartbeat in de sidebar dekt dat.
// Functions/edge-function-overzicht en deploy-controls zitten in Settings → Infra.
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

      {/* Truth of Sources — onderaan het dashboard zodat je in één blik ziet
          dat de fundering (mail, CRM, jira) gezond is. Auto-refresh per 30s. */}
      <TruthOfSourcesView />
    </div>
  )
}
