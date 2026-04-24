import { useState, useEffect } from 'react'

// Simpele media-query-hook. Retourneert true/false en update live bij resize
// of device-rotate. Gebruikt voor mobile/desktop-splitsing in views.
//
// Voorbeeld: `const isMobile = useMediaQuery('(max-width: 768px)')`.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    // Moderne API; fallback op addListener voor oudere Safari.
    if (mql.addEventListener) mql.addEventListener('change', update)
    else mql.addListener(update)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', update)
      else mql.removeListener(update)
    }
  }, [query])

  return matches
}
