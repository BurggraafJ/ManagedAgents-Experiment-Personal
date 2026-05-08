// Datum-/tijd-formatters die in meerdere views worden gebruikt.
// Pure functies — geen React, geen externe libs.

/**
 * Toont een ISO-timestamp als relatieve tijd in het Nederlands.
 *   < 1m   → "zojuist"
 *   < 1u   → "Xm geleden"
 *   < 1d   → "Xu geleden"
 *   ≥ 1d   → "Xd geleden"
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
  return `${Math.round(ms / 86_400_000)}d geleden`
}
