import { DAY_MS, PLAN_MISS_DAILY_LIMIT, MAX_DOTS, downsampleRuns } from '../../../lib/weekProgress'

export default function TodayTimeline({ day, now, agentName }) {
  const { dayStart, plans, hits, runs, planMisses, perf } = day
  const elapsedMs = now.getTime() - dayStart
  const nowPct = Math.max(0, Math.min(100, (elapsedMs / DAY_MS) * 100))

  // Markers staan op vaste tijd-positie (0/6/12/18u). Voor de runs gebruiken
  // we exact dezelfde xOf-functie, zodat dots en gridlines op dezelfde
  // tijd-as liggen — geen "stipje hoort niet bij dat uur"-verschuiving.
  const xOf = (ts) => Math.max(0, Math.min(100, ((ts - dayStart) / DAY_MS) * 100))
  const hourMarks = [
    { pct: 0,            label: '00' },
    { pct: 100 * 6/24,   label: '06' },
    { pct: 100 * 12/24,  label: '12' },
    { pct: 100 * 18/24,  label: '18' },
  ]

  const showPlanMisses = plans <= PLAN_MISS_DAILY_LIMIT
  const visibleMisses = showPlanMisses ? planMisses : []
  const visibleRuns = downsampleRuns(runs)
  const missCountHint = !showPlanMisses && planMisses.length > 0
    ? `${planMisses.length} gepland niet gehaald`
    : null
  const sampledHint = runs.length > MAX_DOTS
    ? `${runs.length} runs vandaag — toont ${visibleRuns.length} representatief`
    : null

  const tooltip = plans > 0
    ? `${agentName} vandaag · ${hits}/${plans} gehaald${runs.length > plans ? ` · ${runs.length - plans} extra` : ''}`
    : runs.length > 0
      ? `${agentName} vandaag · ${runs.length} run${runs.length === 1 ? '' : 's'}`
      : `${agentName} vandaag · niets gepland`

  const summary = plans > 0
    ? `${hits}/${plans}`
    : runs.length > 0
      ? `${runs.length}`
      : '—'

  return (
    <div
      className={`wp-today wp-cell--${perf}`}
      role="cell"
      title={tooltip}
    >
      {/* Background "elapsed" bar — laat zien hoe ver de dag is */}
      <div className="wp-today__elapsed" style={{ width: `${nowPct}%` }} />

      {/* Hour-gridlines op 0/6/12/18 — geven dots een vaste tijd-context. */}
      {hourMarks.map(h => (
        <div key={`gl-${h.label}`} className="wp-today__gridline" style={{ left: `${h.pct}%` }} aria-hidden />
      ))}

      {/* Hour-labels onderaan */}
      <div className="wp-today__hours" aria-hidden>
        {hourMarks.map(h => (
          <span key={`hl-${h.label}`} className="wp-today__hour" style={{ left: `${h.pct}%` }}>{h.label}</span>
        ))}
        <span className="wp-today__hour wp-today__hour--end" style={{ left: '100%' }}>24</span>
      </div>

      {/* Now-marker met label */}
      <div className="wp-today__now" style={{ left: `${nowPct}%` }}>
        <span className="wp-today__now-label">
          {now.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Plan-misses — alleen tonen voor laag-frequentie agents. */}
      {visibleMisses.map((ts, i) => (
        <span
          key={`pm-${i}`}
          className="wp-today__plan-miss"
          style={{ left: `${xOf(ts)}%` }}
          title={`gepland ${new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · niet gedraaid`}
        />
      ))}

      {/* Runs — filled dots op tijd-positie (gesampled bij hoge frequentie). */}
      {visibleRuns.map((r, i) => {
        const t = new Date(r.started_at).getTime()
        return (
          <span
            key={r.id || `r-${i}`}
            className={`wp-today__dot wp-today__dot--${r.status}`}
            style={{ left: `${xOf(t)}%` }}
            title={`${new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · ${r.status}${r.summary ? ' — ' + r.summary.slice(0, 60) : ''}`}
          />
        )
      })}

      {/* Summary rechtsboven (met optionele miss/sample-hint) */}
      <div
        className="wp-today__summary"
        title={[missCountHint, sampledHint].filter(Boolean).join(' · ') || undefined}
      >
        {summary}
        {missCountHint && <span className="wp-today__summary-hint" aria-hidden> ⚠</span>}
      </div>
    </div>
  )
}
