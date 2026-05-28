import styles from '../SenderTimeline.module.css'
import { TYPES } from './timelineHelpers'

// Top-bar controls: stijl-toggle (kaartjes/rail), filter-chips, notes-toggle,
// expand-all-knop en de legenda onder de items.

export function StyleToggle({ mode, setMode }) {
  return (
    <div className={styles.toggleGroup} role="tablist" aria-label="Tijdlijn-stijl">
      <button type="button" role="tab" aria-selected={mode === 'cards'}
        className={`${styles.toggleBtn} ${mode === 'cards' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('cards')}
        title="Maandkopjes met kaartjes per thread">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><rect x="3" y="18" width="18" height="3" rx="1"/>
        </svg>
        Kaartjes
      </button>
      <button type="button" role="tab" aria-selected={mode === 'rail'}
        className={`${styles.toggleBtn} ${mode === 'rail' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('rail')}
        title="Verticale tijdlijn met dots">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="21"/>
          <circle cx="6" cy="7" r="2" fill="currentColor"/><circle cx="6" cy="13" r="2" fill="currentColor"/><circle cx="6" cy="19" r="2" fill="currentColor"/>
          <line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="13" x2="20" y2="13"/><line x1="10" y1="19" x2="20" y2="19"/>
        </svg>
        Tijdlijn
      </button>
    </div>
  )
}

export function FilterChips({ filter, setFilter, mailCount, eventCount, noteCount, notesEnabled }) {
  const baseOptions = [
    { value: 'all', label: 'Alles', count: mailCount + eventCount + (notesEnabled ? noteCount : 0) },
    { value: 'mails', label: 'Mails', count: mailCount },
    { value: 'events', label: 'Meetings', count: eventCount },
  ]
  const options = notesEnabled
    ? [...baseOptions, { value: 'notes', label: 'Notes', count: noteCount }]
    : baseOptions
  return (
    <div className={styles.filterRow}>
      {options.map(o => (
        <button key={o.value} type="button"
          className={`${styles.filterChip} ${filter === o.value ? styles.filterChipActive : ''}`}
          onClick={() => setFilter(o.value)}
          disabled={o.count === 0 && o.value !== 'all'}>
          {o.label}<span className={styles.filterChipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}

export function NotesToggle({ enabled, setEnabled, count, loading, disabled, hint }) {
  const defaultHint = disabled
    ? 'Deze afzender heeft (nog) geen HubSpot-koppeling — geen notes om te tonen.'
    : 'Standaard uit zodat de tijdlijn niet overspoeld wordt — zet aan voor extra context.'
  return (
    <div className={`${styles.notesToggle} ${disabled ? styles.notesToggleDisabled : ''}`}>
      <label className={styles.notesToggleLabel}>
        <input type="checkbox" checked={enabled && !disabled}
          onChange={(e) => setEnabled(e.target.checked)} disabled={disabled}
          className={styles.notesToggleInput} />
        <span className={styles.notesToggleIcon}>📝</span>
        <span className={styles.notesToggleText}><strong>HubSpot-notes</strong> tonen in tijdlijn</span>
        {enabled && !disabled && (
          <span className={styles.notesToggleStatus}>
            {loading ? 'laden…' : `${count} ${count === 1 ? 'note' : 'notes'}`}
          </span>
        )}
      </label>
      <span className={styles.notesToggleHint}>{hint || defaultHint}</span>
    </div>
  )
}

export function ExpandAllButton({ grouped, expandedMonths, setExpandedMonths }) {
  const monthGroups = grouped.filter(g => !g.isUpcoming)
  if (monthGroups.length <= 1) return null
  const allOpen = monthGroups.every(g => expandedMonths.has(g.key))
  function onClick() {
    if (allOpen) setExpandedMonths(new Set())
    else setExpandedMonths(new Set(monthGroups.map(g => g.key)))
  }
  return (
    <button type="button" onClick={onClick} className={styles.expandAllBtn}
      title={allOpen ? 'Alle maanden weer inklappen' : 'Alle verleden-maanden uitklappen (komende meetings blijven dicht)'}>
      {allOpen ? '▴ Alles inklappen' : '▾ Alles uitklappen'}
    </button>
  )
}

export function Legend() {
  return (
    <div className={styles.legend}>
      <span className={styles.legendTitle}>Legenda</span>
      {Object.entries(TYPES).map(([key, t]) => (
        <span key={key} className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles[t.cls]}`} />
          <span>{t.label}</span>
        </span>
      ))}
    </div>
  )
}
