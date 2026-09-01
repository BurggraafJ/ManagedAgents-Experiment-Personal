// Herbeoordeeld-marker (daily-admin skill v5.10, Stap 0.6).
//
// De skill zet `context.reassessed = {at, source, reason}` op een bestaand
// open voorstel zodra hij het opnieuw gewogen én herschreven heeft — na late
// mail/opname, een nieuwe HubSpot-note/property, of een stale-actualisatie.
// Oudere rijen (v5.8/v5.9) hebben alleen een `consolidation_history[]`-entry
// met source 'adaptive-recheck*' — die telt ook. Dashboard toont alleen het
// feit als klein label; geen diff van wát er veranderde.

export function getReassessment(proposal) {
  const ctx = proposal?.context
  if (!ctx || typeof ctx !== 'object') return null
  const r = ctx.reassessed
  if (r && typeof r === 'object' && (r.at || r.reason || r.source)) {
    return { at: r.at || null, source: r.source || null, reason: r.reason || null }
  }
  const hist = Array.isArray(ctx.consolidation_history) ? ctx.consolidation_history : []
  const hits = hist.filter(h => h && typeof h.source === 'string' && h.source.startsWith('adaptive-recheck'))
  if (hits.length === 0) return null
  const last = hits[hits.length - 1]
  return { at: last.at || null, source: last.source, reason: last.reason || null }
}

// Tooltip-tekst: "Herbeoordeeld door daily-admin op 01 sep 12:31 — <reden>".
export function reassessmentTitle(r) {
  if (!r) return ''
  const when = r.at ? new Date(r.at) : null
  const whenTxt = when && !isNaN(when.getTime())
    ? when.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null
  return ['Herbeoordeeld door daily-admin', whenTxt ? `op ${whenTxt}` : null, r.reason ? `— ${r.reason}` : null]
    .filter(Boolean).join(' ')
}
