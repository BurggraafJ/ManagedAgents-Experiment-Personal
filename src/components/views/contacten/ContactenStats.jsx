import { CONTACT_TYPES, CONTACT_TYPE_LABEL } from '../../../lib/contacten'
import styles from './ContactenView.module.css'

/**
 * ContactenStats — KPI-tegels bovenaan: totaal + per contact_type.
 */
export default function ContactenStats({ stats }) {
  if (!stats) return null
  return (
    <div className={styles.kpiStrip}>
      <KpiTile label="Totaal" value={stats.total} />
      {CONTACT_TYPES.filter(t => stats.byType[t]).map(t => (
        <KpiTile key={t} label={CONTACT_TYPE_LABEL[t]} value={stats.byType[t] || 0} />
      ))}
    </div>
  )
}

function KpiTile({ label, value }) {
  return (
    <div className={styles.kpiTile}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value.toLocaleString('nl-NL')}</div>
    </div>
  )
}
