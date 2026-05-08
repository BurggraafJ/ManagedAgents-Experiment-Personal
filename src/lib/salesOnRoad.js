// Pure helpers + constanten voor SalesOnRoadView (road-notes).
// Geen React; geen Supabase.

export const AGENT_NAME = 'sales-on-road'

/** Status van verwerkte sales-events (sales_on_road_events.status). */
export const EVENT_STATUS_LABEL = {
  processed:    'verwerkt',
  needs_review: 'controle nodig',
  pending:      'bezig',
  error:        'fout',
  skipped:      'overgeslagen',
}

export const EVENT_STATUS_TONE = {
  processed:    'success',
  needs_review: 'warning',
  pending:      'idle',
  error:        'error',
  skipped:      'idle',
}

/** Status van inbox-items (sales_on_road_inbox.status). */
export const INBOX_STATUS_LABEL = {
  pending:    'wacht op agent',
  processing: 'wordt verwerkt',
  done:       'verwerkt',
  error:      'fout',
  skipped:    'overgeslagen',
}

export const INBOX_STATUS_TONE = {
  pending:    'idle',
  processing: 'warning',
  done:       'success',
  error:      'error',
  skipped:    'idle',
}

/**
 * Filter events binnen het laatste 7-dagen window.
 */
export function eventsThisWeek(events) {
  const WEEK_MS = 7 * 86_400_000
  const now = Date.now()
  return events.filter(e => now - new Date(e.created_at).getTime() < WEEK_MS)
}

/**
 * Tellers voor de KPI-strip.
 */
export function summarizeEvents(events) {
  return {
    total:       events.length,
    processed:   events.filter(e => e.status === 'processed').length,
    needsReview: events.filter(e => e.status === 'needs_review').length,
    errored:     events.filter(e => e.status === 'error').length,
    thisWeek:    eventsThisWeek(events).length,
  }
}
