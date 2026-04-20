import Heartbeat from './Heartbeat'

export default function Sidebar({ views, activeView, onSelect, lastRefresh, onRefresh, orchestratorAgeMin, theme, onToggleTheme }) {
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
          <span className="sidebar__footer-meta">
            {lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <button className="btn btn--ghost sidebar__icon-btn" onClick={onRefresh} aria-label="Ververs">↻</button>
        </div>
      </div>
    </aside>
  )
}
