// Klok-logica achter het tijdgebonden thema (v1.143).
//
// Het dashboard volgt standaard de tijd van de dag in Europe/Amsterdam:
// overdag licht, 's avonds/'s nachts donker. Bewust géén device-tijdzone —
// Jelle werkt in NL en wil dat de app in NL-ritme meebeweegt, ook als het
// device (of een preview-omgeving) op UTC staat.
//
// Geen React hier: puur functies op een Date, zodat ze los te testen zijn.
// De hook die dit gebruikt is src/hooks/useTheme.js.

const TZ = 'Europe/Amsterdam'

// Licht-venster: 07:00 (inclusief) tot 19:00 (exclusief) NL-tijd.
// Aanname van 2026-09-03; verander alleen deze twee constantes als Jelle een
// ander venster wil — de rest van de logica volgt automatisch.
export const LIGHT_FROM_SEC = 7 * 3600
export const LIGHT_UNTIL_SEC = 19 * 3600

const AMS = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

// Wandklok in Amsterdam op dit moment: kalenderdatum + seconden-sinds-middernacht.
// Via Intl, dus DST (zomer-/wintertijd) klopt vanzelf.
function amsParts(date) {
  const p = {}
  for (const { type, value } of AMS.formatToParts(date)) p[type] = value
  // Sommige engines geven '24' voor middernacht ondanks hourCycle h23.
  const hour = Number(p.hour) % 24
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    sec: hour * 3600 + Number(p.minute) * 60 + Number(p.second),
  }
}

function isLightSec(sec) {
  return sec >= LIGHT_FROM_SEC && sec < LIGHT_UNTIL_SEC
}

// Welk thema hoort bij dit moment als niemand iets overschreven heeft?
export function themeAt(date) {
  return isLightSec(amsParts(date).sec) ? 'light' : 'dark'
}

// Id van het dagdeel waar dit moment in valt: '2026-09-03L' (07:00–19:00) of
// '2026-09-03D' (19:00–07:00). De nacht hoort bij de kalenderdag waarop hij om
// 19:00 begón — anders zou een override die om 23:00 gezet wordt al om
// middernacht vervallen in plaats van om 07:00.
//
// Dit id is de vervaldatum van een override: zolang het id gelijk blijft, zit
// je nog in hetzelfde dagdeel. Dat is DST-proof (geen los uur-rekenwerk) en
// exact "tot de eerstvolgende 07:00/19:00-grens".
export function segmentAt(date) {
  const { y, m, d, sec } = amsParts(date)
  if (isLightSec(sec)) return `${stamp(y, m, d)}L`
  if (sec >= LIGHT_UNTIL_SEC) return `${stamp(y, m, d)}D`
  // Vóór 07:00: dit is de nacht die gisteren om 19:00 begon.
  const prev = new Date(Date.UTC(y, m - 1, d) - 86400000)
  return `${prev.toISOString().slice(0, 10)}D`
}

function stamp(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Milliseconden tot de eerstvolgende 07:00/19:00-grens. Alleen gebruikt om de
// timer te plannen, nooit om het thema zelf te bepalen — dat wordt elke tick
// opnieuw uit de echte klok afgeleid. Op de twee DST-nachten per jaar kan deze
// afstand er een uur naast zitten; de klem van 60 s in useTheme vangt dat op.
export function msUntilNextBoundary(date) {
  const { sec } = amsParts(date)
  const next = sec < LIGHT_FROM_SEC ? LIGHT_FROM_SEC
    : sec < LIGHT_UNTIL_SEC ? LIGHT_UNTIL_SEC
    : LIGHT_FROM_SEC + 86400
  return (next - sec) * 1000 - date.getMilliseconds()
}
