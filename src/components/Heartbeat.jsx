export default function Heartbeat({ ageMin, compact }) {
  let tone = 's-idle'
  let label = 'geen signaal'
  let pulse = false

  if (ageMin !== null && ageMin !== undefined) {
    if (ageMin < 20)      { tone = 's-success'; label = formatAge(ageMin); pulse = true }
    else if (ageMin < 60) { tone = 's-warning'; label = formatAge(ageMin) }
    else                  { tone = 's-error';   label = formatAge(ageMin) }
  }

  if (compact) {
    return (
      <span className={tone} title={`Orchestrator ${label}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
        <span className={`dot ${pulse ? 'dot--pulse' : ''}`} />
      </span>
    )
  }

  return (
    <div className={tone} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <span className={`dot ${pulse ? 'dot--pulse' : ''}`} />
      <span className="dim">orchestrator</span>
      <span style={{ marginLeft: 'auto', color: 'currentColor' }}>{label}</span>
    </div>
  )
}

function formatAge(min) {
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u`
  return `${Math.round(h / 24)}d`
}
