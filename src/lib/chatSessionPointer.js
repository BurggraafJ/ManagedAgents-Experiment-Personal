// Analyse — de wijzer naar "het gesprek waar je was" (v1.226).
//
// Jelle: Analyse verlaten → Postvak → terug = hetzelfde gesprek. Het gesprek
// zelf staat al volledig in Supabase (rag_chat_sessions, RLS owner + MFA); het
// enige dat ontbrak was een WIJZER. Die staat hier: één UUID in sessionStorage.
//
//  • sessionStorage = per tab, leeft zolang de tab leeft. Een SPA-navigatie en
//    zelfs een F5 in dezelfde tab houden hem; een écht gesloten tab niet. Dat
//    is precies de eis ("tab dicht → geen herstel nodig").
//  • Inhoud: alleen de UUID. Nooit berichten, nooit een titel. Het lezen van
//    de rij loopt via de bestaande loadSession() en dus via RLS: een vreemde of
//    verouderde UUID levert geen rij en wordt weggegooid (zie useRagChat).
//  • Geen cookie. Nooit een cookie — zie RESEARCH §3 (analyse-session).
//
// Wissen is altijd expliciet (Nieuw, verwijderen van het huidige gesprek, rij
// niet meer zichtbaar). Géén "sessionId is null → wis", want bij mount is hij
// altijd even null en zou de wijzer verdwijnen vóór hij gelezen is.

const KEY = 'lm_analyse_last_session'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isSessionUuid(v) {
  return typeof v === 'string' && UUID.test(v)
}

export function readLastSessionId() {
  try {
    const v = sessionStorage.getItem(KEY)
    return isSessionUuid(v) ? v : null
  } catch {
    return null
  }
}

export function writeLastSessionId(id) {
  if (!isSessionUuid(id)) return
  try { sessionStorage.setItem(KEY, id) } catch { /* privé-modus / quota — dan geen herstel */ }
}

export function clearLastSessionId() {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}
