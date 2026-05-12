import { useMemo } from 'react'
import { expandCronInRange, toleranceFor, matchRunsToPlans } from '../../../lib/cron'
import {
  HIDDEN_TIERS,
  HIDDEN_AGENTS,
  DAY_MS,
  startOfDay,
  dayLabel,
  shortDate,
} from '../../../lib/weekProgress'
import { agentTone, initialsOf } from '../../../lib/now'
import TodayTimeline from './TodayTimeline'

// Doel-vs-werkelijk — versie 5 (Maestro redesign).
//
// Layout per agent:
//   [avatar][naam + cron][big pct][3 dag-blokjes][today-timeline]
//
// Berekeningen (lanes/days/perf/runs) zijn ongewijzigd t.o.v. v4 —
// we vervangen alleen de JSX/CSS. TodayTimeline.jsx wordt hergebruikt.

export default function WeekProgress({ runs, schedules }) {
  const now = new Date()
  const todayStart = startOfDay(now).getTime()

  const lanes = useMemo(() => {
    return (schedules || [])
      .filter(s => s.enabled && !HIDDEN_TIERS.has(s.tier || 'primary'))
      .filter(s => !HIDDEN_AGENTS.has(s.agent_name))
      .map(s => {
        const fromTs = todayStart - 3 * DAY_MS
        const toTs   = now.getTime()
        const agentRuns = (runs || []).filter(r => {
          if (r.agent_name !== s.agent_name) return false
          const t = new Date(r.started_at).getTime()
          return t >= fromTs && t <= toTs
        })
        const plans = expandCronInRange(s.cron_expression, fromTs, toTs)
        const tolerance = toleranceFor(plans)
        const { planHit, runMatch } = matchRunsToPlans(agentRuns, plans, tolerance)

        const days = [3, 2, 1, 0].map(daysAgo => {
          const dayStart = todayStart - daysAgo * DAY_MS
          const dayEnd   = dayStart + DAY_MS
          const isToday  = daysAgo === 0

          let dayPlans = 0, dayHits = 0
          plans.forEach((ts, pi) => {
            if (ts >= dayStart && ts < dayEnd) {
              dayPlans++
              if (planHit[pi] !== null) dayHits++
            }
          })
          const dayRuns = agentRuns.filter(r => {
            const t = new Date(r.started_at).getTime()
            return t >= dayStart && t < dayEnd
          })
          const errors = dayRuns.filter(r => r.status === 'error').length
          const successes = dayRuns.filter(r => r.status === 'success').length

          let perf = 'idle'
          if (errors > 0 && (successes === 0 || errors / dayRuns.length >= 0.5)) {
            perf = 'error'
          } else if (dayPlans > 0) {
            const ratio = dayHits / dayPlans
            perf = ratio >= 0.85 ? 'ok' : ratio >= 0.5 ? 'warn' : 'miss'
          } else if (dayRuns.length > 0) {
            perf = errors > 0 ? 'warn' : 'ok'
          }

          const dayPlanMisses = []
          plans.forEach((ts, pi) => {
            if (ts >= dayStart && ts < dayEnd && planHit[pi] === null && ts <= now.getTime()) {
              dayPlanMisses.push(ts)
            }
          })

          return {
            daysAgo, isToday, perf,
            plans: dayPlans, hits: dayHits,
            runs: dayRuns,
            planMisses: dayPlanMisses,
            dayStart, dayEnd,
          }
        })

        const totalPlans = plans.length
        const totalHits  = planHit.reduce((c, x) => c + (x !== null ? 1 : 0), 0)
        const totalExtras = runMatch.reduce((c, x) => c + (x === null ? 1 : 0), 0)
        const totalPct   = totalPlans > 0 ? Math.round((totalHits / totalPlans) * 100) : null

        return { schedule: s, days, totalPlans, totalHits, totalExtras, totalPct }
      })
  }, [runs, schedules, todayStart])

  const totalPlans  = lanes.reduce((s, l) => s + l.totalPlans, 0)
  const totalHits   = lanes.reduce((s, l) => s + l.totalHits,  0)
  const overallPct  = totalPlans > 0 ? Math.round((totalHits / totalPlans) * 100) : null
  const overallTone = overallPct === null ? 'idle'
    : overallPct >= 85 ? 'ok'
    : overallPct >= 50 ? 'warn'
    : 'miss'

  if (lanes.length === 0) return null

  return (
    <section id="week-progress" className="now-section">
      <div className="now-section__head">
        <div className="now-section__head-left">
          <h2>Doel vs werkelijk <span>· laatste 4 dagen</span></h2>
          <span className="now-section__hint">
            {totalPlans > 0
              ? <>{totalHits} van {totalPlans} geplande runs gehaald</>
              : 'geen geplande runs deze periode'}
          </span>
        </div>
        {overallPct !== null && (
          <div className={`np-overall np-overall--${overallTone}`}>
            <div className="np-overall__pct">{overallPct}<span>%</span></div>
            <div className="np-overall__label">totaal</div>
          </div>
        )}
      </div>

      <div className="np-list">
        <div className="np-head" role="row" aria-hidden>
          <div className="np-head__name">Agent</div>
          <div className="np-head__score">Haalpct</div>
          <div className="np-head__days">
            <span>{shortDate(3)} <em>{dayLabel(3)}</em></span>
            <span>{shortDate(2)} <em>{dayLabel(2)}</em></span>
            <span>{shortDate(1)} <em>{dayLabel(1)}</em></span>
          </div>
          <div className="np-head__today">Vandaag <em>00:00 — nu</em></div>
        </div>

        {lanes.map(lane => (
          <Row key={lane.schedule.agent_name} lane={lane} now={now} />
        ))}
      </div>

      <Legend />
    </section>
  )
}

function Row({ lane, now }) {
  const { schedule, days, totalHits, totalPlans, totalExtras, totalPct } = lane
  const agent = schedule.agent_name
  const tone = agentTone(agent)
  const initials = initialsOf(schedule.display_name || agent)
  const scoreTone = totalPct === null ? 'idle'
    : totalPct >= 85 ? 'ok'
    : totalPct >= 50 ? 'warn'
    : 'miss'

  return (
    <div className="np-row">
      <div className="np-row__main">
        <div className={`np-row__avatar now-agent__icon--${tone}`}>{initials}</div>
        <div className="np-row__text">
          <div className="np-row__name">{schedule.display_name || agent}</div>
          <div className="np-row__sub">
            {schedule.cron_expression
              ? <><span className="np-row__cron">{schedule.cron_expression}</span></>
              : <span className="np-row__cron muted">on-demand</span>}
            {totalExtras > 0 && <span className="np-row__extras">· +{totalExtras} extra</span>}
          </div>
        </div>
      </div>

      <div className={`np-row__score np-row__score--${scoreTone}`}>
        {totalPct !== null ? (
          <>
            <div className="np-row__score-pct">{totalPct}<span>%</span></div>
            <div className="np-row__score-sub">{totalHits}/{totalPlans}</div>
          </>
        ) : (
          <>
            <div className="np-row__score-pct np-row__score-pct--idle">—</div>
            <div className="np-row__score-sub">{days.reduce((s, d) => s + d.runs.length, 0)} runs</div>
          </>
        )}
      </div>

      <div className="np-row__days">
        {days.slice(0, 3).map(d => (
          <DayChip key={d.daysAgo} day={d} agentName={schedule.display_name || agent} />
        ))}
      </div>

      <div className="np-row__today">
        <TodayTimeline day={days[3]} now={now} agentName={schedule.display_name || agent} />
      </div>
    </div>
  )
}

function DayChip({ day, agentName }) {
  const { perf, hits, plans, runs } = day
  const tooltip = plans > 0
    ? `${agentName} · ${hits}/${plans} gehaald${runs.length > plans ? ` · ${runs.length - plans} extra` : ''}`
    : runs.length > 0
      ? `${agentName} · ${runs.length} run${runs.length === 1 ? '' : 's'}`
      : `${agentName} · niets gepland`
  const main = plans > 0 ? `${hits}/${plans}` : runs.length > 0 ? `${runs.length}` : '—'
  return (
    <div className={`np-chip np-chip--${perf}`} title={tooltip}>
      {main}
    </div>
  )
}

function Legend() {
  return (
    <div className="np-legend">
      <span className="np-legend__item"><span className="np-legend__swatch np-legend__swatch--ok" />doel gehaald</span>
      <span className="np-legend__item"><span className="np-legend__swatch np-legend__swatch--warn" />deels</span>
      <span className="np-legend__item"><span className="np-legend__swatch np-legend__swatch--miss" />veel gemist</span>
      <span className="np-legend__item"><span className="np-legend__swatch np-legend__swatch--error" />errors</span>
      <span className="np-legend__item"><span className="wp-today__dot wp-today__dot--success np-legend__dot" />run vandaag</span>
      <span className="np-legend__item"><span className="wp-today__plan-miss np-legend__dot" />gepland · niet gedraaid</span>
    </div>
  )
}
