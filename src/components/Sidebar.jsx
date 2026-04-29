import { useEffect, useState } from 'react'
import Heartbeat from './Heartbeat'

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
  autodraft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
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
  zoeken: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  chat: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  improvements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
}
const GROUP_ICONS = {
  mailing:  ICONS.autodraft,
  'op-pad': ICONS.sales,
  tools: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-7.3 7.3a1 1 0 0 0 1.4 1.4l7.3-7.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2 2.4-2.4z"/>
    </svg>
  ),
}
function getIcon(id) { return ICONS[id] || GROUP_ICONS[id] || ICONS.settings }

export default function Sidebar({
  views, groups, activeView, onSelect,
  lastRefresh, onRefresh,
  orchestratorAgeMin,
  theme, onToggleTheme,
  notif, onOpenNotifications,
  onOpenHelp,
  profile, onLogout,
}) {
  const freshness = useFreshness(lastRefresh)
  const [openGroups, setOpenGroups] = useState(() => ({
    inbox: true, sales: true, mailing: false, 'op-pad': false, tools: false,
    ...loadGroupState(),
  }))
  // Hover-expand: standaard ingeklapt (rail van 64px), bij hover overlay
  // omhoog naar full-width met labels.
  const [expanded, setExpanded] = useState(false)

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
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="sidebar__logo">
        {expanded ? (
          <>legal<span className="sidebar__logo-accent">mind</span></>
        ) : (
          <span className="sidebar__logo-mark">L</span>
        )}
      </div>
      {expanded && <div className="sidebar__tagline">Agent Command Center</div>}

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

            // Collapsed: één icoon per groep, klik = ga naar primary child
            // (eerste in de lijst). Sub-views verschijnen pas bij hover-expand.
            if (!expanded) {
              const primary = childViews[0]
              if (!primary) return null
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelect(primary.id)}
                  className={`sidebar__link sidebar__link--collapsed ${hasActive ? 'is-active' : ''}`}
                  title={`${node.label} — ${childViews.map(v => v.label).join(', ')}`}
                  aria-label={node.label}
                >
                  <span className="sidebar__icon" aria-hidden>{getIcon(node.id)}</span>
                  {groupCount > 0 && (
                    <span
                      className={`sidebar__link-count-dot ${groupUrgent ? 'sidebar__link-count-dot--urgent' : ''}`}
                      aria-label={`${groupCount}`}
                    />
                  )}
                </button>
              )
            }
            return (
              <div key={node.id} className={`sidebar__group ${isOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className={`sidebar__group-head ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(node.id)}
                  aria-expanded={isOpen}
                >
                  <span className="sidebar__group-caret" aria-hidden>{isOpen ? '▾' : '▸'}</span>
                  <span className="sidebar__icon" aria-hidden>{getIcon(node.id)}</span>
                  <span className="sidebar__group-label">{node.label}</span>
                  {groupCount > 0 && !isOpen && (
                    <span className={`sidebar__link-count ${groupUrgent ? 'sidebar__link-count--urgent' : ''}`}>
                      {groupCount}
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="sidebar__group-body">
                    {childViews.map(v => (
                      <NavItem key={v.id} view={v} activeView={activeView} onSelect={onSelect} nested expanded />
                    ))}
                  </div>
                )}
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
        <div className="sidebar__status">
          <Heartbeat ageMin={orchestratorAgeMin} compact={!expanded} />
          {expanded && (
            <button
              className="sidebar__icon-btn-mini"
              onClick={onRefresh}
              aria-label="Ververs"
              title={`Laatst ververst: ${lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL') : 'nooit'} — ${freshness.label}`}
            >
              <span className={`dot ${freshness.dotClass}`} style={{ marginRight: 4 }} />
              ↻
            </button>
          )}
        </div>

        {profile && expanded && (
          <div className="sidebar__profile-bottom">
            <div className="sidebar__profile-row">
              <div className="sidebar__profile-info">
                <div className="sidebar__profile-name">{profile.display_name}</div>
                <div className="sidebar__profile-role">
                  {profile.role === 'admin' ? 'admin' : 'gebruiker'}
                </div>
              </div>
              <button
                className="sidebar__icon-btn-mini"
                onClick={onToggleTheme}
                title={`Schakel naar ${theme === 'light' ? 'donker' : 'licht'} thema`}
                aria-label="Thema wisselen"
              >
                {theme === 'light' ? '☾' : '☀'}
              </button>
            </div>
            {onLogout && (
              <button
                className="sidebar__logout-btn"
                onClick={onLogout}
                title="Uitloggen — sessie wordt direct ingetrokken"
              >
                Uitloggen
              </button>
            )}
          </div>
        )}
        {profile && !expanded && (
          <button
            className="sidebar__icon-btn-mini"
            onClick={onToggleTheme}
            aria-label="Thema wisselen"
            title="Thema wisselen"
            style={{ alignSelf: 'center' }}
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
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
      {expanded && <span className="sidebar__link-label">{view.label}</span>}
      {expanded && view.count > 0 && (
        <span className={`sidebar__link-count ${view.urgent ? 'sidebar__link-count--urgent' : ''}`}>
          {view.count}
        </span>
      )}
      {!expanded && view.count > 0 && (
        <span
          className={`sidebar__link-count-dot ${view.urgent ? 'sidebar__link-count-dot--urgent' : ''}`}
          aria-label={`${view.count}`}
        />
      )}
    </button>
  )
}

function useFreshness(lastRefresh) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  if (!lastRefresh) return { dotClass: 's-idle', label: 'geen data' }
  const ageMin = (Date.now() - lastRefresh.getTime()) / 60000
  if (ageMin < 3)  return { dotClass: 's-success', label: 'fresh' }
  if (ageMin < 10) return { dotClass: 's-warning', label: 'bijna verlopen' }
  return { dotClass: 's-error', label: 'stale — klik ↻ om te verversen' }
}
