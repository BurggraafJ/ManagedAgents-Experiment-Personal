import { supabase, getRememberedTokens } from './supabase'
import { authLog } from './authLog'

// Herstel van een sessie die auth-js te vroeg heeft weggegooid (v1.150).
//
// auth-js kent maar één retry-klasse: een fetch die gooit (status 0) of een
// HTTP 502/503/504/520-524/530 (`NETWORK_ERROR_CODES` in auth-js
// lib/fetch.js). Álles daarbuiten is voor hem definitief. Dus ook:
//
//   • 429 — GoTrue rate-limit op /token?grant_type=refresh_token
//   • 500 — een hik in de auth-server
//   • 400 refresh_token_already_used — twee contexten die net na elkaar
//     refreshten (zie de storage-opmerking in lib/supabase.js)
//
// In al die gevallen doet auth-js `_removeSession()` en stuurt SIGNED_OUT met
// een lege sessie. Dat is precies de "zomaar naar het loginscherm"-sprong: één
// mislukte refresh, geen tweede poging. Deze module doet die tweede poging wél,
// met het token uit de geheugen-snapshot in lib/supabase.js.
//
// De grens: een token dat de server expliciet heeft ingetrokken (uitgelogd op
// een ander apparaat, wachtwoord gewijzigd, gebruiker verwijderd) is definitief
// en levert direct het loginscherm op. Alleen twijfel wordt opnieuw geprobeerd.

// GoTrue-codes die betekenen: dit token bestaat niet meer. Niet opnieuw proberen.
const REVOKED_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'refresh_token_revoked',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
  'bad_jwt',
])

// Oplopend wachten. Een rate-limit of serverhik is meestal binnen enkele
// seconden voorbij; langer wachten dan dit levert alleen een dashboard op dat
// wel ingelogd lijkt maar niets kan ophalen.
const RETRY_DELAYS_MS = [500, 2000, 4500]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 'revoked' = definitief uitgelogd, 'transient' = het opnieuw waard. */
export function classifyRefreshError(error) {
  if (!error) return 'transient'
  if (error.code && REVOKED_CODES.has(error.code)) return 'revoked'
  if (error.name === 'AuthSessionMissingError') return 'revoked'
  const status = typeof error.status === 'number' ? error.status : null
  if (status === null || status === 0) return 'transient'   // netwerk
  if (status === 408 || status === 429 || status >= 500) return 'transient'
  if (status === 400 || status === 401 || status === 403) return 'revoked'
  return 'transient'
}

let inFlight = null

/**
 * Probeert de zojuist verdwenen sessie terug te halen.
 * Resolvet naar { session, reason } — session=null betekent: echt uitgelogd.
 * Gelijktijdige aanroepen delen dezelfde poging.
 */
export function tryRecoverSession() {
  if (inFlight) return inFlight
  inFlight = runRecovery().finally(() => { inFlight = null })
  return inFlight
}

async function runRecovery() {
  const tokens = getRememberedTokens()
  if (!tokens?.refresh_token) {
    return { session: null, reason: 'no-stored-token' }
  }

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    await sleep(RETRY_DELAYS_MS[attempt - 1])

    // auth-js draait zijn eigen ticker; die kan het intussen al opgelost
    // hebben. Dan niet nóg een refresh doen — dat roteert het token opnieuw en
    // maakt van een geslaagd herstel alsnog een refresh_token_already_used.
    try {
      const { data } = await supabase.auth.getSession()
      if (data?.session) return { session: data.session, reason: `already-restored-attempt-${attempt}` }
    } catch { /* getSession faalt niet echt; door naar de refresh */ }

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: tokens.refresh_token })
    if (data?.session) return { session: data.session, reason: `recovered-attempt-${attempt}` }

    const verdict = classifyRefreshError(error)
    authLog('recovery-attempt-failed', {
      attempt, verdict, status: error?.status ?? null, code: error?.code ?? null,
    })
    if (verdict === 'revoked') {
      // error.code is er alleen als GoTrue de API-versie-header meestuurt;
      // anders blijft de HTTP-status het enige houvast.
      return { session: null, reason: `revoked:${error?.code || `http-${error?.status ?? 'unknown'}`}` }
    }
  }

  return { session: null, reason: 'retries-exhausted' }
}
