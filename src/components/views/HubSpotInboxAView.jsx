import { useMemo, useState, useEffect } from 'react'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  buildPipelineLookup,
  FilteredSection,
  formatDateTime,
} from './HubSpotView'
import ProposalCardV2 from '../ProposalCardV2'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  CardBadge,
  CardCategory,
  CardPipelineStage,
  CardOwnerAvatar,
  CardConfidence,
  computeMetrics,
} from './hubspot-shared.jsx'

// Inbox · Variant A — KPI-row bovenaan met 5 losse cijfer-kaarten, inbox
// split in het midden (smalle lijst + dominant detail-paneel met V2-card),
// en onderaan twee blokken naast elkaar: uitklapbaar Logboek links en
// Andere contactmomenten rechts. Metrics vervangen de oude AgentCard-strip.

export default function HubSpotInboxAView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true, in_progress: true, done: false })

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])
  const flatList = useMemo(() => {
    const out = []
    if (statusFilter.need_input)  out.push(...buckets.need_input)
    if (statusFilter.to_review)   out.push(...buckets.to_review)
    if (statusFilter.in_progress) out.push(...buckets.in_progress)
    if (statusFilter.done)        out.push(...buckets.done.slice(0, 15))
    return out
  }, [buckets, statusFilter])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && flatList.length > 0) setSelectedId(flatList[0].id)
    if (selectedId && !flatList.find(p => p.id === selectedId)) setSelectedId(flatList[0]?.id || null)
  }, [flatList, selectedId])
  const selected = flatList.find(p => p.id === selectedId) || null

  // Metrics voor de KPI-strip
  const metrics = useMemo(() => {
    const now = new Date()
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const weekStart = data.weekStart || (() => {
      const d = new Date(now)
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7))
      d.setHours(0, 0, 0, 0)
      return d
    })()
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86400000)
    return computeMetrics(all, todayStart, weekStart, lastWeekStart)
  }, [all, data.weekStart])

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      {/* ===== Top: 5 losse KPI-kaarten (vervangt AgentCard + customer-name-strip) ===== */}
      <div className="va-kpi-row">
        <KpiCard label="Open voorstellen" value={metrics.open} sub={`${metrics.needs_input} wacht op input`} tone="accent" />
        <KpiCard label="Vandaag aangemaakt" value={metrics.today_created} sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgewezen`} tone="neutral" />
        <KpiCard label="Deze week" value={metrics.week_created} sub={<Trend pct={metrics.week_trend} />} tone="neutral" />
        <KpiCard label="Geaccepteerd deze week" value={metrics.week_accepted} sub="uitgevoerd + accepted" tone="success" />
        <KpiCard label="Afgewezen deze week" value={metrics.week_rejected} sub="rejected + failed" tone="danger" />
      </div>

      {/* ===== Filters (gedeelde strip voor inbox-split) ===== */}
      <div className="va-filters">
        {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
          <button key={g} type="button"
            className={`cat-filter__chip ${statusFilter[g] === false ? 'is-off' : 'is-on'}`}
            onClick={() => setStatusFilter(prev => ({ ...prev, [g]: !prev[g] }))}>
            {GROUP_META[g].label}
            <span className="cat-filter__count" style={{ marginLeft: 6 }}>{buckets[g].length}</span>
          </button>
        ))}
        <span className="muted" style={{ fontSize: 11, margin: '0 6px' }}>·</span>
        {CATEGORIES.map(c => (
          <button key={c} type="button"
            className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
            onClick={() => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))}>
            <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
            <span className="cat-filter__count">{perCat[c] || 0}</span>
          </button>
        ))}
      </div>

      {/* ===== Inbox split ===== */}
      <div className="va-split">
        <aside className="va-list">
          {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="va-list-group">
                <div className={`va-list-group__head va-list-group__head--${GROUP_META[g].accent}`}>
                  {GROUP_META[g].label} <span>{buckets[g].length}</span>
                </div>
                {buckets[g].slice(0, g === 'done' ? 15 : buckets[g].length).map(p => (
                  <ListRow key={p.id} proposal={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                ))}
              </div>
            )
          ))}
          {flatList.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 20, fontSize: 11 }}>Geen items matchen.</div>
          )}
        </aside>
        <main className="va-detail">
          {selected ? (
            <ProposalCardV2 proposal={selected} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>Selecteer een item links.</div>
          )}
        </main>
      </div>

      {/* ===== Bottom row: Logboek + Andere contactmomenten (2 cols) ===== */}
      <div className="va-bottom">
        <LogBlock proposals={buckets.done} />
        <FilteredBlock filtered={data.filtered || []} />
      </div>

    </div>
    </PipelineLookupContext.Provider>
  )
}

function KpiCard({ label, value, sub, tone = 'neutral' }) {
  return (
    <div className={`va-kpi va-kpi--${tone}`}>
      <div className="va-kpi__label">{label}</div>
      <div className="va-kpi__value">{value}</div>
      <div className="va-kpi__sub">{sub || '\u00A0'}</div>
    </div>
  )
}

function Trend({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  const tone = pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat'
  return <span className={`va-trend va-trend--${tone}`}>{arrow} {pct > 0 ? '+' : ''}{pct}% vs vorige week</span>
}

function ListRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  return (
    <button type="button"
      className={`va-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="va-row__top">
        <CardCategory proposal={proposal} />
        {needsInfo && <CardBadge tone="warning">input</CardBadge>}
        {isRevised && <CardBadge tone="revised">✎</CardBadge>}
      </div>
      <div className="va-row__subject">{proposal.subject}</div>
      <div className="va-row__meta">
        <CardPipelineStage proposal={proposal} />
        <CardOwnerAvatar proposal={proposal} />
        <CardConfidence proposal={proposal} />
      </div>
      <div className="va-row__time">{formatDateTime(proposal.created_at)}</div>
    </button>
  )
}

function LogBlock({ proposals }) {
  const [open, setOpen] = useState(false)
  const items = proposals.slice(0, 20)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Logboek</span>
        <span className="va-block__count">{proposals.length}</span>
        <span className="muted va-block__hint">laatste {items.length} afgehandelde voorstellen</span>
      </button>
      {open && (
        <div className="va-block__body">
          {items.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks afgehandeld.</div>
          ) : (
            <div className="va-log-list">
              {items.map(p => <LogLine key={p.id} proposal={p} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function LogLine({ proposal }) {
  const executed = proposal.executed_at || proposal.reviewed_at || proposal.created_at
  return (
    <div className={`va-log-line va-log-line--${proposal.status}`}>
      <span className="va-log-line__status">{proposal.status}</span>
      <span className="va-log-line__subject">{proposal.subject}</span>
      <span className="va-log-line__time">{formatDateTime(executed)}</span>
    </div>
  )
}

function FilteredBlock({ filtered }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Andere contactmomenten</span>
        <span className="va-block__count">{filtered.length}</span>
        <span className="muted va-block__hint">records die agent heeft wegfilterde \u2014 klik + om alsnog op te pakken</span>
      </button>
      {open && (
        <div className="va-block__body">
          <FilteredSection filtered={filtered} />
        </div>
      )}
    </section>
  )
}
