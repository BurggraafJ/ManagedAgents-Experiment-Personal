import { useEffect, useState } from 'react'
import { timeLabel } from '../../../lib/now'
import Icon from './Icon'

// NowTopbar — sticky bovenstrook met crumbs links + sync-pill (live +
// orchestrator-age + clock) + Refresh-knop. Chat-button verwijderd
// 2026-05-22 (legacy admin-chat is weg).
export default function NowTopbar({ shell }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const ageMin = shell?.orchestratorAgeMin
  const tone =
    ageMin == null ? 'idle' :
    ageMin < 20 ? 'live' :
    ageMin < 60 ? 'warn' : 'err'
  const label = ageMin == null ? 'geen signaal' :
    ageMin < 1 ? 'Live' :
    ageMin < 60 ? `${ageMin}m geleden` :
    ageMin < 1440 ? `${Math.round(ageMin / 60)}u geleden` :
    `${Math.round(ageMin / 1440)}d geleden`

  return (
    <header className="now-topbar">
      <div className="now-topbar__crumbs">
        <span className="now-crumb-current">Dashboard</span>
      </div>
      <div className="now-topbar__right">
        <div className={`now-sync-pill now-sync-pill--${tone}`}>
          <span className="now-sync-dot" />
          <span>{label}</span>
          <span className="now-sync-meta">{timeLabel(now)}</span>
        </div>
        <button
          type="button"
          className="now-btn now-btn--ghost"
          onClick={() => { if (shell?.refresh) shell.refresh(); else window.location.reload() }}
          title="Vernieuw alle data"
        >
          <Icon size={13}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></Icon>
          <span className="now-btn__label">Refresh</span>
        </button>
      </div>
    </header>
  )
}
