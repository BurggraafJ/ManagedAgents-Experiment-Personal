import { useEffect, useState } from 'react'
import Heartbeat from './Heartbeat'

export default function Sidebar({
  views, activeView, onSelect,
  lastRefresh, onRefresh,
  orchestratorAgeMin,
  theme, onToggleTheme,
  notif, onOpenNotifications,
  onOpenHelp,
  profile, onLogout,
}) {
  const freshness = useFreshness(lastRefresh)

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
        {views.map(v => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`sidebar__link ${activeView === v.id ? 'is-active' : ''}`}
          >
            <span>{v.label}</span>
            {v.count > 0 && (
              <span className={`sidebar__link-count ${v.urgent ? 'sidebar__link-count--urgent' : ''}`}>
                {v.count}
              </span>
            )}
          </button>
        ))}
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
          <button
            className="btn btn--ghost sidebar__icon-btn"
            onClick={onOpenHelp}
            title="Uitleg"
            aria-label="Uitleg"
          >
            ?
          </button>
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

function NotifButton({ notif, onOpen }) {
  if (!notif || !notif.supported) return null

  const { permission, enabled, enable, disable } = notif
  const active = enabled && permission === 'granted'

  // Shift-klik / rechtermuisknop → enable/disable; normale klik → drawer openen
  const onClick = async (e) => {
    if (e.shiftKey || e.altKey) {
      if (active) disable()
      else await enable()
      return
    }
    if (!active) {
      // Geen meldingen actief → eerst inschakelen
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
