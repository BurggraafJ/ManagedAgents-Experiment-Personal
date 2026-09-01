// Toetsenbord-hoogte uit de visualViewport, gedeeld door de mobiele
// sheets/composer (--m-kb). iOS rapporteert na keyboard-dismiss of bij
// PWA-start soms een visualViewport die tientallen px kleiner is dan de
// window zonder dat er een toetsenbord staat (safe-area/stale-viewport-ruis).
// Alles onder de drempel is dus géén toetsenbord en klemmen we op 0 —
// anders "zweven" composer en sheets met een losse witte strook boven de
// tabbar/home-indicator.
export const KEYBOARD_MIN_PX = 80

export function keyboardInset(vv = window.visualViewport) {
  if (!vv) return 0
  const raw = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  return raw >= KEYBOARD_MIN_PX ? raw : 0
}
