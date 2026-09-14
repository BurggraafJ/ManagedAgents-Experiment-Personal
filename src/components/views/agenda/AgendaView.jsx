import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useAgenda } from '../../../hooks/useAgenda'
import { useAgendaWrite } from '../../../hooks/useAgendaWrite'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useAgendaDerived } from '../../../hooks/useAgendaDerived'
import {
  addDays,
  lastCalendarSyncAt,
  mondayOf,
  startOfDay,
  toLocalDateKey,
} from '../../../lib/agenda'
import AgendaToolbar from './AgendaToolbar'
import AgendaWeekView from './AgendaWeekView'
import AgendaDayView from './AgendaDayView'
import AgendaEventPopover from './AgendaEventPopover'
import AgendaProposalsModal from './AgendaProposalsModal'
import AgendaVoiceModal from './AgendaVoiceModal'
import AgendaSkeleton from './AgendaSkeleton'
import './agenda.css'
import './agenda-luchtlijn.css'

/**
 * AgendaView — desktop + mobile agenda met week-grid, day-view (mobile),
 * spelregel-overlays (reistijd / verkeer / interne dag) en datumvoorstellen.
 *
 * Design uit `Agenda.html` (mockup 2026-05-10). VIEWS-entry `agenda` is
 * fullWidth=true → App.jsx rendert geen view__header; deze container neemt
 * het over (crumbs + Live-pill + voice + "Nieuw event").
 *
 * Data komt uit useAgenda + useAgendaDerived (Refactor 10 architectuur).
 * Geen functionele duplicatie met sub-components — alleen orkestratie.
 *
 * Design A "Luchtlijn" (2026-09-12): haarlijn-grid en veel wit via
 * agenda-luchtlijn.css (overlay op agenda.css, zelfde ag-*-classes), en
 * detail/wijzig/verwijder/nieuw in één popover aan het event-blok i.p.v. een
 * modal in het midden.
 *
 * v1.195 (2026-09-14): de schrijfbaan. De popover schrijft nu écht naar Outlook
 * via `useAgendaWrite`; de deeplinks blijven ernaast staan als tweede route.
 * De hook hangt hier, in de container, en gaat als prop naar beneden — niet
 * tweemaal aanroepen in dezelfde tree (CLAUDE.md pre-flight 4).
 */
const BUILD_TAG = 'ag·luchtlijn·2026-09-12'

function formatSyncTime(iso) {
  if (!iso) return 'geen sync'
  const now = new Date()
  const syncDate = new Date(iso)
  const diffMs = now - syncDate
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'nu'
  if (diffMin < 60) return `${diffMin} min geleden`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}u geleden`
  return syncDate.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function AgendaView({ onNavigate }) {
  const navigate = useNavigate()
  const {
    events,
    attendees,
    rules,
    voiceNotes,
    cities: citiesLookup,
    appointmentProposals,
    locationForecast: dbLocationForecast,
    syncState,
    loading,
    refresh,
  } = useAgenda()
  const { hubspotCustomerEmails } = useAutoDraft()
  // De edge-functie schrijft de spiegel in dezelfde call bij; `refresh` haalt
  // die verse rij meteen op, zodat het grid niet op de */15-sync hoeft te wachten.
  const write = useAgendaWrite(refresh)

  const today    = useMemo(() => startOfDay(new Date()), [])
  const isMobile = useMediaQuery('(max-width: 768px)')

  const [weekStart, setWeekStart]                 = useState(() => mondayOf(new Date()))
  const [selectedDay, setSelectedDay]             = useState(today)
  // Popover-stand: { mode, ev, classified, anchor, draft }. `anchor` is de
  // bounding-rect van het event-blok of van de knop die hem opende.
  const [popover, setPopover]                     = useState(null)
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
  // `last_sync_at` bestond niet in calendar_sync_state; de pil stond daardoor
  // permanent op "geen sync" terwijl de ETL elk kwartier draaide.
  const lastSync = lastCalendarSyncAt(syncState)

  // Klik op een event-blok → detail-popover aan datzelfde blok.
  const openEvent = ({ ev, classified, anchor }) =>
    setPopover({ mode: 'detail', ev, classified, anchor })

  // Klik op een leeg tijdvak → nieuw-event-popover met dat vak voorgevuld.
  const openSlot = ({ start, end, anchor }) =>
    setPopover({ mode: 'create', anchor, draft: { start, end } })

  // "Nieuw event" in de topbar: zelfde popover, geankerd aan de knop, met het
  // volgende halve uur als voorvulling.
  const openNewFromButton = (e) => {
    const start = nextHalfHour()
    openSlot({
      start,
      end: new Date(start.getTime() + 30 * 60000),
      anchor: e.currentTarget.getBoundingClientRect(),
    })
  }

  // Diagnostics: log alleen als weekStart muteert (niet bij elke render).
  useEffect(() => {
    const wkEnd = addDays(weekStart, 7)
    const totalRaw = (events || []).filter(ev => {
      if (ev.is_cancelled) return false
      const s = new Date(ev.start_time), e = new Date(ev.end_time)
      return !(e < weekStart || s >= wkEnd)
    }).length
    // eslint-disable-next-line no-console
    console.log(`[AgendaView ${BUILD_TAG}] week ${toLocalDateKey(weekStart)} → ${toLocalDateKey(wkEnd)}: ${totalRaw} raw events, ${weekEventCount} bound. Total fetched: ${(events || []).length}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  return (
    <div className="ag-app ag-app--lucht">
      <header className="ag-topbar">
        <div className="ag-crumbs">
          <span>Werkruimte</span>
          <span className="ag-crumbs__sep">/</span>
          <span className="ag-crumbs__current">Agenda</span>
          <span className="ag-crumbs__sep">/</span>
          <span>Week {weekNumber(weekStart)}</span>
        </div>
        <div className="ag-topbar__actions">
          <span className="ag-sync-pill" title={`Laatste sync: ${lastSync || 'onbekend'}`}>
            <span className="ag-sync-dot" />
            <span>{formatSyncTime(lastSync)}</span>
            <span className="ag-sync-meta">{clock}</span>
          </span>
          <button
            type="button"
            className="ag-btn ag-btn--ghost ag-btn--sm"
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
            className="ag-btn ag-btn--primary ag-btn--sm"
            title="Nieuwe afspraak in je Outlook-agenda"
            onClick={openNewFromButton}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 4v16M4 12h16"/>
            </svg>
            Nieuw event
          </button>
        </div>
      </header>

      <div className="ag-surface">
        <AgendaToolbar
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

        {loading && (events || []).length === 0 ? (
          <AgendaSkeleton />
        ) : isMobile ? (
          <AgendaDayView
            day={selectedDay}
            eventsByDay={eventsByDay}
            today={today}
            rules={rules}
            showRules={showRules}
            onClickEvent={openEvent}
            onClickSlot={openSlot}
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
            onClickEvent={openEvent}
            onClickSlot={openSlot}
          />
        )}
      </div>

      {popover && (
        <AgendaEventPopover
          mode={popover.mode}
          event={popover.ev}
          classified={popover.classified}
          attendees={popover.ev ? (attendeesByEvent[popover.ev.id] || []) : []}
          anchor={popover.anchor}
          draft={popover.draft}
          write={write}
          onClose={() => setPopover(null)}
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

// Voorvulling voor "Nieuw event": het eerstvolgende hele of halve uur.
function nextHalfHour() {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30)
  return d
}

// ISO week-nummer (Mon-Sun) — topbar toont "Week 19"
function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
