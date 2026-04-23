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

// Inbox · Variant B — compacte stat-ticker bovenaan (één regel met 4-5 dense
// KPIs + trend), inbox-split in midden, en onderaan ÉÉN kaart met tabs
// (Logboek / Andere contactmomenten) in plaats van twee naast elkaar —
// ruimte-efficiënt en minder visuele drukte.

export default function HubSpotInboxBView({ data }) {
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

  const [bottomTab, setBottomTab] = useState('log')

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-4)' }}>

      {/* ===== Compact stat-ticker ===== */}
      <div className="vb-ticker">
        <TickerCell label="Open" value={metrics.open} hint={`${metrics.needs_input} input · ${metrics.revised} herzien`} tone="accent" />
        <TickerCell label="Vandaag" value={metrics.today_created} hint={`${metrics.today_accepted} ok · ${metrics.today_rejected} niet`} tone="neutral" />
        <TickerCell label="Deze week" value={metrics.week_created} hint={<TrendSpan pct={metrics.week_trend} />} tone="neutral" />
        <TickerCell label="Geaccepteerd" value={metrics.week_accepted} hint="deze week" tone="success" />
        <TickerCell label="Afgewezen" value={metrics.week_rejected} hint="deze week" tone="danger" />
      </div>

      {/* ===== Filters ===== */}
      <div className="vb-filters">
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
      <div className="vb-split">
        <aside className="vb-list">
          {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="vb-list-group">
                <div className={`vb-list-group__head vb-list-group__head--${GROUP_META[g].accent}`}>
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
        <main className="vb-detail">
          {selected ? (
            <ProposalCardV2 proposal={selected} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>Selecteer een item links.</div>
          )}
        </main>
      </div>

      {/* ===== Tabbed bottom card: Logboek | Andere contactmomenten ===== */}
      <section className="vb-bottom">
        <div className="vb-bottom__tabs">
          <button type="button"
            className={`vb-bottom__tab ${bottomTab === 'log' ? 'is-active' : ''}`}
            onClick={() => setBottomTab('log')}>
            Logboek <span className="vb-bottom__tab-count">{buckets.done.length}</span>
          </button>
          <button type="button"
            className={`vb-bottom__tab ${bottomTab === 'filtered' ? 'is-active' : ''}`}
            onClick={() => setBottomTab('filtered')}>
            Andere contactmomenten <span className="vb-bottom__tab-count">{(data.filtered || []).length}</span>
          </button>
        </div>
        <div className="vb-bottom__body">
          {bottomTab === 'log' ? (
            <div className="vb-log-list">
              {buckets.done.slice(0, 25).map(p => <LogLine key={p.id} proposal={p} />)}
              {buckets.done.length === 0 && (
                <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks afgehandeld.</div>
              )}
            </div>
          ) : (
            <FilteredSection filtered={data.filtered || []} />
          )}
        </div>
      </section>

    </div>
    </PipelineLookupContext.Provider>
  )
}

function TickerCell({ label, value, hint, tone = 'neutral' }) {
  return (
    <div className={`vb-ticker__cell vb-ticker__cell--${tone}`}>
      <div className="vb-ticker__label">{label}</div>
      <div className="vb-ticker__value">{value}</div>
      <div className="vb-ticker__hint">{hint}</div>
    </div>
  )
}

function TrendSpan({ pct }) {
  if (pct == null || isNaN(pct)) return '—'
  const arrow = pct > 0 ? '↗' : pct < 0 ? '↘' : '→'
  const tone = pct > 0 ? 'trend-up' : pct < 0 ? 'trend-down' : 'trend-flat'
  return <span className={`va-trend va-trend--${tone}`}>{arrow} {pct > 0 ? '+' : ''}{pct}%</span>
}

function ListRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  return (
    <button type="button"
      className={`vb-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="vb-row__top">
        <CardCategory proposal={proposal} />
        {needsInfo && <CardBadge tone="warning">input</CardBadge>}
        {isRevised && <CardBadge tone="revised">✎</CardBadge>}
      </div>
      <div className="vb-row__subject">{proposal.subject}</div>
      <div className="vb-row__meta">
        <CardPipelineStage proposal={proposal} />
        <CardOwnerAvatar proposal={proposal} />
        <CardConfidence proposal={proposal} />
      </div>
      <div className="vb-row__time">{formatDateTime(proposal.created_at)}</div>
    </button>
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
