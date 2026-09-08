import s from './zoeken.module.css'

// Vragenbak in de breedte (project 471302146): rendert het machine-leesbare
// analytics-blok uit rag-chat v4.0 — dekking-banner ("N gescand"-claim) +
// exacte resultaattabel + kosten/definitie-voetnoot. Verschijnt alleen op
// structured/sweep-routes; het semantische pad heeft geen analytics-blok.
const COL_LABELS = {
  naam: 'Naam', bewijs: 'Bewijs', citaat: 'Citaat', datum: 'Datum', confidence: 'Zekerheid',
  company_name: 'Bedrijf', dealname: 'Deal', stage_label: 'Fase', churned_at: 'Gechurnd',
  detected_at: 'Gedetecteerd', new_provider: 'Nieuwe aanbieder', churn_summary: 'Samenvatting',
  domain: 'Domein', last_mail_at: 'Laatste mail', days_silent: 'Dagen stil',
  bron: 'Bron', closedate: 'Closedate', pipeline_label: 'Pipeline', n: 'Aantal',
  amount: 'Bedrag', prijs_per_gebruiker: '€ p/gebruiker', vaste_maandprijs: '€ vast p/mnd',
  startdatum: 'Startdatum', maand_waarde: '€ p/mnd', berekening: 'Berekening', sender: 'Afzender',
}

function fmtCell(col, val) {
  if (val == null || val === '') return '—'
  if (col === 'confidence' && typeof val === 'number') return `${Math.round(val * 100)}%`
  if (/(_at|datum|closedate)$/.test(col) && typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const [y, m, d] = val.slice(0, 10).split('-')
    return `${d}-${m}-${y}`
  }
  if ((col === 'maand_waarde' || col === 'amount' || col.startsWith('prijs') || col.startsWith('vaste')) && !isNaN(Number(val))) {
    return `€${Number(val).toLocaleString('nl-NL')}`
  }
  return String(val)
}

export default function AnalyticsBlock({ analytics, isOwner = false }) {
  if (!analytics) return null
  const rows = analytics.rows || []
  const cols = (analytics.columns || []).filter(c => c !== 'mail_id')

  // v1.155 (spoor 08 I1) — de banner is opgeheven. De claim ("31 klanten
  // geteld…") ís de verantwoordingsregel en staat sinds deze versie één keer,
  // in AnswerLayers, in dezelfde vorm als op elke andere route; de badge
  // "Exacte data" noemde de route, en de route staat in Technisch. Twee keer
  // dezelfde mededeling boven en onder de tabel was de reden dat de tabel niet
  // opviel. Wat overblijft is de tabel zelf, op de volle kolombreedte.
  // De definitie verhuisde mee naar de onderregel ("definitie ▸"); alleen de
  // sweep-kosten blijven hier, en alleen voor owner — daar staat een modelnaam
  // in, en die hoort niet in de klantlaag (poort U2).
  return (
    <div className={s.anaBlock}>
      {rows.length > 0 && cols.length > 0 && (
        <div className={s.anaTableWrap}>
          <table className={s.anaTable}>
            <thead>
              <tr>
                <th>#</th>
                {cols.map(c => <th key={c}>{COL_LABELS[c] || c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={s.anaRowNum}>{i + 1}</td>
                  {cols.map(c => <td key={c} title={typeof r[c] === 'string' && r[c].length > 60 ? r[c] : undefined}>{fmtCell(c, r[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isOwner && analytics.cost?.est_usd != null && (
        <div className={s.anaFoot}>
          sweep-kosten ≈ ${analytics.cost.est_usd} ({analytics.cost.calls} {analytics.cost.model}-calls)
        </div>
      )}
    </div>
  )
}
