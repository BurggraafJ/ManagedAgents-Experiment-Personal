import Heartbeat from './Heartbeat'

export default function MobileBar({ views, activeView, onSelect, onRefresh, orchestratorAgeMin, theme, onToggleTheme }) {
  return (
    <div className="mobilebar">
      <div className="mobilebar__head">
        <div style={{ fontSize: 17, fontWeight: 300 }}>
          legal<span style={{ color: 'var(--accent)' }}>mind</span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>agents</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Heartbeat ageMin={orchestratorAgeMin} compact />
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onToggleTheme} aria-label="Theme wisselen">
            {theme === 'light' ? '☾' : '☀'}
          </button>
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onRefresh} aria-label="Ververs">↻</button>
        </div>
      </div>
      <div className="mobilebar__chips">
        {views.map(v => (
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
