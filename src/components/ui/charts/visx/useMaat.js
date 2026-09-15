import { useEffect, useState } from 'react'

/**
 * Breedte én hoogte van een container, live via ResizeObserver.
 *
 * De Visx-charts tekenen op echte pixelmaat (geen viewBox-schaling): een kaart
 * op het Live-bord geeft zijn plotgebied door en de chart vult het. Geeft
 * `null` terug tot de eerste meting zodat de aanroeper geen frame in de
 * verkeerde maat rendert. Zusje van `useContainerBreedte` (C4) — daar telt
 * alleen de breedte, hier ook de hoogte, want het bord scrollt niet en de
 * kaart bepaalt hoe hoog een chart mag zijn.
 */
export default function useMaat(ref) {
  const [maat, setMaat] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const lees = () => {
      const r = el.getBoundingClientRect()
      setMaat({ breedte: Math.floor(r.width), hoogte: Math.floor(r.height) })
    }
    lees()
    // Ook op window-resize meten: een viewport die ná de eerste layout van
    // maat verandert (headless Chrome past --window-size pas na de eerste
    // frame toe) levert anders een chart die op de oude hoogte blijft staan.
    window.addEventListener('resize', lees)
    if (typeof ResizeObserver === 'undefined') return () => window.removeEventListener('resize', lees)
    const ro = new ResizeObserver(entries => {
      const c = entries[0]?.contentRect
      if (c) setMaat({ breedte: Math.floor(c.width), hoogte: Math.floor(c.height) })
    })
    ro.observe(el)
    return () => { ro.disconnect(); window.removeEventListener('resize', lees) }
  }, [ref])

  return maat
}

/**
 * Een "nette" as-top met drie ticks (0 · midden · top) voor kleine reeksen.
 * Bij een maximum ≤ 10 is de top 10 (dat is de schaal van het doel 8 op de
 * kaart Kennismakingen); daarboven de eerstvolgende ronde stap.
 */
export function netteTop(max) {
  const m = Math.max(0, Number(max) || 0)
  if (m <= 10) return 10
  const stap = m <= 20 ? 10 : m <= 50 ? 10 : m <= 100 ? 20 : m <= 300 ? 50 : 100
  return Math.ceil(m / stap) * stap
}
