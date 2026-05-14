import { useAgents } from '../../hooks/useAgents'
import TruthOfSourcesView from './truth-of-sources/TruthOfSourcesView'
import NowTopbar from './now/NowTopbar'
import Greeting from './now/Greeting'
import FocusGrid from './now/FocusGrid'
import NowAgendaStrip from './now/NowAgendaStrip'
import ActivityFeed from './now/ActivityFeed'
import AgentsGrid from './now/AgentsGrid'
import RunsList from './now/RunsList'
import NowSkeleton from './now/NowSkeleton'
import './now/now.css'

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
//
// WeekProgress (Doel-vs-werkelijk) verwijderd 2026-05-14 op verzoek Jelle.
//
// Styling: lokale .now-* class-scope (eigen tokens binnen now-app, geen
// .theme-maestro afhankelijkheid).
export default function NowView({ onNavigate, badges = {}, shell = null }) {
  const { schedules, latestRuns, history, todayRuns, loading } = useAgents()

  const goto = (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  }
  const onChat = () => goto('/chat')

  // Skeleton zolang er nog niks geladen is. Topbar + Greeting blijven actief
  // zodat de pagina meteen interactief voelt; alleen het data-deel shimmert.
  const isInitialLoad = loading && (latestRuns || []).length === 0

  return (
    <div className="now-app">
      <NowTopbar shell={shell} onChat={onChat} />
      <div className="now-scroll">
        <div className="now-inner">
          <Greeting badges={badges} />
          {isInitialLoad ? (
            <NowSkeleton />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
