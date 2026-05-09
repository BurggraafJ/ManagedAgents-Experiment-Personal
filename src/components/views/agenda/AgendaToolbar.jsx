import {
  MONTH_NL_SHORT,
  formatWeekLabel,
  formatDayHeader,
  mondayOf,
  sameDay,
} from '../../../lib/agenda'

/**
 * AgendaToolbar — bovenbalk van de agenda. Maandselector, week-navigatie,
 * event-count, refresh, voice/instellingen knoppen, spelregels-toggle,
 * voorstellen-toggle en mobiele day-bar.
 */
export default function AgendaToolbar({
  weekStart,
  onPrev,
  onNext,
  onToday,
  onNavigate,
  showRules,
  onToggleRules,
  showProposals,
  onToggleProposals,
  proposalsCount,
  onOpenProposalsList,
  onOpenSettings,
  onOpenVoice,
  isMobile,
  selectedDay,
  onSelectDay,
  days,
  today,
  eventCount,
  buildTag,
}) {
  return (
    <div className="agenda-toolbar">
      <div className="agenda-toolbar__nav">
        <MonthSelector weekStart={weekStart} onNavigate={onNavigate} />
        <button type="button" className="btn btn--ghost" onClick={onToday} title="Naar deze week">Vandaag</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onPrev} aria-label="Vorige week">‹</button>
        <button type="button" className="agenda-toolbar__arrow" onClick={onNext} aria-label="Volgende week">›</button>
        <span className="agenda-toolbar__label">{formatWeekLabel(weekStart)}</span>
        {typeof eventCount === 'number' && (
          <span className="agenda-toolbar__count" title="Aantal events in deze week">{eventCount}</span>
        )}
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
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
        {buildTag && (
          <span className="agenda-toolbar__build" title="Build version">{buildTag}</span>
        )}
      </div>

      <div className="agenda-toolbar__actions">
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenVoice}
          title="Weeknotitie toevoegen"
          aria-label="Weeknotitie toevoegen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="13" rx="3"/>
            <path d="M5 10v2a7 7 0 0 0 14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </button>
        <button
          type="button"
          className="agenda-toolbar__icon-btn"
          onClick={onOpenSettings}
          title="Spelregels instellingen"
          aria-label="Instellingen"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>
          </svg>
        </button>
        <label className="agenda-toolbar__toggle" title="Toon shadow-blokken: reistijd, verkeer, interne dag">
          <input type="checkbox" checked={showRules} onChange={onToggleRules} />
          <span>Toon spelregels</span>
        </label>
        <label className="agenda-toolbar__toggle" title="Toon voorgestelde slots die je via mail hebt verstuurd">
          <input type="checkbox" checked={showProposals} onChange={onToggleProposals} />
          <span>Toon voorstellen{proposalsCount > 0 ? ` (${proposalsCount})` : ''}</span>
        </label>
        {proposalsCount > 0 && (
          <button
            type="button"
            className="agenda-toolbar__icon-btn"
            onClick={onOpenProposalsList}
            title="Bekijk verstuurde datumvoorstellen"
            aria-label="Bekijk verstuurde voorstellen"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              <path d="M8 9h8M8 13h6"/>
            </svg>
          </button>
        )}
      </div>

      {isMobile && (
        <div className="agenda-toolbar__daybar">
          {days.map(d => {
            const { dow, date, isToday } = formatDayHeader(d, today)
            const active = sameDay(d, selectedDay)
            return (
              <button
                key={d.toISOString()}
                type="button"
                className={`agenda-toolbar__daybtn ${active ? 'is-active' : ''} ${isToday ? 'is-today' : ''}`}
                onClick={() => onSelectDay(d)}
              >
                <span className="agenda-toolbar__daybtn-dow">{dow}</span>
                <span className="agenda-toolbar__daybtn-num">{date}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MonthSelector({ weekStart, onNavigate }) {
  const now = new Date()
  const months = []
  for (let i = -3; i <= 11; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({ year: d.getFullYear(), month: d.getMonth() })
  }
  const currentKey = `${weekStart.getFullYear()}-${weekStart.getMonth()}`
  return (
    <select
      className="agenda-month-select"
      value={currentKey}
      onChange={e => {
        const [y, m] = e.target.value.split('-').map(Number)
        onNavigate(mondayOf(new Date(y, m, 1)))
      }}
      title="Ga naar maand"
    >
      {months.map(({ year, month }) => (
        <option key={`${year}-${month}`} value={`${year}-${month}`}>
          {MONTH_NL_SHORT[month]} {year}
        </option>
      ))}
    </select>
  )
}
