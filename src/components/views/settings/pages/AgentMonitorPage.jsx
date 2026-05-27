import { SettingsPage } from '../SettingsLayout'
import AgentsGrid from '../../now/AgentsGrid'
import ActivityFeed from '../../now/ActivityFeed'
import RunsList from '../../now/RunsList'
import '../../now/now.css'

/**
 * AgentMonitorPage — het live Agent Command Center, verhuisd vanaf het
 * Dashboard (NowView) naar Instellingen per 2026-05-27 toen het dashboard de
 * Maestro day-cockpit werd. Functioneel ONGEWIJZIGD: dezelfde AgentsGrid
 * (status-wissel, run-nu, zichtbaarheid-modal, settings-popup), ActivityFeed
 * en RunsList — alleen op een andere plek gemount.
 *
 * De .now-* styling + tokens leven scoped onder .now-app in now.css; we
 * wrappen daarom in .now-app (+ --embed modifier) zodat de kaarten er
 * identiek uitzien, zonder CSS te dupliceren.
 */
export default function AgentMonitorPage({ schedules, latestRuns, history, todayRuns }) {
  return (
    <SettingsPage
      title="Agent-overzicht"
      intro="Live status van al je agents — run nu, wissel status (live/onderhoud/uit) en beheer welke in het overzicht staan. Plus recente activity en de runs van vandaag."
    >
      <div className="now-app now-app--embed">
        <div className="now-stack">
          <AgentsGrid schedules={schedules} latestRuns={latestRuns} history={history} />
          <ActivityFeed history={history} latestRuns={latestRuns} />
          <RunsList todayRuns={todayRuns} />
        </div>
      </div>
    </SettingsPage>
  )
}
