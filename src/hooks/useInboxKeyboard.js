import { useEffect } from 'react'

// j/k + Pijl-omhoog/omlaag door de lijst. Skipt wanneer focus in een input,
// textarea of select staat zodat typen in de draft-editor niet onverwacht
// de selectie verspringt.
export function useInboxKeyboard({ flat, selected, setSelectedId }) {
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      // contenteditable (Postvak variant 2-composer) telt ook als typen —
      // anders navigeert j/k de lijst terwijl je een mail schrijft.
      if (['TEXTAREA','INPUT','SELECT'].includes(tag) || document.activeElement?.isContentEditable) return
      if (!selected) return
      const idx = flat.findIndex(m => m.mail_id === selected.mail_id)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = flat[Math.min(flat.length - 1, idx + 1)]
        if (next) setSelectedId(next.mail_id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = flat[Math.max(0, idx - 1)]
        if (prev) setSelectedId(prev.mail_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, selected, setSelectedId])
}
