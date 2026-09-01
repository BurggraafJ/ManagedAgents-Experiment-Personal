// Pure helpers voor de Taken-weergaven (mobiel + desktop, v1.125 "A2").
// Geen React, geen Supabase. Product-cut 2026-09-01: alleen 'Mijn taken'
// (handmatig/bevestigd, geen project) en 'Projecten' (fases Te doen / Bezig /
// Testen via tags). Jira-, sales_followup- en newly-found-rijen blijven in de
// DB staan maar komen in geen enkele lijst meer voor.

const OPEN_STATUSES = ['open', 'snoozed', 'blocked']
const HIDDEN_SOURCES = ['jira', 'sales_followup']

export function isOpenTask(t) { return OPEN_STATUSES.includes(t.status) }

/** Rij die überhaupt in de Taken-UI thuishoort (geen Jira/Sales/voorstel). */
export function isShownTask(t) {
  return !t.is_newly_found && !HIDDEN_SOURCES.includes(t.source)
}

/** Mijn taken = open, zichtbaar, zonder project. Backlog zit hier ook in. */
export function isMijnTask(t) {
  return isOpenTask(t) && isShownTask(t) && !t.project_id
}

export const PRIOS = ['hoog', 'middel', 'laag']
export const PRIO_LABEL = { hoog: 'Hoog', middel: 'Middel', laag: 'Laag' }
export function prioOf(t) {
  const p = String(t.priority || 'normal').toLowerCase()
  if (p === 'urgent' || p === 'high' || p === 'hoog' || p === '1') return 'hoog'
  if (p === 'low' || p === 'laag') return 'laag'
  return 'middel'
}

// ── Fases (projectbord) ─────────────────────────────────────────────────
export const STAGES = ['todo', 'wip', 'testen']
export const STAGE_LABEL = { todo: 'Te doen', wip: 'Bezig', testen: 'Testen' }
export const STAGE_HINT = { todo: 'Nog niet gestart', wip: 'Wordt aan gewerkt', testen: 'Klaar om te testen' }
export function stageOf(t) {
  const tags = t.tags || []
  if (tags.includes('testen')) return 'testen'
  if (tags.includes('wip')) return 'wip'
  return 'todo'
}
/** Nieuwe tags-array voor een fase-wissel (exclusief: max één fase-tag). */
export function tagsForStage(tags, stage) {
  const base = (tags || []).filter(x => x !== 'wip' && x !== 'testen')
  return stage === 'todo' ? base : [...base, stage]
}

// ── Datum-meta ──────────────────────────────────────────────────────────
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
const DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const BUCKET_RANK = { overdue: 0, today: 1, tomorrow: 2, week: 3, later: 4, none: 5 }
const PRIO_RANK = { hoog: 0, middel: 1, laag: 2 }

function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

/**
 * Datum-info voor de rechter meta van een rij.
 *   { bucket: overdue|today|tomorrow|week|later|none, label }
 * Maand-deadlines (deadline_kind='month') tonen de maandnaam.
 */
export function dueOf(t) {
  const when = t.deadline || t.do_date
  if (!when) return { bucket: 'none', label: '' }
  if (t.deadline && t.deadline_kind === 'month') {
    const [y, m] = t.deadline.split('-').map(Number)
    const now = new Date()
    const cy = now.getFullYear(), cm = now.getMonth() + 1
    const bucket = y < cy || (y === cy && m < cm) ? 'overdue' : (y === cy && m === cm) ? 'today' : 'later'
    return { bucket, label: MONTHS[m - 1] + (y !== cy ? ` ${y}` : '') }
  }
  const today = midnight(new Date())
  const d = midnight(new Date(String(when).slice(0, 10) + 'T12:00:00'))
  const diff = Math.round((d - today) / 86400000)
  const short = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  const long = `${DAYS[d.getDay()]} ${short}`
  if (diff < 0) return { bucket: 'overdue', label: diff === -1 ? 'gisteren' : `${-diff}d te laat` }
  if (diff === 0) return { bucket: 'today', label: 'vandaag' }
  if (diff === 1) return { bucket: 'tomorrow', label: 'morgen' }
  if (diff <= 7) return { bucket: 'week', label: long }
  return { bucket: 'later', label: short }
}

/** Sorteer: verlopen → vandaag → morgen → week → later → geen datum; dan prio. */
export function sortByDue(list) {
  return list.slice().sort((a, b) => {
    const ba = BUCKET_RANK[dueOf(a).bucket], bb = BUCKET_RANK[dueOf(b).bucket]
    if (ba !== bb) return ba - bb
    const da = a.deadline || a.do_date || '9999', db = b.deadline || b.do_date || '9999'
    if (da !== db) return String(da).localeCompare(String(db))
    const pa = PRIO_RANK[prioOf(a)], pb = PRIO_RANK[prioOf(b)]
    if (pa !== pb) return pa - pb
    return new Date(b.created_at || 0) - new Date(a.created_at || 0)
  })
}

export function groupBy(list, keyFn) {
  const m = new Map()
  for (const t of list) { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t) }
  return m
}

/**
 * Projectlijst met afgeleide tellers. `open` is gesorteerd op urgentie;
 * `total` telt open + done (dropped niet). Gearchiveerde projecten vallen weg.
 */
export function deriveProjects(tasks, projects) {
  return (projects || [])
    .filter(p => p.status !== 'archived')
    .map(p => {
      const all = tasks.filter(t => t.project_id === p.id && t.status !== 'dropped' && isShownTask(t))
      const open = sortByDue(all.filter(isOpenTask))
      const done = all.filter(t => t.status === 'done')
      const byStage = groupBy(open, stageOf)
      const stageCount = Object.fromEntries(STAGES.map(s => [s, (byStage.get(s) || []).length]))
      return { ...p, open, done, total: all.length, stageCount, byStage }
    })
}
