import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
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
import AgendaMaestroToolbar from './AgendaMaestroToolbar'
import AgendaWeekView from './AgendaWeekView'
import AgendaDayView from './AgendaDayView'
import AgendaEventModal from './AgendaEventModal'
import AgendaProposalsModal from './AgendaProposalsModal'
import AgendaVoiceModal from './AgendaVoiceModal'
import './agenda-maestro-v2.css'

// AgendaMaestroView — Maestro v2 (mockup uit Downloads/Agenda.html, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Dezelfde hooks/state/sub-components als AgendaView; deze wrapper voegt
// alleen een mockup-topbar en vervangt de toolbar door een Maestro-variant.
// Routes /agenda + /agenda-maestro draaien naast elkaar zoals
// /administratie + /administratie-maestro.
//
// VIEWS-entry voor `agenda_maestro` is fullWidth=true → App.jsx rendert
// geen view__header; deze wrapper neemt het over (crumbs + sync-pill +
// voice + "Nieuw event").
const BUILD_TAG = 'agm·v2·2026-05-10'

export default function AgendaMaestroView({ onNavigate }) {
  const navigate = useNavigate()
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
  const [showRules, setShowRules]                 = useState(true)
  const [showProposals, setShowProposals]         = useState(false)
  const [showProposalsList, setShowProposalsList] = useState(false)
  const [showVoice, setShowVoice]                 = useState(false)
  const [clock, setClock]                         = useState(() => formatClock(new Date()))

  // Houd selectedDay binnen weekStart..weekStart+7
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    if (selectedDay < weekStart || selectedDay >= wkEnd) {
      setSelectedDay(weekStart < today && today < wkEnd ? today : weekStart)
    }
  }, [weekStart, selectedDay, today])

  // Live-klok in topbar (refresh elke 30s)
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 30000)
    return () => clearInterval(id)
  }, [])

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

  const proposalsCount = appointmentProposals.filter(p => p.status === 'sent').length

  // Diagnostics: log alleen als weekStart muteert (niet bij elke render).
  // events-array verwijst is bij elke render, daarom alleen op weekStart deps.
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    const totalRaw = (events || []).filter(ev => {
      if (ev.is_cancelled) return false
      const s = new Date(ev.start_time), e = new Date(ev.end_time)
      return !(e < weekStart || s >= wkEnd)
    }).length
    // eslint-disable-next-line no-console
    console.log(`[AgendaMaestroView ${BUILD_TAG}] week ${toLocalDateKey(weekStart)} → ${toLocalDateKey(wkEnd)}: ${totalRaw} raw events, ${weekEventCount} bound. Total fetched: ${(events || []).length}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  return (
    <div className="theme-maestro agm-app">
      {/* Mockup-topbar (crumbs + sync-pill + actions) */}
      <header className="agm-topbar">
        <div className="agm-crumbs">
          <span>Werkruimte</span>
          <span className="agm-crumbs__sep">/</span>
          <span className="agm-crumbs__current">Agenda</span>
          <span className="agm-crumbs__sep">/</span>
          <span>Week {weekNumber(weekStart)}</span>
        </div>
        <div className="agm-topbar__actions">
          <span className="agm-sync-pill" title="Live-verbinding actief">
            <span className="agm-sync-dot" />
            <span>Live</span>
            <span className="agm-sync-meta">{clock}</span>
          </span>
          <button
            type="button"
            className="agm-btn agm-btn--ghost agm-btn--sm"
            onClick={() => setShowVoice(true)}
            title="Voice-note toevoegen"
            aria-label="Voice-note"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="12" rx="3"/>
              <path d="M5 12a7 7 0 0014 0M12 19v3"/>
            </svg>
          </button>
          <button
            type="button"
            className="agm-btn agm-btn--primary agm-btn--sm"
            title="Nieuw event in Outlook (opent direct het detail-modal als handvat)"
            onClick={() => {
              window.open('https://outlook.office.com/calendar/deeplink/compose', '_blank', 'noopener,noreferrer')
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v16M4 12h16"/>
            </svg>
            Nieuw event
          </button>
        </div>
      </header>

      {/* Surface (witte card met toolbar + grid) */}
      <div className="agm-surface">
        <AgendaMaestroToolbar
          weekStart={weekStart}
          onPrev={() => setWeekStart(addDays(weekStart, -7))}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
          onToday={() => setWeekStart(mondayOf(new Date()))}
          showRules={showRules}
          onToggleRules={() => setShowRules(v => !v)}
          showProposals={showProposals}
          onToggleProposals={() => setShowProposals(v => !v)}
          proposalsCount={proposalsCount}
          onOpenProposalsList={() => setShowProposalsList(true)}
          onOpenSettings={() => (onNavigate ? onNavigate('agenda_rules') : navigate('/agenda/spelregels'))}
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
      </div>

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

function formatClock(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ISO week-nummer (Mon-Sun) — Mockup-topbar toont "Week 19"
function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
