import { useEffect, useRef, useState } from 'react'
// Heartbeat staat nu in de Dashboard-header (OrchestratorPill); niet meer
// in de sidebar-footer.

const STORAGE_KEY = 'lm-dashboard-sidebar-groups'

function loadGroupState() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch { return {} }
}
function saveGroupState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

// SVG-iconen per view-id. Outline-stijl (Lucide-look). 18px om in 64px
// collapsed-rail goed leesbaar te blijven.
const ICONS = {
  nu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/>
      <rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>
    </svg>
  ),
  hubspot: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><rect x="9" y="11" width="6" height="10"/>
    </svg>
  ),
  jellemind: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
      <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
      <path d="M12 6v14"/>
    </svg>
  ),
  // Gloeilamp + sparkle = Legal AI Thought Leadership (research + ideeën)
  legalai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6"/>
      <path d="M10 22h4"/>
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/>
      <path d="M19 4l1 1"/>
      <path d="M5 4 4 5"/>
      <path d="M21 9h-1"/>
      <path d="M4 9H3"/>
    </svg>
  ),
  autodraft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
    </svg>
  ),
  agenda: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
    </svg>
  ),
  salestodo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 2h6v4H9z"/>
      <path d="m9 14 2 2 4-4"/>
    </svg>
  ),
  sales: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  linkedin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M8 11v5M8 8v.01M12 16v-3a2 2 0 0 1 4 0v3M12 11v5"/>
    </svg>
  ),
  kilometers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17H3a1 1 0 0 1-1-1v-3l2-7h16l2 7v3a1 1 0 0 1-1 1h-2"/>
      <circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>
    </svg>
  ),
  taken: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 11 3 3 5-5"/>
    </svg>
  ),
  contacten: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  zoeken: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  intelligence: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 1v6m0 10v6M4.22 4.22l4.24 4.24m7.08 7.08l4.24 4.24M1 12h6m10 0h6M4.22 19.78l4.24-4.24m7.08-7.08l4.24-4.24"/>
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  health: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>
  ),
  security: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  docs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
}
const GROUP_ICONS = {
  operations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
    </svg>
  ),
  hoofdagents: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2"/>
      <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
      <circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/>
    </svg>
  ),
}
function getIcon(id) { return ICONS[id] || GROUP_ICONS[id] || ICONS.settings }

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Sidebar({
  views, groups, activeView, onSelect,
  lastRefresh, onRefresh,
  orchestratorAgeMin,
  theme, onToggleTheme,
  notif, onOpenNotifications,
  onOpenHelp,
  profile, onLogout,
}) {
  // Default: alle groepen ingeklapt. Klik = openklappen. localStorage
  // bewaart de keuze per groep zodat het over refresh heen blijft.
  const [openGroups, setOpenGroups] = useState(() => ({
    operations: true, hoofdagents: false,
    ...loadGroupState(),
  }))
  // Hover-expand: standaard ingeklapt (rail van 64px), bij hover overlay
  // omhoog naar full-width met labels.
  const [expanded, setExpanded] = useState(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ bottom: 72, left: 8 })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleOutsideClick(e) {
      if (
        !menuRef.current?.contains(e.target) &&
        !triggerRef.current?.contains(e.target)
      ) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [menuOpen])

  function openMenu() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setMenuPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
    }
    setMenuOpen(prev => !prev)
  }

  const toggleGroup = (id) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      saveGroupState(next)
      return next
    })
  }

  // Zorg dat een actieve view in een gesloten groep zichtbaar wordt zodra
  // de sidebar wordt geopend.
  useEffect(() => {
    if (!groups || !expanded) return
    const parent = groups.find(g => g.kind === 'group' && g.children?.includes(activeView))
    if (parent && !openGroups[parent.id]) {
      toggleGroup(parent.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, expanded])

  const viewById = Object.fromEntries((views || []).map(v => [v.id, v]))
  const nodes = groups || (views || []).map(v => ({ kind: 'item', id: v.id }))

  return (
    <aside
      className={`sidebar ${expanded ? 'sidebar--expanded' : 'sidebar--collapsed'}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => { if (!menuOpen) setExpanded(false) }}
    >
      <div className="sidebar__logo">
        <span className="sidebar__logo-mark">L</span>
        <span className="sidebar__logo-text">legal<span className="sidebar__logo-accent">mind</span></span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

      <nav className="sidebar__nav">
        {nodes.map((node, idx) => {
          if (node.kind === 'spacer') {
            return <div key={`sp-${idx}`} className="sidebar__spacer" />
          }
          if (node.kind === 'group') {
            const isOpen = !!openGroups[node.id]
            const childViews = (node.children || []).map(id => viewById[id]).filter(Boolean)
            const groupCount = childViews.reduce((a, v) => a + (v.count || 0), 0)
            const groupUrgent = childViews.some(v => v.urgent)
            const hasActive = childViews.some(v => v.id === activeView)
            const primary = childViews[0]

            // Stabiel DOM ongeacht expanded — alleen via CSS hidden of niet.
            // Voorkomt dat icons "verspringen" tijdens de width-transition.
            const handleHeadClick = () => {
              if (!expanded && primary) onSelect(primary.id)
              else toggleGroup(node.id)
            }

            return (
              <div
                key={node.id}
                className={`sidebar__group ${isOpen ? 'is-open' : ''} ${!expanded ? 'sidebar__group--collapsed' : ''}`}
              >
                <button
                  type="button"
                  className={`sidebar__group-head ${hasActive ? 'has-active' : ''}`}
                  onClick={handleHeadClick}
                  aria-expanded={expanded ? isOpen : undefined}
                  title={!expanded ? `${node.label} — ${childViews.map(v => v.label).join(', ')}` : undefined}
                  aria-label={!expanded ? node.label : undefined}
                >
                  <span className="sidebar__group-caret" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                  <span className="sidebar__icon" aria-hidden>{getIcon(node.id)}</span>
                  <span className="sidebar__group-label">{node.label}</span>
                  {groupCount > 0 && expanded && !isOpen && (
                    <span className={`sidebar__link-count ${groupUrgent ? 'sidebar__link-count--urgent' : ''}`}>
                      {groupCount}
                    </span>
                  )}
                  {groupCount > 0 && !expanded && (
                    <span
                      className={`sidebar__link-count-dot ${groupUrgent ? 'sidebar__link-count-dot--urgent' : ''}`}
                      aria-label={`${groupCount}`}
                    />
                  )}
                </button>
                <div className={`sidebar__group-body ${expanded && isOpen ? 'is-visible' : ''}`}>
                  {childViews.map(v => (
                    <NavItem key={v.id} view={v} activeView={activeView} onSelect={onSelect} nested expanded={expanded} />
                  ))}
                </div>
              </div>
            )
          }
          // item
          const v = viewById[node.id]
          if (!v) return null
          return <NavItem key={v.id} view={v} activeView={activeView} onSelect={onSelect} expanded={expanded} />
        })}
      </nav>

      <div className="sidebar__footer">
        {profile && (
          <>
            {menuOpen && (
              <div className="sidebar__user-menu" ref={menuRef} style={{ bottom: menuPos.bottom, left: menuPos.left }}>
                <div className="sidebar__menu-header">
                  <div className="sidebar__menu-avatar-lg">{getInitials(profile.display_name)}</div>
                  <div className="sidebar__menu-header-info">
                    <div className="sidebar__menu-name">{profile.display_name}</div>
                    <div className="sidebar__menu-role">{profile.role === 'admin' ? 'admin' : 'gebruiker'}</div>
                  </div>
                </div>
                <div className="sidebar__menu-divider" />
                <button className="sidebar__menu-item" onClick={() => { onSelect('settings'); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.settings}</span>
                  <span>Instellingen</span>
                </button>
                <button className="sidebar__menu-item" onClick={() => { onSelect('health'); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.health}</span>
                  <span>Health &amp; Issues</span>
                </button>
                <button className="sidebar__menu-item" onClick={() => { onSelect('security'); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.security}</span>
                  <span>Security</span>
                </button>
                <a
                  className="sidebar__menu-item"
                  href="https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/410484738/AI+Agent+Ecosysteem"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMenuOpen(false)}
                >
                  <span className="sidebar__menu-item-icon">{ICONS.docs}</span>
                  <span>Documentatie</span>
                  <span className="sidebar__menu-item-ext" aria-hidden>↗</span>
                </a>
                <div className="sidebar__menu-divider" />
                <button className="sidebar__menu-item" onClick={() => { onToggleTheme(); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon sidebar__menu-item-icon--text">{theme === 'light' ? '☾' : '☀'}</span>
                  <span>{theme === 'light' ? 'Donker thema' : 'Licht thema'}</span>
                </button>
                <div className="sidebar__menu-divider" />
                <button className="sidebar__menu-item sidebar__menu-item--danger" onClick={() => { onLogout && onLogout(); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.logout}</span>
                  <span>Uitloggen</span>
                </button>
              </div>
            )}
            <button
              ref={triggerRef}
              className={`sidebar__user-trigger ${menuOpen ? 'is-open' : ''}`}
              onClick={openMenu}
              title={profile.display_name}
              aria-label={`Accountmenu voor ${profile.display_name}`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="sidebar__user-avatar">{getInitials(profile.display_name)}</span>
              <span className="sidebar__user-trigger-info">
                <span className="sidebar__user-trigger-name">{profile.display_name}</span>
                <span className="sidebar__user-trigger-role">{profile.role === 'admin' ? 'admin' : 'gebruiker'}</span>
              </span>
              <span className="sidebar__user-trigger-caret" aria-hidden>{menuOpen ? '▴' : '▾'}</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}

function NavItem({ view, activeView, onSelect, nested, expanded = true }) {
  const icon = getIcon(view.id)
  return (
    <button
      type="button"
      onClick={() => onSelect(view.id)}
      className={`sidebar__link ${activeView === view.id ? 'is-active' : ''} ${nested ? 'sidebar__link--nested' : ''} ${!expanded ? 'sidebar__link--collapsed' : ''}`}
      title={!expanded ? view.label : undefined}
    >
      <span className="sidebar__icon" aria-hidden>{icon}</span>
      <span className="sidebar__link-label">{view.label}</span>
      {view.count > 0 && (
        <span className={`sidebar__link-count ${view.urgent ? 'sidebar__link-count--urgent' : ''}`}>
          {view.count}
        </span>
      )}
      {view.count > 0 && (
        <span
          className={`sidebar__link-count-dot ${view.urgent ? 'sidebar__link-count-dot--urgent' : ''}`}
          aria-label={`${view.count}`}
        />
      )}
    </button>
  )
}

