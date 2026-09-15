import { useCallback, useEffect, useRef, useState } from 'react'

// useLongPressDrag — ingedrukt houden en slepen op een touchscherm (v1.205).
//
// De desktop heeft HTML5 drag-and-drop; op de telefoon bestaat dat niet. Dit
// is de mobiele tegenhanger: houd een rij ~340 ms vast, de rij "licht op" en
// volgt je vinger, en de zone waar je boven zweeft licht op. Loslaten levert
// de zone terug aan `onDrop(id, zone)`.
//
// Drie dingen zijn geen detail:
//   • Vóór de druk-drempel mag de lijst gewoon scrollen. Beweegt de vinger
//     meer dan 10 px vóór de timer afgaat, dan was het een scroll en geen
//     sleep — timer weg, niets gebeurt.
//   • Zodra de sleep loopt MOET native scroll uit. `touch-action: none` zetten
//     werkt hier niet (iOS heeft het gebaar dan al geclaimd), dus een
//     non-passive `touchmove`-luisteraar met preventDefault. Dat kan alleen
//     omdat de scroll nog niet begonnen is — zie de vorige regel.
//   • Het sleepbeeld (de "ghost") krijgt `pointer-events: none` in de CSS,
//     anders wijst `elementFromPoint` altijd naar de ghost zelf en vindt de
//     hook nooit een zone.
//
// Auto-scroll aan de rand: de prio-groepen passen zelden samen op één scherm,
// dus bij de bovenste/onderste 96 px schuift de scroller mee.
const HOLD_MS = 340
const MOVE_CANCEL_PX = 10
const EDGE_PX = 96
const EDGE_STEP = 14
const CLICK_SWALLOW_MS = 400

export function useLongPressDrag({
  onDrop,
  zoneAttr = 'data-dropzone',
  nodragSelector = '[data-nodrag]',
  holdMs = HOLD_MS,
  scrollSelector = '.m-main',
} = {}) {
  // { id, label, left, width, height, top, zone } — null als er niet gesleept wordt.
  const [drag, setDrag] = useState(null)
  const st = useRef(null)
  const rafId = useRef(0)
  const justDragged = useRef(false)

  const zoneAt = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y)
    return el?.closest(`[${zoneAttr}]`)?.getAttribute(zoneAttr) || null
  }, [zoneAttr])

  const stop = useCallback(() => {
    const s = st.current
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    window.removeEventListener('pointermove', s.onMove)
    window.removeEventListener('pointerup', s.onUp)
    window.removeEventListener('pointercancel', s.onUp)
    document.removeEventListener('touchmove', s.onTouch, { passive: false })
    st.current = null
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = 0 }
    document.documentElement.classList.remove('m-dragging')
    setDrag(null)
  }, [])

  useEffect(() => stop, [stop])

  const tick = useCallback(() => {
    const s = st.current
    if (!s?.active) { rafId.current = 0; return }
    const sc = document.querySelector(scrollSelector)
    if (sc) {
      if (s.y < EDGE_PX) sc.scrollTop -= EDGE_STEP
      else if (s.y > window.innerHeight - EDGE_PX) sc.scrollTop += EDGE_STEP
    }
    rafId.current = requestAnimationFrame(tick)
  }, [scrollSelector])

  const onPointerDown = useCallback((e, id, label) => {
    if (!e.isPrimary || (e.button != null && e.button > 0)) return
    if (e.target?.closest?.(nodragSelector)) return
    if (st.current) stop()

    const rect = e.currentTarget.getBoundingClientRect()
    const s = {
      id, label, pointerId: e.pointerId,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
      grabY: e.clientY - rect.top,
      left: rect.left, width: rect.width, height: rect.height,
      active: false, timer: null,
    }

    s.onMove = (ev) => {
      if (ev.pointerId !== s.pointerId) return
      s.x = ev.clientX; s.y = ev.clientY
      if (!s.active) {
        if (Math.abs(ev.clientY - s.y0) > MOVE_CANCEL_PX || Math.abs(ev.clientX - s.x0) > MOVE_CANCEL_PX) stop()
        return
      }
      setDrag(d => (d ? { ...d, top: s.y - s.grabY, zone: zoneAt(s.x, s.y) } : d))
    }
    s.onUp = (ev) => {
      if (ev.pointerId !== s.pointerId) return
      const wasActive = s.active
      const zone = wasActive ? zoneAt(s.x, s.y) : null
      stop()
      if (!wasActive) return
      // Een sleep eindigt met een pointerup, en die wordt door de browser
      // gevolgd door een click op de rij. Die click zou de detail-sheet
      // openen — precies niet wat je bedoelde. Kort dempen.
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, CLICK_SWALLOW_MS)
      if (zone) onDrop?.(id, zone)
    }
    s.onTouch = (ev) => { if (s.active) ev.preventDefault() }

    s.timer = setTimeout(() => {
      s.timer = null
      s.active = true
      try { navigator.vibrate?.(12) } catch { /* geen haptics op deze telefoon */ }
      document.documentElement.classList.add('m-dragging')
      setDrag({ id, label, left: s.left, width: s.width, height: s.height, top: s.y - s.grabY, zone: zoneAt(s.x, s.y) })
      if (!rafId.current) rafId.current = requestAnimationFrame(tick)
    }, holdMs)

    st.current = s
    window.addEventListener('pointermove', s.onMove)
    window.addEventListener('pointerup', s.onUp)
    window.addEventListener('pointercancel', s.onUp)
    document.addEventListener('touchmove', s.onTouch, { passive: false })
  }, [holdMs, nodragSelector, onDrop, stop, tick, zoneAt])

  const rowProps = useCallback((id, label) => ({
    onPointerDown: (e) => onPointerDown(e, id, label),
  }), [onPointerDown])

  // Op de container die de rijen bevat: slikt de click die ná een sleep komt.
  const swallowClick = useCallback((e) => {
    if (!justDragged.current) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  return { drag, rowProps, swallowClick }
}
