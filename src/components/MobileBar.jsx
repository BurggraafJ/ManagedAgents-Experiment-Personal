import Heartbeat from './Heartbeat'

export default function MobileBar({
  views, activeView, onSelect, onRefresh,
  orchestratorAgeMin, theme, onToggleTheme,
  notif, onOpenNotifications, onOpenHelp,
  profile, onLogout,
}) {
  // Settings tonen we via een eigen icoon-knop, niet als chip — consistent met
  // het gear-icoon rechtsbovenin de desktop view-header.
  const navChips = (views || []).filter(v => v.id !== 'settings')
  const notifActive = notif?.supported && notif?.enabled && notif?.permission === 'granted'

  const onBellClick = async () => {
    if (!notif?.supported) return
    if (!notifActive) {
      const ok = await notif.enable()
      if (!ok) return
    }
    onOpenNotifications?.()
  }

  const onBellLongPress = async (e) => {
    e.preventDefault()
    if (!notif?.supported) return
    if (notifActive) notif.disable()
    else await notif.enable()
  }

  return (
    <div className="mobilebar">
      <div className="mobilebar__head">
        <div style={{ fontSize: 17, fontWeight: 300, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>legal<span style={{ color: 'var(--accent)' }}>mind</span></span>
          {profile && <span className="muted" style={{ fontSize: 11 }}>· {profile.display_name.split(' ')[0]}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Heartbeat ageMin={orchestratorAgeMin} compact />
          {notif?.supported && (
            <button
              className="btn btn--ghost sidebar__icon-btn"
              onClick={onBellClick}
              onContextMenu={onBellLongPress}
              aria-label="Meldingen"
              style={{ color: notifActive ? 'var(--accent)' : 'var(--text-faint)' }}
            >
              {notifActive ? '🔔' : '🔕'}
            </button>
          )}
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onToggleTheme} aria-label="Theme">
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onRefresh} aria-label="Ververs">↻</button>
          <button
            className="btn btn--ghost sidebar__icon-btn"
            onClick={() => onSelect(activeView === 'settings' ? 'nu' : 'settings')}
            aria-label="Instellingen"
            title="Instellingen"
            style={{ color: activeView === 'settings' ? 'var(--accent)' : undefined }}
          >
            ⚙
          </button>
          {onLogout && (
            <button className="btn btn--ghost sidebar__icon-btn" onClick={onLogout} aria-label="Uitloggen" title="Uitloggen">↩</button>
          )}
        </div>
      </div>
      <div className="mobilebar__chips">
        {navChips.map(v => (
          <button
            key={v.id}
            onClick={() => onSelect(v.id)}
            className={`mobilebar__chip ${activeView === v.id ? 'is-active' : ''}`}
          >
            {v.label}
            {v.count > 0 && <span>· {v.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
