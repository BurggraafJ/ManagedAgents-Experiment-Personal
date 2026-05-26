import { useState } from 'react'

/**
 * FilterBar — generieke collapsible filter (reden óf concurrent).
 * Mockup-stijl: één-regel bar + uitklap-paneel met chip-group.
 *
 * Props:
 *  - label       korte kop links ("Reden" / "Overgestapt naar")
 *  - toggleLabel tekst op de uitklap-knop ("Filter op reden")
 *  - allLabel    chip + current-tekst voor "geen filter" ("Alle redenen")
 *  - items       [{ key, label, color, count }] — color optioneel
 *  - activeKey   geselecteerde key of null (= alles)
 *  - totalCount  totaal aantal records (voor de "alle"-chip)
 *  - onChange    (key|null) => void
 */
export default function FilterBar({ label, toggleLabel, allLabel, items, activeKey, totalCount, onChange }) {
  const [open, setOpen] = useState(false)
  const visible = items.filter(it => it.count > 0)
  const active = activeKey === null ? null : items.find(it => it.key === activeKey)

  return (
    <div>
      <div className="kl2-filter-bar">
        <span className="kl2-filter-bar__lbl">{label}</span>
        <span className="kl2-filter-bar__current">
          {active?.color && <span className="kl2-filter-chip__dot" style={{ '--cat-color': active.color }} />}
          <span>{active ? active.label : allLabel}</span>
          <span className="kl2-filter-bar__sub">
            · {active ? active.count : totalCount} klant{(active ? active.count : totalCount) === 1 ? '' : 'en'}
          </span>
        </span>
        {activeKey !== null && (
          <button type="button" className="kl2-filter-bar__clear" onClick={() => onChange(null)}>
            filter wissen
          </button>
        )}
        <button
          type="button"
          className={`kl2-filter-bar__toggle ${open ? 'is-open' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <span>{toggleLabel}</span>
          <span className="kl2-filter-bar__toggle-caret" aria-hidden>▾</span>
        </button>
      </div>

      <div className={`kl2-chip-panel ${open ? 'is-open' : ''}`}>
        <div className="kl2-chip-group">
          <button
            type="button"
            className={`kl2-filter-chip ${activeKey === null ? 'is-active' : ''}`}
            onClick={() => onChange(null)}
          >
            {allLabel} <span className="kl2-filter-chip__count">{totalCount}</span>
          </button>
          {visible.map(it => {
            const isActive = activeKey === it.key
            return (
              <button
                key={it.key}
                type="button"
                className={`kl2-filter-chip ${isActive ? 'is-active' : ''}`}
                onClick={() => onChange(it.key)}
                style={!isActive && it.color ? { '--cat-color': it.color } : undefined}
              >
                {it.color && <span className="kl2-filter-chip__dot" />}
                <span style={{ color: 'var(--kl-ink)' }}>{it.label}</span>
                <span className="kl2-filter-chip__count">{it.count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
