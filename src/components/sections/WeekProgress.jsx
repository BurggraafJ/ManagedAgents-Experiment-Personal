import { useMemo } from 'react'
import { expandCronInRange, toleranceFor, matchRunsToPlans } from '../../lib/cron'

// Prognose-vs-werkelijk — versie 3.
//
// Vorige versie toonde voor elke dag in de week een dichte stroom puntjes
// per cron-tijdstip. Voor oude dagen is dat alleen ruis — Jelle wil daar
// alleen "is het doel gehaald?" weten.
//
// Deze versie: per agent een rij met 7 dag-blokken (ma → zo). Elke cel
// kleurt op basis van hit-ratio + errors. Vandaag-cel heeft een ENKELE
// extra strip met de runs van vandaag (max 8 dots) — zo zie je in één
// blik hoe het de afgelopen runs ging.

const HIDDEN_TIERS = new Set(['infra', 'secondary', 'source'])
const HIDDEN_AGENTS = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])
const DAY_LABELS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

const DAY_MS = 86400000

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function computeMondayStart(d) {
  const ref = startOfDay(d)
  ref.setDate(ref.getDate() - ((ref.getDay() + 6) % 7))
  return ref
}

export default function WeekProgress({ runs, schedules, weekStart }) {
  const now = new Date()
  const todayIdx = (now.getDay() + 6) % 7
  const monday = weekStart ? new Date(weekStart) : computeMondayStart(now)

  const lanes = useMemo(() => {
    return (schedules || [])
      .filter(s => s.enabled && !HIDDEN_TIERS.has(s.tier || 'primary'))
      .filter(s => !HIDDEN_AGENTS.has(s.agent_name))
      .map(s => {
        const fromTs = monday.getTime()
        const toTs = Math.min(monday.getTime() + 7 * DAY_MS, now.getTime())
        const agentRuns = (runs || []).filter(r => r.agent_name === s.agent_name)
        const plans = expandCronInRange(s.cron_expression, fromTs, toTs)
        const tolerance = toleranceFor(plans)
        const { planHit, runMatch } = matchRunsToPlans(agentRuns, plans, tolerance)

        // Slice per dag-index (0..6)
        const days = Array.from({ length: 7 }, (_, dayIdx) => {
          const dayStart = monday.getTime() + dayIdx * DAY_MS
          const dayEnd   = dayStart + DAY_MS
          const isFuture = dayStart > now.getTime()
          const isToday  = dayIdx === todayIdx

          // Plans + hits binnen deze dag
          let dayPlans = 0
          let dayHits  = 0
          plans.forEach((ts, pi) => {
            if (ts >= dayStart && ts < dayEnd) {
              dayPlans++
              if (planHit[pi] !== null) dayHits++
            }
          })

          // Runs binnen deze dag (incl. extra/handmatig)
          const dayRuns = agentRuns.filter(r => {
            const t = new Date(r.started_at).getTime()
            return t >= dayStart && t < dayEnd
          })
          const errors = dayRuns.filter(r => r.status === 'error').length
          const successes = dayRuns.filter(r => r.status === 'success').length

          // Performance-classificatie voor de cel-kleur
          let perf = 'idle'
          if (isFuture) {
            perf = 'future'
          } else if (errors > 0 && (successes === 0 || errors / dayRuns.length >= 0.5)) {
            perf = 'error'
          } else if (dayPlans > 0) {
            const ratio = dayHits / dayPlans
            perf = ratio >= 0.85 ? 'ok' : ratio >= 0.5 ? 'warn' : 'miss'
          } else if (dayRuns.length > 0) {
            perf = errors > 0 ? 'warn' : 'ok'
          }

          return {
            dayIdx, isToday, isFuture, perf,
            plans: dayPlans, hits: dayHits,
            runs: dayRuns,
          }
        })

        const totalPlans = plans.length
        const totalHits  = planHit.reduce((c, x) => c + (x !== null ? 1 : 0), 0)
        const totalExtras = runMatch.reduce((c, x) => c + (x === null ? 1 : 0), 0)

        return {
          schedule: s,
          tolerance,
          totalPlans, totalHits, totalExtras,
          days,
        }
      })
  }, [runs, schedules, monday.getTime(), now.getTime()])

  const totalPlans   = lanes.reduce((s, l) => s + l.totalPlans, 0)
  const totalHits    = lanes.reduce((s, l) => s + l.totalHits,  0)
  const totalMissed  = totalPlans - totalHits
  const overallPct   = totalPlans > 0 ? Math.round((totalHits / totalPlans) * 100) : null

  if (lanes.length === 0) return null

  return (
    <section id="week-progress">
      <div className="section__head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <h2 className="section__title">Doel vs werkelijk</h2>
        <span className="section__hint">
          {totalPlans > 0
            ? <>{totalHits}/{totalPlans} gehaald{overallPct !== null && ` (${overallPct}%)`}{totalMissed > 0 && ` · ${totalMissed} gemist`}</>
            : 'geen geplande runs deze week'}
        </span>
      </div>

      <div className="card wp-card">
        <Legend />

        <div className="wp-grid" role="table" aria-label="Doel vs werkelijk per agent per dag">
          <div className="wp-grid__header" role="row">
            <div className="wp-grid__col-name" role="columnheader" />
            {DAY_LABELS.map((label, i) => (
              <div
                key={label}
                role="columnheader"
                className={`wp-grid__col-day ${i === todayIdx ? 'wp-grid__col-day--today' : ''}`}
              >
                <span className="wp-grid__day-label">{label}</span>
                {i === todayIdx && <span className="wp-grid__today-pill">vandaag</span>}
              </div>
            ))}
          </div>

          {lanes.map(lane => (
            <Row key={lane.schedule.agent_name} lane={lane} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Row({ lane }) {
  const { schedule, days, totalHits, totalPlans, totalExtras } = lane
  const summary = totalPlans > 0
    ? `${totalHits}/${totalPlans} (${Math.round((totalHits / totalPlans) * 100)}%)`
    : `${days.reduce((s, d) => s + d.runs.length, 0)} runs`

  return (
    <div className="wp-grid__row" role="row">
      <div className="wp-grid__name" role="rowheader" title={schedule.agent_name}>
        <span className="wp-grid__name-text">{schedule.display_name || schedule.agent_name}</span>
        <span className="wp-grid__name-summary">{summary}{totalExtras > 0 && ` · +${totalExtras}`}</span>
      </div>
      {days.map(d => <DayCell key={d.dayIdx} day={d} agentName={schedule.display_name || schedule.agent_name} />)}
    </div>
  )
}

function DayCell({ day, agentName }) {
  const { perf, hits, plans, runs, isToday, isFuture } = day

  // Tooltip-tekst
  const tooltip = (() => {
    if (isFuture) return `${agentName} · komt nog`
    if (plans > 0) return `${agentName} · ${hits}/${plans} gehaald${runs.length > plans ? ` · ${runs.length - plans} extra` : ''}`
    if (runs.length > 0) return `${agentName} · ${runs.length} run${runs.length === 1 ? '' : 's'}`
    return `${agentName} · niets gepland`
  })()

  // Voor vandaag: dots strip met max 8 runs
  const todayDots = isToday && runs.length > 0 ? (
    <div className="wp-cell__dots" aria-hidden>
      {runs.slice(-8).map((r, i) => (
        <span
          key={i}
          className={`wp-cell__dot wp-cell__dot--${r.status}`}
          title={`${new Date(r.started_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · ${r.status}`}
        />
      ))}
      {runs.length > 8 && <span className="wp-cell__dot-more">+{runs.length - 8}</span>}
    </div>
  ) : null

  // Hoofdtekst: hits/plans of run-count
  const mainText = isFuture
    ? '·'
    : plans > 0
      ? `${hits}/${plans}`
      : runs.length > 0
        ? `${runs.length}`
        : '—'

  return (
    <div
      className={`wp-cell wp-cell--${perf} ${isToday ? 'wp-cell--today' : ''}`}
      role="cell"
      title={tooltip}
    >
      <div className="wp-cell__main">{mainText}</div>
      {todayDots}
    </div>
  )
}

function Legend() {
  return (
    <div className="wp-legend">
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--ok" />goal gehaald</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--warn" />deels gehaald</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--miss" />veel gemist</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--error" />errors</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--idle" />geen plans</span>
    </div>
  )
}
