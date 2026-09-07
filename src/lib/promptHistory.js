// =============================================================================
// promptHistory — de vragen die JIJ stelde, lokaal bewaard
// =============================================================================
// Los van HistoryPanel (dat toont *gesprekken* uit rag_chat_sessions). Dit is
// de platte lijst losse prompts achter de composer-knop "Eerdere vragen", op
// desktop én mobiel gevoed vanuit één plek: useRagChat.send().
//
// Waarom localStorage en niet de database: de sessie-rijen dragen het volledige
// bericht incl. citations/steps mee, dus "alle user-prompts van de laatste 50
// gesprekken" ophalen betekent megabytes JSON downloaden voor een popover die
// binnen 100 ms open moet staan. De prompt zelf is klein, hoort bij dit apparaat
// en overleeft een reload — precies wat localStorage doet.
// =============================================================================

const KEY = 'rag-prompt-history'
export const MAX_PROMPTS = 50

// Losse abonnees (popover op desktop, sheet op mobiel). Een Set zodat dezelfde
// callback nooit dubbel vuurt.
const listeners = new Set()

function emit() {
  for (const fn of listeners) {
    try { fn() } catch { /* een kapotte luisteraar mag de rest niet stoppen */ }
  }
}

function readRaw() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    // Defensief: één corrupte rij mag de hele lijst niet onbruikbaar maken.
    return parsed
      .filter(row => row && typeof row.q === 'string' && row.q.trim())
      .map(row => ({ q: row.q, ts: Number(row.ts) || Date.now() }))
      .slice(0, MAX_PROMPTS)
  } catch { return [] }
}

function writeRaw(rows) {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX_PROMPTS))) }
  catch { /* private mode / vol quotum — de chat zelf mag hier niet op stuklopen */ }
  emit()
}

// Nieuwste eerst.
export function readPromptHistory() {
  return readRaw()
}

// Eén verstuurde vraag erbij. Dezelfde vraag opnieuw stellen verplaatst hem naar
// boven in plaats van een duplicaat toe te voegen — anders vult een herhaalde
// testvraag de hele lijst.
export function recordPrompt(text) {
  const q = (text || '').trim()
  if (!q) return
  const key = q.toLowerCase()
  const rest = readRaw().filter(row => row.q.trim().toLowerCase() !== key)
  writeRaw([{ q, ts: Date.now() }, ...rest])
}

export function clearPromptHistory() {
  writeRaw([])
}

// Abonneer op wijzigingen. Ook op het `storage`-event, zodat een tweede tab die
// een vraag stelt de open popover in deze tab bijwerkt.
export function subscribePromptHistory(fn) {
  listeners.add(fn)
  const onStorage = (e) => { if (e.key === KEY) fn() }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}
