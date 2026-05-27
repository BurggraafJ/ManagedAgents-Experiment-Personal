import { useNavigate } from 'react-router-dom'
import { useDashboard } from '../../hooks/useDashboard'
import DashTopbar from './now/dash/DashTopbar'
import DashHero from './now/dash/DashHero'
import NuCard from './now/dash/NuCard'
import Queues from './now/dash/Queues'
import DayTimeline from './now/dash/DayTimeline'
import EodRibbon from './now/dash/EodRibbon'
import DashSide from './now/dash/DashSide'
import './now/dash/maestro-dash.css'

// NowView — Maestro day-cockpit (volledige herbouw 2026-05-27 op basis van
// de nieuwe Claude Design-mockup "Dashboard (1).html").
//
// Layout:
//   topbar (sync + refresh)
//   hero       — greeting + datum + items-te-gaan + done-today + breakdown
//   nu-kaart   — eerstvolgende meeting (online-link + agenda-CTA)
//   grid:
//     links    — Wachtrijen (3 progress-rings) + forward-timeline + EOD-ribbon
//     rechts   — snelle-taak-capture + aankomende taken + Morgen-kaart
//
// Het oude Agent Command Center (agents-grid + activity-feed + runs-tabel)
// is per 2026-05-27 verhuisd naar Instellingen → "Agent-overzicht"
// (AgentMonitorPage). Niets is verwijderd, alleen verplaatst.
//
// Alle styling scoped onder .mdash (zie now/dash/maestro-dash.css);
// data-afleiding in useDashboard().
export default function NowView({ badges = {}, shell = null }) {
  const navigate = useNavigate()
  const goto = (path) => navigate(path)
  const vm = useDashboard({ badges })

  return (
    <div className="mdash">
      <DashTopbar shell={shell} />
      <div className="dash-scroll">
        <div className="dash-inner">
          <DashHero vm={vm} />
          <NuCard nu={vm.nu} goto={goto} />

          <div className="grid">
            <div>
              <Queues
                queues={vm.queues}
                totalOpen={vm.totalOpen}
                totalDone={vm.doneTotal}
                goto={goto}
              />
              <DayTimeline timeline={vm.timeline} goto={goto} />
              <EodRibbon itemsToGo={vm.itemsToGo} />
            </div>
            <DashSide vm={vm} goto={goto} />
          </div>
        </div>
      </div>
    </div>
  )
}
