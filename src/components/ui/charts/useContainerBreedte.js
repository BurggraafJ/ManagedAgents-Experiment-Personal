import { useEffect, useState } from 'react'

/**
 * Breedte van een container, live via ResizeObserver.
 *
 * Voor primitieven die hun layout aan de **containerbreedte** hangen en niet
 * aan de viewport (C4: balk onder ↔ kolom op 560 px — het D10-masterpaneel is
 * op desktop smal genoeg om zich als "smal" te gedragen). Geeft `null` terug
 * tot de eerste meting, zodat de aanroeper zelf een startlayout kan kiezen in
 * plaats van één frame in de verkeerde vorm te renderen.
 */
export default function useContainerBreedte(ref) {
  const [breedte, setBreedte] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof ResizeObserver === 'undefined') {
      setBreedte(el.getBoundingClientRect().width)
      return undefined
    }
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width
      if (w !== undefined) setBreedte(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return breedte
}
