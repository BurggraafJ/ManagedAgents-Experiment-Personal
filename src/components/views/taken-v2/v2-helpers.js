// Pure helpers voor Taken v2.0.

const MONTHS_NL = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']

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

export function isOverdueIso(iso) {
  if (!iso) return false
  return new Date(iso + 'T23:59:59') < new Date()
}

export function fmtDate(iso) {
  if (!iso) return ''
  const p = iso.split('-')
  if (p.length !== 3) return iso
  return parseInt(p[2], 10) + ' ' + MONTHS_NL[parseInt(p[1], 10) - 1]
}

/**
 * passesDateFilter — filter logic uit mockup.
 *   all | overdue | today | week | month | none
 */
export function passesDateFilter(task, filter) {
  if (filter === 'all')  return true
  if (filter === 'none') return !task.deadline
  if (!task.deadline) return false
  const dl = new Date(task.deadline + 'T12:00:00')
  const now = new Date()
  const todayStr = ymd(now)
  if (filter === 'overdue') return new Date(task.deadline + 'T23:59:59') < now
  if (filter === 'today')   return task.deadline === todayStr
  if (filter === 'week')    return dl >= startOfWeek(now) && dl <= endOfWeek(now)
  if (filter === 'month')   return dl.getMonth() === now.getMonth() && dl.getFullYear() === now.getFullYear()
  return true
}
