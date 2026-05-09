import { useState, useMemo, useEffect } from 'react'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAgenda } from '../../../hooks/useAgenda'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useAgendaDerived } from '../../../hooks/useAgendaDerived'
import {
  addDays,
  mondayOf,
  startOfDay,
  toLocalDateKey,
} from '../../../lib/agenda'
import AgendaToolbar from './AgendaToolbar'
import AgendaWeekView from './AgendaWeekView'
import AgendaDayView from './AgendaDayView'
import AgendaEventModal from './AgendaEventModal'
import AgendaProposalsModal from './AgendaProposalsModal'
import AgendaVoiceModal from './AgendaVoiceModal'

/**
 * AgendaView — container voor de agenda-pagina.
 * Refactor 10 (2026-05-09): file-split + lib-extract; alle UI naar
 * sub-components in deze folder, pure helpers in src/lib/agenda.js,
 * derives + auto-sync in src/hooks/useAgendaDerived.js.
 */
const BUILD_TAG = 'r10·2026-05-09'

export default function AgendaView({ onNavigate }) {
  const {
    events,
    attendees,
    rules,
    voiceNotes,
    cities: citiesLookup,
    appointmentProposals,
    locationForecast: dbLocationForecast,
  } = useAgenda()
  const { hubspotCustomerEmails } = useAutoDraft()

  const today    = useMemo(() => startOfDay(new Date()), [])
  const isMobile = useMediaQuery('(max-width: 768px)')

  const [weekStart, setWeekStart]                 = useState(() => mondayOf(new Date()))
  const [selectedDay, setSelectedDay]             = useState(today)
  const [selectedEvent, setSelectedEvent]         = useState(null)
  const [showRules, setShowRules]                 = useState(false)
  const [showProposals, setShowProposals]         = useState(false)
  const [showProposalsList, setShowProposalsList] = useState(false)
  const [showVoice, setShowVoice]                 = useState(false)

  // Houd selectedDay binnen weekStart..weekStart+7
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    if (selectedDay < weekStart || selectedDay >= wkEnd) {
      setSelectedDay(weekStart < today && today < wkEnd ? today : weekStart)
    }
  }, [weekStart, selectedDay, today])

  const {
    days,
    proposalsByDay,
    locationForecast,
    attendeesByEvent,
    eventsByDay,
    weekEventCount,
  } = useAgendaDerived({
    weekStart,
    events,
    attendees,
    rules,
    voiceNotes,
    citiesLookup,
    appointmentProposals,
    dbLocationForecast,
    hubspotCustomerEmails,
  })

  // Diagnostics: log naar console bij week-switch
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    const totalRaw = (events || []).filter(ev => {
      if (ev.is_cancelled) return false
      const s = new Date(ev.start_time), e = new Date(ev.end_time)
      return !(e < weekStart || s >= wkEnd)
    }).length
    // eslint-disable-next-line no-console
    console.log(`[AgendaView ${BUILD_TAG}] week ${toLocalDateKey(weekStart)} → ${toLocalDateKey(wkEnd)}: ${totalRaw} events in raw filter, ${weekEventCount} in eventsByDay. Total fetched: ${(events || []).length}`)
  }, [weekStart, events, weekEventCount])

  return (
    <div className="agenda-app">
      <AgendaToolbar
        weekStart={weekStart}
        onPrev={() => setWeekStart(addDays(weekStart, -7))}
        onNext={() => setWeekStart(addDays(weekStart, 7))}
        onToday={() => setWeekStart(mondayOf(new Date()))}
        onNavigate={setWeekStart}
        showRules={showRules}
        onToggleRules={() => setShowRules(v => !v)}
        showProposals={showProposals}
        onToggleProposals={() => setShowProposals(v => !v)}
        proposalsCount={appointmentProposals.filter(p => p.status === 'sent').length}
        onOpenProposalsList={() => setShowProposalsList(true)}
        onOpenSettings={() => onNavigate?.('agenda_rules')}
        onOpenVoice={() => setShowVoice(true)}
        isMobile={isMobile}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        days={days}
        today={today}
        eventCount={weekEventCount}
        buildTag={BUILD_TAG}
      />

      {isMobile ? (
        <AgendaDayView
          day={selectedDay}
          eventsByDay={eventsByDay}
          today={today}
          rules={rules}
          showRules={showRules}
          onClickEvent={setSelectedEvent}
        />
      ) : (
        <AgendaWeekView
          days={days}
          eventsByDay={eventsByDay}
          today={today}
          rules={rules}
          showRules={showRules}
          showProposals={showProposals}
          proposalsByDay={proposalsByDay}
          locationForecast={locationForecast}
          onClickEvent={setSelectedEvent}
        />
      )}

      {selectedEvent && (
        <AgendaEventModal
          event={selectedEvent.ev}
          classified={selectedEvent.classified}
          attendees={attendeesByEvent[selectedEvent.ev.id] || []}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {showVoice && (
        <AgendaVoiceModal
          weekStart={weekStart}
          onClose={() => setShowVoice(false)}
        />
      )}

      {showProposalsList && (
        <AgendaProposalsModal
          proposals={appointmentProposals}
          onClose={() => setShowProposalsList(false)}
        />
      )}
    </div>
  )
}
