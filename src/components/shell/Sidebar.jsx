import { useEffect, useRef, useState } from 'react'
import { ICONS, UI_ICONS, getIcon, LogoMark } from './SidebarIcons'
import { APP_VERSION } from '../../version'
import { useUpdateStatus, reopenUpdatePrompt } from '../../lib/updateStatus'
// Heartbeat staat nu in de Dashboard-header (OrchestratorPill); niet meer
// in de sidebar-footer.

const STORAGE_KEY = 'lm-dashboard-sidebar-groups'
const PINNED_KEY = 'lm-dashboard-sidebar-pinned'

function loadGroupState() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch { return {} }
}
function saveGroupState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}
function loadPinnedState() {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(PINNED_KEY) === 'true'
  } catch { return false }
}
function savePinnedState(pinned) {
  try { localStorage.setItem(PINNED_KEY, pinned ? 'true' : 'false') } catch {}
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
  // v1.158 — "espresso": het vaste 248px-vlak uit de Inkt-layout. Geen
  // hover-collapse, dus merknaam en account staan altijd in beeld. De
  // hover/pin-variant blijft de default en is ongewijzigd.
  variant = 'default',
  onSearch,
  // Optioneel gecontroleerd account-menu, zodat de avatar in de topbalk
  // hetzelfde menu opent als de voet-knop. Zonder deze props blijft de
  // interne state leidend (oude gedrag).
  menuOpen: menuOpenProp,
  onMenuOpenChange,
}) {
  const isEspresso = variant === 'espresso'
  // Default: alle groepen open zodra je hovert. localStorage bewaart de keuze.
  const [openGroups, setOpenGroups] = useState(() => ({
    operations: true, kennis: true, 'customer-success': true,
    ...loadGroupState(),
  }))
  // Pin-state — wanneer gepind blijft de sidebar altijd expanded.
  const [pinned, setPinned] = useState(() => loadPinnedState())
  // Hover-expand — collapsed (64px) default, hover → expanded (240px) overlay.
  // Als gepind, start en blijf expanded. In de espresso-variant is de rail
  // vast en staat expanded altijd aan.
  const [expandedState, setExpanded] = useState(() => loadPinnedState())
  const expanded = isEspresso ? true : expandedState

  // Update-cue: true zolang een nieuwe versie in de SW klaarstaat (ook als de
  // ReloadPrompt-popup met 'Later' is weggeklikt).
  const { waiting: updateWaiting } = useUpdateStatus()

  const [menuOpenState, setMenuOpenState] = useState(false)
  const controlled = menuOpenProp !== undefined
  const menuOpen = controlled ? menuOpenProp : menuOpenState
  const setMenuOpen = (next) => {
    const value = typeof next === 'function' ? next(menuOpen) : next
    if (!controlled) setMenuOpenState(value)
    onMenuOpenChange?.(value)
  }
  const [menuPos, setMenuPos] = useState({ bottom: 72, left: 8 })
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleOutsideClick(e) {
      if (
        !menuRef.current?.contains(e.target) &&
        !triggerRef.current?.contains(e.target) &&
        // De avatar in de topbalk opent hetzelfde menu; zonder deze uitzondering
        // sluit z'n mousedown het menu net vóór z'n eigen click het weer opent.
        !e.target?.closest?.('[data-account-trigger]')
      ) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen])

  // Positie van de popout hangt aan de voet-knop — ook als het menu vanuit de
  // topbalk-avatar geopend wordt. Vandaar een effect i.p.v. alleen de klik.
  useEffect(() => {
    if (!menuOpen || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setMenuPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
  }, [menuOpen])

  function openMenu() {
    setMenuOpen(prev => !prev)
  }

  const toggleGroup = (id) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      saveGroupState(next)
      return next
    })
  }

  const togglePin = () => {
    const nextPinned = !pinned
    setPinned(nextPinned)
    savePinnedState(nextPinned)
    if (nextPinned) {
      setExpanded(true)
    }
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
      className={`sidebar ${expanded ? 'sidebar--expanded' : 'sidebar--collapsed'} ${pinned ? 'sidebar--pinned' : ''} ${isEspresso ? 'sidebar--espresso' : ''}`}
      onMouseEnter={() => { if (!isEspresso && !pinned) setExpanded(true) }}
      onMouseLeave={() => { if (!isEspresso && !menuOpen && !pinned) setExpanded(false) }}
    >
      <div className="sidebar__logo">
        <span className="sidebar__logo-mark">{LogoMark}</span>
        <span className="sidebar__logo-text">legal<span className="sidebar__logo-accent">mind</span></span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

      {isEspresso && onSearch && (
        <button type="button" className="sidebar__find" onClick={onSearch} title="Zoeken in alles wat Maestro weet (⌘K)">
          <span className="sidebar__find-icon" aria-hidden>{UI_ICONS.search}</span>
          <span className="sidebar__find-label">Zoeken</span>
          <span className="sidebar__find-kbd" aria-hidden>⌘K</span>
        </button>
      )}

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
        <div className="sidebar__footer-top">
          {updateWaiting ? (
            <button
              type="button"
              className="sidebar__version sidebar__version--update"
              onClick={reopenUpdatePrompt}
              title="Update klaar — klik om te herladen"
              aria-label="Update klaar — open herlaad-melding"
            >
              <span className="sidebar__update-dot" aria-hidden />
              <span className="sidebar__version-text">v{APP_VERSION}</span>
            </button>
          ) : (
            <div className="sidebar__version" title={`Maestro v${APP_VERSION}`}>v{APP_VERSION}</div>
          )}
          <button
            type="button"
            className="sidebar__pin-btn"
            onClick={togglePin}
            title={pinned ? 'Ontkoppel sidebar' : 'Koppel sidebar vast'}
            aria-label={pinned ? 'Ontkoppel sidebar' : 'Koppel sidebar vast'}
            aria-pressed={pinned}
          >
            {ICONS.pin}
          </button>
        </div>
        {profile && (
          <>
            {menuOpen && (
              <div className="sidebar__user-menu" ref={menuRef} style={{ bottom: menuPos.bottom, left: menuPos.left }}>
                <div className="sidebar__menu-header">
                  <div className="sidebar__menu-avatar-lg">{getInitials(profile.display_name)}</div>
                  <div className="sidebar__menu-header-info">
                    <div className="sidebar__menu-name">{profile.display_name}</div>
                    <div className="sidebar__menu-role">{profile.role === 'owner' ? 'owner' : 'gebruiker'}</div>
                  </div>
                </div>
                <div className="sidebar__menu-divider" />
                {profile.role === 'owner' && (
                  <button className="sidebar__menu-item" onClick={() => { onSelect('admin'); setMenuOpen(false) }}>
                    <span className="sidebar__menu-item-icon">{ICONS.beheer || ICONS.settings}</span>
                    <span>Organisatie</span>
                    <span className="sidebar__menu-item-ext" aria-hidden>owner</span>
                  </button>
                )}
                <button className="sidebar__menu-item" onClick={() => { onSelect('settings'); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.settings}</span>
                  <span>Instellingen</span>
                </button>
                <button className="sidebar__menu-item" onClick={() => { onSelect('updates'); setMenuOpen(false) }}>
                  <span className="sidebar__menu-item-icon">{ICONS.docs}</span>
                  <span>Wat is nieuw</span>
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
                <span className="sidebar__user-trigger-role">{profile.role === 'owner' ? 'owner' : 'gebruiker'}</span>
              </span>
              <span className="sidebar__user-trigger-caret" aria-hidden>{menuOpen ? '▴' : '▾'}</span>
            </button>
          </>
        )}
      </div>
    </aside>
  )
}

// Status-pill naast een nav-item. Twee waarden, vastgelegd 2026-09-12:
// Const (geel) = in aanbouw, Soon (rood) = nog niet. Er is bewust géén
// Prod-status — een afgeronde pagina draagt geen pill.
const STATUS_LABELS = { const: 'Const', soon: 'Soon' }

function NavItem({ view, activeView, onSelect, nested, expanded = true }) {
  const icon = getIcon(view.id)
  const statusLabel = STATUS_LABELS[view.status]
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
      {statusLabel && (
        <span className={`sidebar__pill sidebar__pill--${view.status}`}>{statusLabel}</span>
      )}
      {/* Getal én pill naast elkaar is te druk (Jelle 2026-09-12): een item met
          een status-pill toont geen teller. */}
      {!statusLabel && view.count > 0 && (
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

