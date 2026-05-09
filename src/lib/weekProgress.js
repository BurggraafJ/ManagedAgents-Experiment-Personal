// Pure helpers + constants voor WeekProgress section.

export const HIDDEN_TIERS = new Set(['infra', 'secondary', 'source'])
export const HIDDEN_AGENTS = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

export const DAY_MS = 86400000

// Plan-misses (open ringen) en run-dots worden onleesbaar voor hoge-frequentie
// agents (auto-draft = 96 runs/dag). Daarom:
//   - Plan-misses: alleen tonen tot <= PLAN_MISS_DAILY_LIMIT/dag
//   - Run-dots: subsamplen tot maximaal MAX_DOTS — errors/warnings altijd los,
//     success-runs uniform sampled over de tijdas
export const PLAN_MISS_DAILY_LIMIT = 12
export const MAX_DOTS = 24

export function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}

export function dayLabel(daysAgo) {
  if (daysAgo === 0) return 'vandaag'
  if (daysAgo === 1) return 'gisteren'
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('nl-NL', { weekday: 'short' })
}

export function shortDate(daysAgo) {
  const d = new Date(); d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export function downsampleRuns(runs) {
  if (runs.length <= MAX_DOTS) return runs
  const critical = runs.filter(r => r.status === 'error' || r.status === 'warning' || r.status === 'running')
  const successes = runs.filter(r => r.status === 'success')

  const target = Math.max(0, MAX_DOTS - critical.length)
  if (target === 0 || successes.length === 0) return critical

  // Uniform sampling over success-runs op tijd-volgorde — geeft een
  // gelijkmatig verspreide reeks ipv clusters.
  const sorted = [...successes].sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
  const stride = sorted.length / target
  const sampled = []
  for (let i = 0; i < target; i++) {
    sampled.push(sorted[Math.floor(i * stride)])
  }
  return [...sampled, ...critical]
}
