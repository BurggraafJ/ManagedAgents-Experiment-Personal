import { useEffect } from 'react'
import { keyboardInset } from '../lib/keyboardInset'

// iOS scrollt bij input-focus soms het hele window omhoog om het veld boven
// het toetsenbord te tonen. De mobiele shell is position:fixed, dus dat
// window mag nooit gescrold staan — maar na keyboard-dismiss laat iOS die
// scroll geregeld staan. Gevolg: de fixed tabbar "zweeft" boven de
// home-indicator met een losse witte balk eronder (heel de layout is dan
// verschoven). Deze guard zet het window terug op 0 zodra het toetsenbord
// dicht is en er geen veld meer focus heeft.
export function useMobileViewportGuard(enabled) {
  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    const isEditing = () => {
      const el = document.activeElement
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    }
    const fix = () => {
      if (keyboardInset(vv) > 0 || isEditing()) return
      if (window.scrollY > 0 || (vv && vv.offsetTop > 0)) window.scrollTo(0, 0)
    }
    vv?.addEventListener('resize', fix)
    vv?.addEventListener('scroll', fix)
    window.addEventListener('scroll', fix, { passive: true })
    window.addEventListener('focusout', fix)
    return () => {
      vv?.removeEventListener('resize', fix)
      vv?.removeEventListener('scroll', fix)
      window.removeEventListener('scroll', fix)
      window.removeEventListener('focusout', fix)
    }
  }, [enabled])
}
