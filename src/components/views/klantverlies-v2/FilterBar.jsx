import { useState } from 'react'

/**
 * FilterBar — collapsible categorie-filter.
 * Mockup-stijl: één-regel bar + uitklap-paneel met chip-group.
 */
export default function FilterBar({ categories, churns, activeCategoryId, onChange }) {
  const [open, setOpen] = useState(false)

  // Counts per category-id
  const countsByCat = new Map()
  churns.forEach(c => {
    const k = c.category_id || '__none__'
    countsByCat.set(k, (countsByCat.get(k) || 0) + 1)
  })

  const current = activeCategoryId === null
    ? { label: 'Alle redenen', color: null, count: churns.length }
    : (() => {
        const cat = categories.find(c => c.id === activeCategoryId)
        if (!cat) return { label: 'Onbekend', color: null, count: 0 }
        return { label: cat.label, color: cat.color, count: countsByCat.get(cat.id) || 0 }
      })()

  return (
    <div>
      <div className="kl2-filter-bar">
        <span className="kl2-filter-bar__lbl">Reden</span>
        <span className="kl2-filter-bar__current">
          {current.color && (
            <span className="kl2-filter-chip__dot" style={{ color: current.color }} />
          )}
          <span>{current.label}</span>
          <span className="kl2-filter-bar__sub">· {current.count} klant{current.count === 1 ? '' : 'en'}</span>
        </span>
        {activeCategoryId !== null && (
          <button
            type="button"
            className="kl2-filter-bar__clear"
            onClick={() => onChange(null)}
          >
            filter wissen
          </button>
        )}
        <button
          type="button"
          className={`kl2-filter-bar__toggle ${open ? 'is-open' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <span>Filter op reden</span>
          <span className="kl2-filter-bar__toggle-caret" aria-hidden>▾</span>
        </button>
      </div>

      <div className={`kl2-chip-panel ${open ? 'is-open' : ''}`}>
        <div className="kl2-chip-group">
          <button
            type="button"
            className={`kl2-filter-chip ${activeCategoryId === null ? 'is-active' : ''}`}
            onClick={() => onChange(null)}
          >
            Alle redenen <span className="kl2-filter-chip__count">{churns.length}</span>
          </button>
          {categories.map(c => {
            const n = countsByCat.get(c.id) || 0
            if (n === 0) return null
            const active = activeCategoryId === c.id
            return (
              <button
                key={c.id}
                type="button"
                className={`kl2-filter-chip ${active ? 'is-active' : ''}`}
                onClick={() => onChange(c.id)}
                style={active ? undefined : { color: c.color }}
              >
                <span className="kl2-filter-chip__dot" />
                <span style={{ color: 'var(--kl2-ink)' }}>{c.label}</span>
                <span className="kl2-filter-chip__count">{n}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
