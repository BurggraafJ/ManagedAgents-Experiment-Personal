// Opmaak-helpers voor de commerciële borden (D1, D10, later D9). Bewust alleen
// formattering — geen rekenwerk: elk getal op die borden komt uit een view
// (skill `dashboarding`, bouwproces.md "de UI rekent niet"). Wat hier gebeurt
// is uitsluitend "hoe ziet het eruit".
//
// Stond tot v1.174 in `d1/format.js`. Verhuisd naar het niveau erboven toen D10
// dezelfde opmaak nodig had: één bedrag-, bereik- en datumnotatie over alle
// stuurborden is de bedoeling, twee kopieën die uit elkaar lopen niet.

const NL = 'nl-NL'

export function getal(n) {
  if (n === null || n === undefined) return null
  return Number(n).toLocaleString(NL, { maximumFractionDigits: 0 })
}

export function decimaal(n, cijfers = 1) {
  if (n === null || n === undefined) return null
  return Number(n).toLocaleString(NL, { minimumFractionDigits: cijfers, maximumFractionDigits: cijfers })
}

export function euro(n) {
  if (n === null || n === undefined) return null
  return `€ ${Number(n).toLocaleString(NL, { maximumFractionDigits: 0 })}`
}

// Compacte euro's voor staaflabels: € 13,1k. Onder de duizend gewoon voluit,
// want "€ 0,9k" leest slechter dan "€ 875".
export function euroKort(n) {
  if (n === null || n === undefined) return null
  const v = Number(n)
  if (Math.abs(v) < 1000) return `€ ${v.toLocaleString(NL, { maximumFractionDigits: 0 })}`
  return `€ ${(v / 1000).toLocaleString(NL, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`
}

// Bodem–plafond is op dit bord de normale vorm: er bestaat geen enkele
// "pipeline-waarde" (onderzoek §4.8). Eén van beide leeg → geen bereik.
export function bereik(onder, boven, fmt = euro) {
  if (onder === null || onder === undefined || boven === null || boven === undefined) return null
  return `${fmt(onder)} – ${fmt(boven)}`
}

export function maandKort(datum) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(NL, { month: 'short' }).replace('.', '')
}

export function maandJaar(datum) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(NL, { month: 'short', year: '2-digit' }).replace('.', '')
}

export function dagMaand(datum) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(NL, { day: 'numeric', month: 'short' }).replace('.', '')
}

export function datumKort(datum) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(NL, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// De laatste peiling van een bord, kort: "13-09 00:04". Voor de tegel op het
// Dashboard (v1.189) — daar zegt de datum-plus-tijd in één blik van welke
// stand de getallen zijn, zonder de tegel een regel te kosten. Zelfde vorm
// als de peildatum in de standaardbalk van het bord (DataStatusBar, kop).
export function peilingKort(datum) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(NL, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '')
}

// Tooltip bij die peiling: de volle datum plus de leeftijd, als die bekend is.
export function peilingTitel(datum, minutenOud = null) {
  if (!datum) return null
  const d = new Date(datum)
  if (Number.isNaN(d.getTime())) return null
  const vol = d.toLocaleString(NL, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (minutenOud === null || minutenOud === undefined) return `Laatste peiling ${vol}`
  const oud = minutenOud < 60 ? `${minutenOud} min oud`
    : minutenOud < 1440 ? `${Math.floor(minutenOud / 60)} uur oud`
    : `${Math.floor(minutenOud / 1440)} ${Math.floor(minutenOud / 1440) === 1 ? 'dag' : 'dagen'} oud`
  return `Laatste peiling ${vol} · ${oud}`
}

// Label van een forecast-emmer. 'later' en 'geen' zijn échte emmers in de view
// en krijgen hier hun woorden; een maand-emmer leent de naam van zijn datum.
export function bucketLabel(rij) {
  if (rij.soort === 'geen')  return 'Geen datum'
  if (rij.soort === 'later') return 'Later'
  return maandJaar(rij.maand_start) || rij.bucket
}
