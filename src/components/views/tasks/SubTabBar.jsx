import styles from './tasks.module.css'

export default function SubTabBar({ active, onSelect, counts }) {
  const tabs = [
    { id: 'taken', label: 'Taken', count: counts.taken },
    { id: 'jira',  label: 'Jira-overzicht', count: counts.jira },
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
