import Agents, { AgentsHelpersFunctions } from '../sections/Agents'
import WeekProgress       from '../sections/WeekProgress'
import TruthOfSourcesView from './TruthOfSourcesView'
import { useAgents } from '../../hooks/useAgents'
import { useSales } from '../../hooks/useSales'

// Dashboard. Volgorde van boven naar beneden:
//   1. WeekProgress — Doel vs werkelijk (3 oude dagen + vandaag-timeline)
//   2. Agents       — alle agent-kaarten (Voorstel C: activity feed)
//   3. Database     — Outlook / HubSpot / Jira / Fireflies / JelleMind / Agenda
//
// Migratie 2026-05-08: leest niet meer uit de `data`-prop maar uit eigen
// feature-hooks (useAgents + useSales). Onderdeel van Refactor 02.
export default function NowView() {
  const { weekRuns, schedules, weekStart, latestRuns, history, questions } = useAgents()
  const { events: salesEvents, todos: salesTodos } = useSales()

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <WeekProgress
        runs={weekRuns}
        schedules={schedules}
        weekStart={weekStart}
      />

      <Agents
        schedules={schedules}
        latestRuns={latestRuns}
        history={history}
        questions={questions}
        salesEvents={salesEvents}
        salesTodos={salesTodos}
      />

      <TruthOfSourcesView />

      <AgentsHelpersFunctions
        schedules={schedules}
        latestRuns={latestRuns}
        history={history}
        questions={questions}
        salesEvents={salesEvents}
        salesTodos={salesTodos}
      />
    </div>
  )
}
