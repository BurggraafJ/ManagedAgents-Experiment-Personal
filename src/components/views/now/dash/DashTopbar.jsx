import { useEffect, useState } from 'react'
import { timeLabel } from '../../../../lib/now'
import Icon from '../Icon'

// DashTopbar — sticky bovenstrook: "Dashboard" crumb + sync-pill
// (orchestrator-age / online-state) + Refresh. Behoudt de live/refresh-
// functionaliteit van de oude NowTopbar in de nieuwe Maestro-styling.
export default function DashTopbar({ shell }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const offline = shell && shell.online === false
  const ageMin = shell?.orchestratorAgeMin
  const tone = offline ? 'err'
    : ageMin == null ? 'idle'
    : ageMin < 20 ? 'live'
    : ageMin < 60 ? 'warn' : 'err'
  const label = offline ? 'offline'
    : ageMin == null ? 'geen signaal'
    : ageMin < 1 ? 'Live'
    : ageMin < 60 ? `${ageMin}m geleden`
    : ageMin < 1440 ? `${Math.round(ageMin / 60)}u geleden`
    : `${Math.round(ageMin / 1440)}d geleden`

  return (
    <header className="dash-topbar">
      <span className="dash-topbar__crumb">Dashboard</span>
      <div className="dash-topbar__right">
        <div className={`dash-sync dash-sync--${tone}`}>
          <span className="dash-sync__dot" />
          <span>{label}</span>
          <span className="dash-sync__meta">{timeLabel(now)}</span>
        </div>
        <button
          type="button"
          className="dash-btn"
          onClick={() => { if (shell?.refresh) shell.refresh(); else window.location.reload() }}
          title="Vernieuw alle data"
        >
          <Icon size={13}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></Icon>
          Refresh
        </button>
      </div>
    </header>
  )
}
