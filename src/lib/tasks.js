// Pure helpers voor de Taken-view. Geen React, geen Supabase.
// Wordt door components/views/TasksView.jsx + sub-components gebruikt.

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 }

/**
 * Welke bucket (Hoog/Midden/Laag) hoort de taak in?
 * Mapping puur op `priority`. Datum-urgentie wordt niet hier afgehandeld;
 * een rode pill in de UI laat overdue zien zonder dat de bucket verschuift.
 */
export function bucketOf(task) {
  const p = (task.priority || 'normal').toLowerCase()
  if (p === 'urgent' || p === 'high') return 'high'
  if (p === 'low') return 'low'
  return 'mid'
}

export const BUCKET_TO_PRIORITY = { high: 'high', mid: 'normal', low: 'low' }
export const BUCKET_LABEL = { high: 'Hoog', mid: 'Midden', low: 'Laag' }

/**
 * Streng "is dit echt voor Jelle?"-filter, gebruikt bij newly-found-items.
 * Alleen door als de titel of notes EXPLICIET naar Jelle verwijst.
 */
export function looksLikeForJelle(task) {
  const t = (task.title || '').toLowerCase()
  const n = (task.notes || '').toLowerCase()
  const haystack = t + ' ' + n
  if (/\bjelle\b/.test(haystack)) return true
  if (/\b(ik|mijn|mij)\b/.test(t)) return true
  if (/\b(moet ik|ga ik|zal ik|zou ik|kan ik|wil ik|stuur ik)\b/.test(t)) return true
  return false
}

/** Knip een titel kort op zin- of woord-grens. */
export function shortTitle(title, max = 70) {
  if (!title) return ''
  if (title.length <= max) return title
  const m = title.match(/^([^.!?:;]+[.!?:;])/)
  if (m && m[1].length <= max) return m[1].trim()
  const cut = title.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut) + '…'
}

/** Klant-taak: expliciet category=klant, of jira-Sales board, of road-notes. */
export function isKlant(task) {
  if (task.category === 'klant') return true
  if (task.source === 'jira' && task.jira_board === 'Sales') return true
  if (task.source === 'sales_on_road') return true
  return false
}

/** Live = open en niet expliciet in backlog of nog te keuren als newly-found. */
export function isLive(task) {
  if (task.status === 'done' || task.status === 'dropped') return false
  if (task.is_newly_found) return false
  if (task.in_backlog) return false
  return true
}

export function isInBacklog(task) {
  if (task.status !== 'open' && task.status !== 'snoozed' && task.status !== 'blocked') return false
  if (task.is_newly_found) return false
  return !!task.in_backlog
}

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export const ymd = (d) => d.toISOString().slice(0, 10)

/** Deadline gepasseerd en taak nog niet afgehandeld. */
export function isOverdue(task) {
  if (!task.deadline || task.status === 'done' || task.status === 'dropped') return false
  return new Date(task.deadline) < startOfDay(new Date())
}

/** Deadline of do_date is vandaag. */
export function isDueToday(task) {
  const y = ymd(startOfDay(new Date()))
  return task.deadline === y || task.do_date === y
}

/**
 * Sorteer taken op urgency: overdue eerst, dan op datum (do_date | deadline),
 * dan priority, dan jongste eerst.
 */
export function sortTasks(list) {
  const today = ymd(startOfDay(new Date()))
  return list.slice().sort((a, b) => {
    const aOver = a.deadline && a.deadline < today && a.status !== 'done'
    const bOver = b.deadline && b.deadline < today && b.status !== 'done'
    if (aOver !== bOver) return aOver ? -1 : 1
    const aDate = a.do_date || a.deadline || '9999-99-99'
    const bDate = b.do_date || b.deadline || '9999-99-99'
    if (aDate !== bDate) return aDate.localeCompare(bDate)
    const aP = PRIORITY_RANK[a.priority || 'normal']
    const bP = PRIORITY_RANK[b.priority || 'normal']
    if (aP !== bP) return aP - bP
    return new Date(b.created_at) - new Date(a.created_at)
  })
}

// =====================================================================
// UI-constants — labels en kleuren voor pills/badges in TasksView
// =====================================================================

export const STATUS_LABEL   = { open: 'open', done: 'klaar', blocked: 'geblokt', snoozed: 'uitgesteld', dropped: 'gedropt' }
export const PRIORITY_LABEL = { low: 'laag', normal: 'normaal', high: 'hoog', urgent: 'urgent' }
export const PRIORITY_PILL  = { low: 's-idle', normal: '', high: 's-warning', urgent: 's-error' }
export const EFFORT_LABEL   = { quick: '⚡ quick', medium: 'medium', deep: 'deep work' }

export const SOURCE_LABEL = {
  manual: 'handmatig', fireflies: 'Fireflies', email: 'mail', slack: 'Slack',
  voice: 'spraak', agent: 'agent', jira: 'Jira', other: 'overig',
}

export const JIRA_BOARD_COLOR = { Sales: '#7c8aff', Management: '#22c55e', Recruitment: '#f59e0b' }

export const SALES_TYPE_LABEL = {
  offerte_reminder:    'offerte herinnering',
  trial_ending:        'trial loopt af',
  checkin:             'check-in',
  onboarding_followup: 'onboarding',
  stille_contact:      'stille contact',
  ovk_geen_reactie:    'ovk geen reactie',
  trial_einde:         'trial loopt af',
  other:               'overig',
}

export const SOURCE_LABEL_DONE = {
  autodraft: 'Mail (AutoDraft)', draft_events: 'Mail-drafts', sales_todos: 'Sales TODO',
  linkedin: 'LinkedIn', agent_proposals: 'Daily Admin', hubspot: 'HubSpot',
  sales_on_road: 'Road Notes', km_trips: 'Kilometerregistratie', fireflies: 'Fireflies',
  agent_runs: 'Skill-run', other: 'Anders',
}

// =====================================================================
// Date-helpers (NL-format) en string-truncate
// =====================================================================

export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = startOfDay(new Date())
  const tom   = addDays(today, 1)
  const yIso  = ymd(today)
  const tIso  = ymd(tom)
  if (iso === yIso) return 'vandaag'
  if (iso === tIso) return 'morgen'
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export function formatShortDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
