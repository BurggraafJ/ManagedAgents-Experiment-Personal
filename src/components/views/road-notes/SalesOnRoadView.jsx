import { useMemo } from 'react'
import AgentCard from '../../AgentCard'
import { useAgents } from '../../../hooks/useAgents'
import { useSales } from '../../../hooks/useSales'
import { AGENT_NAME, summarizeEvents } from '../../../lib/salesOnRoad'
import NoteCapture from './NoteCapture'
import NotesInboxList from './NotesInboxList'
import WeekKpis from './WeekKpis'
import EventsTable from './EventsTable'
import RecentRawNotes from './RecentRawNotes'

/**
 * SalesOnRoadView — quick-capture road-notes + verwerkte gesprekken-tabel.
 * De agent draait via orchestrator en verwerkt inbox → events.
 *
 * Refactor 22 (Golf D): geen `data`-prop meer. useAgents (Refactor 02) levert
 * schedule/run, useSales (Refactor 02) levert events + inbox. Form via
 * useFormState (Refactor 04).
 */
export default function SalesOnRoadView() {
  const agents = useAgents()
  const sales  = useSales()

  const schedule  = (agents.schedules || []).find(s => s.agent_name === AGENT_NAME)
  const latestRun = (agents.latestRuns || {})[AGENT_NAME]
  const history   = (agents.history    || {})[AGENT_NAME] || []

  const events = sales.events || []
  const inbox  = sales.inbox  || []
  const summary = useMemo(() => summarizeEvents(events), [events])

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <NoteCapture />
      <NotesInboxList inbox={inbox} />

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">verwerkt aantekeningen uit inbox-tabel hierboven</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT_NAME}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={[]}
          />
        </div>
      </section>

      <WeekKpis summary={summary} />
      <EventsTable events={events} />
      <RecentRawNotes events={events} />
    </div>
  )
}
