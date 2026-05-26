import { useState } from 'react'
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
//
// Versie: bij needRefresh halen we /version.json op (niet door de SW gecached)
// = de versie waar je naartoe update. Fallback op de in-bundle build-tijd.

const CHECK_INTERVAL_MS = 60 * 1000
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : null
// eslint-disable-next-line no-undef
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null

// Build-tijd → leesbaar moment, bv "27 mei, 14:32".
function whenLabel(iso) {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('nl-NL', {
      timeZone: 'Europe/Amsterdam', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso)).replace(' om ', ', ')
  } catch { return null }
}

export default function ReloadPrompt() {
  const [info, setInfo] = useState(null) // { version, builtAt } van de nieuwe deploy
  const [reloading, setReloading] = useState(false)

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        if (!navigator.onLine) return
        registration.update().catch(() => {})
      }, CHECK_INTERVAL_MS)
    },
    onNeedRefresh() {
      // Haal de versie op waar we naartoe updaten (niet door SW gecached).
      fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setInfo({ version: j?.version || null, builtAt: j?.builtAt || null }))
        .catch(() => setInfo(null))
    },
    onRegisterError(err) {
      // eslint-disable-next-line no-console
      console.error('Service worker registratie faalde:', err)
    },
  })

  if (!needRefresh) return null

  const version = info?.version || APP_VERSION
  const when = whenLabel(info?.builtAt || BUILD_TIME)

  // updateServiceWorker(true) activeert de nieuwe SW en herlaadt via
  // controllerchange (clientsClaim zorgt dat die vuurt). Fallback-reload als
  // extra vangnet mocht de controllerchange in een edge-case uitblijven.
  // reloading-state geeft directe feedback (spinner) zodat de klik nooit
  // 'dood' aanvoelt terwijl de nieuwe versie wordt geladen.
  function handleReload() {
    if (reloading) return
    setReloading(true)
    try { updateServiceWorker(true) } catch { /* noop */ }
    setTimeout(() => window.location.reload(), 2500)
  }

  return (
    <div className="rlp" role="status" aria-live="polite">
      <span className="rlp__glow" aria-hidden="true" />
      <div className="rlp__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z" />
          <path d="M19 3v3M20.5 4.5h-3M5 17v2M6 18H4" />
        </svg>
      </div>

      <div className="rlp__body">
        <div className="rlp__eyebrow">
          <span className="rlp__dot" />
          Update klaar
        </div>
        <div className="rlp__title">Nieuwe versie beschikbaar</div>
        <div className="rlp__meta">
          {version && <span className="rlp__ver">v{version}</span>}
          {when && <span className="rlp__when">{when}</span>}
        </div>
      </div>

      <div className="rlp__actions">
        <button className={`rlp__btn ${reloading ? 'is-loading' : ''}`} type="button" onClick={handleReload} disabled={reloading}>
          {reloading ? (
            <>
              <svg className="rlp__spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-6.2-8.6" />
              </svg>
              Bezig…
            </>
          ) : (
            <>
              Herladen
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </>
          )}
        </button>
        <button className="rlp__later" type="button" onClick={() => setNeedRefresh(false)} disabled={reloading}>
          Later
        </button>
      </div>
    </div>
  )
}
