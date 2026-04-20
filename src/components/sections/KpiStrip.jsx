const KPIS = [
  { key: 'runs',     label: 'Runs deze week' },
  { key: 'drafts',   label: 'Drafts geschreven' },
  { key: 'connects', label: 'Connects verstuurd' },
  { key: 'deals',    label: 'HubSpot deal-updates' },
]

export default function KpiStrip({ weekStats, lastWeekStats }) {
  return (
    <section id="week">
      <div className="section__head">
        <h2 className="section__title">Week</h2>
        <span className="section__hint">vs. vorige week</span>
      </div>

      <div className="grid grid--kpi">
        {KPIS.map(k => (
          <KpiCell key={k.key} label={k.label} value={weekStats[k.key]} prev={lastWeekStats[k.key]} />
        ))}
      </div>
    </section>
  )
}

function KpiCell({ label, value, prev }) {
  const delta = value - prev
  let trendClass = 'kpi__trend--flat'
  let trendText = '±0'
  if (delta > 0) { trendClass = 'kpi__trend--up';   trendText = `▲ +${delta}` }
  if (delta < 0) { trendClass = 'kpi__trend--down'; trendText = `▼ ${delta}` }

  return (
    <div className="kpi">
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="kpi__label">{label}</div>
      <div className={`kpi__trend ${trendClass}`}>
        {trendText} <span className="muted">vorige week {prev}</span>
      </div>
    </div>
  )
}
