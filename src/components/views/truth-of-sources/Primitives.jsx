import styles from './TruthOfSourcesView.module.css'

/**
 * Kleine UI-primitieven die door meerdere TruthOfSources-sub-components
 * gedeeld worden. Refactor 27 (2026-05-09).
 */

export function StatRow({ label, value }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statRowLabel}>{label}</span>
      <span className={styles.statRowValue}>{value}</span>
    </div>
  )
}

export function SectionLabel({ children }) {
  return (
    <div className={`kpi__label ${styles.sectionLabel}`}>
      {children}
    </div>
  )
}
