import { useRegisterSW } from 'virtual:pwa-register/react'
import './reload-prompt.css'

// ReloadPrompt — Claude-achtige "nieuwe versie beschikbaar"-popup linksonder.
//
// De PWA staat op registerType:'prompt' (vite.config). Zodra een nieuwe deploy
// live is, installeert de service worker zich en blijft in 'waiting'. Deze
// hook detecteert dat (needRefresh=true) → popup. Klik op Herladen roept
// updateServiceWorker(true) aan: stuurt SKIP_WAITING naar de nieuwe SW en
// herlaadt de pagina met de nieuwe assets.
//
// Een periodieke r.update() (elke minuut) zorgt dat de popup vanzelf verschijnt
// terwijl het dashboard openstaat — geen handmatige refresh meer nodig.

const CHECK_INTERVAL_MS = 60 * 1000

export default function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        // Alleen checken als de tab niet offline is; voorkomt nutteloze fetches.
        if (!navigator.onLine) return
        registration.update().catch(() => {})
      }, CHECK_INTERVAL_MS)
    },
    onRegisterError(err) {
      // eslint-disable-next-line no-console
      console.error('Service worker registratie faalde:', err)
    },
  })

  if (!needRefresh) return null

  return (
    <div className="rlp" role="status" aria-live="polite">
      <div className="rlp__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
        </svg>
      </div>
      <div className="rlp__body">
        <div className="rlp__title">Nieuwe versie beschikbaar</div>
        <div className="rlp__sub">Herlaad om de laatste updates te zien.</div>
      </div>
      <button className="rlp__btn" type="button" onClick={() => updateServiceWorker(true)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
        </svg>
        Herladen
      </button>
      <button className="rlp__close" type="button" aria-label="Sluiten" onClick={() => setNeedRefresh(false)}>
        ×
      </button>
    </div>
  )
}
