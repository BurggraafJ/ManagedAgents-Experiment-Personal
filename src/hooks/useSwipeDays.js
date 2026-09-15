import { useRef } from 'react'

/**
 * useSwipeDays — horizontaal vegen = een dag vooruit of terug (v1.216).
 *
 * Geeft touch-handlers terug voor op het dag-grid. Dezelfde as-keuze als de
 * veegrij in het Postvak (MobilePostvakRow): de éérste beweging bepaalt of het
 * gebaar horizontaal of verticaal is, en een verticaal gebaar blijft van deze
 * hook af zodat scrollen door de dag nooit met vegen vecht. Geen
 * `preventDefault`, geen eigen scroll — de browser scrollt gewoon door.
 *
 *   onPrev  — veeg naar rechts (van links naar rechts) → vorige dag
 *   onNext  — veeg naar links → volgende dag
 *
 * Drempels: minstens 48 px horizontaal en duidelijk horizontaler dan verticaal.
 * Een tik op een event-blok is geen veeg (te kort), en de blokken zelf
 * stoppen hun klik al, dus dit botst niet met openen of met het tijdvak-tikken.
 */
const MIN_DX = 48
const AXIS_AT = 8

export function useSwipeDays({ onPrev, onNext, disabled = false }) {
  const start = useRef(null)

  const onTouchStart = (e) => {
    if (disabled || e.touches.length !== 1) { start.current = null; return }
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, axis: null }
  }

  const onTouchMove = (e) => {
    const s = start.current
    if (!s || s.axis) return
    const t = e.touches[0]
    const dx = Math.abs(t.clientX - s.x)
    const dy = Math.abs(t.clientY - s.y)
    if (dx < AXIS_AT && dy < AXIS_AT) return
    s.axis = dx > dy * 1.4 ? 'x' : 'y'
  }

  const onTouchEnd = (e) => {
    const s = start.current
    start.current = null
    if (!s || s.axis !== 'x') return
    const t = e.changedTouches && e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - s.x
    if (Math.abs(dx) < MIN_DX) return
    if (dx < 0) onNext?.()
    else onPrev?.()
  }

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => { start.current = null } }
}
