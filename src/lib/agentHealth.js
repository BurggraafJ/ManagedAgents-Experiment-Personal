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
 * Het percentage waar de Health-pagina op kleurt: `health_pct` uit de view =
 * (success + warning) / totaal.
 *
 * Waarom niet `success_pct`: een run met `status='warning'` is per
 * logging.md-contract een **voltooide** run met een aantekening, geen
 * mislukking. Op success_pct kleurde de orchestrator (43 runs, 0 errors,
 * 40 warnings) daarom rood op 7% en las de pagina als "draait niet".
 * De losse ✓ / ⚠ / ✗ kolommen houden de nuance zichtbaar.
 *
 * Valt terug op `success_pct` zolang een omgeving de view nog zonder
 * `health_pct` heeft (migration 20260903_agent_health_pct.sql).
 *
 * @param {object} row — rij uit agent_runs_health_7d
 * @returns {number|null}
 */
export function healthPct(row) {
  const raw = row?.health_pct ?? row?.success_pct
  return raw === null || raw === undefined ? null : Number(raw)
}

/**
 * Severity-tone voor één view-rij — `tone()` op het juiste percentage.
 * @param {object} row — rij uit agent_runs_health_7d
 */
export function rowTone(row) {
  return tone(healthPct(row), row?.runs_total ?? 0)
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
    const t = rowTone(r)
    if (t === 'error') critical++
    else if (t === 'warning') warning++
    else if (t === 'idle') idle++
    else ok++
  }
  return { critical, warning, idle, ok, total: rows.length }
}

/**
 * Sorteer agent-rijen: severity (error→warning→success→idle), dan op laagste
 * health_pct, dan alfabetisch op agent_name.
 */
export function sortBySeverity(rows) {
  return rows.slice().sort((a, b) => {
    const ta = rowTone(a)
    const tb = rowTone(b)
    if (SEVERITY_ORDER[ta] !== SEVERITY_ORDER[tb]) {
      return SEVERITY_ORDER[ta] - SEVERITY_ORDER[tb]
    }
    const pa = healthPct(a) ?? 999
    const pb = healthPct(b) ?? 999
    if (pa !== pb) return pa - pb
    return (a.agent_name || '').localeCompare(b.agent_name || '')
  })
}
