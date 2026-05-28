import Heartbeat from '../Heartbeat'

// Top chip-bar voor tablet-formaat (768–900px). Onder 768px komt de
// mobiele shell met bottom tab bar; boven 900px de Sidebar. Geen bell-/
// melding-knop meer — gebruikers-meldingen zijn 2026-05-28 verwijderd.
export default function MobileBar({
  views, activeView, onSelect, onRefresh,
  orchestratorAgeMin, theme, onToggleTheme,
  profile, onLogout,
}) {
  // Settings tonen we via een eigen icoon-knop, niet als chip — consistent met
  // het gear-icoon rechtsbovenin de desktop view-header.
  const navChips = (views || []).filter(v => v.id !== 'settings')

  return (
    <div className="mobilebar">
      <div className="mobilebar__head">
        <div style={{ fontSize: 17, fontWeight: 300, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>legal<span style={{ color: 'var(--accent)' }}>mind</span></span>
          {profile && <span className="muted" style={{ fontSize: 11 }}>· {profile.display_name.split(' ')[0]}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Heartbeat ageMin={orchestratorAgeMin} compact />
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
