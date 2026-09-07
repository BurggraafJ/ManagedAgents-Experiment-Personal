import { useLayoutEffect } from 'react'

// Auto-groeiende textarea (ChatGPT-stijl): één regel hoog bij een lege
// composer, groeit mee met de inhoud tot de `max-height` uit de CSS en scrollt
// daarna binnen het veld. De CSS blijft dus de bron van de afmetingen
// (min-height / max-height); de hook zet alleen de tussenliggende hoogte —
// een content-gedreven dimensie, en die mag inline (CLAUDE.md → conventies).
//
// useLayoutEffect en niet useEffect: de hoogte wordt vóór de paint gezet, zodat
// een extra regel niet één frame lang als sprong zichtbaar is.
export function useAutoGrow(ref, value) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Eerst loslaten: scrollHeight krimpt anders niet mee als er een regel af gaat.
    el.style.height = 'auto'
    const cs = getComputedStyle(el)
    // scrollHeight telt padding wél mee, border niet. Bij border-box moet de
    // border er dus bij; bij content-box moet de padding eraf.
    const extra = cs.boxSizing === 'border-box'
      ? (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
      : -((parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0))
    const wanted = el.scrollHeight + extra
    const max = parseFloat(cs.maxHeight)
    const capped = Number.isFinite(max) && wanted > max
    el.style.height = `${capped ? max : wanted}px`
    el.style.overflowY = capped ? 'auto' : 'hidden'
  }, [ref, value])
}
