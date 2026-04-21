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
    agents: true, hubspot: true,
    ...loadGroupState(),
  }))

  const toggleGroup = (id) => {
    setOpenGroups(prev => {
      const next = { ...prev, [id]: !prev[id] }
      saveGroupState(next)
      return next
    })
  }

  // Zorg dat een actieve view in een gesloten groep zichtbaar wordt
  useEffect(() => {
    if (!groups) return
    const parent = groups.find(g => g.kind === 'group' && g.children?.includes(activeView))
    if (parent && !openGroups[parent.id]) {
      toggleGroup(parent.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  const viewById = Object.fromEntries((views || []).map(v => [v.id, v]))

  const nodes = groups || (views || []).map(v => ({ kind: 'item', id: v.id }))

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        legal<span className="sidebar__logo-accent">mind</span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

      {profile && (
        <div className="sidebar__profile">
          <div className="sidebar__profile-name">{profile.display_name}</div>
          <div className="sidebar__profile-role">{profile.role === 'admin' ? 'admin' : 'gebruiker'}</div>
        </div>
      )}

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
            return (
              <div key={node.id} className={`sidebar__group ${isOpen ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className={`sidebar__group-head ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(node.id)}
                  aria-expanded={isOpen}
                >
                  <span className="sidebar__group-caret" aria-hidden>{isOpen ? '▾' : '▸'}</span>
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
                      <NavItem key={v.id} view={v} activeView={activeView} onSelect={onSelect} nested />
                    ))}
                  </div>
                )}
              </div>
            )
          }
          // item
          const v = viewById[node.id]
          if (!v) return null
          return <NavItem key={v.id} view={v} activeView={activeView} onSelect={onSelect} />
        })}
      </nav>

      <div className="sidebar__footer">
        <Heartbeat ageMin={orchestratorAgeMin} />

        <div className="sidebar__footer-row">
          <button
            className="btn btn--ghost sidebar__icon-btn"
            onClick={onToggleTheme}
            title={`Schakel naar ${theme === 'light' ? 'donker' : 'licht'}`}
            aria-label="Theme wisselen"
          >
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <NotifButton notif={notif} onOpen={onOpenNotifications} />
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onRefresh} aria-label="Ververs" title="Ververs">↻</button>
        </div>

        <div className="sidebar__footer-row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
          <span title={`Data-freshness: ${freshness.label}`}>
            <span className={`dot ${freshness.dotClass}`} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            <span className="muted">{lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
          </span>
          {onLogout && (
            <button
              className="btn btn--ghost"
              onClick={onLogout}
              style={{ fontSize: 11 }}
              title="Uitloggen — token wordt direct ingetrokken"
            >
              ↩ uitloggen
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

function NavItem({ view, activeView, onSelect, nested }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(view.id)}
      className={`sidebar__link ${activeView === view.id ? 'is-active' : ''} ${nested ? 'sidebar__link--nested' : ''}`}
    >
      <span>{view.label}</span>
      {view.count > 0 && (
        <span className={`sidebar__link-count ${view.urgent ? 'sidebar__link-count--urgent' : ''}`}>
          {view.count}
        </span>
      )}
    </button>
  )
}

function NotifButton({ notif, onOpen }) {
  if (!notif || !notif.supported) return null

  const { permission, enabled, enable, disable } = notif
  const active = enabled && permission === 'granted'

  const onClick = async (e) => {
    if (e.shiftKey || e.altKey) {
      if (active) disable()
      else await enable()
      return
    }
    if (!active) {
      const ok = await enable()
      if (!ok) return
    }
    onOpen?.()
  }

  const onContext = async (e) => {
    e.preventDefault()
    if (active) disable()
    else await enable()
  }

  return (
    <button
      className="btn btn--ghost sidebar__icon-btn"
      onClick={onClick}
      onContextMenu={onContext}
      title={active
        ? 'Klik: meldingen-paneel · Alt/Shift-klik: uitzetten'
        : permission === 'denied'
          ? 'Meldingen geblokkeerd — pas je browser/app-instellingen aan'
          : 'Klik om meldingen aan te zetten'}
      aria-label="Meldingen"
      style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}
    >
      {active ? '🔔' : '🔕'}
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
