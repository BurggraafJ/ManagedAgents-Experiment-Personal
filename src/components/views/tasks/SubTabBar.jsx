// SubTabBar — tab-strip "Taken" / "Jira-overzicht"

export default function SubTabBar({ active, onSelect, counts }) {
  const tabs = [
    { id: 'taken', label: 'Taken', count: counts.taken },
    { id: 'jira',  label: 'Jira-overzicht', count: counts.jira },
  ]
  return (
    <div style={{
      display: 'flex',
      gap: 4,
      borderBottom: '1px solid var(--border)',
      paddingBottom: 0,
    }}>
      {tabs.map(t => {
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              color: isActive ? 'var(--accent)' : 'var(--text-faint)',
              fontWeight: isActive ? 600 : 500,
              fontSize: 14,
              marginBottom: -1,
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{
                marginLeft: 8,
                padding: '1px 8px',
                borderRadius: 10,
                fontSize: 11,
                background: isActive ? 'rgba(124,138,255,0.18)' : 'var(--border)',
                color: isActive ? 'var(--accent)' : 'var(--text-faint)',
                fontWeight: 600,
              }}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
