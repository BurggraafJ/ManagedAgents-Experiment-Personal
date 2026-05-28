// Avatar-helpers — initialen + deterministische kleur per email/identiteit.
// Outlook-stijl palette zodat avatars consistent voelen tussen sessies (hash
// op email garandeert dat dezelfde afzender altijd dezelfde kleur krijgt).

// Outlook-look palette — 10 kleuren met genoeg contrast voor witte tekst.
const PALETTE = [
  '#0078d4', // blue
  '#2b88d8', // light-blue
  '#107c10', // green
  '#498205', // dark-green
  '#d83b01', // orange
  '#c239b3', // pink
  '#5c2d91', // purple
  '#a4262c', // red
  '#0099bc', // teal
  '#a0522d', // sienna
]

// Stabiele FNV-1a-achtige string-hash → palette-index. Niet crypto-grade,
// alleen voor visuele assignment.
function hashCode(s) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return h >>> 0
}

export function colorForEmail(email) {
  const key = String(email || '').toLowerCase().trim()
  if (!key) return PALETTE[0]
  return PALETTE[hashCode(key) % PALETTE.length]
}

// Initialen: probeer voornaam + achternaam uit from_name. Fallback: eerste
// twee letters van email local-part (jelle.burggraaf@x.nl → "JB"). Speciale
// case "Jij" voor eigen mails — geeft "J".
export function initialsFor(name, email) {
  const n = String(name || '').trim()
  if (n) {
    if (n === 'Jij' || n === 'jij') return 'J'
    // Strip "aan " prefix (komt voor bij awaiting-mails)
    const cleaned = n.replace(/^aan\s+/i, '').trim()
    // Eerst zinnige naam-tokens (geen leestekens)
    const tokens = cleaned.split(/[\s,]+/).filter(t => /[a-z]/i.test(t))
    if (tokens.length >= 2) {
      const first = tokens[0][0] || ''
      const last  = tokens[tokens.length - 1][0] || ''
      return (first + last).toUpperCase()
    }
    if (tokens.length === 1 && tokens[0].length > 0) {
      return tokens[0].slice(0, 2).toUpperCase()
    }
  }
  const e = String(email || '').trim()
  if (e) {
    const local = e.split('@')[0] || ''
    if (local) {
      // Probeer "voor.naam" → "VN"
      const parts = local.split(/[._-]+/).filter(Boolean)
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
      return local.slice(0, 2).toUpperCase()
    }
  }
  return '—'
}
