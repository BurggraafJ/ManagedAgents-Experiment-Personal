// mailPolicy — wie Maestro mag mailen, aan de kant van het scherm.
//
// Spiegel van `supabase/functions/_shared/mail-policy.ts`. Bewust een kopie van
// twee regels en geen gedeeld pakket: dit bestand bestaat om te **vertellen**
// (de knop heet "Concept" in plaats van "Verstuur" zodra er een extern adres in
// staat, en het scherm zegt waarom), niet om te **beveiligen**. Beveiligen doet
// de Edge Function, want een frontend-check kost één devtools-tab.
//
// Beleid van Jelle (2026-09-15 00:44 CEST), HARD:
//   • versturen alleen naar `@legal-mind.nl` — élk adres in Aan, Cc én Bcc
//   • extern of gemengd → géén send, wél een concept
//   • 7 sends per uur per gebruiker (die telt de database, niet dit bestand)

export const SEND_DOMAIN = 'legal-mind.nl'
export const SEND_RATE_PER_HOUR = 7

/**
 * Eén `@`, en het stuk erachter is exact het domein. Geen `endsWith`: dat laat
 * `legal-mind.nl.evil.com` én `notlegal-mind.nl` door.
 */
export function isInternalAddress(addr) {
  const a = String(addr || '').trim().toLowerCase()
  const at = a.lastIndexOf('@')
  if (at <= 0) return false
  return a.slice(at + 1) === SEND_DOMAIN
}

/** Adressen uit een vrij ingetypt veld ("a@b.nl, c@d.nl; e@f.nl"). */
export function splitAddresses(s) {
  return String(s || '')
    .split(/[,;\s]+/).map(x => x.trim()).filter(x => /\S+@\S+\.\S+/.test(x))
}

/**
 * @returns {{ verdict: 'internal'|'external'|'empty', external: string[], total: number }}
 */
export function checkRecipients(...groups) {
  const all = []
  for (const g of groups) for (const a of (g || [])) if (String(a || '').trim()) all.push(String(a).trim())
  if (all.length === 0) return { verdict: 'empty', external: [], total: 0 }
  const external = all.filter(a => !isInternalAddress(a))
  return {
    verdict: external.length > 0 ? 'external' : 'internal',
    external,
    total: all.length,
  }
}

/** De zin die bij een extern adres hoort. Eén plek, zodat hij overal gelijk luidt. */
export function externalCopy(external) {
  const list = external.slice(0, 3).join(', ')
  const rest = external.length > 3 ? ` en ${external.length - 3} andere` : ''
  return `Maestro verstuurt alleen naar @${SEND_DOMAIN}. ${list}${rest} ${external.length === 1 ? 'valt' : 'vallen'} daarbuiten.`
}
