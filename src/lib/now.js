// Pure helpers voor NowView en sub-components.
// Geen React-imports — uitsluitend data-formatting.

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi)
}

export function truncate(str, n) {
  return str && str.length > n ? str.slice(0, n - 1) + '…' : (str || '')
}

export function initialsOf(name) {
  if (!name) return '?'
  const parts = String(name).replace(/[-_]/g, ' ').split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function prettyAgent(agent) {
  return String(agent || '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function agentTone(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return 'adm'
  if (a.includes('mail') || a.includes('autodraft')) return 'mail'
  if (a.includes('agenda') || a.includes('plan'))    return 'cal'
  if (a.includes('jelle') || a.includes('mind'))     return 'qa'
  if (a.includes('brief') || a.includes('research') || a.includes('legal')) return 'brief'
  if (a.includes('sales') || a.includes('linkedin')) return 'mail'
  if (a.includes('task') || a.includes('todo'))      return 'cal'
  return 'def'
}

export function relTime(iso) {
  if (!iso) return 'geen run'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1)   return 'nu'
  if (min < 60)  return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24)   return `${hr}u`
  return `${Math.round(hr / 24)}d`
}

export function eventTone(ev) {
  const cats = (ev.categories || []).map(c => String(c).toLowerCase())
  const subj = String(ev.subject || '').toLowerCase()
  if (cats.some(c => c.includes('klant') || c.includes('customer'))) return 'c'
  if (cats.some(c => c.includes('prospect') || c.includes('lead'))) return 'p'
  if (cats.some(c => c.includes('intern')) || subj.includes('standup') || subj.includes('1:1')) return 'i'
  return 'd'
}

export const STATUS_LABEL = { live: 'Live', maintenance: 'Onderhoud', off: 'Uit' }
export const NEXT_STATUS = { live: 'maintenance', maintenance: 'off', off: 'live' }
export const NO_STATUS_TOGGLE = new Set(['orchestrator'])
export const NO_RUN_NOW = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

export function statusOf(s) {
  return !s?.enabled ? 'off' : s?.is_maintenance ? 'maintenance' : 'live'
}

export function greetingFor(date) {
  const h = date.getHours()
  if (h < 12) return 'Goedemorgen'
  if (h < 18) return 'Goedemiddag'
  return 'Goedenavond'
}

const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

export function dateLabel(date) {
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

export function timeLabel(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

// Inline SVG icon paths per agent-tone — gebruikt in ActivityFeed FeedRow.
// Geretourneerd als JSX-fragment-children (geen Icon-wrap); de caller
// rendert ze in een <svg> wrapper.
export function agentIconPathSvg(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return 'M12 2v20M2 12h20'
  if (a.includes('mail') || a.includes('autodraft')) return 'M3 7h18v12H3z|M3 7l9 7 9-7'
  if (a.includes('agenda') || a.includes('plan'))    return 'rect:3,5,18,16,2|M3 9h18'
  return 'circle:12,12,9|M9 12h6'
}
