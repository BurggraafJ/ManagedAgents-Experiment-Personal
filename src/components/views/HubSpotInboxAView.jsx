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
} from './hubspot-common'
import ProposalCardCompact from '../ProposalCardCompact'
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

// Daily Admin — hoofdlayout. Inbox (lijst + detail) toont ALLEEN de twee
// actieve groepen: "Meer informatie nodig" en "Goedkeuren". Alles wat
// verwerkt is (amended verstuurd / geaccepteerd / afgewezen / uitgevoerd /
// gefaald) verhuist naar het Logboek-blok onderaan, zodat het postvak
// echt leger voelt zodra je iets hebt afgehandeld.

export default function HubSpotInboxAView({ data, onRefresh, CardComponent = ProposalCardCompact }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  // Status-filter geldt nu alleen voor de 2 actieve groepen; Verwerkt staat
  // los in Logboek met eigen expand/collapse gedrag.
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true })

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])

  const inboxList = useMemo(() => {
    const out = []
    if (statusFilter.need_input) out.push(...buckets.need_input)
    if (statusFilter.to_review)  out.push(...buckets.to_review)
    return out
  }, [buckets, statusFilter])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && inboxList.length > 0) setSelectedId(inboxList[0].id)
    if (selectedId && !inboxList.find(p => p.id === selectedId)) setSelectedId(inboxList[0]?.id || null)
  }, [inboxList, selectedId])
  const selected = inboxList.find(p => p.id === selectedId) || null

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

      {/* KPI-row — vervangt de oude AgentCard-strip met klantnamen */}
      <div className="va-kpi-row">
        <KpiCard label="Open voorstellen" value={metrics.open} sub={`${metrics.needs_input} wacht op input`} tone="accent" />
        <KpiCard label="Vandaag aangemaakt" value={metrics.today_created} sub={`${metrics.today_accepted} akkoord · ${metrics.today_rejected} afgewezen`} tone="neutral" />
        <KpiCard label="Deze week" value={metrics.week_created} sub={<Trend pct={metrics.week_trend} />} tone="neutral" />
        <KpiCard label="Geaccepteerd deze week" value={metrics.week_accepted} sub="uitgevoerd + accepted" tone="success" />
        <KpiCard label="Afgewezen deze week" value={metrics.week_rejected} sub="rejected + failed" tone="danger" />
      </div>

      {/* Filters — alleen 2 status-chips (de actieve groepen) + categorie */}
      <div className="va-filters">
        {['need_input', 'to_review'].map(g => (
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

      {/* Inbox split — alleen de 2 actieve groepen */}
      <div className="va-split">
        <aside className="va-list">
          {['need_input', 'to_review'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="va-list-group">
                <div className={`va-list-group__head va-list-group__head--${GROUP_META[g].accent}`}>
                  {GROUP_META[g].label} <span>{buckets[g].length}</span>
                </div>
                {buckets[g].map(p => (
                  <ListRow key={p.id} proposal={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                ))}
              </div>
            )
          ))}
          {inboxList.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 30, fontSize: 12, textAlign: 'center' }}>
              Postvak leeg — alle voorstellen zijn verwerkt.<br />
              <span className="muted" style={{ fontSize: 10.5 }}>Zie Logboek hieronder.</span>
            </div>
          )}
        </aside>
        <main className="va-detail">
          {selected ? (
            // key forceert remount bij item-wissel, zodat lokale state
            // (feedback-tekst, mode, optimistische overrides) niet lekt
            // tussen voorstellen.
            <CardComponent key={selected.id} proposal={selected} onRefresh={onRefresh} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              {inboxList.length === 0 ? 'Geen actieve voorstellen.' : 'Selecteer een item links.'}
            </div>
          )}
        </main>
      </div>

      {/* Bottom row: Verwerkt (Logboek) + Andere contactmomenten */}
      <div className="va-bottom">
        <LogBlock proposals={buckets.processed} />
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
  const needsInfo = proposal.needs_info === true && !proposal.amended_from
  return (
    <button type="button"
      className={`va-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="va-row__top">
        <CardCategory proposal={proposal} />
        {needsInfo && <CardBadge tone="warning">input</CardBadge>}
        {isRevised && <CardBadge tone="revised">✎ herzien</CardBadge>}
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

// Logboek — toont alles in de 'processed' bucket. Gesorteerd op meest recent,
// max 25 items. Compact genoeg voor scan, met uitbreidbaar per-status filter
// als de lijst lang wordt.
function LogBlock({ proposals }) {
  const [open, setOpen] = useState(false)
  const [showStatus, setShowStatus] = useState({ amended: true, accepted: true, executed: true, rejected: true, failed: true })
  const filtered = proposals.filter(p => showStatus[p.status] !== false)
  const items = filtered.slice(0, 25)

  const counts = proposals.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc }, {})

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Logboek · Verwerkt</span>
        <span className="va-block__count">{proposals.length}</span>
        <span className="muted va-block__hint">alles wat uit je postvak is — wacht op run, geaccepteerd, afgewezen of gefaald</span>
      </button>
      {open && (
        <div className="va-block__body">
          {proposals.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks verwerkt.</div>
          ) : (
            <>
              <div className="va-log-filters">
                {[
                  ['amended',  'Wacht op run'],
                  ['accepted', 'Geaccepteerd'],
                  ['executed', 'Uitgevoerd'],
                  ['rejected', 'Afgewezen'],
                  ['failed',   'Gefaald'],
                ].map(([key, label]) => (
                  <button key={key} type="button"
                    className={`cat-filter__chip ${showStatus[key] === false ? 'is-off' : 'is-on'}`}
                    onClick={() => setShowStatus(prev => ({ ...prev, [key]: !prev[key] }))}>
                    {label} <span className="cat-filter__count" style={{ marginLeft: 6 }}>{counts[key] || 0}</span>
                  </button>
                ))}
              </div>
              <div className="va-log-list">
                {items.map(p => <LogLine key={p.id} proposal={p} />)}
                {filtered.length > items.length && (
                  <div className="muted va-log-truncated">
                    … nog {filtered.length - items.length} verborgen (meest recente 25 getoond).
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

const STATUS_LABEL = {
  amended:  'wacht op run',
  accepted: 'geaccepteerd',
  executed: 'uitgevoerd',
  rejected: 'afgewezen',
  failed:   'gefaald',
}

function LogLine({ proposal }) {
  const when = proposal.executed_at || proposal.reviewed_at || proposal.created_at
  return (
    <div className={`va-log-line va-log-line--${proposal.status}`}>
      <span className="va-log-line__status">{STATUS_LABEL[proposal.status] || proposal.status}</span>
      <span className="va-log-line__subject">{proposal.subject}</span>
      <span className="va-log-line__time">{formatDateTime(when)}</span>
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
        <span className="muted va-block__hint">records die agent heeft weggefilterd — klik + om alsnog op te pakken</span>
      </button>
      {open && (
        <div className="va-block__body">
          <FilteredSection filtered={filtered} />
        </div>
      )}
    </section>
  )
}
