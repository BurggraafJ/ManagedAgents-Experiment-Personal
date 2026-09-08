import { useCallback, useRef, useState } from 'react'

// useSheetDrag — sleep een bottom-sheet naar beneden om hem te sluiten.
//
// Tot v1.156 had géén enkele mobiele sheet dit: het greepje boven de kop was
// puur decoratief (`aria-hidden`), en de enige sluiter was een tik op het
// scrim. Bij de Onderzoek-sheet zat dat scrim voor een deel áchter de composer
// en de tabbar, dus dan was er in de praktijk geen weg terug — Jelle's bug
// ("greepje zichtbaar, slepen doet niets", 2026-09-08).
//
// Waarom pointer-events en niet touch-events: één set handlers dekt vinger,
// stylus en muis, en `setPointerCapture` houdt de beweging bij dit element ook
// als je vinger buiten de greep komt. Dat laatste is precies wat een sleep is.
//
// Twee dingen zijn geen detail:
//   • `touch-action: none` MOET op het sleep-vlak staan (zie mobile.css
//     .m-sheet__drag). Zonder dat pakt iOS de verticale beweging zelf als
//     pagina-scroll en krijgt de handler na de eerste paar px niets meer.
//   • omhoog slepen mag de sheet niet laten groeien: dat zou een tweede,
//     halfbakken "expand"-gebaar suggereren. Omhoog is rubber (gedeeld door 4),
//     omlaag volgt 1:1.
const DEFAULT_THRESHOLD = 96          // px — daaronder veert hij terug
const FLICK_MIN_PX = 36               // een korte, snelle veeg sluit ook
const FLICK_MIN_SPEED = 0.5           // px/ms

export function useSheetDrag({ onClose, threshold = DEFAULT_THRESHOLD, enabled = true } = {}) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef(null)

  const onPointerDown = useCallback((e) => {
    if (!enabled || !e.isPrimary) return
    start.current = { y: e.clientY, t: Date.now(), id: e.pointerId }
    setDragging(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* oudere WebKit */ }
  }, [enabled])

  const onPointerMove = useCallback((e) => {
    const s = start.current
    if (!s || e.pointerId !== s.id) return
    const d = e.clientY - s.y
    setDy(d > 0 ? d : d / 4)
  }, [])

  const finish = useCallback((e) => {
    const s = start.current
    if (!s || (e.pointerId != null && e.pointerId !== s.id)) return
    start.current = null
    setDragging(false)
    const d = e.clientY - s.y
    const speed = d / Math.max(Date.now() - s.t, 1)
    setDy(0)
    if (d > threshold || (d > FLICK_MIN_PX && speed > FLICK_MIN_SPEED)) onClose?.()
  }, [onClose, threshold])

  // De handlers zitten op één vlak; `dragStyle` gaat op de sheet zelf. Inline
  // transform is hier toegestaan: het is een data-driven dimensie, geen styling
  // (CLAUDE.md § conventies).
  //
  // `onPointerLeave` is het vangnet voor de tak waar setPointerCapture faalde:
  // zonder capture stoppen de move-events zodra je vinger het greepje verlaat,
  // en dan zou de sheet verschoven blijven staan. Mét capture vuurt leave niet,
  // dus dit kost daar niets. Zonder ingedrukte pointer valt hij op start.current
  // === null meteen terug.
  return {
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onPointerLeave: finish,
    },
    dragStyle: dy !== 0 ? { transform: `translateY(${Math.round(dy)}px)` } : undefined,
  }
}
