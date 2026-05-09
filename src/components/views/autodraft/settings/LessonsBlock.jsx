import { useState, useMemo } from 'react'

export default function LessonsBlock({ lessons, categories, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const grouped = useMemo(() => {
    const m = new Map()
    for (const l of lessons) {
      const key = l.scope === 'category' ? (l.scope_value || 'onbekend') : l.scope
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(l)
    }
    return m
  }, [lessons])

  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Geleerde regels</span>
          <span className="va-block__count">{lessons.length}</span>
          <span className="muted va-block__hint">uit amendments · skill leest ze bij elke draft</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Geleerde regels</span>
          <span className="va-block__count">{lessons.length}</span>
          <span className="muted va-block__hint">uit amendments · skill leest ze bij elke draft</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          {lessons.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>
              Nog geen regels. Zodra je een aanpassingsvoorstel indient, distilleert de skill er regels uit
              en vraagt hij ze via "Nieuwe schrijfregel voorgesteld" aan jou.
            </div>
          ) : (
            <div className="stack stack--sm">
              {[...grouped.entries()].map(([scope, items]) => {
                const cat = categories.find(c => c.category_key === scope)
                return (
                  <div key={scope}>
                    <div className="kpi__label" style={{ marginBottom: 6 }}>
                      {cat ? cat.label : scope === 'global' ? 'Globaal' : scope}
                    </div>
                    <ul className="ad-lessons">
                      {items.map(l => (
                        <li key={l.id}>
                          <span>{l.lesson}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{l.times_applied}× toegepast</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
