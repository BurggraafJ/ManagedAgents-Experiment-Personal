import { useState } from 'react'
import { SEV_LABEL, sortFindings } from '../../../lib/severity'
import FindingCard from './FindingCard'
import styles from './SecurityView.module.css'

const SEV_KEYS = ['critical', 'high', 'medium', 'low', 'info']

/**
 * FindingsList — severity-filter + lijst van findings. De container geeft
 * een al-gefilterde set door op basis van het tab; FindingsList zorgt enkel
 * voor de severity-pill-filter en het renderen van rijen.
 */
export default function FindingsList({ findings, allFindings, tab, updatingId, onUpdateStatus }) {
  const [sevFilter, setSevFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)

  const visible = sortFindings(
    sevFilter === 'all' ? findings : findings.filter(f => f.severity === sevFilter)
  )

  const availableSevs = SEV_KEYS.filter(s => allFindings.some(f => f.severity === s))

  return (
    <>
      <div className={styles.filterRow}>
        <FilterPill active={sevFilter === 'all'} onClick={() => setSevFilter('all')} label="Alle ernst" />
        {availableSevs.map(s => (
          <FilterPill
            key={s}
            active={sevFilter === s}
            onClick={() => setSevFilter(s)}
            label={SEV_LABEL[s] || s}
            severity={s}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <div className={`card ${styles.empty}`}>
          {tab === 'open'
            ? '✅ Geen open bevindingen — alles schoon'
            : 'Geen bevindingen in deze filter'}
        </div>
      ) : (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          {visible.map(f => (
            <FindingCard
              key={f.id}
              finding={f}
              expanded={expandedId === f.id}
              onToggle={(id) => setExpandedId(prev => prev === id ? null : id)}
              updatingId={updatingId}
              onUpdateStatus={onUpdateStatus}
            />
          ))}
        </div>
      )}
    </>
  )
}

function FilterPill({ active, onClick, label, severity }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.filterPill} ${active ? styles['filterPill--active'] : ''}`}
    >
      {severity && <span className={styles.filterDot} data-severity={severity} />}
      {label}
    </button>
  )
}
