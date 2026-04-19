const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'configuratie', label: 'Configuratie' },
]

export default function TabNav({ active, onChange, inboxCount }) {
  return (
    <nav style={{
      background: '#2B2B2B',
      borderBottom: '1px solid #383838',
      padding: '0 28px',
      display: 'flex',
      gap: 4,
    }}>
      {TABS.map(tab => {
        const isActive = active === tab.id
        const showBadge = tab.id === 'inbox' && inboxCount > 0
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              background: 'transparent',
              color: isActive ? '#E86832' : '#bbb',
              border: 'none',
              borderBottom: isActive ? '2px solid #E86832' : '2px solid transparent',
              padding: '12px 16px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: isActive ? 500 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {tab.label}
            {showBadge && (
              <span style={{
                background: '#E86832',
                color: '#fff',
                fontSize: 11,
                padding: '2px 7px',
                borderRadius: 10,
                fontWeight: 600,
              }}>{inboxCount}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
