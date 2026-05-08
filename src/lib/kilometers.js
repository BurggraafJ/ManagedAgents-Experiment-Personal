// Pure helpers voor kilometers/reiskosten weergave.
// Geen React; geen Supabase.

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
 * ISO-datum (YYYY-MM-DD) voor vandaag in de lokale tijdzone.
 */
export function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Kort datumlabel "12 mei" — voor inbox-rijen wanneer datum ontbreekt.
 */
export function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short' })
}

/**
 * Formatteer Euro-bedrag als "€ 12,50" (2 decimalen, NL-stijl).
 * Geeft '—' bij null/undefined.
 */
export function formatEuro(value) {
  if (value === null || value === undefined || value === '') return '—'
  return `€ ${Number(value).toFixed(2)}`
}

/**
 * Datum + tijd kort "12 mei 14:30" voor recent-runs lijst.
 */
export function formatRunStamp(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * "12 mei 2026" voor parking-timeline header.
 */
export function formatParkingDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Bepaal overall status van een parking-run uit z'n steps.
 * Error wint van warning, anders success.
 */
export function parkingOverall(steps) {
  if (steps.some(s => s.status === 'error')) return 'error'
  if (steps.some(s => s.status === 'warning')) return 'warning'
  return 'success'
}
