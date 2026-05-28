/* Linker lijst-pane voor Klantbase: filter chips + deal-rijen.
   Twee modi: 'over' (overdracht) en 'ren' (verlenging — toont add-row).
*/
import { useMemo, useState } from 'react'

const FILTERS = [
  { f: 'all',   label: 'Alles' },
  { f: 'urg',   label: 'Urgent' },
  { f: 'ready', label: 'Klaar' },
  { f: 'check', label: 'Te checken' },
  { f: 'hold',  label: 'Wacht' },
]

export default function KlantbaseListPane({
  mode, deals, selectedId, onSelect, onAddRenewal,
}) {
  const [filter, setFilter] = useState('all')
  const [addInput, setAddInput] = useState('')

  const counts = useMemo(() => {
    const c = { all: deals.length, urg: 0, ready: 0, check: 0, hold: 0 }
    deals.forEach(d => { if (c[d.filter] !== undefined) c[d.filter]++ })
    return c
  }, [deals])

  const filteredDeals = useMemo(() => {
    if (filter === 'all') return deals
    return deals.filter(d => d.filter === filter)
  }, [deals, filter])

  const urgent = filteredDeals.filter(d => d.dueUrg)
  const later = filteredDeals.filter(d => !d.dueUrg)

  return (
    <aside className="kb-list">
      <div className="kb-list-head">
        <div className="kb-list-title-row">
          <h2 className="kb-list-title">
            {mode === 'over' ? 'Klaar voor overdracht' : 'Verwachte verlengingen'}
          </h2>
          <span className="kb-list-meta">
            {deals.length} {mode === 'over' ? 'deals' : 'verlengingen'}
          </span>
        </div>
        <div className="kb-list-sub">
          {mode === 'over' ? (
            <>AI-voorstellen om <b>sales-deals</b> naar de customer base te verplaatsen — eerst alle 19 business-metrics laten controleren.</>
          ) : (
            <>Voorspellingen voor klanten waarvan de <b>pilot afloopt</b> of <b>het contract wijzigt</b> — agent stelt een nieuwe deal voor en sluit de oude.</>
          )}
        </div>
        <div className="kb-filters">
          {FILTERS.map(f => (
            <button
              key={f.f}
              type="button"
              className={`kb-chip ${filter === f.f ? 'is-active' : ''}`}
              onClick={() => setFilter(f.f)}
            >
              {f.label} <span className="kb-chip-cnt">{counts[f.f] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === 'ren' && (
        <div className="kb-add-row">
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder='Welke company een nieuwe deal? Bijv. "Westpoort Notarissen"…'
            onKeyDown={(e) => { if (e.key === 'Enter' && addInput.trim()) { onAddRenewal(addInput.trim()); setAddInput('') } }}
          />
          <button
            className="kb-btn-mini"
            onClick={() => { if (addInput.trim()) { onAddRenewal(addInput.trim()); setAddInput('') } }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v3M12 19v3M22 12h-3M5 12H2M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>
            </svg>
            Run AI
          </button>
        </div>
      )}

      <div className="kb-list-scroll">
        {urgent.length > 0 && (
          <>
            <div className="kb-list-day">
              <span>Urgent — voor maandafsluiting</span>
              <span className="urg mono">{urgent.length}</span>
            </div>
            {urgent.map(d => <DealRow key={d.id} d={d} mode={mode} selected={d.id === selectedId} onSelect={onSelect} />)}
          </>
        )}
        {later.length > 0 && (
          <>
            <div className="kb-list-day">
              <span>Komende weken</span>
              <span className="mono">{later.length}</span>
            </div>
            {later.map(d => <DealRow key={d.id} d={d} mode={mode} selected={d.id === selectedId} onSelect={onSelect} />)}
          </>
        )}
        {!filteredDeals.length && (
          <div className="kb-list-empty">Geen resultaten met dit filter.</div>
        )}
      </div>
    </aside>
  )
}

function DealRow({ d, mode, selected, onSelect }) {
  const okCount = d.fields.filter(f => f.status === 'approved' || f.status === 'edited').length
  const ratio = okCount / d.fields.length
  const pct = Math.round(ratio * 100)
  const ready = ratio >= 0.999
  const fieldsTodo = d.fields.filter(f => f.status === 'pending').length

  const priceField = d.fields.find(f => f.key === 'licentieprijs_per_gebruiker')
  const fixedField = d.fields.find(f => f.key === 'vaste_licentieprijs_maand')
  const omvField = d.fields.find(f => f.key === 'omvang_licentieperiode')
  const priceLbl = (priceField && priceField.proposed && priceField.proposed !== '—')
    ? `${priceField.proposed}/user`
    : (fixedField?.proposed || '—')
  const accLbl = omvField?.proposed || '—'

  const dueIcon = d.dueUrg ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 3"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
    </svg>
  )

  return (
    <div className={`kb-row ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(d.id)}>
      <div className={`kb-row-av kb-${d.avCls}`}>{d.avInit}</div>
      <div className="kb-row-top">
        <span className="kb-row-name">{d.company}</span>
        <span className={`kb-row-due ${d.dueUrg ? 'urg' : ''}`}>
          {dueIcon}
          {d.dueDate}
        </span>
      </div>
      <div className="kb-row-meta">
        <span className="kb-pill">{mode === 'over' ? `Deal ${d.id}` : d.oldDealName}</span>
        <span className="mono">{priceLbl} · {accLbl} acc.</span>
        {ready ? <span className="kb-pill kb-pill--ok">Klaar</span> : <span className="mono">{fieldsTodo} te checken</span>}
      </div>
      <div className="kb-row-progress">
        <span>{pct}%</span>
        <div className={`bar ${ready ? 'ok' : ''}`}><i style={{ width: `${pct}%` }} /></div>
        <span className="mono">{d.fields.length} velden</span>
      </div>
    </div>
  )
}
