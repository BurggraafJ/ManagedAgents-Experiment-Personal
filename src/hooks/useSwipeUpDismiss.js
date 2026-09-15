import { useCallback, useEffect, useRef, useState } from 'react'

// =============================================================================
// useSwipeUpDismiss — een harde veeg omhoog sluit een schermvullend vel
// =============================================================================
// De mail op de telefoon staat schermvullend (`.m-mailsheet`), met alleen een
// chevron linksboven als weg terug. Jelle's vraag (2026-09-15): een **harde
// veeg omhoog, helemaal naar boven** hoort terug naar de lijst te gaan — het
// gevoel van de iOS-terugveeg, maar dan verticaal, omdat de mail-body zelf
// nooit horizontaal veegt en de lijstrij dat gebaar al voor de acties gebruikt.
//
// ── Het probleem: omhoog vegen is ook gewoon scrollen ─────────────────────
// Elke leesbeweging in een lange mail is een veeg omhoog. Dus het gebaar
// mag níet winnen van scrollen; het moet er duidelijk bóven zitten. Twee
// wegen naar sluiten, allebei bewust streng:
//
//   1. **De worp.** Van (onder in) het scherm tot in de bovenste strook, in
//      één snelle beweging: minstens de helft van de schermhoogte, eindigend
//      in de bovenste 22 %, met een snelheid die geen leesbeweging haalt. Een
//      leesveeg is 150–300 px op gemak; een worp over een 850 px-scherm is
//      425 px+ in een tel. Daartussen zit lucht, en dat is de bedoeling.
//   2. **Onderaan.** Kan de body niet verder (je staat al op het eind, of de
//      mail is korter dan het scherm), dan is er niets meer te scrollen en
//      betekent een stevige veeg omhoog maar één ding. Dan volstaat een derde
//      van het scherm.
//
// Wat het gebaar bewust NIET doet:
//   • `preventDefault` — de native scroll blijft de baas tot het moment dat
//     we sluiten. Geen `touch-action: none` op de body, want dan scrolt er
//     niets meer.
//   • het vel laten meebewegen tijdens de veeg. Dat zou een tweede visuele
//     laag over de scroll leggen die om de paar px van gedachten wisselt.
//     Bij het besluit tot sluiten glijdt het vel in één keer omhoog weg
//     (`is-leaving`, ~180 ms) en dán pas roept hij `onDismiss` aan.
//   • starten vanuit een invoerveld. Het concept-tekstvak onderin heeft zijn
//     eigen scroll en het toetsenbord; een veeg dáár is typen, geen gebaar.
//
// Touch-events, geen pointer-events: hier is geen sleepvlak dat we vastpakken
// (vergelijk useSheetDrag), het is de body zelf die scrolt, en die willen we
// alleen bekijken, niet claimen.
// =============================================================================

const THROW_FRACTION = 0.5       // deel van de schermhoogte dat de vinger omhoog moet
const THROW_END_ZONE = 0.22      // de vinger eindigt in de bovenste 22 %
const THROW_MIN_SPEED = 0.6      // px/ms — een leesveeg zit daar ruim onder
const AT_END_FRACTION = 0.32     // staat de body al op het eind: een derde volstaat
const AT_END_MIN_SPEED = 0.45    // px/ms
const MAX_DRIFT_X = 90           // px zijwaarts — meer is een schuine, geen worp
const LEAVE_MS = 180             // duur van de weg-glij-animatie (zie mobile.css)

const atScrollEnd = (el) => !el || (el.scrollTop + el.clientHeight >= el.scrollHeight - 2)

export function useSwipeUpDismiss({ onDismiss, scrollRef, enabled = true } = {}) {
  const start = useRef(null)
  const timer = useRef(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onTouchStart = useCallback((e) => {
    if (!enabled || leaving || e.touches.length !== 1) { start.current = null; return }
    if (e.target?.closest?.('textarea, input, select, [contenteditable="true"]')) { start.current = null; return }
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, t: Date.now(), atEnd: atScrollEnd(scrollRef?.current) }
  }, [enabled, leaving, scrollRef])

  // Een tweede vinger erbij = knijpen/zoomen, geen worp.
  const onTouchMove = useCallback((e) => {
    if (e.touches.length !== 1) start.current = null
  }, [])

  const onTouchEnd = useCallback((e) => {
    const s = start.current
    start.current = null
    if (!s) return
    const t = e.changedTouches?.[0]
    if (!t) return
    const up = s.y - t.clientY                                 // positief = omhoog
    const drift = Math.abs(t.clientX - s.x)
    const speed = up / Math.max(Date.now() - s.t, 1)
    const vh = window.innerHeight || 800
    if (drift > MAX_DRIFT_X || up <= 0) return

    const worp = up >= vh * THROW_FRACTION && t.clientY <= vh * THROW_END_ZONE && speed >= THROW_MIN_SPEED
    const onderaan = s.atEnd && up >= vh * AT_END_FRACTION && speed >= AT_END_MIN_SPEED
    if (!worp && !onderaan) return

    setLeaving(true)
    timer.current = setTimeout(() => { timer.current = null; onDismiss?.() }, LEAVE_MS)
  }, [onDismiss])

  const onTouchCancel = useCallback(() => { start.current = null }, [])

  return {
    leaving,
    handleProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  }
}
