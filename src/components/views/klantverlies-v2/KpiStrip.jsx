/**
 * KpiStrip — 4 KPI cards bovenaan Klantverlies v2.
 * Berekent direct uit de churns-array.
 */
const monthsNames = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function isSameMonth(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() }

export default function KpiStrip({ churns }) {
  const now = new Date()
  const thisMonth = startOfMonth(now)
  const prevMonth = new Date(thisMonth); prevMonth.setMonth(prevMonth.getMonth() - 1)
  const last30 = new Date(now); last30.setDate(last30.getDate() - 30)

  const total = churns.length
  const thisMonthChurns = churns.filter(c => c.closedate && isSameMonth(new Date(c.closedate), thisMonth))
  const prevMonthChurns = churns.filter(c => c.closedate && isSameMonth(new Date(c.closedate), prevMonth))
  const last30Churns = churns.filter(c => c.closedate && new Date(c.closedate) >= last30)

  const delta = thisMonthChurns.length - prevMonthChurns.length
  const deltaLabel = delta === 0 ? null : (delta > 0 ? `+${delta}` : `${delta}`)
  const deltaUp = delta > 0

  // Top categorie (laatste 30 dagen)
  const catCounts = new Map()
  last30Churns.forEach(c => {
    if (!c.category) return
    const k = c.category.label
    catCounts.set(k, (catCounts.get(k) || 0) + 1)
  })
  let topCat = null, topCatCount = 0
  for (const [k, v] of catCounts) {
    if (v > topCatCount) { topCat = k; topCatCount = v }
  }

  // Verloren MRR deze maand
  const mrrThisMonth = thisMonthChurns.reduce((s, c) => s + (Number(c.mrr) || 0), 0)
  const mrrFmt = mrrThisMonth > 0
    ? `€ ${mrrThisMonth.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
    : '—'

  const prevMonthLabel = monthsNames[prevMonth.getMonth()]

  return (
    <div className="kl2-kpis">
      <div className="kl2-kpi kl2-kpi--accent">
        <span className="kl2-kpi__lbl">Totaal verloren</span>
        <span className="kl2-kpi__val">{total}</span>
        <span className="kl2-kpi__sub">in deze tabel</span>
      </div>
      <div className="kl2-kpi">
        <span className="kl2-kpi__lbl">Deze maand</span>
        <span className="kl2-kpi__val">
          {thisMonthChurns.length}
          {deltaLabel && (
            <span className={`kl2-kpi__delta ${deltaUp ? 'kl2-kpi__delta--up' : 'kl2-kpi__delta--dn'}`}>
              {deltaLabel}
            </span>
          )}
        </span>
        <span className="kl2-kpi__sub">t.o.v. {prevMonthLabel} ({prevMonthChurns.length})</span>
      </div>
      <div className="kl2-kpi">
        <span className="kl2-kpi__lbl">Top-reden 30 dagen</span>
        <span className="kl2-kpi__val" style={{ fontSize: 20 }}>
          {topCat || <span style={{ color: 'var(--kl2-neutral-400)' }}>—</span>}
        </span>
        <span className="kl2-kpi__sub">
          {topCat ? `${topCatCount} van ${last30Churns.length} dossiers` : 'nog geen data'}
        </span>
      </div>
      <div className="kl2-kpi">
        <span className="kl2-kpi__lbl">Verloren MRR</span>
        <span className="kl2-kpi__val">{mrrFmt}</span>
        <span className="kl2-kpi__sub">deze maand</span>
      </div>
    </div>
  )
}
