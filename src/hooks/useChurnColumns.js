import { useState, useCallback, useRef, useEffect } from 'react'

const STORAGE_W = 'kl2-columns-widths-v1'
const STORAGE_C = 'kl2-columns-collapsed-v1'
const DEFAULTS = { id: 260, cat: 200, note: 320 } // summary = flexibele 1fr
const MIN = 110
const MAX = 640
const COLLAPSED_W = 30

/**
 * useChurnColumns — beheert kolom-breedtes (slepen) + ingeklapte kolommen
 * voor de Klantverlies v2-tabel. Persisteert in localStorage.
 *
 * Kolommen: id / cat / (summary = altijd 1fr, niet resizable) / note.
 * Resizable + collapsible: id, cat, note.
 */
export function useChurnColumns() {
  const [widths, setWidths] = useState(() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_W) || '{}') } }
    catch { return { ...DEFAULTS } }
  })
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_C) || '[]')) }
    catch { return new Set() }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_W, JSON.stringify(widths)) } catch { /* ignore */ }
  }, [widths])
  useEffect(() => {
    try { localStorage.setItem(STORAGE_C, JSON.stringify([...collapsed])) } catch { /* ignore */ }
  }, [collapsed])

  const drag = useRef(null)

  const startResize = useCallback((key, e) => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { key, startX: e.clientX, startW: widths[key] || DEFAULTS[key] }
    const onMove = (ev) => {
      if (!drag.current) return
      const dx = ev.clientX - drag.current.startX
      const w = Math.max(MIN, Math.min(MAX, drag.current.startW + dx))
      setWidths(prev => ({ ...prev, [drag.current.key]: w }))
    }
    const onUp = () => {
      drag.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [widths])

  const toggleCollapse = useCallback((key) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setWidths({ ...DEFAULTS })
    setCollapsed(new Set())
  }, [])

  const colSize = (key) => collapsed.has(key) ? `${COLLAPSED_W}px` : `${widths[key] || DEFAULTS[key]}px`
  // id / cat / summary(1fr) / note
  const gridTemplate = `${colSize('id')} ${colSize('cat')} minmax(0, 1fr) ${colSize('note')}`

  return { widths, collapsed, gridTemplate, startResize, toggleCollapse, reset }
}
