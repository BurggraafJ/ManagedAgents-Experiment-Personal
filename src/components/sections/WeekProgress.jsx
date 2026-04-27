import { useMemo } from 'react'
import { expandCronInRange, toleranceFor, matchRunsToPlans } from '../../lib/cron'

// Prognose-vs-werkelijk tijdlijn — versie 2 van WeekTimeline.
// Per primary agent een lane met:
//   - Open ringetje voor plan-tijdstippen ZONDER match-run binnen tolerantie
//   - Gevulde dot voor werkelijke runs (status-gekleurd)
//   - Lichte 'extra' marker voor runs zonder geplande tegenhanger (handmatig)
//
// Tolerantie schaalt mee met de cron-frequentie (zie lib/cron.js): voor een
// 5-min agent ~5 min, voor uurlijks ~30 min, voor dagelijks ~1u.

const STATUS_COLOR = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  error:   'var(--error)',
}

// We tonen alleen primary werk-agents — infra/secondary zou de visualisatie
// vol gooien met plumbing-runs (mail-sync elke 5 min, etc.).
const HIDDEN_TIERS = new Set(['infra', 'secondary'])
const DAY_LABELS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

function computeMondayStart(d) {
  const ref = new Date(d)
  const dayIdx = (ref.getDay() + 6) % 7
  ref.setDate(ref.getDate() - dayIdx)
  ref.setHours(0, 0, 0, 0)
  return ref
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('nl-NL', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function WeekProgress({ runs, schedules, weekStart }) {
  const now = new Date()
  const start = weekStart ? new Date(weekStart) : computeMondayStart(now)
  const end   = new Date(start.getTime() + 7 * 86400000)
  const range = end.getTime() - start.getTime()

  const xOf = (ts) => ((ts - start.getTime()) / range) * 100

  const lanes = useMemo(() => {
    return (schedules || [])
      .filter(s => s.enabled && !HIDDEN_TIERS.has(s.tier || 'primary'))
      .filter(s => !['orchestrator', 'dashboard-refresh', 'agent-manager'].includes(s.agent_name))
      .map(s => {
        const fromTs = start.getTime()
        // Plans tot NU — toekomst is nog geen "gemist" ('zal nog komen').
        const toTs = Math.min(end.getTime(), now.getTime())
        const agentRuns = (runs || []).filter(r => r.agent_name === s.agent_name)
        const plans = expandCronInRange(s.cron_expression, fromTs, toTs)
        const tolerance = toleranceFor(plans)
        const { planHit, runMatch } = matchRunsToPlans(agentRuns, plans, tolerance)
        const hits = planHit.reduce((c, x) => c + (x !== null ? 1 : 0), 0)
        const missed = plans.length - hits
        const extras = runMatch.reduce((c, x) => c + (x === null ? 1 : 0), 0)
        return {
          schedule: s,
          agentRuns,
          plans,
          planHit,
          runMatch,
          tolerance,
          hits,
          missed,
          extras,
        }
      })
  }, [runs, schedules, start])

  const totalPlans  = lanes.reduce((s, l) => s + l.plans.length, 0)
  const totalHits   = lanes.reduce((s, l) => s + l.hits,        0)
  const totalMissed = lanes.reduce((s, l) => s + l.missed,      0)
  const totalExtras = lanes.reduce((s, l) => s + l.extras,      0)
  const overallPct  = totalPlans > 0 ? Math.round((totalHits / totalPlans) * 100) : null

  const nowPct = Math.max(0, Math.min(100, xOf(now.getTime())))
  const dayBoundaries = [1, 2, 3, 4, 5, 6].map(i => (i / 7) * 100)

  if (lanes.length === 0) {
    return null  // niets te tonen, valt onder bestaande WeekTimeline
  }

  return (
    <section id="week-progress">
      <div className="section__head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <h2 className="section__title">Prognose vs werkelijk</h2>
        <span className="section__hint">
          {totalPlans > 0 && (
            <>
              {totalHits}/{totalPlans} gehaald
              {overallPct !== null && ` (${overallPct}%)`}
              {totalMissed > 0 && ` · ${totalMissed} gemist`}
              {totalExtras > 0 && ` · ${totalExtras} extra/handmatig`}
            </>
          )}
          {totalPlans === 0 && 'geen geplande runs in deze week'}
        </span>
      </div>

      <div className="card" style={{ padding: 'var(--s-4)' }}>
        <Legend />

        <div className="timeline timeline--week" style={{ marginTop: 12 }}>
          <div className="timeline__lanes">
            {lanes.map(l => (
              <Lane
                key={l.schedule.agent_name}
                lane={l}
                xOf={xOf}
                nowPct={nowPct}
                dayBoundaries={dayBoundaries}
              />
            ))}
          </div>

          <div className="timeline__axis">
            <div />
            <div className="timeline__axis-scale timeline__axis-scale--week">
              {DAY_LABELS.map((label, i) => (
                <span
                  key={label}
                  className={i === ((now.getDay() + 6) % 7) ? 'timeline__axis-today' : ''}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Lane({ lane, xOf, nowPct, dayBoundaries }) {
  const { schedule, agentRuns, plans, planHit, runMatch, tolerance, hits, missed, extras } = lane

  // Score-tekst: aantal gehaald / aantal gepland; '-' als geen plans
  let score = '—'
  let scoreClass = ''
  if (plans.length > 0) {
    score = `${hits}/${plans.length}`
    if (hits === plans.length) scoreClass = 'wp-score--ok'
    else if (hits / plans.length >= 0.7) scoreClass = 'wp-score--warn'
    else scoreClass = 'wp-score--err'
  } else if (agentRuns.length > 0) {
    score = `${agentRuns.length} run${agentRuns.length === 1 ? '' : 's'}`
  }

  const cronHint = `cron ${schedule.cron_expression} · tolerantie ${Math.round(tolerance / 60000)}m`

  return (
    <div className="timeline__lane">
      <div
        className="timeline__lane-name"
        title={cronHint}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {schedule.display_name || schedule.agent_name}
        </span>
        <span className={`wp-score ${scoreClass}`} title={`${hits} gehaald · ${missed} gemist · ${extras} extra`}>
          {score}
        </span>
      </div>

      <div className="timeline__track">
        {dayBoundaries.map((pct, i) => (
          <div key={i} className="timeline__gridline" style={{ left: `${pct}%` }} />
        ))}
        <div className="timeline__now" style={{ left: `${nowPct}%` }} />

        {/* Plan-punten zonder match — open ring (gemist) */}
        {plans.map((ts, pi) => {
          if (planHit[pi] !== null) return null
          const pct = xOf(ts)
          if (pct < 0 || pct > 100) return null
          return (
            <span
              key={`p-${pi}`}
              className="wp-plan-miss"
              style={{ left: `${pct}%` }}
              title={`Gepland: ${fmtTime(ts)} — niet gedraaid (binnen ±${Math.round(tolerance / 60000)}m)`}
            />
          )
        })}

        {/* Werkelijke runs — gevulde cirkel met status-kleur */}
        {agentRuns.map((r, ri) => {
          const t = typeof r.started_at === 'string' ? new Date(r.started_at).getTime() : r.started_at
          const pct = xOf(t)
          if (pct < 0 || pct > 100) return null
          const matched = runMatch[ri] !== null
          const color = STATUS_COLOR[r.status] || 'var(--text-faint)'
          const planTs = matched ? plans[runMatch[ri]] : null
          const drift = matched ? Math.round((t - planTs) / 60000) : null
          const driftLabel = matched
            ? (drift === 0 ? 'op tijd' : `${drift > 0 ? '+' : ''}${drift}m van plan`)
            : 'extra · geen plan'
          return (
            <span
              key={r.id || `r-${ri}`}
              className={`wp-run ${matched ? 'wp-run--matched' : 'wp-run--extra'}`}
              style={{ left: `${pct}%`, background: matched ? color : 'transparent', borderColor: matched ? 'transparent' : color }}
              title={`${fmtTime(t)} · ${r.status} · ${driftLabel}${r.summary ? ' — ' + r.summary : ''}`}
            />
          )
        })}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="wp-legend">
      <span className="wp-legend__item">
        <span className="wp-run wp-run--matched wp-legend__swatch" style={{ background: 'var(--success)' }} />
        gedraaid op tijd
      </span>
      <span className="wp-legend__item">
        <span className="wp-plan-miss wp-legend__swatch" />
        gepland · niet gedraaid
      </span>
      <span className="wp-legend__item">
        <span className="wp-run wp-run--extra wp-legend__swatch" style={{ borderColor: 'var(--text-muted)' }} />
        extra / handmatig
      </span>
    </div>
  )
}
