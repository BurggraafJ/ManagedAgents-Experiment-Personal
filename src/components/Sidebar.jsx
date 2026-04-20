import { useEffect, useState } from 'react'
import Heartbeat from './Heartbeat'

export default function Sidebar({
  views, activeView, onSelect,
  lastRefresh, onRefresh,
  orchestratorAgeMin,
  theme, onToggleTheme,
  notif, onLogout,
}) {
  const freshness = useFreshness(lastRefresh)

  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        legal<span className="sidebar__logo-accent">mind</span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

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
          <NotifToggle notif={notif} />
          <span
            className="sidebar__footer-meta"
            title={`Data-freshness: ${freshness.label}`}
          >
            <span className={`dot ${freshness.dotClass}`} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onRefresh} aria-label="Ververs">↻</button>
        </div>

        {onLogout && (
          <button
            className="btn btn--ghost"
            onClick={onLogout}
            style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}
            title="Uitloggen — je moet opnieuw de code invoeren"
          >
            ↩ Uitloggen
          </button>
        )}
      </div>
    </aside>
  )
}

function NotifToggle({ notif }) {
  if (!notif || !notif.supported) return null

  const { permission, enabled, enable, disable } = notif
  const active = enabled && permission === 'granted'

  const onClick = async () => {
    if (active) {
      disable()
    } else {
      await enable()
    }
  }

  return (
    <button
      className="btn btn--ghost sidebar__icon-btn"
      onClick={onClick}
      title={active
        ? 'Meldingen uitzetten'
        : permission === 'denied'
          ? 'Meldingen geblokkeerd — pas je browser/app-instellingen aan'
          : 'Meldingen aanzetten (iPhone: voeg eerst toe aan beginscherm)'}
      aria-label="Meldingen"
      style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}
    >
      {active ? '🔔' : '🔕'}
    </button>
  )
}

/**
 * < 3 min  → success (groen)     "fresh"
 * 3–10 min → warning (oranje)    "bijna verlopen"
 * > 10 min → error (rood)        "stale"
 */
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
