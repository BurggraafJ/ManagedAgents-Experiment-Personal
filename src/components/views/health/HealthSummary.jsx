import styles from './HealthView.module.css'

/**
 * HealthSummary — severity-strip met KPI-pills + actieknoppen (drempel-help,
 * ververs). Geen state; puur presentational.
 */
export default function HealthSummary({ summary, refreshing, onRefresh, onShowHelp }) {
  return (
    <div className="card admin-strip" style={{ padding: 'var(--s-5)' }}>
      <div className={styles.summaryRow}>
        <SummaryKpi tone="error"   value={summary.critical} label="agents met fouten" />
        <SummaryKpi tone="warning" value={summary.warning}  label="agents om in de gaten te houden" />
        <SummaryKpi tone="success" value={summary.ok}       label="agents gezond" />
        <SummaryKpi tone="idle"    value={summary.idle}     label="agents zonder runs (7d)" />

        <div className={styles.summaryActions}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onShowHelp}
            title="Wat betekenen de drempels?"
          >
            ? Drempels
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onRefresh}
            disabled={refreshing}
            title="Ververs nu"
          >
            {refreshing ? 'Verversen…' : 'Ververs'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SummaryKpi({ tone, value, label }) {
  return (
    <div className={styles.summaryKpi}>
      <span className={`pill s-${tone} ${styles.summaryPill}`}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  )
}
