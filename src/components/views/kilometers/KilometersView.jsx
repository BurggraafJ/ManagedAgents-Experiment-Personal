import { useMemo } from 'react'
import AgentCard from '../../AgentCard'
import { useAgents } from '../../../hooks/useAgents'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import TripForm from './TripForm'
import TripsInboxList from './TripsInboxList'
import RecentRunsList from './RecentRunsList'
import ParkingTimeline from './ParkingTimeline'
import styles from './KilometersView.module.css'

const AGENT_NAME = 'kilometerregistratie'

/**
 * KilometersView — dagelijkse km-registratie. Quick-capture form + inbox-
 * wachtrij + parking-timeline + recente runs. De agent zelf draait 1×/maand.
 *
 * Refactor 18 (Golf D): geen `data`-prop meer. Schedules + runs uit
 * `useAgents` (Refactor 02), inbox direct via `useSupabaseQuery` (Refactor 04).
 * Form gebruikt `useFormState` — eerste echte testcase voor dat patroon.
 */
export default function KilometersView() {
  const agents = useAgents()
  const inboxQ = useSupabaseQuery('km_trips_inbox', {
    orderBy: ['created_at', { ascending: false }],
    limit: 50,
    realtime: true,
  })

  const schedule  = (agents.schedules || []).find(s => s.agent_name === AGENT_NAME)
  const latestRun = (agents.latestRuns || {})[AGENT_NAME]
  const history   = (agents.history    || {})[AGENT_NAME] || []

  // Recente runs van deze agent — max 12 voor de tabel.
  const allRuns = useMemo(() => {
    const source = agents.rangeRuns?.length ? agents.rangeRuns : (agents.recentRuns || [])
    return source.filter(r => r.agent_name === AGENT_NAME).slice(0, 12)
  }, [agents.rangeRuns, agents.recentRuns])

  // Recente unieke "van/naar" voor datalist (autocomplete).
  const inbox = inboxQ.data || []
  const recentPlaces = useMemo(() => {
    const set = new Set()
    for (const i of inbox) {
      if (i.van) set.add(i.van)
      if (i.naar) set.add(i.naar)
    }
    return Array.from(set).slice(0, 30)
  }, [inbox])

  // Parking-timeline tovert latestRun + recente runs samen — dedupe in component.
  const parkingSource = [latestRun, ...allRuns].filter(Boolean)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <TripForm recentPlaces={recentPlaces} />
      <TripsInboxList inbox={inbox} />

      <div className="grid grid--agents">
        <AgentCard
          agent={AGENT_NAME}
          schedule={schedule}
          latestRun={latestRun}
          history={history}
          openQuestions={[]}
        />
      </div>

      <ParkingTimeline runs={parkingSource} />

      <section>
        <div className="section__head">
          <h2 className="section__title">Hoe gebruik ik dit?</h2>
        </div>
        <div className={`card ${styles.helpCard}`}>
          <p>
            Standaard draait de agent op de <strong>2e van elke maand</strong> en verwerkt automatisch
            de vorige maand uit je Outlook-agenda + de ritten die je hier hebt toegevoegd.
            Resultaat landt in <span className="mono">reiskosten_2026.xlsx</span>.
          </p>
          <p>
            Voeg ritten direct toe via het invoerblok hierboven — agent leest ze bij de volgende run.
            Wil je een specifieke maand handmatig laten verwerken? Klik op <strong>↻ Run nu</strong> in het
            ⋯-menu rechts op de kaart.
          </p>
        </div>
      </section>

      <RecentRunsList runs={allRuns} />
    </div>
  )
}
