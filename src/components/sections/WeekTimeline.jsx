import { useMemo } from 'react'

const STATUS_COLOR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error:   'var(--error)',
}

const HIDDEN = new Set(['dashboard-refresh', 'orchestrator', 'agent-manager'])
const DAY_LABELS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

/**
 * Toont per agent een 7-dag strip (maandag → zondag van huidige week).
 * Dots staan op de juiste dag+uur-positie. "Now"-line laat zien waar we
 * vandaag staan in de week.
 */
export default function WeekTimeline({ runs, schedules, weekStart }) {
  const now = new Date()
  const start = weekStart ? new Date(weekStart) : computeMondayStart(now)
  const end   = new Date(start.getTime() + 7 * 86400000)
  const range = end.getTime() - start.getTime()

  const xOf = (ts) => {
    const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
    return ((t - start.getTime()) / range) * 100
  }

  const lanes = useMemo(() => {
    const agentNames = Array.from(new Set([
      ...schedules.filter(s => s.enabled).map(s => s.agent_name),
      ...runs.map(r => r.agent_name),
    ]))
    const byAgent = Object.fromEntries(agentNames.map(a => [a, []]))
    runs.forEach(r => {
      if (!byAgent[r.agent_name]) byAgent[r.agent_name] = []
      byAgent[r.agent_name].push(r)
    })
    return agentNames
      .filter(a => !HIDDEN.has(a))
      .map(a => {
        const sched = schedules.find(s => s.agent_name === a)
        return { agent_name: a, display_name: sched?.display_name || a, runs: byAgent[a] || [] }
      })
  }, [runs, schedules])

  const visibleRunCount = lanes.reduce((sum, l) => sum + l.runs.length, 0)
  const nowPct = Math.max(0, Math.min(100, xOf(now.getTime())))

  // Dag-grens pos voor gridlines (elke dag)
  const dayBoundaries = [0, 1, 2, 3, 4, 5, 6, 7].map(i => (i / 7) * 100)

  if (lanes.every(l => l.runs.length === 0)) {
    return (
      <section id="week-activity">
        <div className="section__head">
          <h2 className="section__title">Deze week</h2>
          <span className="section__hint">{formatWeekLabel(start)} · activiteit</span>
        </div>
        <div className="empty">Nog geen runs deze week.</div>
      </section>
    )
  }

  return (
    <section id="week-activity">
      <div className="section__head">
        <h2 className="section__title">Deze week</h2>
        <span className="section__hint">{formatWeekLabel(start)} · {visibleRunCount} runs</span>
      </div>

      <div className="timeline timeline--week">
        <div className="timeline__lanes">
          {lanes.map(lane => (
            <div key={lane.agent_name} className="timeline__lane">
              <div className="timeline__lane-name" title={lane.display_name}>{lane.display_name}</div>
              <div className="timeline__track">
                {/* dag-grens-lijnen */}
                {dayBoundaries.slice(1, -1).map((pct, i) => (
                  <div key={i} className="timeline__gridline" style={{ left: `${pct}%` }} />
                ))}
                <div className="timeline__now" style={{ left: `${nowPct}%` }} />
                {lane.runs.map(r => {
                  const pct = xOf(r.started_at)
                  if (pct < 0 || pct > 100) return null
                  return <TimelineDot key={r.id || r.started_at} run={r} pct={pct} />
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="timeline__axis">
          <div />
          <div className="timeline__axis-scale timeline__axis-scale--week">
            {DAY_LABELS.map((label, i) => {
              const isToday = i === getWeekdayIndex(now)
              return (
                <span key={label} className={isToday ? 'timeline__axis-today' : ''}>
                  {label}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function TimelineDot({ run, pct }) {
  const color = STATUS_COLOR[run.status] || 'var(--text-faint)'
  const d = new Date(run.started_at)
  const label = d.toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <span
      className="timeline__dot"
      style={{ left: `${pct}%`, background: color }}
      title={`${label} · ${run.status}${run.summary ? ` — ${run.summary}` : ''}`}
    />
  )
}

/** Maandag 00:00 lokale tijd van de week waarin `d` valt. */
function computeMondayStart(d) {
  const ref = new Date(d)
  const dayIdx = (ref.getDay() + 6) % 7 // 0 = ma .. 6 = zo
  ref.setDate(ref.getDate() - dayIdx)
  ref.setHours(0, 0, 0, 0)
  return ref
}

function getWeekdayIndex(d) {
  return (d.getDay() + 6) % 7
}

function formatWeekLabel(monday) {
  const sun = new Date(monday.getTime() + 6 * 86400000)
  const fmt = (x) => x.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
  return `${fmt(monday)} – ${fmt(sun)}`
}
