import styles from './tasks.module.css'

export default function SubTabBar({ active, onSelect, counts }) {
  const tabs = [
    { id: 'mijn',      label: 'Mijn taken',      count: counts.mijn },
    { id: 'projecten', label: 'Projecten',       count: counts.projecten },
    { id: 'nieuw',     label: 'Nieuw gevonden',  count: counts.nieuw },
    { id: 'sales',     label: 'Sales followups', count: counts.sales },
    { id: 'jira',      label: 'Jira',            count: counts.jira },
    { id: 'afgerond',  label: 'Afgeronde taken', count: counts.afgerond },
  ]
  return (
    <div className={styles.tabBar}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : styles.tabBtnInactive}`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`${styles.tabCount} ${isActive ? styles.tabCountActive : styles.tabCountInactive}`}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
