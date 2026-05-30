import { useEffect, useState } from 'react'

/**
 * useKbAudience — globale keuze tussen de twee kennisbanken: 'intern' of 'klant'.
 * Default = 'klant'. Persistent in localStorage + live-sync tussen alle
 * kennisbank-schermen (overzicht/review/artikel) via een window-event, en
 * tussen tabs via het storage-event. Geen realtime-channel (veilig om in
 * meerdere componenten te gebruiken).
 */
const KEY = 'knb-audience'
const EVT = 'knb-aud-change'
const read = () => { try { return localStorage.getItem(KEY) || 'klant' } catch { return 'klant' } }

export function useKbAudience() {
  const [aud, setAudState] = useState(read)
  useEffect(() => {
    const sync = () => setAudState(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync) }
  }, [])
  const setAud = (v) => {
    try { localStorage.setItem(KEY, v) } catch { /* ignore */ }
    setAudState(v)
    window.dispatchEvent(new Event(EVT))
  }
  return [aud, setAud]
}
