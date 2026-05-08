import styles from './SalesOnRoadView.module.css'

/**
 * WeekKpis — viertal KPI-cellen: gesprekken deze week, totaal verwerkt,
 * controle nodig, fouten. Berekening komt van summarizeEvents in de container.
 */
export default function WeekKpis({ summary }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Deze week</h2>
        <span className="section__hint">verwerkte gesprekken</span>
      </div>
      <div className="grid grid--kpi">
        <Kpi value={summary.thisWeek}    label="Gesprekken deze week" />
        <Kpi value={summary.processed}   label="Totaal verwerkt" />
        <Kpi value={summary.needsReview} label="Controle nodig" tone="warning" />
        <Kpi value={summary.errored}     label="Fouten" tone={summary.errored > 0 ? 'error' : 'accent'} />
      </div>
    </section>
  )
}

function Kpi({ value, label, tone }) {
  const toneClass =
    tone === 'warning' ? styles.kpiWarning :
    tone === 'error'   ? styles.kpiError   :
    tone === 'accent'  ? styles.kpiAccent  : ''
  return (
    <div className="kpi">
      <div className={`kpi__value ${styles.kpiNum} ${toneClass}`}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}
