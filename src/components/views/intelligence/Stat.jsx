import styles from './IntelligenceView.module.css'

/**
 * Stat — compact label+value-card. Optionele kleur via inline style
 * (data-driven dimensie voor outcome-specific tinting).
 */
export default function Stat({ label, value, color }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={color ? { color } : undefined}>{value}</div>
    </div>
  )
}
