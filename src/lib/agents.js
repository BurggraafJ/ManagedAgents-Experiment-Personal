// Pure helpers voor agent-runs / -schedules / -questions data.
// Geen React; geen Supabase. Wordt gebruikt door hooks/useAgents.js.

const DAY = 86400000

export function emptyStats() {
  return { runs: 0, drafts: 0, connects: 0, deals: 0 }
}

export function addStats(acc, run) {
  acc.runs++
  const s = run.stats || {}
  if (s.drafts_created) acc.drafts += Number(s.drafts_created) || 0
  if (s.connects_sent) acc.connects += Number(s.connects_sent) || 0
  if (s.deals_updated) acc.deals += Number(s.deals_updated) || 0
}

/**
 * Bereken alle afgeleide views op runs / runHistory / schedules / questions.
 * Geen side-effects; geschikt voor useMemo.
 */
export function deriveAgentsState({ runs, runHistory, schedules, questions }) {
  const now = new Date()
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)
  const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY)

  const latestRuns = {}
  runs.forEach(r => { if (!latestRuns[r.agent_name]) latestRuns[r.agent_name] = r })

  const history = {}
  runHistory.forEach(r => {
    if (!history[r.agent_name]) history[r.agent_name] = []
    if (history[r.agent_name].length < 7) history[r.agent_name].push(r.status)
  })
  Object.keys(history).forEach(a => {
    history[a].reverse()
    while (history[a].length < 7) history[a].unshift('empty')
  })

  const todayRuns = runs.filter(r => new Date(r.started_at) >= dayStart)
  const weekRuns = runs.filter(r => new Date(r.started_at) >= weekStart)
  const rangeRuns = runs.filter(r => new Date(r.started_at) >= new Date(now.getTime() - 180 * DAY))
  const recentRuns = runs.slice(0, 30)

  const weekStats = emptyStats()
  const lastWeekStats = emptyStats()
  runs.forEach(r => {
    if (r.agent_name === 'orchestrator') return
    const t = new Date(r.started_at)
    if (r.status !== 'success' && r.status !== 'warning') return
    if (t >= weekStart) addStats(weekStats, r)
    else if (t >= lastWeekStart && t < weekStart) addStats(lastWeekStats, r)
  })

  const overdueSchedules = schedules.filter(s => {
    if (!s.enabled || s.is_running) return false
    if (!s.next_run_at) return false
    return new Date(s.next_run_at) < now
  })
  const runningSchedules = schedules.filter(s => s.is_running)
  const nextRun = schedules
    .filter(s => s.enabled && s.next_run_at && new Date(s.next_run_at) > now)
    .sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0] || null

  const questionsWithUrgency = questions.map(qu => {
    const asked = new Date(qu.asked_at)
    const expires = qu.expires_at ? new Date(qu.expires_at) : null
    const daysOpen = Math.floor((now - asked) / DAY)
    let urgency = 'ok'
    if (expires && now > expires) urgency = 'expired'
    else if (expires && now > new Date(expires - DAY)) urgency = 'urgent'
    else if (daysOpen >= 3) urgency = 'warning'
    return { ...qu, days_open: daysOpen, urgency }
  })

  return {
    latestRuns,
    history,
    todayRuns,
    weekRuns,
    rangeRuns,
    recentRuns,
    weekStart,
    weekStats,
    lastWeekStats,
    overdueSchedules,
    runningSchedules,
    nextRun,
    questions: questionsWithUrgency,
  }
}
