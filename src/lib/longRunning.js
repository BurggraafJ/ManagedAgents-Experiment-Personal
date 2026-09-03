// longRunning — waar draait een geplande taak écht, en hoe lang doet hij erover.
//
// Bron: view `v_agent_runs_summary` (één rij per agent_schedules-rij, met de
// laatste run erbij gejoind). De view heeft geen "uitvoerder"-kolom, dus die
// leiden we af uit `last_stats.triggered_by` — het veld dat de taak zelf bij
// zijn laatste run heeft weggeschreven. Geen gok: is het veld leeg, dan is de
// uitvoerder `unknown` en zeggen we dat ook.
//
// Waarom dit onderscheid ertoe doet: taken in de bucket `claude` worden
// uitgevoerd door één externe Claude-routine (de agent-orchestrator poller).
// Die routine bestaat precies één keer voor de hele organisatie, dus die
// bucket schaalt niet mee met het aantal gebruikers. De bucket `app` draait
// op pg_cron → Edge Function en heeft geen Claude-sessie nodig.

export const RUNNERS = {
  claude: {
    label: 'Claude Cloud',
    sub: 'Buiten de app — één externe Claude-routine voert de SKILL.md uit',
    tone: 'warning',
  },
  app: {
    label: 'In de app',
    sub: 'pg_cron → Edge Function — geen Claude-sessie nodig',
    tone: 'success',
  },
  unknown: {
    label: 'Onbekend',
    sub: 'Geen run met een herkenbare trigger — nog niet vast te stellen',
    tone: 'idle',
  },
  off: {
    label: 'Uit',
    sub: 'enabled = false — staat in de planning, draait niet',
    tone: 'idle',
  },
}

export const RUNNER_ORDER = ['claude', 'app', 'unknown', 'off']

// stats.triggered_by-waarden zoals ze feitelijk in agent_runs voorkomen.
const APP_TRIGGERS = new Set(['pg_cron', 'edge_cron', 'pg_cron_fallback'])
const CLAUDE_TRIGGERS = new Set([
  'orchestrator', 'orchestrator_catchup', 'scheduled-task', 'manual', 'manual_run_request',
])

export function runnerOf(row) {
  if (row.enabled === false) return 'off'
  const t = row.last_stats?.triggered_by
  if (t && APP_TRIGGERS.has(t)) return 'app'
  if (t && CLAUDE_TRIGGERS.has(t)) return 'claude'
  return 'unknown'
}

// Achterstallig = ingeschakeld, draait niet, en de geplande tijd is meer dan
// GRACE_MS verstreken. De grace-marge dekt de poll-interval van de poller.
const GRACE_MS = 15 * 60 * 1000

export function overdueMs(row, now = Date.now()) {
  if (row.enabled === false || row.is_running) return 0
  if (!row.next_run_at) return 0
  const late = now - new Date(row.next_run_at).getTime()
  return late > GRACE_MS ? late : 0
}

// Een run van ≥ 10 minuten is "long running" in de zin van deze pagina: hij
// overleeft geen enkele Edge-Function-invocatie (die stopt rond 150 s) en
// bezet de poller waar andere taken achter in de rij staan.
export const LONG_RUN_S = 600

export function isLongRun(row) {
  return typeof row.last_duration_s === 'number' && row.last_duration_s >= LONG_RUN_S
}

// Sommige skills schrijven completed_at vóór started_at (tijdzone-fout in hun
// eigen agent_runs-insert). Dat geeft een negatieve duur — die tonen we niet
// als getal, maar als expliciet "onbetrouwbaar".
export function isBadDuration(row) {
  return typeof row.last_duration_s === 'number' && row.last_duration_s < 0
}

export function durationLabel(row) {
  const s = row.last_duration_s
  if (typeof s !== 'number') return '—'
  if (s < 0) return 'onbetrouwbaar'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rest = s % 60
  return rest === 0 ? `${m}m` : `${m}m ${rest}s`
}

export function lateLabel(ms) {
  const min = Math.floor(ms / 60000)
  if (min < 90) return `${min} min te laat`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} uur te laat`
  return `${Math.floor(h / 24)} dagen te laat`
}

// Een taak die 20 min achterloopt op een */15-ritme is niet stuk — dat is de
// poll-interval van de poller. Pas vanaf twee uur is er echt iets mis.
const LATE_CRITICAL_MS = 2 * 60 * 60 * 1000

export function lateTone(ms) {
  if (ms <= 0) return null
  return ms >= LATE_CRITICAL_MS ? 'error' : 'warning'
}

// Compacte variant voor de mobiele rij-pill (smalle kolom, mono-font).
export function lateShort(ms) {
  const min = Math.floor(ms / 60000)
  if (min < 90) return `${min}m laat`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}u laat`
  return `${Math.floor(h / 24)}d laat`
}

export const STATUS_TONE = { success: 'success', warning: 'warning', error: 'error' }

export function summarizeLongRunning(rows, now = Date.now()) {
  const byRunner = { claude: 0, app: 0, unknown: 0, off: 0 }
  let overdue = 0
  let stalled = 0
  let long = 0
  let running = 0
  for (const r of rows) {
    byRunner[runnerOf(r)] += 1
    const late = overdueMs(r, now)
    if (late > 0) overdue += 1
    if (lateTone(late) === 'error') stalled += 1
    if (isLongRun(r)) long += 1
    if (r.is_running) running += 1
  }
  return { total: rows.length, byRunner, overdue, stalled, long, running }
}

// Zwaarste eerst: achterstallig, dan lang, dan laatste status, dan naam.
const STATUS_RANK = { error: 0, warning: 1, success: 2 }

export function sortForReview(rows, now = Date.now()) {
  return [...rows].sort((a, b) => {
    const la = overdueMs(a, now)
    const lb = overdueMs(b, now)
    if (la !== lb) return lb - la
    if (isLongRun(a) !== isLongRun(b)) return isLongRun(a) ? -1 : 1
    const sa = STATUS_RANK[a.last_status] ?? 3
    const sb = STATUS_RANK[b.last_status] ?? 3
    if (sa !== sb) return sa - sb
    return (a.display_name || a.agent_name).localeCompare(b.display_name || b.agent_name)
  })
}
