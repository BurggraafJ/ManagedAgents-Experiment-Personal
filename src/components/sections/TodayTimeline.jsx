import { useMemo, useState } from 'react'

const STATUS_COLOR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error:   'var(--error)',
}

export default function TodayTimeline({ runs, schedules, nowDate }) {
  const now = nowDate || new Date()
  const start = new Date(now); start.setHours(6, 0, 0, 0)
  const end   = new Date(now); end.setHours(22, 0, 0, 0)

  // If now is before 6 or after 22, widen the window so "now" stays visible
  const effectiveStart = now < start ? new Date(now).setHours(Math.max(0, now.getHours() - 1), 0, 0, 0) : start.getTime()
  const effectiveEnd   = now > end   ? new Date(now).setHours(Math.min(23, now.getHours() + 1), 0, 0, 0) : end.getTime()

  const xOf = (ts) => {
    const t = typeof ts === 'number' ? ts : new Date(ts).getTime()
    return ((t - effectiveStart) / (effectiveEnd - effectiveStart)) * 100
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
    const HIDDEN = new Set(['dashboard-refresh', 'orchestrator', 'agent-manager'])
    return agentNames
      .filter(a => !HIDDEN.has(a))
      .map(a => {
        const sched = schedules.find(s => s.agent_name === a)
        return { agent_name: a, display_name: sched?.display_name || a, runs: byAgent[a] || [] }
      })
  }, [runs, schedules])

  const visibleRunCount = lanes.reduce((sum, l) => sum + l.runs.length, 0)

  const nowPct = xOf(now.getTime())

  if (lanes.every(l => l.runs.length === 0)) {
    return (
      <section id="vandaag">
        <div className="section__head">
          <h2 className="section__title">Vandaag</h2>
          <span className="section__hint">{formatTimeRange(effectiveStart, effectiveEnd)}</span>
        </div>
        <div className="empty">Nog geen runs vandaag.</div>
      </section>
    )
  }

  return (
    <section id="vandaag">
      <div className="section__head">
        <h2 className="section__title">Vandaag</h2>
        <span className="section__hint">{formatTimeRange(effectiveStart, effectiveEnd)} · {visibleRunCount} runs</span>
      </div>

      <div className="timeline">
        <div className="timeline__lanes">
          {lanes.map(lane => (
            <div key={lane.agent_name} className="timeline__lane">
              <div className="timeline__lane-name" title={lane.display_name}>{lane.display_name}</div>
              <div className="timeline__track">
                <div className="timeline__now" style={{ left: `${nowPct}%` }} />
                {lane.runs.map(r => {
                  const pct = xOf(r.started_at)
                  if (pct < 0 || pct > 100) return null
                  return (
                    <TimelineDot key={r.id || r.started_at} run={r} pct={pct} />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="timeline__axis">
          <div />
          <div className="timeline__axis-scale">
            {axisLabels(effectiveStart, effectiveEnd).map(label => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function TimelineDot({ run, pct }) {
  const [hover, setHover] = useState(false)
  const color = STATUS_COLOR[run.status] || 'var(--text-faint)'
  const tijd = new Date(run.started_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <span
        className="timeline__dot"
        style={{ left: `${pct}%`, background: color }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={`${tijd} · ${run.status}${run.summary ? ` — ${run.summary}` : ''}`}
      />
    </>
  )
}

function axisLabels(startMs, endMs) {
  const labels = []
  const hours = (endMs - startMs) / 3600000
  const step = hours >= 12 ? 3 : hours >= 6 ? 2 : 1
  const startH = new Date(startMs).getHours()
  const endH = new Date(endMs).getHours()
  for (let h = startH; h <= endH; h += step) {
    labels.push(`${String(h).padStart(2, '0')}:00`)
  }
  return labels
}

function formatTimeRange(startMs, endMs) {
  const fmt = (ms) => new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return `${fmt(startMs)} – ${fmt(endMs)}`
}
