import { TIER_LABELS, TIER_ORDER } from '../../../lib/agentHealth'
import styles from './HealthView.module.css'

/**
 * HealthFilterBar — tier-filter-pills boven de health-tabel.
 * Telt aantallen per tier en verbergt tiers zonder rijen.
 */
export default function HealthFilterBar({ rows, tierFilter, onChange }) {
  return (
    <div className="card admin-chipbar" style={{ padding: 'var(--s-4) var(--s-5)' }}>
      <div className={styles.filterRow}>
        <span className={`kpi__label ${styles.filterLabel}`}>Filter op tier:</span>
        <FilterPill
          active={tierFilter === 'all'}
          onClick={() => onChange('all')}
          label={`Alle (${rows.length})`}
        />
        {TIER_ORDER.map(t => {
          const count = rows.filter(r => r.tier === t).length
          if (count === 0) return null
          return (
            <FilterPill
              key={t}
              active={tierFilter === t}
              onClick={() => onChange(t)}
              label={`${TIER_LABELS[t] || t} (${count})`}
            />
          )
        })}
      </div>
    </div>
  )
}

function FilterPill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pill ${styles.filterPill} ${active ? `${styles['filterPill--active']} is-active` : ''}`}
    >
      {label}
    </button>
  )
}
