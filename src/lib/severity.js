// Pure helpers voor security-findings severity & status.
// Geen React; geen Supabase. Wordt gebruikt door views/security/.

/**
 * Sort-priority voor severity — laag = bovenaan.
 * critical (0) > high > medium > low > info (4) > onbekend (9).
 */
export const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

export const SEV_LABEL = {
  critical: 'Kritiek',
  high:     'Hoog',
  medium:   'Medium',
  low:      'Laag',
  info:     'Info',
}

/**
 * Mappen van database-severity naar onze pill-tone (`s-error|warning|idle|success`).
 * Critical/high → error, medium → warning, low/info → idle.
 */
export const SEV_TONE = {
  critical: 'error',
  high:     'error',
  medium:   'warning',
  low:      'idle',
  info:     'idle',
}

/**
 * Status-tone voor de status-pill op een finding.
 */
export const STATUS_TONE = {
  open:           'error',
  resolved:       'success',
  accepted_risk:  'warning',
  false_positive: 'idle',
}

export const STATUS_LABEL = {
  open:           'Open',
  resolved:       'Opgelost',
  accepted_risk:  'Geaccepteerd',
  false_positive: 'Onterecht',
}

/**
 * Categorie-labels en -iconen (RLS, secrets, auth, code, config, network).
 */
export const CAT_LABEL = {
  rls:     'RLS',
  secrets: 'Secrets',
  auth:    'Auth',
  code:    'Code',
  config:  'Config',
  network: 'Netwerk',
}

export const CAT_ICON = {
  rls:     '🔒',
  secrets: '🔑',
  auth:    '🛡',
  code:    '💻',
  config:  '⚙️',
  network: '🌐',
}

export const SCAN_LABEL = {
  daily_monitor: 'Dagelijks',
  weekly_scan:   'Wekelijks',
  manual:        'Handmatig',
}

/**
 * Sorteer findings: severity-asc (kritiek bovenaan), bij gelijk → nieuwste found_at eerst.
 */
export function sortFindings(list) {
  return list.slice().sort((a, b) => {
    const sa = SEV_ORDER[a.severity] ?? 9
    const sb = SEV_ORDER[b.severity] ?? 9
    if (sa !== sb) return sa - sb
    return new Date(b.found_at) - new Date(a.found_at)
  })
}

/**
 * Severity-tellers voor de KPI-strip op basis van OPEN findings.
 * Low + info worden samengeteld als 'low'.
 */
export function summarizeFindings(findings) {
  const open = findings.filter(f => f.status === 'open')
  return {
    critical: open.filter(f => f.severity === 'critical').length,
    high:     open.filter(f => f.severity === 'high').length,
    medium:   open.filter(f => f.severity === 'medium').length,
    low:      open.filter(f => f.severity === 'low' || f.severity === 'info').length,
    resolved: findings.filter(f => f.status === 'resolved').length,
    accepted: findings.filter(f => f.status === 'accepted_risk').length,
    total:    findings.length,
  }
}
