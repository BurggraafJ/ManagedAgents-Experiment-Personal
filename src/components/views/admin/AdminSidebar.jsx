import { Link, useLocation } from 'react-router-dom'

// AdminSidebar — eigen navigatie binnen de Admin-shell.
// Apart van de hoofd-Dashboard sidebar; alleen zichtbaar binnen /admin/*.
// Klik op "← Dashboard" om de admin-shell te verlaten.

const ICONS = {
  health: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  intelligence: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" />
    </svg>
  ),
  jellemind: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
      <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
      <path d="M12 6v14"/>
    </svg>
  ),
  legalai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6"/><path d="M10 22h4"/>
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/>
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
}

const NAV_GROUPS = [
  {
    group: 'Overzicht',
    items: [
      { id: 'home', label: 'Admin home', path: '/admin', icon: ICONS.home, exact: true },
    ],
  },
  {
    group: 'Monitoring',
    items: [
      { id: 'health',   label: 'Health & Issues', path: '/admin/health',   icon: ICONS.health },
      { id: 'security', label: 'Security',        path: '/admin/security', icon: ICONS.security },
    ],
  },
  {
    group: 'Intelligence',
    items: [
      { id: 'intelligence-hub',          label: 'Hub',           path: '/admin/intelligence',                icon: ICONS.intelligence, exact: true },
      { id: 'intelligence-quality',      label: 'Quality',       path: '/admin/intelligence/quality',        icon: ICONS.intelligence },
      { id: 'intelligence-observability',label: 'Observability', path: '/admin/intelligence/observability',  icon: ICONS.intelligence },
    ],
  },
  {
    group: 'Agent-laag',
    items: [
      { id: 'jellemind', label: 'JelleMind', path: '/admin/jellemind', icon: ICONS.jellemind },
      { id: 'legalai',   label: 'Legal AI',  path: '/admin/legalai',   icon: ICONS.legalai },
      { id: 'chat',      label: 'Chat',      path: '/admin/chat',      icon: ICONS.chat },
    ],
  },
  {
    group: 'Configuratie',
    items: [
      { id: 'gebruikers', label: 'Gebruikers', path: '/admin/gebruikers', icon: ICONS.users },
    ],
  },
]

export default function AdminSidebar({ onExit }) {
  const location = useLocation()

  function isActive(item) {
    if (item.exact) return location.pathname === item.path
    return location.pathname === item.path || location.pathname.startsWith(item.path + '/')
  }

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar__head">
        <button type="button" onClick={onExit} className="admin-sidebar__back" aria-label="Terug naar dashboard">
          <span aria-hidden>←</span> Dashboard
        </button>
        <Link to="/admin" className="admin-sidebar__title">
          Admin
          <span className="admin-sidebar__title-badge">owner</span>
        </Link>
      </div>

      <nav className="admin-sidebar__nav" aria-label="Admin navigatie">
        {NAV_GROUPS.map(group => (
          <div key={group.group}>
            <div className="admin-sidebar__group-label">{group.group}</div>
            {group.items.map(item => (
              <Link
                key={item.id}
                to={item.path}
                className={`admin-sidebar__link ${isActive(item) ? 'is-active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
