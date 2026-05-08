import styles from './SecurityView.module.css'

/**
 * SecurityTabs — tab-switcher tussen Open issues / Alle / Afgehandeld / Scan-logs.
 * Aangedreven door tellers uit de container.
 */
export default function SecurityTabs({ tab, onChange, counts }) {
  const tabs = [
    { id: 'open',     label: `Open issues (${counts.open})` },
    { id: 'all',      label: `Alle bevindingen (${counts.total})` },
    { id: 'resolved', label: `Afgehandeld (${counts.resolved})` },
    { id: 'logs',     label: `Scan-logs (${counts.logs})` },
  ]
  return (
    <div className={styles.tabBar}>
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`${styles.tabBtn} ${tab === t.id ? styles['tabBtn--active'] : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
