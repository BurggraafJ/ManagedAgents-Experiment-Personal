import {
  formatWeekLabel,
  formatDayHeader,
  sameDay,
} from '../../../lib/agenda'

/**
 * AgendaToolbar — v3 toolbar (mockup Agenda.html, 2026-05-10).
 *
 * Zelfde props/state als AgendaToolbar minus MonthSelector + topbar-only-knoppen
 * (Refresh, Voice, Nieuw event zitten in ag-topbar). Pill-toggles met dot,
 * weeklabel met info-line, geen build-tag in toolbar.
 *
 * Alle state-handlers worden ongewijzigd doorgegeven uit AgendaView →
 * useAgenda + useAgendaDerived blijven autoritair voor data.
 */
export default function AgendaToolbar({
  weekStart,
  onPrev,
  onNext,
  onToday,
  showRules,
  onToggleRules,
  showProposals,
  onToggleProposals,
  proposalsCount,
  onOpenProposalsList,
  onOpenSettings,
  isMobile,
  selectedDay,
  onSelectDay,
  days,
  today,
  eventCount,
}) {
  const wkNo = isoWeek(weekStart)
  const proposalsOpenCount = proposalsCount || 0

  return (
    <div className="ag-toolbar">
      <div className="ag-toolbar__nav">
        <button type="button" className="ag-btn ag-btn--sm" onClick={onToday} title="Naar deze week">Vandaag</button>
        <button type="button" className="ag-arrow" onClick={onPrev} aria-label="Vorige week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
        </button>
        <button type="button" className="ag-arrow" onClick={onNext} aria-label="Volgende week">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div className="ag-week-label">
        {formatWeekLabel(weekStart)}
        <small>
          week {wkNo}
          {typeof eventCount === 'number' && (
            <> · {eventCount} events</>
          )}
          {proposalsOpenCount > 0 && (
            <> · <span className="ag-week-label__accent">{proposalsOpenCount} voorstellen open</span></>
          )}
        </small>
      </div>

      <div className="ag-toolbar__actions">
        <button
          type="button"
          className={`ag-toggle ${showRules ? 'is-active' : ''}`}
          onClick={onToggleRules}
          title="Toon shadow-blokken: reistijd, verkeer, interne dag"
          aria-pressed={showRules}
        >
          <span className="ag-toggle__dot" />
          Regels
        </button>
        <button
          type="button"
          className={`ag-toggle ${showProposals ? 'is-active' : ''}`}
          onClick={onToggleProposals}
          title="Toon voorgestelde slots die je via mail hebt verstuurd"
          aria-pressed={showProposals}
        >
          <span className="ag-toggle__dot" />
          Voorstellen
          {proposalsOpenCount > 0 && (
            <span className="ag-toggle__count">{proposalsOpenCount}</span>
          )}
        </button>
        {proposalsOpenCount > 0 && (
          <button
            type="button"
            className="ag-icon-btn"
            onClick={onOpenProposalsList}
            title="Bekijk verstuurde datumvoorstellen"
            aria-label="Bekijk verstuurde voorstellen"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <path d="M8 9h8M8 13h6"/>
            </svg>
          </button>
        )}
        <button
          type="button"
          className="ag-icon-btn"
          onClick={onOpenSettings}
          title="Spelregels instellingen"
          aria-label="Instellingen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
          </svg>
        </button>
        <button
          type="button"
          className="ag-icon-btn"
          onClick={() => { window.location.reload(true) }}
          title="Hard refresh (cache leeg, data opnieuw ophalen)"
          aria-label="Refresh"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>

      {isMobile && (
        <div className="ag-daybar">
          {days.map(d => {
            const { dow, date, isToday } = formatDayHeader(d, today)
            const active = sameDay(d, selectedDay)
            return (
              <button
                key={d.toISOString()}
                type="button"
                className={`ag-daybtn ${active ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => onSelectDay(d)}
              >
                <span className="ag-daybtn__dow">{dow}</span>
                <span className="ag-daybtn__num">{date}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
