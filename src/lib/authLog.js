// Waarom-log voor auth-overgangen (v1.150).
//
// Tot nu toe eindigde élke route naar het loginscherm — idle-timer, verlopen
// 7-dagen venster, mislukte token-refresh, een andere tab — in dezelfde stille
// `status='no-session'`. Daardoor was "ik werd zomaar uitgelogd" niet te
// diagnosticeren: er was geen enkel spoor van wélke route het was.
//
// Elke overgang schrijft nu een regel met een reason: in de console én in een
// kleine ring-buffer in localStorage. Die buffer is er voor de iPhone-PWA —
// daar is de console weg zodra de app herlaadt, dus zonder buffer is het bewijs
// verdwenen op precies het moment dat je het nodig hebt.
//
// Uitlezen: `__lmAuthLog()` in de console (Safari remote debug op de iPhone).

const LOG_KEY = 'lm_auth_log'
const MAX_ENTRIES = 25

function append(entry) {
  try {
    const raw = localStorage.getItem(LOG_KEY)
    const list = raw ? JSON.parse(raw) : []
    list.push(entry)
    localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_ENTRIES)))
  } catch { /* private mode of vol quotum — de console-regel blijft over */ }
}

/** Niet-terminale gebeurtenis: herstelpoging, storage-migratie, mode-override. */
export function authLog(reason, detail) {
  append({ at: new Date().toISOString(), kind: 'event', reason, detail: detail ?? null })
  // eslint-disable-next-line no-console
  console.info(`[auth] ${reason}`, detail ?? '')
}

/** Terminale overgang naar het loginscherm. Altijd met een reason. */
export function authLogout(reason, detail) {
  append({ at: new Date().toISOString(), kind: 'logout', reason, detail: detail ?? null })
  // eslint-disable-next-line no-console
  console.warn(`[auth] logout reason=${reason}`, detail ?? '')
}

/** De laatste 25 regels, nieuwste onderaan. */
export function readAuthLog() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]') } catch { return [] }
}

export function clearAuthLog() {
  try { localStorage.removeItem(LOG_KEY) } catch { /* noop */ }
}

if (typeof window !== 'undefined') {
  window.__lmAuthLog = readAuthLog
  window.__lmAuthLogClear = clearAuthLog
}
