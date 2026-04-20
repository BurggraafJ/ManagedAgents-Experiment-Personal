import Heartbeat from './Heartbeat'

export default function MobileBar({ links, active, onJump, onRefresh, orchestratorAgeMin }) {
  return (
    <div className="mobilebar">
      <div className="mobilebar__head">
        <div style={{ fontSize: 17, fontWeight: 300 }}>
          legal<span style={{ color: 'var(--accent)' }}>mind</span>
          <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>agents</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Heartbeat ageMin={orchestratorAgeMin} compact />
          <button className="btn btn--ghost" onClick={onRefresh} aria-label="Ververs">↻</button>
        </div>
      </div>
      <div className="mobilebar__chips">
        {links.map(link => (
          <button
            key={link.id}
            onClick={() => onJump(link.id)}
            className={`mobilebar__chip ${active === link.id ? 'is-active' : ''}`}
          >
            {link.label}
            {link.count > 0 && <span>· {link.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
