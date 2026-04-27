// Lichtgewicht cron-expander voor de Dashboard. Ondersteunt de syntax die
// in `agent_schedules.cron_expression` voorkomt:
//
//   minute hour day month dayofweek
//
// Velden mogen zijn: '*', een integer, een range 'a-b', een step '*/n' of
// 'a-b/n', of een lijst 'a,b,c'. Geen named-aliases (MON, JAN), geen 'L'/'#'.
//
// Doel: voor de WeekProgress-widget berekenen welke tijdstippen een agent
// volgens zijn cron HAD moeten draaien — onafhankelijk van of hij echt
// gedraaid heeft. Zodat we plan vs werkelijk kunnen visualiseren.

function expandField(field, min, max) {
  const out = new Set()
  if (field === '*') {
    for (let i = min; i <= max; i++) out.add(i)
    return out
  }
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/)
    if (stepMatch) {
      const range = stepMatch[1]
      const step  = +stepMatch[2]
      let lo = min, hi = max
      if (range !== '*') {
        const dash = range.split('-').map(Number)
        lo = dash[0]
        hi = dash.length > 1 ? dash[1] : max
      }
      for (let i = lo; i <= hi; i += step) out.add(i)
      continue
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const a = +rangeMatch[1], b = +rangeMatch[2]
      for (let i = a; i <= b; i++) out.add(i)
      continue
    }
    if (/^\d+$/.test(part)) {
      out.add(+part)
      continue
    }
    // Onbekend — silent skip; we faken liever 0 plan-punten dan exception.
  }
  return out
}

/**
 * Genereer alle plan-tijdstippen voor `cron` in [fromTs, toTs] (lokale tijd).
 * Returns een gesorteerde array van numerieke timestamps (ms epoch).
 */
export function expandCronInRange(cron, fromTs, toTs) {
  if (!cron) return []
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return []

  const [mF, hF, dF, monF, dowF] = parts
  const minutes = expandField(mF,   0, 59)
  const hours   = expandField(hF,   0, 23)
  const days    = expandField(dF,   1, 31)
  const months  = expandField(monF, 1, 12)
  const dows    = expandField(dowF, 0, 6)

  const out = []
  // Iteer per dag — voorkomt 10K minute-iteraties voor week-window.
  const cur = new Date(fromTs)
  cur.setHours(0, 0, 0, 0)
  const guard = toTs + 86400000  // 1 dag buffer voor late slots
  while (cur.getTime() <= guard) {
    const dw = cur.getDay()
    const d  = cur.getDate()
    const mn = cur.getMonth() + 1
    if (days.has(d) && months.has(mn) && dows.has(dw)) {
      for (const h of hours) {
        for (const m of minutes) {
          const t = new Date(cur)
          t.setHours(h, m, 0, 0)
          const ts = t.getTime()
          if (ts >= fromTs && ts <= toTs) out.push(ts)
        }
      }
    }
    cur.setDate(cur.getDate() + 1)
  }
  out.sort((a, b) => a - b)
  return out
}

/** Mediaan-interval tussen achtereenvolgende plan-punten (ms). */
function medianInterval(plans) {
  if (plans.length < 2) return Infinity
  const diffs = []
  for (let i = 1; i < plans.length; i++) diffs.push(plans[i] - plans[i - 1])
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}

/**
 * Tolerantie waarbinnen een werkelijke run als 'op tijd' geldt voor een
 * geplande slot. Schaalt mee met de cron-frequentie:
 *  - 5-min cron → tolerantie ~5 min (strict, anders matcht 1 run te veel slots)
 *  - 1u cron    → tolerantie 30 min
 *  - dagelijks  → tolerantie 1u
 *  - maandelijks→ tolerantie 4u (cap)
 *
 * Floor 5 min, ceiling 4 uur.
 */
export function toleranceFor(plans) {
  const interval = medianInterval(plans)
  if (!isFinite(interval)) return 4 * 3600 * 1000
  const half = Math.floor(interval / 2)
  return Math.max(5 * 60 * 1000, Math.min(half, 4 * 3600 * 1000))
}

/**
 * Match elke werkelijke run aan zijn dichtstbijzijnde nog-niet-gematchte
 * plan-punt binnen tolerantie. Greedy: runs in chronologische volgorde,
 * elk plan-punt kan maar 1 run claimen.
 *
 * Returns:
 *   planHit:  Array<runIndex|null>  per plan, welke run het invulde (of null = gemist)
 *   runMatch: Array<planIndex|null> per run, welk plan het matchte (of null = extra)
 */
export function matchRunsToPlans(runs, plans, tolerance) {
  const planHit  = new Array(plans.length).fill(null)
  const runMatch = new Array((runs || []).length).fill(null)
  if (!runs || runs.length === 0) return { planHit, runMatch }

  const runsByTime = runs.map((r, i) => ({
    i,
    t: typeof r.started_at === 'string' ? new Date(r.started_at).getTime() : (r.started_at || 0),
  })).sort((a, b) => a.t - b.t)

  for (const { i: ri, t: rt } of runsByTime) {
    let bestI = -1
    let bestD = Infinity
    for (let pi = 0; pi < plans.length; pi++) {
      if (planHit[pi] !== null) continue
      const d = Math.abs(rt - plans[pi])
      if (d < bestD) { bestD = d; bestI = pi }
      // Plans zijn gesorteerd: zodra de afstand weer toeneemt, zijn we voorbij.
      if (plans[pi] > rt + tolerance) break
    }
    if (bestI >= 0 && bestD <= tolerance) {
      planHit[bestI]  = ri
      runMatch[ri]    = bestI
    }
  }
  return { planHit, runMatch }
}
