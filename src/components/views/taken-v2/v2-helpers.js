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
  if (filter === 'week')    return dl >= startOfWeek(now) && dl <= endOfWeek(now)
  if (filter === 'month')   return dl.getMonth() === now.getMonth() && dl.getFullYear() === now.getFullYear()
  return true
}
