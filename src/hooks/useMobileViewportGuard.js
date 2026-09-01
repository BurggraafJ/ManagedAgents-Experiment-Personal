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
  // Scroll-lock: zolang de mobiele shell actief is krijgen html/body
  // .m-shell-lock (overflow:hidden, height:100%) — het document heeft dan
  // 0 scroll-range, dus iOS kan het window niet verschoven achterlaten.
  useEffect(() => {
    if (!enabled) return
    document.documentElement.classList.add('m-shell-lock')
    document.body.classList.add('m-shell-lock')
    return () => {
      document.documentElement.classList.remove('m-shell-lock')
      document.body.classList.remove('m-shell-lock')
    }
  }, [enabled])

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
      // window.scrollTo is op iOS een no-op als het document zelf niet
      // scrollbaar is terwijl scrollingElement wél verschoven staat.
      const se = document.scrollingElement
      if (se && se.scrollTop > 0) se.scrollTop = 0
    }
    vv?.addEventListener('resize', fix)
    vv?.addEventListener('scroll', fix)
    window.addEventListener('scroll', fix, { passive: true })
    window.addEventListener('focusout', fix)
    window.addEventListener('pageshow', fix)
    return () => {
      vv?.removeEventListener('resize', fix)
      vv?.removeEventListener('scroll', fix)
      window.removeEventListener('scroll', fix)
      window.removeEventListener('focusout', fix)
      window.removeEventListener('pageshow', fix)
    }
  }, [enabled])
}
