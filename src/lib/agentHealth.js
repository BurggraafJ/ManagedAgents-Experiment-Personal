// Pure helpers voor agent-health metrics (agent_runs_health_7d view).
// Geen React; geen Supabase. Wordt gebruikt door views/health/.

/**
 * Bepaal de severity-tone voor een agent op basis van success-percentage en
 * aantal runs in het tijdvenster.
 *
 * @param {number|null} pct — success_pct (0-100) of null wanneer geen runs
 * @param {number} runs — aantal runs in het venster
 * @returns {'idle'|'error'|'warning'|'success'}
 *   idle    — geen runs of pct == null
 *   error   — pct < 80
 *   warning — pct 80-95
 *   success — pct >= 95
 */
export function tone(pct, runs) {
  if (runs === 0 || pct === null) return 'idle'
  if (pct >= 95) return 'success'
  if (pct >= 80) return 'warning'
  return 'error'
}

/**
 * Sorteer-priority voor severity in tabellen — laag = bovenaan.
 * error < warning < success < idle.
 */
export const SEVERITY_ORDER = { error: 0, warning: 1, success: 2, idle: 3 }

/**
 * Tier-labels en volgorde voor de filter-balk.
 */
export const TIER_LABELS = {
  source:    'Source (sync)',
  infra:     'Infra (poller / deploy)',
  primary:   'Primary',
  secondary: 'Secondary',
}
export const TIER_ORDER = ['primary', 'secondary', 'source', 'infra']

/**
 * Bereken severity-tellers voor het summary-strip.
 * @param {Array} rows — rijen uit agent_runs_health_7d
 */
export function summarize(rows) {
  let critical = 0, warning = 0, idle = 0, ok = 0
  for (const r of rows) {
    const t = tone(r.success_pct === null ? null : Number(r.success_pct), r.runs_total)
    if (t === 'error') critical++
    else if (t === 'warning') warning++
    else if (t === 'idle') idle++
    else ok++
  }
  return { critical, warning, idle, ok, total: rows.length }
}

/**
 * Sorteer agent-rijen: severity (error→warning→success→idle), dan op laagste
 * success_pct, dan alfabetisch op agent_name.
 */
export function sortBySeverity(rows) {
  return rows.slice().sort((a, b) => {
    const ta = tone(a.success_pct === null ? null : Number(a.success_pct), a.runs_total)
    const tb = tone(b.success_pct === null ? null : Number(b.success_pct), b.runs_total)
    if (SEVERITY_ORDER[ta] !== SEVERITY_ORDER[tb]) {
      return SEVERITY_ORDER[ta] - SEVERITY_ORDER[tb]
    }
    const pa = a.success_pct === null ? 999 : Number(a.success_pct)
    const pb = b.success_pct === null ? 999 : Number(b.success_pct)
    if (pa !== pb) return pa - pb
    return (a.agent_name || '').localeCompare(b.agent_name || '')
  })
}
