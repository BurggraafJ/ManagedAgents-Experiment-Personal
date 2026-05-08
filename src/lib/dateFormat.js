// Datum-/tijd-formatters die in meerdere views worden gebruikt.
// Pure functies — geen React, geen externe libs.

/**
 * Toont een ISO-timestamp als relatieve tijd in het Nederlands.
 *   < 1m   → "zojuist"
 *   < 1u   → "Xm geleden"
 *   < 1d   → "Xu geleden"
 *   < 7d   → "Xd geleden"
 *   ≥ 7d   → korte datum "5 mei" (NL locale)
 *
 * @param {string|null|undefined} iso
 * @returns {string|null} — null wanneer iso ontbreekt, anders een leesbare label
 */
export function relativeTime(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'zojuist'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m geleden`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}u geleden`
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)}d geleden`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

/**
 * Toont een ISO-timestamp als absolute datum in NL-locale: "wo 7 mei 14:30".
 * Voor weergave in detail-secties waar exacte tijd nuttig is.
 *
 * @param {string|null|undefined} iso
 * @returns {string} — '—' wanneer iso ontbreekt, anders de geformatteerde string
 */
export function absDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', {
    weekday: 'short',
    day:     'numeric',
    month:   'short',
    hour:    '2-digit',
    minute:  '2-digit',
  })
}

/**
 * Korte datum + tijd zonder weekday: "12 mei 14:30".
 * Voor lijst-rijen waar weekday-prefix te druk wordt.
 */
export function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', {
    day:    '2-digit',
    month:  'short',
    hour:   '2-digit',
    minute: '2-digit',
  })
}

/**
 * Datum-label met semantische dag-context — "Vandaag", "Gisteren",
 * "maandag" (binnen huidige week) of "12 mei 2026" (ouder dan een week).
 * Voor date-separators in chat-streams en activity-feeds.
 */
export function formatDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = (today - day) / 86400000
  if (diff === 0) return 'Vandaag'
  if (diff === 1) return 'Gisteren'
  if (diff < 7)  return d.toLocaleDateString('nl-NL', { weekday: 'long' })
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}
