// Postvak variant 2 — pure helpers. Geen React, geen styling-hergebruik van
// variant 1: dit zijn de design-helpers (catVars, tijden, avatar-tinten) plus
// de woord-diff voor de taalcheck-track-changes.
import { isFromShareholder, isInternalEmail } from '../../../lib/autodraft'

// ---- Categorie-kleursysteem ----
// Het design werkt met één oklch-familie via catVars(); de echte categorieën
// komen uit autodraft_categories (met eigen kleur per rij). We voeden het
// design-mechanisme met de DB-kleur; zonder DB-kleur valt de categorie terug
// op een vaste design-tint uit de familie (stabiel per key).
const FALLBACK_ACCENTS = [
  'var(--c-klant)', 'var(--c-intern)', 'var(--c-aandeel)',
  'var(--c-partner)', 'var(--c-plan)', 'var(--c-overig)',
]

function hashKey(s) {
  let h = 0
  for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) % 997
  return h
}

export function accentFor(categoryKey, categoriesByKey) {
  const row = categoriesByKey?.get?.(categoryKey)
  if (row?.color) return row.color
  if (!categoryKey) return 'var(--c-overig)'
  return FALLBACK_ACCENTS[hashKey(categoryKey) % FALLBACK_ACCENTS.length]
}

// Design-formule: één accent → alle tag/rij-tinten via color-mix.
export function catVars(accent) {
  const a = accent || 'var(--c-overig)'
  return {
    '--cat': a,
    '--tag-fg': `color-mix(in oklch, ${a} 82%, #2a241e)`,
    '--tag-bg': `color-mix(in oklch, ${a} 11%, #fff)`,
    '--tag-line': `color-mix(in oklch, ${a} 24%, #fff)`,
    '--tc': a,
  }
}

export function catVarsFor(categoryKey, categoriesByKey) {
  return catVars(accentFor(categoryKey, categoriesByKey))
}

export function catLabel(categoryKey, categoriesByKey) {
  const row = categoriesByKey?.get?.(categoryKey)
  if (row?.label) return row.label
  return categoryKey ? categoryKey.replace(/_/g, ' ') : 'Overige'
}

// ---- Avatar-tint (design: brand / dark / slate) ----
export function avatarTone(email) {
  if (isFromShareholder(email)) return 'brand'
  if (isInternalEmail(email)) return 'dark'
  return 'slate'
}

export function initialsOf(name, email) {
  const src = (name || email || '?').trim()
  const parts = src.split(/[\s.@_-]+/).filter(Boolean)
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
}

// ---- Tijden (design toont '15:23' vandaag, anders '06 mei') ----
export function rowTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

export function msgTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function minutesAgo(iso) {
  if (!iso) return null
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
}

// ---- Kennisbank-relevantiedrempels (empirisch gekalibreerd 2026-07-05:
// écht relevante mail↔artikel-paren scoren ~0.52-0.55, ruisvloer ~0.40-0.46
// op text-embedding-3-large mail-chunks × kb_articles). ----
export const KB_SCORE_GREEN = 0.52
export const KB_SCORE_YELLOW = 0.45
export function kbScoreTone(score) {
  const s = Number(score || 0)
  if (s >= KB_SCORE_GREEN) return 'green'
  if (s >= KB_SCORE_YELLOW) return 'yellow'
  return 'neutral'
}

// ---- Woord-diff voor taalcheck track-changes ----
// LCS op woord-niveau (tokens incl. witruimte behouden zodat de weergave
// exact reconstrueerbaar is). Output: [{type:'same'|'del'|'ins', text}].
export function diffWords(oldText, newText) {
  const tok = s => String(s || '').split(/(\s+)/).filter(t => t.length > 0)
  const a = tok(oldText)
  const b = tok(newText)
  const n = a.length, m = b.length
  // DP-tabel LCS — postvak-drafts zijn kort (< ~1k tokens), dus O(n*m) is ok.
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out = []
  const push = (type, text) => {
    const last = out[out.length - 1]
    if (last && last.type === type) last.text += text
    else out.push({ type, text })
  }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i++ }
    else { push('ins', b[j]); j++ }
  }
  while (i < n) { push('del', a[i]); i++ }
  while (j < m) { push('ins', b[j]); j++ }
  return out
}

export function diffStats(segments) {
  let del = 0, ins = 0
  for (const s of segments) {
    if (s.type === 'del' && s.text.trim()) del++
    if (s.type === 'ins' && s.text.trim()) ins++
  }
  return { del, ins, changed: del + ins > 0 }
}

// ---- Recipients → chips/labels ----
export function recipientEmails(list) {
  const out = []
  if (Array.isArray(list)) {
    for (const x of list) {
      if (typeof x === 'string') out.push({ email: x, name: x })
      else if (x?.email) out.push({ email: x.email, name: x.name || x.email })
      else if (x?.address) out.push({ email: x.address, name: x.name || x.address })
    }
  } else if (typeof list === 'string') {
    for (const e of list.split(',').map(s => s.trim()).filter(Boolean)) out.push({ email: e, name: e })
  }
  return out
}
