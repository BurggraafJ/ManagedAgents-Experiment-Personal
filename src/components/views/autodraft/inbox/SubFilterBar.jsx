import styles from '../autodraft.module.css'

// Sub-filter pillen onder de audience-tab. 'Voor jou' krijgt Aandeelhouder/
// Klant/Intern/Overig; de legacy 'awaiting'-audience (CSS-verborgen
// MinimalToolbar) heeft Klant/Algemeen. De nieuwe awaiting_klant/algemeen
// tabs hebben de split al op tab-niveau, dus geen pillen voor hen.
const AWAITING_PILLS = [
  { id: 'all',      label: 'Alles' },
  { id: 'klant',    label: '🟢 Klanten' },
  { id: 'algemeen', label: '⚪ Algemeen' },
]
const FOR_YOU_PILLS = [
  { id: 'all',           label: 'Alles' },
  { id: 'aandeelhouder', label: '🔴 Aandeelhouder' },
  { id: 'klant',         label: '🟢 Klant' },
  { id: 'intern',        label: '🔵 Intern' },
  { id: 'overig',        label: '⚪ Overig' },
]

export default function SubFilterBar({ audience, subFilter, setSubFilter, subCounts }) {
  if (!subCounts || subCounts.all === 0) return null
  const pills = audience === 'awaiting' ? AWAITING_PILLS : FOR_YOU_PILLS
  const visible = pills.filter(p => p.id === 'all' || subCounts[p.id] > 0)
  if (visible.length <= 1) return null
  return (
    <div className={styles.subFilterBar}>
      {visible.map(p => {
        const on = subFilter === p.id
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setSubFilter(p.id)}
            className={`${styles.subFilterPill} ${on ? styles.subFilterPillActive : ''}`}
          >
            {p.label} <span className={styles.subFilterCount}>{subCounts[p.id]}</span>
          </button>
        )
      })}
    </div>
  )
}
