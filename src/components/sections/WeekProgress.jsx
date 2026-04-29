import { useMemo } from 'react'
import { expandCronInRange, toleranceFor, matchRunsToPlans } from '../../lib/cron'

// Doel-vs-werkelijk — versie 4.
//
// Layout: per agent een rij met
//   [ Naam ] [ -3d ] [ -2d ] [ -1d ] [ ───────────  vandaag-timeline  ─────────── ]
//
// De drie oude dagen tonen alleen "is doel gehaald"-blok (klein).
// Vandaag is een tijdlijn-strip die de overgebleven breedte pakt: dots
// op tijd-percentage (00:00 → nu) zodat je in één blik ziet hoe vaak
// de agent vandaag draaide en wat de status was.

const HIDDEN_TIERS = new Set(['infra', 'secondary', 'source'])
const HIDDEN_AGENTS = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

const DAY_MS = 86400000

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function dayLabel(daysAgo) {
  if (daysAgo === 0) return 'vandaag'
  if (daysAgo === 1) return 'gisteren'
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('nl-NL', { weekday: 'short' })
}
function shortDate(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export default function WeekProgress({ runs, schedules }) {
  const now = new Date()
  const todayStart = startOfDay(now).getTime()

  const lanes = useMemo(() => {
    return (schedules || [])
      .filter(s => s.enabled && !HIDDEN_TIERS.has(s.tier || 'primary'))
      .filter(s => !HIDDEN_AGENTS.has(s.agent_name))
      .map(s => {
        // Window: 3 dagen terug t/m nu
        const fromTs = todayStart - 3 * DAY_MS
        const toTs   = now.getTime()
        const agentRuns = (runs || []).filter(r => {
          const t = new Date(r.started_at).getTime()
          return t >= fromTs && t <= toTs
        })
        const plans = expandCronInRange(s.cron_expression, fromTs, toTs)
        const tolerance = toleranceFor(plans)
        const { planHit, runMatch } = matchRunsToPlans(agentRuns, plans, tolerance)

        // Per dag: -3, -2, -1, 0
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

          // Voor vandaag-timeline: ook plan-misses bewaren (niet alleen runs)
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

        return { schedule: s, days, totalPlans, totalHits, totalExtras }
      })
  }, [runs, schedules, todayStart])

  const totalPlans  = lanes.reduce((s, l) => s + l.totalPlans, 0)
  const totalHits   = lanes.reduce((s, l) => s + l.totalHits,  0)
  const overallPct  = totalPlans > 0 ? Math.round((totalHits / totalPlans) * 100) : null

  if (lanes.length === 0) return null

  return (
    <section id="week-progress">
      <div className="section__head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <h2 className="section__title">Doel vs werkelijk</h2>
        <span className="section__hint">
          {totalPlans > 0
            ? <>Afgelopen 4 dagen: {totalHits}/{totalPlans} gehaald{overallPct !== null && ` (${overallPct}%)`}</>
            : 'geen geplande runs deze periode'}
        </span>
      </div>

      <div className="panel panel--accent-blue wp-panel">
        <Legend />

        <div className="wp-grid-v2" role="table" aria-label="Doel vs werkelijk per agent">
          <div className="wp-grid-v2__header" role="row">
            <div /> {/* naam-kolom */}
            <div className="wp-day-head">{shortDate(3)}<span>{dayLabel(3)}</span></div>
            <div className="wp-day-head">{shortDate(2)}<span>{dayLabel(2)}</span></div>
            <div className="wp-day-head">{shortDate(1)}<span>{dayLabel(1)}</span></div>
            <div className="wp-day-head wp-day-head--today">
              <span className="wp-day-head__today-pill">vandaag</span>
              <span className="wp-day-head__times">00:00 — nu</span>
            </div>
          </div>

          {lanes.map(lane => (
            <Row key={lane.schedule.agent_name} lane={lane} now={now} />
          ))}
        </div>
      </div>
    </section>
  )
}

function Row({ lane, now }) {
  const { schedule, days, totalHits, totalPlans, totalExtras } = lane
  const summary = totalPlans > 0
    ? `${totalHits}/${totalPlans}`
    : `${days.reduce((s, d) => s + d.runs.length, 0)} runs`

  return (
    <div className="wp-grid-v2__row" role="row">
      <div className="wp-grid-v2__name" role="rowheader" title={schedule.agent_name}>
        <span className="wp-grid-v2__name-text">{schedule.display_name || schedule.agent_name}</span>
        <span className="wp-grid-v2__name-summary">{summary}{totalExtras > 0 && ` · +${totalExtras}`}</span>
      </div>
      {days.slice(0, 3).map(d => <SmallDayCell key={d.daysAgo} day={d} agentName={schedule.display_name || schedule.agent_name} />)}
      <TodayTimeline day={days[3]} now={now} agentName={schedule.display_name || schedule.agent_name} />
    </div>
  )
}

function SmallDayCell({ day, agentName }) {
  const { perf, hits, plans, runs } = day
  const tooltip = plans > 0
    ? `${agentName} · ${hits}/${plans} gehaald${runs.length > plans ? ` · ${runs.length - plans} extra` : ''}`
    : runs.length > 0
      ? `${agentName} · ${runs.length} run${runs.length === 1 ? '' : 's'}`
      : `${agentName} · niets gepland`
  const main = plans > 0 ? `${hits}/${plans}` : runs.length > 0 ? `${runs.length}` : '—'
  return (
    <div className={`wp-cell wp-cell--small wp-cell--${perf}`} role="cell" title={tooltip}>
      <div className="wp-cell__main">{main}</div>
    </div>
  )
}

// Cluster plan-misses zodat hoge-frequentie agents (auto-draft = elke 5 min,
// = 96 plans per dag) niet de hele timeline vol drukken met open ringen.
function clusterPlanMisses(planMisses, dayStart) {
  if (planMisses.length === 0) return []
  if (planMisses.length <= 12) {
    return planMisses.map(ts => ({ ts, count: 1 }))
  }
  const buckets = new Map()
  for (const ts of planMisses) {
    const hour = Math.floor((ts - dayStart) / 3600000)
    if (!buckets.has(hour)) buckets.set(hour, { ts, count: 0 })
    buckets.get(hour).count++
  }
  return Array.from(buckets.entries()).map(([hour, { count }]) => ({
    ts: dayStart + hour * 3600000 + 1800000,
    count,
  }))
}

// Cluster runs ook bij hoge frequentie. Errors/warnings altijd los tonen
// — die wil je individueel kunnen zien. Success-runs > drempel → per uur
// samengevat tot één dot met count.
function clusterRuns(runs, dayStart) {
  if (runs.length <= 24) return runs.map(r => ({ ...r, count: 1, isCluster: false }))
  const buckets = new Map()
  const standalone = []
  for (const r of runs) {
    if (r.status !== 'success') {
      standalone.push({ ...r, count: 1, isCluster: false })
      continue
    }
    const ts = new Date(r.started_at).getTime()
    const hour = Math.floor((ts - dayStart) / 3600000)
    if (!buckets.has(hour)) buckets.set(hour, [])
    buckets.get(hour).push(r)
  }
  const clustered = Array.from(buckets.entries()).map(([hour, hourRuns]) => ({
    id: `cluster-${hour}`,
    started_at: new Date(dayStart + hour * 3600000 + 1800000).toISOString(),
    status: 'success',
    count: hourRuns.length,
    isCluster: true,
    summary: `${hourRuns.length} runs in dit uur`,
  }))
  return [...clustered, ...standalone]
}

function TodayTimeline({ day, now, agentName }) {
  const { dayStart, plans, hits, runs, planMisses, perf } = day
  const elapsedMs = now.getTime() - dayStart
  const nowPct = Math.max(0, Math.min(100, (elapsedMs / DAY_MS) * 100))

  const xOf = (ts) => Math.max(0, Math.min(100, ((ts - dayStart) / DAY_MS) * 100))
  const clusteredMisses = clusterPlanMisses(planMisses, dayStart)
  const clusteredRuns = clusterRuns(runs, dayStart)

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

      {/* Now-marker */}
      <div className="wp-today__now" style={{ left: `${nowPct}%` }} />

      {/* Plan-misses (open rings, geclusterd voor hoge-frequentie agents) */}
      {clusteredMisses.map(({ ts, count }, i) => (
        <span
          key={`pm-${i}`}
          className={`wp-today__plan-miss ${count > 1 ? 'wp-today__plan-miss--cluster' : ''}`}
          style={{ left: `${xOf(ts)}%` }}
          title={count > 1
            ? `${count} geplande runs gemist rond ${new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
            : `gepland ${new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · niet gedraaid`}
        >
          {count > 1 && <span className="wp-today__plan-miss-count">{count}</span>}
        </span>
      ))}

      {/* Runs (filled dots, geclusterd bij hoge frequentie) */}
      {clusteredRuns.map((r, i) => {
        const t = new Date(r.started_at).getTime()
        return (
          <span
            key={r.id || `r-${i}`}
            className={`wp-today__dot wp-today__dot--${r.status} ${r.isCluster ? 'wp-today__dot--cluster' : ''}`}
            style={{ left: `${xOf(t)}%` }}
            title={r.isCluster
              ? `${r.count} runs rond ${new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · ${r.status}`
              : `${new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · ${r.status}${r.summary ? ' — ' + r.summary.slice(0, 60) : ''}`}
          >
            {r.isCluster && r.count > 1 && <span className="wp-today__dot-count">{r.count}</span>}
          </span>
        )
      })}

      {/* Summary rechtsboven */}
      <div className="wp-today__summary">{summary}</div>
    </div>
  )
}

function Legend() {
  return (
    <div className="wp-legend">
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--ok" />goal gehaald</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--warn" />deels</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--miss" />veel gemist</span>
      <span className="wp-legend__item"><span className="wp-legend__swatch wp-legend__swatch--error" />errors</span>
      <span className="wp-legend__item"><span className="wp-today__dot wp-today__dot--success wp-legend__swatch-dot" />run vandaag</span>
      <span className="wp-legend__item"><span className="wp-today__plan-miss wp-legend__swatch-dot" />gepland · niet gedraaid</span>
    </div>
  )
}
