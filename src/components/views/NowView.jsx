import { useAgents } from '../../hooks/useAgents'
import WeekProgress from '../sections/week-progress'
import TruthOfSourcesView from './truth-of-sources/TruthOfSourcesView'
import NowTopbar from './now/NowTopbar'
import Greeting from './now/Greeting'
import FocusGrid from './now/FocusGrid'
import NowAgendaStrip from './now/NowAgendaStrip'
import ActivityFeed from './now/ActivityFeed'
import AgentsGrid from './now/AgentsGrid'
import RunsList from './now/RunsList'
import './now/now-maestro.css'

// NowView — slim container (sessie 16 refactor, 2026-05-10).
//
// Render-tree (boven naar beneden):
//   1. NowTopbar           — sync-pill + refresh + chat
//   2. Greeting            — live klok + dynamic count
//   3. FocusGrid           — 4 tiles (admin / meeting / postvak / taken)
//   4. NowAgendaStrip      — full-width 08-20 met events + voorstellen + spelregels
//   5. ActivityFeed        — laatste 8 user-facing agent runs (filter NEVER_SHOW)
//   6. AgentsGrid          — alle agents (filter show_in_overview), 3-puntjes-menu
//                            + AgentVisibilityModal voor sleep-beheer
//   7. RunsList            — vandaag-runs
//   8. TruthOfSourcesView  — Database (oud, restyled overlay)
//   9. WeekProgress        — Doel-vs-werkelijk (v5 Maestro redesign)
//
// AgentsHelpersFunctions (oud) is verwijderd op verzoek Jelle —
// helpers/functions wonen elders.
//
// HARD-RULE: oude code is leidend. WeekProgress + TruthOfSourcesView blijven
// hun bestaande JSX/state — pure CSS-overlay via now-maestro.css.
export default function NowView({ onNavigate, badges = {}, shell = null }) {
  const { schedules, weekRuns, weekStart, latestRuns, history, todayRuns } = useAgents()

  const goto = (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }
  const onChat = () => goto('/chat')

  return (
    <div className="theme-maestro now-app">
      <NowTopbar shell={shell} onChat={onChat} />
      <div className="now-scroll">
        <div className="now-inner">
          <Greeting badges={badges} />
          <FocusGrid badges={badges} goto={goto} />
          {/* Row-2col layout (mockup Dashboard.html .row-2col 1.4fr 1fr) — agenda-strip
              en activity-feed naast elkaar ipv stacked. */}
          <div className="now-row-2col">
            <NowAgendaStrip />
            <ActivityFeed history={history} latestRuns={latestRuns} />
          </div>
          <AgentsGrid schedules={schedules} latestRuns={latestRuns} history={history} />
          <RunsList todayRuns={todayRuns} />
          <TruthOfSourcesView />
          <WeekProgress runs={weekRuns} schedules={schedules} weekStart={weekStart} />
        </div>
      </div>
    </div>
  )
}
