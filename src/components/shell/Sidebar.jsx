import { useEffect, useRef, useState } from 'react'
import { ICONS, getIcon, LogoMark } from './SidebarIcons'
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

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Sidebar — production component
// -----------------------------------------------------------------------------
// Permanente twee-koloms rail+nav (geen hover-expand). Geïnspireerd op de
// pv2-shell uit Postvak v2 en doorgevoerd als globale app-navigatie.
//
//   ┌────┬──────────────┐
//   │ ⌂ │ Zoek menu... │   ← rail (56px) + nav-paneel (240px)
//   │ 📥 │ Dashboard    │
//   │ 📅 │ Operations ▾ │
//   │ 🔍 │   Postvak    │
//   │ ✓ │   Agenda     │
//   │    │ Hoofdagents… │
//   │ ⚙ │              │
//   │ JB │              │
//   └────┴──────────────┘

export default function Sidebar({
  views, groups, activeView, onSelect,
  theme, onToggleTheme,
  profile, onLogout,
}) {
  // Default: alle groepen open zodra je hovert. localStorage bewaart de keuze.
  const [openGroups, setOpenGroups] = useState(() => ({
    operations: true, hoofdagents: false,
    ...loadGroupState(),
  }))
  // Hover-expand — collapsed (64px) default, hover → expanded (240px) overlay.
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

  // Actieve view in gesloten groep automatisch zichtbaar maken bij expand.
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
        <span className="sidebar__logo-mark">{LogoMark}</span>
        <span className="sidebar__logo-text">legal<span className="sidebar__logo-accent">mind</span></span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

      <nav className="sidebar__nav" aria-label="Navigatie">
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
                <button className="sidebar__menu-item" onClick={() => { onToggleTheme && onToggleTheme(); setMenuOpen(false) }}>
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
      data-view-id={view.id}
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

// De Postvak-tabs en Mappen-tree leven binnen de Postvak-pagina zelf
// (AutoDraftView + TabsSidebar). De globale Sidebar blijft hover-expand
// collapse, één kolom, en navigeert tussen views.

