import Heartbeat from './Heartbeat'

export default function Sidebar({ links, active, onJump, lastRefresh, onRefresh, orchestratorAgeMin }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__logo">
        legal<span className="sidebar__logo-accent">mind</span>
      </div>
      <div className="sidebar__tagline">Agent Command Center</div>

      <nav className="sidebar__nav">
        {links.map(link => (
          <button
            key={link.id}
            onClick={() => onJump(link.id)}
            className={`sidebar__link ${active === link.id ? 'is-active' : ''}`}
          >
            <span>{link.label}</span>
            {link.count > 0 && (
              <span className={`sidebar__link-count ${link.urgent ? 'sidebar__link-count--urgent' : ''}`}>
                {link.count}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <Heartbeat ageMin={orchestratorAgeMin} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="muted">
            {lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '—'}
          </span>
          <button className="btn btn--ghost" onClick={onRefresh} aria-label="Ververs">↻</button>
        </div>
      </div>
    </aside>
  )
}
