import { useEffect, useRef } from 'react'

/**
 * useScrollToNow — zet de "nu"-lijn in het MIDDEN van de scrollport (v1.216).
 *
 * Tot v1.215 opende de agenda bovenaan de dag (08:00) en moest je zelf naar
 * het huidige tijdstip scrollen. Jelle wil het zoals Outlook: open, en je
 * kijkt naar nu.
 *
 *   ref  — een element ín het grid dat het huidige tijdstip markeert
 *          (`.ag-now-line` op de desktop, `.m-agl__now` op de telefoon).
 *   key  — waarvoor deze positie geldt (dagsleutel of weeksleutel). Verandert
 *          de sleutel, dan mag er opnieuw gescrold worden; blijft hij gelijk,
 *          dan niet — anders trekt elke re-render (klok, sync, realtime) de
 *          gebruiker terug terwijl die net naar 15:00 aan het kijken was.
 *   enabled — false als de getoonde dag niet vandaag is (er is dan geen nu).
 *   insetTop — px (of een functie die px teruggeeft) die bovenaan de scrollport
 *          door een sticky kop wordt afgedekt. Op de telefoon is dat de
 *          `.m-ag__head` (weekstrip + titel, ±190 px): zonder correctie ligt
 *          "het midden" dan zichtbaar onder het midden.
 *
 * De scrollport wordt gezocht, niet aangenomen: op de desktop is dat
 * `.ag-grid__body` (overflow-y: auto), op de telefoon `.m-main`. Zo werkt
 * dezelfde hook voor beide zonder dat een van de twee de ander z'n
 * class-naam hoeft te kennen. `scrollIntoView({ block: 'center' })` deed dit
 * ook, maar scrollt in Safari óók de buitenste pagina mee; hier alleen de
 * dichtstbijzijnde scrollport.
 */
export function useScrollToNow(ref, key, enabled = true, { insetTop = 0 } = {}) {
  const doneFor = useRef(null)

  useEffect(() => {
    if (!enabled || !ref.current) return
    if (doneFor.current === key) return
    const el = ref.current
    const port = scrollParentOf(el)
    if (!port) return
    // Na de layout, zodat de hoogte van de scrollport klopt (het grid krijgt
    // zijn `flex: 1`-hoogte pas ná de eerste paint van de omliggende shell).
    const id = requestAnimationFrame(() => {
      const inset = typeof insetTop === 'function' ? (insetTop() || 0) : insetTop
      const visible = Math.max(0, port.clientHeight - inset)
      const target = offsetWithin(el, port) - inset - visible / 2
      port.scrollTop = Math.max(0, target)
      doneFor.current = key
    })
    return () => cancelAnimationFrame(id)
    // `insetTop` bewust niet in de deps: een inline functie zou het effect elke
    // render opnieuw laten lopen, en `doneFor` maakt dat toch een no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, key, enabled])
}

function scrollParentOf(el) {
  let node = el.parentElement
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    node = node.parentElement
  }
  return null
}

/** Afstand van `el` tot de bovenkant van de inhoud van `port` (niet van het scherm). */
function offsetWithin(el, port) {
  const a = el.getBoundingClientRect()
  const b = port.getBoundingClientRect()
  return a.top - b.top + port.scrollTop
}
