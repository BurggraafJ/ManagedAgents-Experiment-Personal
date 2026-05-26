// Pure helpers voor Taken v2.0.

const MONTHS_SHORT = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']
const MONTHS_LONG  = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']

/** Map DB priority → mockup prio (hoog/middel/laag). */
export function dbPrioToMockup(p) {
  const v = (p || 'normal').toLowerCase()
  if (v === 'urgent' || v === 'high') return 'hoog'
  if (v === 'low') return 'laag'
  return 'middel'
}

/** Map mockup prio → DB priority. */
export function mockupPrioToDb(p) {
  if (p === 'hoog')   return 'high'
  if (p === 'middel') return 'normal'
  if (p === 'laag')   return 'low'
  return 'normal'
}

export function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export function startOfWeek(d) {
  const x = new Date(d)
  const dow = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dow)
  x.setHours(0, 0, 0, 0)
  return x
}

export function endOfWeek(d) {
  const s = startOfWeek(d)
  const e = new Date(s)
  e.setDate(s.getDate() + 6)
  e.setHours(23, 59, 59, 999)
  return e
}

/**
 * Urgentie van een deadline relatief tot vandaag.
 * Returns: 'overdue' | 'today' | 'tomorrow' | 'future' | null
 * Kind-aware: month-deadlines worden vergeleken op jaar+maand.
 */
export function dateUrgencyKind(iso, kind = 'day') {
  if (!iso) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)

  if (kind === 'month') {
    const [y, m] = iso.split('-').map(Number)
    const cy = today.getFullYear()
    const cm = today.getMonth() + 1
    if (y < cy || (y === cy && m < cm)) return 'overdue'
    if (y === cy && m === cm) return 'today'
    const nextMonth = cm === 12 ? 1 : cm + 1
    const nextYear  = cm === 12 ? cy + 1 : cy
    if (y === nextYear && m === nextMonth) return 'tomorrow'
    return 'future'
  }

  const todayIso = ymd(today)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const tomorrowIso = ymd(tomorrow)
  if (iso < todayIso) return 'overdue'
  if (iso === todayIso) return 'today'
  if (iso === tomorrowIso) return 'tomorrow'
  return 'future'
}

/** Overdue op basis van kind ('day' | 'month'). */
export function isOverdueIso(iso, kind = 'day') {
  if (!iso) return false
  if (kind === 'month') {
    const [y, m] = iso.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    const lastIso = y + '-' + String(m).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0')
    return new Date(lastIso + 'T23:59:59') < new Date()
  }
  return new Date(iso + 'T23:59:59') < new Date()
}

/** Render date string. Kind 'month' → "juni" of "juni 2027" als ander jaar. */
export function fmtDateOrMonth(iso, kind = 'day') {
  if (!iso) return ''
  const p = iso.split('-')
  if (p.length !== 3) return iso
  const y = parseInt(p[0], 10)
  const m = parseInt(p[1], 10)
  const d = parseInt(p[2], 10)
  const cy = new Date().getFullYear()
  if (kind === 'month') {
    return MONTHS_LONG[m - 1] + (y !== cy ? ' ' + y : '')
  }
  return d + ' ' + MONTHS_SHORT[m - 1]
}

/** Backwards-compat alias. */
export const fmtDate = (iso) => fmtDateOrMonth(iso, 'day')

/**
 * Short, vrolijke success-toon bij afronden (twee korte sine-tones).
 * Web Audio API — geen externe asset nodig. Faalt stil als browser blokkeert.
 */
export function playSuccessChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const tones = [880, 1320]  // A5, E6 (open fifth + octave)
    tones.forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'
      o.frequency.value = freq
      const start = ctx.currentTime + i * 0.08
      g.gain.setValueAtTime(0.09, start)
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.22)
      o.start(start)
      o.stop(start + 0.27)
    })
    // Close context na de tonen voor cleanup
    setTimeout(() => { try { ctx.close() } catch {} }, 600)
  } catch {}
}

/**
 * Display-label voor een deadline, contextueel ipv puur cijfers.
 *   vandaag      → "vandaag"
 *   morgen       → "morgen"
 *   gisteren     → "gisteren"
 *   2-7d verlopen → "Nd geleden"
 *   anders       → "5 jun" (day) of "juni" (month)
 */
export function fmtDeadlineLabel(iso, kind = 'day') {
  if (!iso) return ''
  if (kind === 'month') return fmtDateOrMonth(iso, 'month')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayIso = ymd(today)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const yesterdayIso = ymd(yesterday)
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const tomorrowIso = ymd(tomorrow)

  if (iso === todayIso) return 'vandaag'
  if (iso === tomorrowIso) return 'morgen'
  if (iso === yesterdayIso) return 'gisteren'

  // Verleden 2-7d: relatief label
  if (iso < todayIso) {
    const d = new Date(iso + 'T12:00:00')
    const daysAgo = Math.round((today - d) / 86400000)
    if (daysAgo >= 2 && daysAgo <= 7) return `${daysAgo}d geleden`
  }
  return fmtDateOrMonth(iso, 'day')
}

/**
 * Sort tasks op urgency: overdue → today → tomorrow → future → geen datum.
 * Secundair: ascending deadline, dan priority.
 */
const URGENCY_ORDER = { overdue: 0, today: 1, tomorrow: 2, future: 3 }
const PRIO_ORDER    = { urgent: 0, high: 1, normal: 2, low: 3 }
export function sortByUrgency(tasks) {
  return tasks.slice().sort((a, b) => {
    const ua = dateUrgencyKind(a.deadline, a.deadline_kind || 'day')
    const ub = dateUrgencyKind(b.deadline, b.deadline_kind || 'day')
    const oa = ua ? URGENCY_ORDER[ua] : 4
    const ob = ub ? URGENCY_ORDER[ub] : 4
    if (oa !== ob) return oa - ob
    const ad = a.deadline || '9999-99-99'
    const bd = b.deadline || '9999-99-99'
    if (ad !== bd) return ad.localeCompare(bd)
    const pa = PRIO_ORDER[a.priority] ?? 2
    const pb = PRIO_ORDER[b.priority] ?? 2
    if (pa !== pb) return pa - pb
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })
}

/**
 * passesDateFilter — datum-filter met keuze van bron-veld.
 *   filter: all | overdue | today | week | month | none
 *   source: 'deadline' | 'created' | 'backlog'
 */
export function passesDateFilter(task, filter, source = 'deadline') {
  if (filter === 'all')  return true
  let iso
  if (source === 'deadline') iso = task.deadline
  if (source === 'created')  iso = task.created_at ? task.created_at.slice(0, 10) : null
  if (source === 'backlog')  iso = task.in_backlog_at ? task.in_backlog_at.slice(0, 10) : null

  if (filter === 'none') return !iso
  if (!iso) return false

  const dl = new Date(iso + 'T12:00:00')
  const now = new Date()
  const todayStr = ymd(now)

  // Voor source='deadline' met kind='month': gebruik last-day voor overdue check
  const kind = source === 'deadline' ? (task.deadline_kind || 'day') : 'day'
  if (filter === 'overdue') {
    if (kind === 'month') {
      const [y, m] = iso.split('-').map(Number)
      const lastDay = new Date(y, m, 0).getDate()
      const lastIso = y + '-' + String(m).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0')
      return new Date(lastIso + 'T23:59:59') < now
    }
    return new Date(iso + 'T23:59:59') < now
  }
  if (filter === 'today')   return iso === todayStr
  if (filter === 'tomorrow') {
    const tom = new Date(now); tom.setDate(now.getDate() + 1)
    return iso === ymd(tom)
  }
  if (filter === 'week')    return dl >= startOfWeek(now) && dl <= endOfWeek(now)
  if (filter === 'month')   return dl.getMonth() === now.getMonth() && dl.getFullYear() === now.getFullYear()
  return true
}
