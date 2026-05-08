// Pure helpers + constanten voor LinkedInView.
// Geen React; geen Supabase.

export const TARGET_STATUS_TONE = {
  pending:           'idle',
  scheduled:         'warning',
  sent:              'success',
  accepted:          'success',
  declined:          'error',
  already_connected: 'idle',
  skipped:           'idle',
  failed:            'error',
  blacklisted:       'idle',
}

export const SEGMENT_LABEL = {
  mailbox:                       'inbox',
  hubspot_new:                   'hubspot',
  advocatenkantoor_proefperiode: 'proefperiode-kantoor',
  competitors:                   'concurrent',
  thought_leaders:               'thought leader',
  manual:                        'handmatig',
  other:                         'overig',
}

export const EVENT_LABEL = {
  discovered:        'ontdekt',
  queued:            'ingepland',
  sent:              'verstuurd',
  accepted:          'geaccepteerd',
  declined:          'geweigerd',
  already_connected: 'al verbonden',
  skipped:           'overgeslagen',
  failed:            'fout',
  note:              'notitie',
  strategy_edit:     'strategie-edit',
  run_start:         'run gestart',
  run_end:           'run klaar',
  rate_limit:        'rate-limit',
  login_required:    'login nodig',
}

/**
 * Tone-class voor een activity-log event. Sent/accepted/run_end = success;
 * failed/rate_limit/login_required = error; queued/discovered = idle;
 * strategy_edit = warning.
 */
export function eventTone(eventType) {
  if (eventType === 'sent' || eventType === 'accepted' || eventType === 'run_end') return 'success'
  if (eventType === 'failed' || eventType === 'rate_limit' || eventType === 'login_required') return 'error'
  if (eventType === 'queued' || eventType === 'discovered') return 'idle'
  if (eventType === 'strategy_edit') return 'warning'
  return ''
}

/**
 * Trim een string tot maxN chars met ellipsis.
 */
export function truncate(s, maxN) {
  if (!s) return ''
  return s.length > maxN ? s.slice(0, maxN - 1) + '…' : s
}

/**
 * Split comma-separated string naar array van trimmed entries (strategie-form).
 */
export function splitList(s) {
  if (!s) return []
  return String(s).split(',').map(x => x.trim()).filter(Boolean)
}

/**
 * Bereken effectiviteits-KPIs op basis van targets-array. Telt sent (verstuurd),
 * sent vandaag/deze-week, accepted, queued, failed, al-geconnect en hit-rate.
 *
 * Hit-rate = sent_week / (sent_week + already_connected_week) — hoeveel %
 * van de bezochte profielen écht nieuw was.
 */
export function computeLinkedInKpis(targets) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7))

  const sent = targets.filter(t => t.status === 'sent' || t.status === 'accepted')
  const sentToday = sent.filter(t => t.sent_at && new Date(t.sent_at) >= today).length
  const sentWeek  = sent.filter(t => t.sent_at && new Date(t.sent_at) >= weekStart).length
  const accepted  = targets.filter(t => t.status === 'accepted').length
  const accRate   = sent.length ? Math.round(100 * accepted / sent.length) : null
  const queued    = targets.filter(t => t.status === 'pending' || t.status === 'scheduled').length
  const failed    = targets.filter(t => t.status === 'failed').length

  const alreadyAll = targets.filter(t => t.status === 'already_connected').length
  const alreadyWeek = targets.filter(t =>
    t.status === 'already_connected' &&
    t.last_attempt_at && new Date(t.last_attempt_at) >= weekStart
  ).length

  const touchedWeek = sentWeek + alreadyWeek
  const hitRate = touchedWeek ? Math.round(100 * sentWeek / touchedWeek) : null

  return { sentToday, sentWeek, queued, accRate, failed, alreadyAll, alreadyWeek, hitRate }
}

/**
 * Sorteer segments op count, descending.
 */
export function segmentCounts(targets) {
  const counts = {}
  for (const t of targets) counts[t.segment] = (counts[t.segment] || 0) + 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
}
