import { useCallback, useEffect, useState } from 'react'

// Splitter-breedte tussen mail-lijst en detail-pane. Persisted in localStorage,
// range 280-560 (leesbare lijst + ruim detail-veld). Publiceert de waarde als
// CSS-var `--mcm-list-width` zodat Maestro-styling de lijst-breedte kan lezen.
const MIN = 280
const MAX = 560
const DEFAULT = 380

export function useInboxListWidth() {
  const [listWidth, setListWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('mc-list-width')
      const n = saved ? Number(saved) : DEFAULT
      return Number.isFinite(n) ? Math.max(MIN, Math.min(MAX, n)) : DEFAULT
    } catch { return DEFAULT }
  })

  useEffect(() => {
    try { localStorage.setItem('mc-list-width', String(listWidth)) } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--mcm-list-width', `${listWidth}px`)
    }
  }, [listWidth])

  const startDrag = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    let startW = 0
    setListWidth(w => { startW = w; return w })
    function onMove(ev) {
      const dx = ev.clientX - startX
      const next = Math.max(MIN, Math.min(MAX, startW + dx))
      setListWidth(next)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  return { listWidth, startDrag }
}
