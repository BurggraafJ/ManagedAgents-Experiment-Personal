import styles from './LinkedInView.module.css'

/**
 * LinkedInKpis — effectiviteit-grid: vandaag/week sent, al-verbonden, hit-rate,
 * accept-rate, queue, fouten. Kleurt waarschuwingen (warning/error) als de
 * targeting overlap of fouten heeft.
 */
export default function LinkedInKpis({ kpis }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Cijfers</h2>
        <span className="section__hint">
          effectiviteit: hoeveel écht-nieuwe connects versus mensen die al in je netwerk zaten
        </span>
      </div>
      <div className="grid grid--kpi">
        <KpiCell value={kpis.sentToday} label="Vandaag verstuurd" tone="accent" />
        <KpiCell value={kpis.sentWeek}  label="Deze week verstuurd" />
        <KpiCell
          value={kpis.alreadyWeek}
          label="Al verbonden (deze week)"
          tone={kpis.alreadyWeek > kpis.sentWeek ? 'warning' : null}
        />
        <KpiCell
          value={kpis.hitRate == null ? '—' : `${kpis.hitRate}%`}
          label="Hit-rate nieuw / bezocht"
          tone={kpis.hitRate != null && kpis.hitRate < 50 ? 'warning' : null}
        />
        <KpiCell value={kpis.accRate == null ? '—' : `${kpis.accRate}%`} label="Accept-rate (cumul.)" />
        <KpiCell value={kpis.queued} label="In queue" />
        <KpiCell value={kpis.alreadyAll} label="Al verbonden (totaal)" />
        <KpiCell value={kpis.failed} label="Fouten" tone={kpis.failed > 0 ? 'error' : null} />
      </div>
      {kpis.hitRate != null && kpis.hitRate < 50 && (
        <div className={`muted ${styles.warningHint}`}>
          ⚠ Minder dan de helft van de bezochte profielen is écht nieuw — de targeting overlapt sterk
          met je bestaande netwerk. Overweeg concurrenten/keywords in de strategie te verbreden of
          proefperiode-kantoren waar je al veel mensen van kent te deprioriteren.
        </div>
      )}
    </section>
  )
}

function KpiCell({ value, label, tone }) {
  const toneClass =
    tone === 'accent'  ? styles.kpiAccent  :
    tone === 'error'   ? styles.kpiError   :
    tone === 'warning' ? styles.kpiWarning : ''
  return (
    <div className="kpi">
      <div className={`kpi__value ${styles.kpiNum} ${toneClass}`}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}
